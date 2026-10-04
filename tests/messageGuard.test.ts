import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNTRUSTED_SENDER,
  checkExtensionCommandSender,
  checkFrameCommandSender,
  checkRuntimeBroadcasterSender,
  checkSenderTargetsSameTab,
  describeRejection,
  extensionUrlPrefix,
  isOwnExtensionUrl,
  redactSenderUrl,
} from "../src/utils/messageGuard";

/**
 * 消息边界校验（ITEM 1）。
 *
 * 这里要证明的是**行为**，不是字符串：伪造 sender 的那条路必须走不到「写入」这一步。
 * 所以除了判据矩阵，还各自把 background / content 真的 import 进来（它们在 import 时注册
 * onMessage 监听），拿伪造与合法的 sender 去敲那个监听，断言：
 *   - 合法 → 填写真的发生（content 侧 fillFields 被调用 / background 侧 tabs.sendMessage 收到 FILL_FIELDS）
 *   - 伪造 → 填写一次都没发生，回包是失败，且日志里没有资料值、没有完整 URL
 */

const ID = "abcdefghijklmnoapppppppppppppppppp";
const PANEL = `${extensionUrlPrefix(ID)}sidepanel.html`;
const WORKER = `${extensionUrlPrefix(ID)}/`;
/** Background 发往 content 的实测地址：chrome-extension://<id>/background.js（不是根） */
const BG = `${extensionUrlPrefix(ID)}background.js`;
const PAGE = "https://careers.example.com/apply?token=supersecret";
const FOREIGN_PAGE = "https://evil.example.com/pwn";

/* ------------------------- 判据矩阵 ------------------------- */

describe("判据 1：指令必须来自本扩展自己的页面", () => {
  it("接受：Side Panel 页面（同 id + 同扩展前缀）", () => {
    expect(checkExtensionCommandSender({ id: ID, url: PANEL }, ID).ok).toBe(true);
  });

  it("接受：service worker 自己（URL 就是扩展根）", () => {
    expect(checkExtensionCommandSender({ id: ID, url: BG }, ID).ok).toBe(true);
  });

  it("拒绝：伪造的 sender.id（另一个扩展冒用我们的消息类型）", () => {
    const d = checkExtensionCommandSender({ id: "not-our-id", url: PANEL }, ID);
    expect(d).toMatchObject({ ok: false, reason: "sender_id" });
  });

  it("拒绝：id 对了但地址是网页（sender.url 不属于本扩展）", () => {
    const d = checkExtensionCommandSender({ id: ID, url: FOREIGN_PAGE }, ID);
    expect(d).toMatchObject({ ok: false, reason: "sender_url" });
  });

  it("拒绝：没有 sender / id 缺失 / 地址空串 —— 全部 fail closed", () => {
    expect(checkExtensionCommandSender(undefined, ID)).toMatchObject({ ok: false, reason: "sender_missing" });
    expect(checkExtensionCommandSender({}, ID)).toMatchObject({ ok: false, reason: "sender_id" });
    expect(checkExtensionCommandSender({ id: ID, url: "" }, ID)).toMatchObject({ ok: false, reason: "sender_url" });
    // runtimeId 拿不到时不许「因为比不了所以放行」
    expect(checkExtensionCommandSender({ id: ID, url: PANEL }, "").ok).toBe(false);
  });

  it("id 前缀相似的别的扩展不算自己（chrome-extension://<IDEV>/…）", () => {
    expect(isOwnExtensionUrl(`chrome-extension://${ID}evil/x.html`, ID)).toBe(false);
    expect(isOwnExtensionUrl(`chrome-extension://${ID}/sidepanel.html`, ID)).toBe(true);
  });
});

