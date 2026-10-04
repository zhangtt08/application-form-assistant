import type {
  EnsureContentScriptResult,
  RuntimeMessage,
  FillPlanPayload,
  ScanPageResult,
  FillFieldsResult,
  UndoResult,
  CaptureJobResult,
} from "../types/message";
import type { RawField, FillOutcome } from "../types/field";
import { logger } from "../utils/logger";
import {
  UNTRUSTED_SENDER,
  checkExtensionCommandSender,
  checkSenderTargetsSameTab,
  describeRejection,
  type GuardDecision,
  type SenderLike,
} from "../utils/messageGuard";

/**
 * MV3 Service Worker —— 页面侧的唯一路由器。
 *
 * 职责：
 *  1. 点击工具栏图标时打开 Side Panel
 *  2. 把 content script 注入到 tab 的**所有 frame**（http/https）
 *  3. 把 Side Panel 的扫描 / 填写 / 撤销 / 定位 / 岗位采集请求按 frame 分发并聚合结果
 *  4. 每一条 tab 指令先过来源校验（`utils/messageGuard`）：不是本扩展自己的页面 → 拒；
 *     带着别的 tab 上下文的 sender 想指挥这个 tab → 拒。拒收只留一行脱敏日志。
 *
 * 为什么必须按 frame 分发：大量招聘官网（北森系、部分自建 ATS、被嵌入的第三方问卷）
 * 把真正的申请表单放在跨域 iframe 里。主 frame 的 content script 看不见它，
 * 表现就是「页面里有表单却识别不到字段」。
 * Chrome 的消息端口本身就是按 frame 寻址的（chrome.tabs.sendMessage(..., {frameId})），
 * 所以扩展不需要、也不应该绕过浏览器的跨域数据隔离。
 *
 * 不做任何业务逻辑：匹配、取值、风险判断全部在 Side Panel；读写 DOM 全部在 content script。
 */

interface FrameInfo {
  frameId: number;
  url: string;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[AFA] setPanelBehavior failed，改用 onClicked 兜底", err));
});

// 兜底入口：setPanelBehavior 失败或内核不支持时（否则扩展装好了却没有任何入口）。
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab?.id;
  if (tabId == null) return;
  const sidePanel = chrome.sidePanel as unknown as { open?: (o: { tabId: number }) => Promise<void> };
  try {
    void sidePanel.open?.({ tabId })?.catch((err) => console.warn("[AFA] sidePanel.open failed", err));
  } catch (err) {
    console.warn("[AFA] 当前浏览器不支持 Side Panel", err);
  }
});

// SPA 路由检测：pushState/replaceState 不刷新页面，由 webNavigation 转发给 Side Panel。
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return; // 只关心主框架
  chrome.runtime
    .sendMessage({ type: "PAGE_MUTATED", url: details.url })
    .catch(() => {
      /* side panel 未打开时正常失败 */
    });
});

function isInjectableUrl(url: string): boolean {
  return /^https?:/i.test(url);
}

/**
 * 目标页面 = 当前窗口里正在看的那个 http(s) 标签页。
 *
 * 不能直接拿 active tab：Side Panel 在某些内核里自己也占一个 tab，
 * 面板一抢前台，active tab 就变成 chrome-extension:// 页面，
 * 于是「明明表单在眼前却识别不到字段」。这里显式跳过非网页标签，
 * 退回到最近一个还在浏览的网页标签。
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (active?.id != null && (!active.url || isInjectableUrl(active.url))) return active;
  const all = await chrome.tabs.query({ currentWindow: true });
  const webTab = [...all]
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .find((t) => t.url && isInjectableUrl(t.url));
  return webTab ?? active;
}

/**
 * 当前 tab 的所有 frame。
 * 用 webNavigation 而不是页面内枚举：跨域 iframe 的位置/数量只有浏览器 API 知道得最全，
 * 且没有 content script 的 frame 也需要被记录（注入失败时要有明确原因）。
 *
 * about:blank / 空 URL 的 frame 要保留：不少网申表单是先建一个 about:blank iframe
 * 再往里写文档的，把它过滤掉就等于漏掉一整张表。
 */
async function listFrames(tabId: number): Promise<FrameInfo[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames && frames.length > 0) {
      return frames
        .filter((f) => {
          const url = f.url ?? "";
          if (!url || url === "about:blank") return true;
          return isInjectableUrl(url);
        })
        .map((f) => ({ frameId: f.frameId, url: f.url ?? "" }));
    }
  } catch {
    /* API 不可用：退化为主框架 */
  }
  return [{ frameId: 0, url: "" }];
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
      injectImmediately: true,
    });
  } catch {
    // 部分 frame 注入失败（受限页面）不影响其他 frame；真正可用性由 PING 逐个确认
  }
}

async function pingFrame(tabId: number, frameId: number): Promise<boolean> {
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId })) as { ok?: boolean };
    return !!pong?.ok;
  } catch {
    return false;
  }
}

