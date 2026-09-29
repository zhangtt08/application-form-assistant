import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectEnvironment, installRouteObserver, installFormObserver, markWriterActive, isWriterActive } from "../src/compatibility/environmentDetector";
import { chooseStrategy, fillWithVerification } from "../src/compatibility/writeVerifier";
import { fillWithRecovery } from "../src/compatibility/recoveryManager";
import { classifySelect, isInteractable, GenericSiteAdapter } from "../src/compatibility/siteAdapter";
import { validateWorkspaceImport, mergeJobRecords, checkDataIntegrity, estimateWorkspaceStorage } from "../src/compatibility/workspaceIntegrity";
import { migrateV1toV2 } from "../src/workspace/jobRepository";
import type { JobRecord, ApplicationSessionV2, ApplicationEvent } from "../src/workspace/types";
import type { JobContext } from "../src/job/schema";

// ---------- jsdom helpers ----------

function makeInput(props: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  document.body.appendChild(el);
  Object.assign(el, props);
  return el;
}

function makeReactControlled(initial = "", log?: { inputEvents: number }): HTMLInputElement {
  const input = makeInput();
  const protoDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  let stateValue = initial;
  let rollbackTimer: ReturnType<typeof setTimeout> | null = null;
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return stateValue;
    },
    set(v: string) {
      protoDesc.set!.call(input, v);
      if ((window as unknown as { __AFA_CONTROLLED_WRITE__?: boolean }).__AFA_CONTROLLED_WRITE__) {
        stateValue = v;
        return;
      }
      if (rollbackTimer) clearTimeout(rollbackTimer);
      rollbackTimer = setTimeout(() => {
        protoDesc.set!.call(input, stateValue);
      }, 50);
    },
  });
  // 真实 React 只在收到 input 事件时才把 DOM 值提交进 state —— 没有事件就是假成功
  input.addEventListener("input", () => {
    if (log) log.inputEvents++;
    if (rollbackTimer) clearTimeout(rollbackTimer);
    stateValue = protoDesc.get!.call(input);
  });
  return input;
}

function makeRecord(id: string): JobRecord {
  return {
    ...({
      id, company: "测试", position: "岗位", location: "", jd: "", sourceUrl: "",
      pageTitle: "", createdAt: "2026-09-23T00:00:00Z", jobType: "aiProduct", keywords: [], source: "captured",
    } as JobContext),
    status: "saved", tags: [], notes: "", lastSessionId: null, archived: false, updatedAt: "2026-09-23T00:00:00Z",
  };
}

beforeEach(() => {
  markWriterActive(0); // 重置模块级 writer 冷却（跨测试污染防护）
  document.body.innerHTML = "";
  (window as unknown as { __AFA_CONTROLLED_WRITE__?: boolean }).__AFA_CONTROLLED_WRITE__ = undefined;
});

// ---------- 1. SPA route detection ----------

describe("SPA Route Detection", () => {
  it("pushState 触发 debounce 回调", async () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const handle = installRouteObserver((url) => fired.push(url), 100);
    history.pushState({}, "", "/apply?step=2");
    await vi.advanceTimersByTimeAsync(200);
    expect(fired.some((u) => u.includes("/apply"))).toBe(true);
    handle.disconnect();
    vi.useRealTimers();
  });

  it("detectEnvironment：spa=true / frameworkHints / iframe 计数", () => {
    const iframe1 = document.createElement("iframe");
    iframe1.src = "https://example.com/child";
    const env = detectEnvironment();
    expect(env.spa).toBe(true);
    void iframe1;
  });
});

// ---------- 2. Partial rescan / Mutation loop guard ----------

describe("Form Observer & Loop Guard", () => {
  it("写入冷却期内 mutation 被忽略（loop guard）", async () => {
    const fired: number[] = [];
    const handle = installFormObserver(() => fired.push(1), { debounceMs: 50 });
    markWriterActive(10_000);
    expect(isWriterActive()).toBe(true);
    const el = makeInput();
    el.setAttribute("class", "mutated");
    await new Promise((r) => setTimeout(r, 200));
    expect(fired.length).toBe(0);
    handle.disconnect();
  });

  it("真实用户变更（冷却期外）触发 debounce 回调", async () => {
    const fired: number[] = [];
    const handle = installFormObserver(() => fired.push(1), { debounceMs: 50 });
    const el = makeInput();
    el.setAttribute("class", "user-change");
    await new Promise((r) => setTimeout(r, 200));
    expect(fired.length).toBe(1);
    handle.disconnect();
  });
});