describe("判据 2：别的网页 tab 不许指挥这个 tab", () => {
  const target = { tabId: 7, url: PAGE };

  it("接受：Side Panel 的真实形状 —— 面板自己占一个 tab，tab.url 是本扩展页面", () => {
    // 这条形状是 delivery-flow E2E 实测出来的（不是推的）。第一版判据写成
    // 「带 tab 就必须等于目标 tab」，于是面板自己的 tab 被当成越界，五条 E2E 全红。
    // 改坏这一条 = 扩展在真实浏览器里根本填不进去。
    expect(
      checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 309061281, url: PANEL } }, target, ID).ok,
    ).toBe(true);
  });

  it("接受：service worker 直发（没有 tab 上下文）", () => {
    expect(checkSenderTargetsSameTab({ id: ID, url: BG }, target, ID).ok).toBe(true);
  });

  it("接受：网页自己请求处理它所在的那个 tab（id 与 url 都逐字相等）", () => {
    expect(checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 7, url: PAGE } }, target, ID).ok).toBe(true);
  });

  it("拒绝：另一个网页 tab 的上下文来指挥这个 tab（tab id 对不上）", () => {
    expect(
      checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 3, url: "http://other.example/" } }, target, ID),
    ).toMatchObject({ ok: false, reason: "sender_tab_mismatch" });
  });

  it("拒绝：tab id 相同但那一页已经不是目标地址", () => {
    expect(
      checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 7, url: "https://other.example.com/x" } }, target, ID),
    ).toMatchObject({ ok: false, reason: "sender_tab_mismatch" });
  });

  it("拒绝：别人的扩展页面（前缀相似）不算本扩展的 tab", () => {
    expect(
      checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 9, url: `chrome-extension://other-id/x.html` } }, target, ID),
    ).toMatchObject({ ok: false, reason: "sender_tab_mismatch" });
  });

  it("拒绝：tab 上下文没有 url 时不许当成「没法比就放行」", () => {
    expect(checkSenderTargetsSameTab({ id: ID, url: PANEL, tab: { id: 9 } }, target, ID)).toMatchObject({
      ok: false,
      reason: "sender_tab_mismatch",
    });
  });

  it("拒绝：没有 sender", () => {
    expect(checkSenderTargetsSameTab(undefined, target, ID)).toMatchObject({ ok: false, reason: "sender_missing" });
  });
});

describe("判据 3：content 只执行属于本 frame 的指令", () => {
  it("接受：Background / Side Panel（本扩展页面）", () => {
    expect(checkFrameCommandSender({ id: ID, url: BG }, ID, PAGE).ok).toBe(true);
    expect(checkFrameCommandSender({ id: ID, url: PANEL }, ID, PAGE).ok).toBe(true);
  });

  it("接受：按 frame 寻址、sender.url 就是本 frame 自己的地址", () => {
    expect(checkFrameCommandSender({ id: ID, url: PAGE, tab: { id: 7 } }, ID, PAGE).ok).toBe(true);
  });

  it("拒绝：id 伪造", () => {
    expect(checkFrameCommandSender({ id: "attacker", url: WORKER }, ID, PAGE)).toMatchObject({ ok: false, reason: "sender_id" });
  });

  it("拒绝：id 是本扩展，但地址是另一个页面的上下文", () => {
    expect(checkFrameCommandSender({ id: ID, url: FOREIGN_PAGE }, ID, PAGE)).toMatchObject({ ok: false, reason: "sender_url" });
  });
});

describe("广播来源（Side Panel 的 PAGE_MUTATED）", () => {
  it("接受本扩展 id，拒绝别的 id", () => {
    expect(checkRuntimeBroadcasterSender({ id: ID, url: PAGE }, ID).ok).toBe(true);
    expect(checkRuntimeBroadcasterSender({ id: "other", url: PAGE }, ID).ok).toBe(false);
    expect(checkRuntimeBroadcasterSender(undefined, ID).ok).toBe(false);
  });
});

/* ------------------------- 日志脱敏 ------------------------- */