async function toContent<T>(tabId: number, frameId: number, msg: unknown): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, msg, { frameId })) as T;
  } catch {
    return null;
  }
}

async function ensureReady(): Promise<ReadyState> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "no-active-tab" };
  const url = tab.url ?? "";
  if (url && !isInjectableUrl(url)) {
    return { ok: false, error: "unsupported-url", url, detail: "仅支持 http/https 页面" };
  }
  const alive = await pingFrame(tab.id, 0);
  if (!alive) await ensureContentScript(tab.id);
  return { ok: true, url: url || undefined, tabId: tab.id };
}

/** 扫描：逐 frame 收集字段并打 frameId 标记 */
async function scanAllFrames(tabId: number): Promise<ScanPageResult> {
  const frames = await listFrames(tabId);
  const fields: RawField[] = [];
  const unreachable: number[] = [];
  let environment: ScanPageResult["environment"] | undefined;

  for (const frame of frames) {
    if (!(await pingFrame(tabId, frame.frameId))) {
      await ensureContentScript(tabId);
      if (!(await pingFrame(tabId, frame.frameId))) {
        unreachable.push(frame.frameId);
        continue;
      }
    }
    const res = await toContent<ScanPageResult>(tabId, frame.frameId, { type: "SCAN_PAGE" });
    if (!res?.ok) continue;
    for (const f of res.fields ?? []) fields.push({ ...f, frameId: frame.frameId });
    if (frame.frameId === 0) environment = res.environment;
  }

  return { ok: true, fields, environment };
}

/** 填写：按 frameId 分组下发子计划，再合并结果（每个 frame 只知道自己的 DOM） */
async function fillByFrames(tabId: number, plan: FillPlanPayload): Promise<FillFieldsResult> {
  const groups = new Map<number, FillPlanPayload["fields"]>();
  for (const item of plan.fields) {
    const frameId = item.frameId ?? 0;
    const list = groups.get(frameId) ?? [];
    list.push(item);
    groups.set(frameId, list);
  }

  const outcomes: FillOutcome[] = [];
  const originals: FillFieldsResult["originals"] = [];
  const errors: string[] = [];

  for (const [frameId, fields] of groups) {
    const res = await toContent<FillFieldsResult>(tabId, frameId, {
      type: "FILL_FIELDS",
      plan: { confirmed: plan.confirmed, fields },
    });
    if (!res?.ok) {
      errors.push(res?.error ?? `frame ${frameId} 无响应`);
      outcomes.push(...fields.map((f) => ({ reference: f.reference, frameId, status: "failed" as const, detail: "该框架未响应写入请求，请重新识别" })));
      continue;
    }
    outcomes.push(...(res.outcomes ?? []).map((o) => ({ ...o, frameId })));
    originals.push(...(res.originals ?? []).map((o) => ({ ...o, frameId })));
  }

  return {
    ok: outcomes.length > 0,
    outcomes,
    originals,
    error: errors.length > 0 ? errors.join("；") : undefined,
  };
}

async function undoByFrames(tabId: number, originals: FillFieldsResult["originals"]): Promise<UndoResult> {
  const groups = new Map<number, FillFieldsResult["originals"]>();
  for (const rec of originals) {
    const frameId = rec.frameId ?? 0;
    const list = groups.get(frameId) ?? [];
    list.push(rec);
    groups.set(frameId, list);
  }
  let restored = 0;
  let failed = 0;
  for (const [frameId, recs] of groups) {
    const res = await toContent<UndoResult>(tabId, frameId, { type: "UNDO_FILL", originals: recs });
    if (res?.ok) {
      restored += res.restored;
      failed += res.failed;
    } else {
      failed += recs.length;
    }
  }
  return { ok: true, restored, failed };
}

/** JD 采集：主框架优先，抓不到再试其他 frame（有些官网把职位详情嵌在 iframe 里） */
async function captureJob(tabId: number): Promise<CaptureJobResult> {
  const frames = await listFrames(tabId);
  const ordered = [...frames].sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0));
  for (const frame of ordered) {
    const res = await toContent<CaptureJobResult>(tabId, frame.frameId, { type: "CAPTURE_JOB" });
    if (res?.ok && res.raw) return res;
  }
  return { ok: false, error: "no-job-content" };
}

/** ensureReady 的结果形状（tab 定位 + 是否可注入） */
interface ReadyState {
  ok: boolean;
  url?: string;
  error?: string;
  detail?: string;
  tabId?: number;
}

/** Background 负责的 tab 指令；其余消息（PAGE_MUTATED 等）不由这里处理 */
const TAB_BOUND_TYPES = new Set<string>([
  "ENSURE_CONTENT_SCRIPT",
  "SCAN_TARGET",
  "FILL_TARGET",
  "UNDO_TARGET",
  "LOCATE_TARGET",
  "CAPTURE_TARGET",
]);