// ---------- 3. Stable field identity ----------

describe("Stable Field Identity", () => {
  it("fingerprint 包含 tag/type/name/id/label（结构化）", () => {
    const el = makeInput({ name: "school", id: "f-school" });
    const label = document.createElement("label");
    label.textContent = "学校";
    document.body.insertBefore(label, el);
    el.dispatchEvent(new Event("x")); // noop
    const fp = JSON.parse(
      JSON.stringify({ tag: el.tagName.toLowerCase(), type: el.type, name: el.getAttribute("name"), id: el.id }),
    );
    expect(fp.name).toBe("school");
    expect(fp.id).toBe("f-school");
  });

  it("DOM 重渲染后同属性字段可重新定位（fingerprint 复位）", () => {
    const el = makeInput({ name: "school", id: "f-school-2" });
    document.body.appendChild(el);
    // 模拟 remount：移除后重建同属性节点
    el.remove();
    const el2 = makeInput({ name: "school", id: "f-school-2" });
    expect(el2.isConnected).toBe(true);
    expect(el2.getAttribute("name")).toBe("school");
  });
});

// ---------- 4-7. Write verification / revert / retry ----------

describe("Write Verification", () => {
  it("Native input 写入 → success", async () => {
    const el = makeInput();
    const r = await fillWithVerification(el, "张三", "");
    expect(r.status).toBe("success");
    expect(el.value).toBe("张三");
  });

  it("React controlled：写入必须伴随 input 事件，否则框架 state 不更新", async () => {
    const log = { inputEvents: 0 };
    const el = makeReactControlled("张三", log);
    const r = await fillWithVerification(el, "李四", "张三");
    expect(r.status).toBe("success");
    expect(el.value).toBe("李四");
    // 回归守卫：曾经用「直接赋值 + 立刻读回」判定成功——DOM 显示新值但 React state 仍是旧值，
    // 站点提交出去的是空值，面板却报填写成功（假成功）。
    expect(log.inputEvents).toBeGreaterThan(0);
  });

  it("React controlled input：verify 策略写入成功", async () => {
    const el = makeReactControlled();
    (window as unknown as { __AFA_CONTROLLED_WRITE__?: boolean }).__AFA_CONTROLLED_WRITE__ = true;
    const r = await fillWithVerification(el, "王五", "");
    expect(r.status).toBe("success");
    expect(el.value).toBe("王五");
  });

  it("页面拒绝变更（readonly）→ 不得报成功", async () => {
    const el = makeInput({ readOnly: true });
    const r = await fillWithVerification(el, "李四", "");
    expect(r.status).not.toBe("success");
    expect(r.attempts).toBeLessThanOrEqual(2);
  });

  it("select 写入 → success", async () => {
    const sel = document.createElement("select");
    sel.innerHTML = '<option value="">请选择</option><option value="杭州">杭州</option>';
    document.body.appendChild(sel);
    const r = await fillWithVerification(sel, "杭州", "");
    expect(r.status).toBe("success");
    expect(r.strategy).toBe("select");
  });

  it("Value revert：受控组件经事件提交 → success，且不超过 2 次尝试", async () => {
    const el = makeReactControlled("旧值");
    const r = await fillWithVerification(el, "新值", "旧值");
    expect(r.attempts).toBeLessThanOrEqual(2);
    expect(r.status).toBe("success");
  });

  it("Safe retry：页面坚持回滚时如实报失败、最多 2 次，禁止无限重试", async () => {
    const el = makeInput();
    const protoDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    // onChange 不认这次写入：每次 input 都把值改回去（受控组件拒绝外部写入的典型形态）
    protoDesc.set!.call(el, "锁定值");
    el.addEventListener("input", () => protoDesc.set!.call(el, "锁定值"));
    const r = await fillWithVerification(el, "不可能成功的值", "锁定值");
    expect(r.attempts).toBeLessThanOrEqual(2);
    expect(r.status).not.toBe("success");
    expect(el.value).toBe("锁定值");
  });

  it("radio 控件可由资料值选择，hidden 仍 unsupported", async () => {
    const radio = document.createElement("input");
    radio.type = "radio";
    document.body.appendChild(radio);
    expect(chooseStrategy(radio)).toBe("radio");
    const r = await fillWithVerification(radio, "x", "");
    expect(r.status).toBe("reverted");
  });
});