describe("拒收日志只带协议+主机，不带路径与查询串", () => {
  it("redactSenderUrl 丢掉 path/query（那里常挂 token 与职位 id）", () => {
    expect(redactSenderUrl(PAGE)).toBe("https://careers.example.com");
    expect(redactSenderUrl(undefined)).toBe("<none>");
    expect(redactSenderUrl("chrome-extension://abc/sidepanel.html")).toBe("chrome-extension://abc");
    expect(redactSenderUrl("不是地址")).toBe("<none>");
    expect(redactSenderUrl("blob:https://x.example/uuid")).toBe("blob:");
  });

  it("describeRejection 里查不到原始 URL 的任何片段", () => {
    const d = checkExtensionCommandSender({ id: ID, url: PAGE }, ID);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    const line = describeRejection("FILL_TARGET", d, PAGE);
    expect(line).toContain("type=FILL_TARGET");
    expect(line).toContain("reason=sender_url");
    expect(line).not.toContain("supersecret");
    expect(line).not.toContain("/apply");
  });
});

/* ------------------------- chrome 桩 ------------------------- */

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined;

interface ChromeStubState {
  listeners: Listener[];
  tabSends: { tabId: number; frameId?: number; msg: Record<string, unknown> }[];
  runtimeSends: unknown[];
}

interface StubOptions {
  activeTabUrl?: string | null;
  activeTabId?: number;
}

/** 当前用例的桩状态：installChromeStub 会把它接到这里，dispatch/sendsOf 都读它 */
let current: ChromeStubState = { listeners: [], tabSends: [], runtimeSends: [] };

function installChromeStub(opts: StubOptions = {}): ChromeStubState {
  const state: ChromeStubState = { listeners: [], tabSends: [], runtimeSends: [] };
  const tabId = opts.activeTabId ?? 7;
  const url = opts.activeTabUrl === null ? "" : (opts.activeTabUrl ?? PAGE);

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: ID,
      getURL: (p: string) => `${extensionUrlPrefix(ID)}${p}`,
      sendMessage: (m: unknown) => {
        state.runtimeSends.push(m);
        return Promise.reject(new Error("no receiver"));
      },
      onMessage: {
        addListener: (fn: Listener) => state.listeners.push(fn),
        removeListener: () => {},
      },
      onInstalled: { addListener: () => {} },
    },
    action: { onClicked: { addListener: () => {} } },
    sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    webNavigation: {
      onHistoryStateUpdated: { addListener: () => {} },
      getAllFrames: async () => [{ frameId: 0, url }],
    },
    tabs: {
      query: async () => (url ? [{ id: tabId, url, lastAccessed: 1 }] : []),
      sendMessage: async (t: number, msg: Record<string, unknown>, o?: { frameId?: number }) => {
        state.tabSends.push({ tabId: t, frameId: o?.frameId, msg });
        if (msg.type === "PING") return { ok: true };
        if (msg.type === "FILL_FIELDS") {
          return { ok: true, outcomes: [{ reference: "f1", status: "filled" }], originals: [] };
        }
        if (msg.type === "SCAN_PAGE") return { ok: true, fields: [] };
        return { ok: true };
      },
    },
    scripting: { executeScript: async () => {} },
  };
  current = state;
  return state;
}

/** 敲一次已注册的监听，拿回它的响应（异步分支等 promise 落地） */
async function dispatch(msg: unknown, sender: unknown): Promise<{ response: unknown; keepalive: boolean }> {
  expect(current.listeners.length).toBeGreaterThan(0);
  let response: unknown = undefined;
  let resolveResponse!: (r: unknown) => void;
  const waited = new Promise((r) => (resolveResponse = r));
  let keepalive = false;
  for (const fn of current.listeners.slice()) {
    if (fn(msg, sender, (r) => {
      response = r;
      resolveResponse(r);
    }) === true) {
      keepalive = true;
    }
  }
  if (keepalive) response = await Promise.race([waited, new Promise((r) => setTimeout(() => r("timeout"), 1000))]);
  return { response, keepalive };
}