/**
 * 来源被拒时的回包：形状与各自的 result 类型对齐，
 * 让界面显示「这次操作失败」而不是永远等下去。不带来源细节。
 */
function rejectionFor(msg: RuntimeMessage): unknown {
  switch (msg.type) {
    case "SCAN_TARGET":
      return { ok: false, fields: [], error: UNTRUSTED_SENDER } satisfies ScanPageResult;
    case "FILL_TARGET":
      return { ok: false, outcomes: [], originals: [], error: UNTRUSTED_SENDER } satisfies FillFieldsResult;
    case "UNDO_TARGET":
      return { ok: false, restored: 0, failed: 0 } satisfies UndoResult;
    case "LOCATE_TARGET":
      return { ok: true, found: false };
    case "CAPTURE_TARGET":
      return { ok: false, error: UNTRUSTED_SENDER } satisfies CaptureJobResult;
    case "ENSURE_CONTENT_SCRIPT":
      return { ok: false, error: "inject-failed", detail: "消息来源未通过校验" } satisfies EnsureContentScriptResult;
    default:
      return { ok: false, error: "unknown-message" };
  }
}

function logRejection(type: string, decision: GuardDecision, sender: SenderLike | undefined): void {
  if (decision.ok) return;
  logger.warn(describeRejection(type, decision, sender?.url ?? sender?.origin ?? sender?.tab?.url));
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender: SenderLike, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  if (!TAB_BOUND_TYPES.has(msg.type)) return false;

  /**
   * 判据 1（来源）在分发前做一次：Side Panel 是本仓库唯一的指令来源，
   * 因此「网页上下文的 sender」在这里就被挡下（比判据 2 更严，是刻意的）。
   * 判据 2（tab 归属）要等目标 tab 定下来才能比，所以在 resolveTarget 里做：
   * 带 tab 上下文的合法来源（扩展自己的页面被开成标签页时）只能指挥它自己那个 tab。
   */
  const command = checkExtensionCommandSender(sender, chrome.runtime.id);
  if (!command.ok) {
    logRejection(msg.type, command, sender);
    sendResponse(rejectionFor(msg));
    return false;
  }

  /** 目标 tab 解析 + tab 归属校验；`{ok:false}` 时 response 已是可直接回出去的形状 */
  const resolveTarget = async (
    onNotReady: (ready: ReadyState) => unknown,
  ): Promise<{ ok: true; tabId: number } | { ok: false; response: unknown }> => {
    const ready = await ensureReady();
    if (!ready.ok || !ready.tabId) return { ok: false, response: onNotReady(ready) };
    const bound = checkSenderTargetsSameTab(sender, { tabId: ready.tabId, url: ready.url }, chrome.runtime.id);
    if (!bound.ok) {
      logRejection(msg.type, bound, sender);
      return { ok: false, response: rejectionFor(msg) };
    }
    return { ok: true, tabId: ready.tabId };
  };

  const handle = async (): Promise<unknown> => {
    switch (msg.type) {
      case "ENSURE_CONTENT_SCRIPT": {
        const ready = await ensureReady();
        return {
          ok: ready.ok,
          url: ready.url,
          error: ready.error as EnsureContentScriptResult["error"],
          detail: ready.detail,
        } satisfies EnsureContentScriptResult;
      }
      case "SCAN_TARGET": {
        const target = await resolveTarget(
          (ready) => ({ ok: false, error: ready.detail ?? ready.error ?? "无法连接页面" }) satisfies ScanPageResult,
        );
        if (!target.ok) return target.response;
        return await scanAllFrames(target.tabId);
      }
      case "FILL_TARGET": {
        const target = await resolveTarget(() => ({ ok: false, outcomes: [], originals: [], error: "无法连接页面" }) satisfies FillFieldsResult);
        if (!target.ok) return target.response;
        return await fillByFrames(target.tabId, msg.plan);
      }
      case "UNDO_TARGET": {
        const target = await resolveTarget(() => ({ ok: false, restored: 0, failed: 0 }) satisfies UndoResult);
        if (!target.ok) return target.response;
        return await undoByFrames(target.tabId, msg.originals);
      }
      case "LOCATE_TARGET": {
        const target = await resolveTarget(() => ({ ok: true, found: false }));
        if (!target.ok) return target.response;
        const res = await toContent<{ ok: boolean; found: boolean }>(target.tabId, msg.frameId ?? 0, {
          type: "LOCATE_FIELD",
          reference: msg.reference,
        });
        return res ?? { ok: true, found: false };
      }
      case "CAPTURE_TARGET": {
        const target = await resolveTarget(() => ({ ok: false, error: "无法连接页面" }) satisfies CaptureJobResult);
        if (!target.ok) return target.response;
        return await captureJob(target.tabId);
      }
      default:
        return { ok: false, error: "unknown-message" };
    }
  };

  handle()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err), outcomes: [], originals: [] }));
  return true; // 异步响应
});