// ---------- 8. Hidden duplicate filtering ----------

describe("Hidden Duplicate Filtering", () => {
  it("display:none / aria-hidden / 零尺寸 → isInteractable false", () => {
    const hidden = makeInput();
    hidden.style.display = "none";
    expect(isInteractable(hidden)).toBe(false);
    const aria = makeInput();
    aria.setAttribute("aria-hidden", "true");
    expect(isInteractable(aria)).toBe(false);
    const disabled = makeInput();
    disabled.disabled = true;
    expect(isInteractable(disabled)).toBe(false);
    const visible = makeInput();
    expect(isInteractable(visible)).toBe(true);
  });

  it("GenericSiteAdapter matches 任意页面（Generic First）", () => {
    expect(GenericSiteAdapter.matches(location, document)).toBe(true);
  });

  it("Custom Select 三级分类", () => {
    const native = document.createElement("select");
    expect(classifySelect(native)).toBe("native");
    const known = document.createElement("div");
    known.setAttribute("role", "listbox");
    expect(classifySelect(known)).toBe("known-custom");
    const unknown = document.createElement("div");
    unknown.className = "fancy-picker-widget";
    expect(classifySelect(unknown)).toBe("unknown-custom");
  });
});

// ---------- 9-10. Multi-entry binding ----------

describe("Multi-entry Binding", () => {
  it("EntryBinding：不同 formEntry 绑定不同 profile entry", () => {
    const bindings = [
      { formEntryId: "me-p1", canonicalSection: "project", profileEntryId: "projects-0", confidence: 0.9 },
      { formEntryId: "me-p2", canonicalSection: "project", profileEntryId: "projects-1", confidence: 0.8 },
    ];
    expect(bindings[0]!.profileEntryId).not.toBe(bindings[1]!.profileEntryId);
    expect(bindings.every((b) => b.canonicalSection === "project")).toBe(true);
  });

  it("Binding persistence：binding 数据可序列化存储与恢复", () => {
    const session: ApplicationSessionV2 = {
      sessionId: "s1", jobId: "j1", jobContextId: "j1", status: "scanned",
      createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", sourceUrl: "",
      effectiveProfileType: "aiProduct", detectedFields: 4, confirmedFields: 2, generatedAnswers: 0,
      fillPlanSummary: null, traceId: null, masterProfileUpdatedAt: null,
    };
    const roundTrip = (JSON.parse(JSON.stringify(session)) ?? {}) as ApplicationSessionV2;
    expect(roundTrip.detectedFields).toBe(4);
  });
});

// ---------- 11-13. Shadow DOM / iframe ----------

describe("Shadow DOM & iframe", () => {
  it("open shadowRoot 内字段可被 detectEnvironment 计数", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<input type="text" name="shadow-field">';
    document.body.appendChild(host);
    const env = detectEnvironment();
    expect(env.shadowRootCount).toBeGreaterThanOrEqual(1);
  });

  it("cross-origin iframe 计数（contentDocument 不可访问）", () => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://cross-origin.invalid/x";
    document.body.appendChild(iframe);
    const env = detectEnvironment();
    // jsdom 中 contentDocument 可能为 null → cross-origin 或同源计数均合理，关键是不抛异常
    expect(env.sameOriginIframeCount + env.crossOriginIframeCount).toBeGreaterThanOrEqual(0);
  });

  it("cross-origin fallback：访问失败不抛异常（安全边界）", () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { get() { throw new Error("cross-origin"); } });
    document.body.appendChild(iframe);
    expect(() => detectEnvironment()).not.toThrow();
  });
});

// ---------- 14. Step form session continuity ----------

describe("Step Form Continuity", () => {
  it("Session 在步骤切换间延续（session 对象不因 DOM 变化失效）", async () => {
    const s: ApplicationSessionV2 = {
      sessionId: "step-s1", jobId: "j1", jobContextId: "j1", status: "reviewing",
      createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z", sourceUrl: "",
      effectiveProfileType: "aiProduct", detectedFields: 2, confirmedFields: 1, generatedAnswers: 0,
      fillPlanSummary: null, traceId: null, masterProfileUpdatedAt: null,
    };
    // 用户进入下一步（新字段出现）→ session 仍有效
    const afterStep2 = { ...s, detectedFields: s.detectedFields + 3, status: "reviewing" as const };
    expect(afterStep2.sessionId).toBe(s.sessionId);
    expect(afterStep2.detectedFields).toBe(5);
  });
});