/** 只数「被真正发出去的那类指令」，别的（探活 PING）不计 */
function sendsOf(type: string): Record<string, unknown>[] {
  return current.tabSends.filter((s) => s.msg.type === type).map((s) => s.msg);
}

/** 真实 Chrome 里 Side Panel 的 sender（delivery-flow E2E 实测形状：面板自己占一个 tab） */
const PANEL_SENDER = { id: ID, url: PANEL, frameId: 0, tab: { id: 309061281, url: PANEL } };

const CONFIRMED_PLAN = {
  confirmed: true,
  fields: [{ reference: "f1", kind: "input", value: "LEAKCANARY-私密资料值" }],
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  current = { listeners: [], tabSends: [], runtimeSends: [] };
  // content script 有 __AFA_INJECTED__ 防重入标记；不清掉的话第二个用例根本不会注册监听
  delete (window as unknown as { __AFA_INJECTED__?: boolean }).__AFA_INJECTED__;
  installChromeStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------- Background 真监听 ------------------------- */

describe("Background：tab 指令的来源校验（真实 listener）", () => {
  it("合法的 Side Panel sender 下发 FILL_TARGET：照常写", async () => {
    await import("../src/background/index");
    const { response } = await dispatch({ type: "FILL_TARGET", plan: CONFIRMED_PLAN }, PANEL_SENDER);
    expect(response).toMatchObject({ ok: true });
    expect(sendsOf("FILL_FIELDS")).toHaveLength(1);
  });

  it("伪造 sender.id 的 FILL_TARGET：一次都不许写，且回包失败", async () => {
    await import("../src/background/index");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const forged = { id: "attacker-extension-id", url: "chrome-extension://attacker-extension-id/sidepanel.html" };
    const { response } = await dispatch({ type: "FILL_TARGET", plan: CONFIRMED_PLAN }, forged);
    // 连探活 PING 都没发出去 —— 这条路在执行任何东西之前就停了
    expect(current.tabSends).toHaveLength(0);
    expect(response).toMatchObject({ ok: false, outcomes: [], originals: [], error: UNTRUSTED_SENDER });
    const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("reason=sender_id");
    expect(line).not.toContain("LEAKCANARY");
    expect(line).not.toContain("supersecret");
  });

  it("网页地址的 sender（同 id 也不行）：拒绝", async () => {
    await import("../src/background/index");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await dispatch({ type: "SCAN_TARGET" }, { id: ID, url: FOREIGN_PAGE });
    expect(current.tabSends).toHaveLength(0);
  });

  it("tab 上下文里的 sender 指挥别的 tab：拒绝（判据 2）", async () => {
    await import("../src/background/index");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { response } = await dispatch(
      { type: "FILL_TARGET", plan: CONFIRMED_PLAN },
      { id: ID, url: PANEL, tab: { id: 99, url: FOREIGN_PAGE } },
    );
    expect(sendsOf("FILL_FIELDS")).toHaveLength(0);
    expect(response).toMatchObject({ ok: false, error: UNTRUSTED_SENDER });
  });

  it("带着 tab 的合法来源，且那个 tab 就是操作目标：允许（判据 2 的接受侧）", async () => {
    await import("../src/background/index");
    await dispatch({ type: "SCAN_TARGET" }, { id: ID, url: PANEL, tab: { id: 7, url: PAGE } });
    expect(sendsOf("SCAN_PAGE")).toHaveLength(1);
  });

  it("网页上下文的 sender 想指挥路由器：判据 1 就挡下（比判据 2 更严，且是刻意的）", async () => {
    await import("../src/background/index");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { response } = await dispatch(
      { type: "SCAN_TARGET" },
      { id: ID, url: PAGE, tab: { id: 7, url: PAGE } },
    );
    expect(current.tabSends).toHaveLength(0);
    expect(response).toMatchObject({ ok: false, error: UNTRUSTED_SENDER });
  });

  it("非 tab 指令（PAGE_MUTATED）不由 Background 处理，也不误回包", async () => {
    await import("../src/background/index");
    const { keepalive, response } = await dispatch({ type: "PAGE_MUTATED", url: PAGE }, { id: ID, url: PAGE });
    expect(keepalive).toBe(false);
    expect(response).toBeUndefined();
  });

  it("未知类型不处理；没有可用网页标签时按原有形状回失败", async () => {
    installChromeStub({ activeTabUrl: null });
    await import("../src/background/index");
    const unknown = await dispatch({ type: "NOT_A_COMMAND" }, PANEL_SENDER);
    expect(unknown.keepalive).toBe(false);
    const { response } = await dispatch({ type: "FILL_TARGET", plan: CONFIRMED_PLAN }, PANEL_SENDER);
    expect(response).toMatchObject({ ok: false, error: "无法连接页面" });
  });
});

/* ------------------------- Content 真监听 ------------------------- */

vi.mock("../src/content/filler", () => ({
  fillFields: vi.fn(async () => ({ outcomes: [{ reference: "f1", status: "filled" }], originals: [] })),
  locateField: vi.fn(() => true),
  undoFill: vi.fn(async () => ({ restored: 1, failed: 0 })),
}));

vi.mock("../src/content/scanner", () => ({
  scanPageSettled: vi.fn(async () => []),
}));

describe("Content：写入侧的来源校验（真实 listener）", () => {
  it("Background（本扩展 worker）下发的 FILL_FIELDS：照常写", async () => {
    await import("../src/content/index");
    const filler = await import("../src/content/filler");
    const { response } = await dispatch({ type: "FILL_FIELDS", plan: CONFIRMED_PLAN }, { id: ID, url: BG });
    expect(filler.fillFields).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ ok: true });
  });

  it("伪造 sender.id 的 FILL_FIELDS：filler 一次都不被调用", async () => {
    await import("../src/content/index");
    const filler = await import("../src/content/filler");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { response } = await dispatch(
      { type: "FILL_FIELDS", plan: CONFIRMED_PLAN },
      { id: "attacker-extension-id", url: WORKER },
    );
    expect(filler.fillFields).toHaveBeenCalledTimes(0);
    expect(response).toMatchObject({ ok: false, outcomes: [], originals: [], error: UNTRUSTED_SENDER });
    const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("reason=sender_id");
    expect(line).not.toContain("LEAKCANARY");
  });

  it("id 对、但 sender 是另一个页面的地址：拒绝写入（判据 3）", async () => {
    await import("../src/content/index");
    const filler = await import("../src/content/filler");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { response } = await dispatch(
      { type: "FILL_FIELDS", plan: CONFIRMED_PLAN },
      { id: ID, url: FOREIGN_PAGE, tab: { id: 42, url: FOREIGN_PAGE } },
    );
    expect(filler.fillFields).toHaveBeenCalledTimes(0);
    expect(response).toMatchObject({ ok: false, error: UNTRUSTED_SENDER });
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("reason=sender_url");
  });

  it("按 frame 寻址、sender.url 就是本 frame 自己：允许", async () => {
    await import("../src/content/index");
    const filler = await import("../src/content/filler");
    await dispatch({ type: "UNDO_FILL", originals: [] }, { id: ID, url: document.URL, tab: { id: 7 } });
    expect(filler.undoFill).toHaveBeenCalledTimes(1);
  });

  it("SCAN_PAGE 走同一道闸：伪造来源时扫描器一次都不跑", async () => {
    await import("../src/content/index");
    const scanner = await import("../src/content/scanner");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await dispatch({ type: "SCAN_PAGE" }, { id: "attacker-extension-id", url: WORKER });
    expect(scanner.scanPageSettled).toHaveBeenCalledTimes(0);
  });

  it("未知消息类型：不回包也不执行（与改动前一致）", async () => {
    await import("../src/content/index");
    const { keepalive, response } = await dispatch({ type: "SOMETHING_ELSE" }, { id: ID, url: BG });
    expect(keepalive).toBe(false);
    expect(response).toBeUndefined();
  });
});