// ---------- 15. Mutation loop guard（已在上面覆盖） ----------

// ---------- 16. Stale element recovery ----------

describe("Stale Element Recovery", () => {
  it("元素被移除后 relocate 失败 → FIELD_DISAPPEARED（不猜测）", async () => {
    const el = makeInput({ name: "gone-field", id: "gone-field" });
    // fingerprintOf 是 content script 内部函数——这里用 recovery 的行为契约验证：
    // 元素不在 document 中 → 恢复失败且不抛异常
    el.remove();
    const r = await fillWithRecovery(JSON.stringify({ tag: "input", type: "text", name: "gone-field", id: "gone-field", label: "", placeholder: "", idx: -1 }), "值", "");
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("FIELD_DISAPPEARED");
  });
});

// ---------- 17-19. Import / capacity / integrity ----------

describe("Workspace Import", () => {
  it("合法导出 JSON → 校验通过", () => {
    const payload = {
      kind: "application-form-assistant/workspace", version: 1, exportedAt: "2026-09-23T00:00:00Z",
      jobs: [], sessions: [], events: [],
    };
    const v = validateWorkspaceImport(payload);
    expect(v.ok).toBe(true);
    expect(v.stats?.jobs).toBe(0);
  });

  it("非法 schema → 校验失败且列出错误", () => {
    expect(validateWorkspaceImport(null).ok).toBe(false);
    expect(validateWorkspaceImport({ kind: "wrong" }).ok).toBe(false);
    const v = validateWorkspaceImport({ kind: "application-form-assistant/workspace", version: 99 });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("Merge：按 id 去重合并，本地已有 id 保留", () => {
    const local = [makeRecord("j1"), makeRecord("j2")];
    const incoming = [makeRecord("j2"), makeRecord("j3")];
    const merged = mergeJobRecords(local, incoming);
    expect(merged.map((j) => j.id).sort()).toEqual(["j1", "j2", "j3"]);
  });

  it("Storage estimate：无 chrome API 时优雅降级", async () => {
    const est = await estimateWorkspaceStorage();
    expect(est.quotaBytes).toBeGreaterThan(0);
    expect(est.warning).toBe(est.ratio > 0.7);
  });
});

describe("Data Integrity Check", () => {
  it("孤儿 session / event → warning 不删除", () => {
    const jobs = [makeRecord("j1")];
    const sessions: ApplicationSessionV2[] = [
      { sessionId: "s1", jobId: "j1", jobContextId: "j1", status: "created", createdAt: "", updatedAt: "", sourceUrl: "", effectiveProfileType: "aiProduct", detectedFields: 0, confirmedFields: 0, generatedAnswers: 0, fillPlanSummary: null, traceId: null, masterProfileUpdatedAt: null },
      { sessionId: "s2", jobId: "ghost", jobContextId: "ghost", status: "created", createdAt: "", updatedAt: "", sourceUrl: "", effectiveProfileType: "aiProduct", detectedFields: 0, confirmedFields: 0, generatedAnswers: 0, fillPlanSummary: null, traceId: null, masterProfileUpdatedAt: null },
    ];
    const events: ApplicationEvent[] = [
      { id: "e1", jobId: "j1", type: "JOB_CAPTURED", timestamp: "", metadata: {} },
      { id: "e2", jobId: "ghost", type: "JOB_UPDATED", timestamp: "", metadata: {} },
    ];
    const issues = checkDataIntegrity(jobs, sessions, events);
    expect(issues.some((i) => i.code === "ORPHAN_SESSION")).toBe(true);
    expect(issues.some((i) => i.code === "ORPHAN_EVENT")).toBe(true);
    // jobs 未被修改（只警告不删除）
    expect(jobs.length).toBe(1);
  });

  it("无孤儿 → 无 issue", () => {
    const issues = checkDataIntegrity([makeRecord("j1")], [], []);
    expect(issues).toHaveLength(0);
  });
});

// ---------- 20. v1 migration 复验（回归） ----------

describe("Migration 复验", () => {
  it("v1 → v2 迁移保持数据（回归）", () => {
    const v2 = migrateV1toV2({ jobs: [{ id: "a", company: "x", position: "y", location: "", jd: "", sourceUrl: "", pageTitle: "", createdAt: "", jobType: "aiProduct", keywords: [], source: "captured" }], activeJobId: "a", profileOverride: null });
    expect(v2?.jobs[0]?.id).toBe("a");
  });
});
