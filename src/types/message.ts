import type { FillOutcome, RawField } from "./field";
import type { RawJobPage } from "../job/schema";

/** Side Panel → Background：确保 content script 已注入当前 tab（activeTab 模式） */
export interface EnsureContentScriptMsg {
  type: "ENSURE_CONTENT_SCRIPT";
}

/** 注入结果 */
export interface EnsureContentScriptResult {
  ok: boolean;
  url?: string;
  error?: "no-active-tab" | "unsupported-url" | "inject-failed" | "ping-failed";
  detail?: string;
}

/** Side Panel → Content：扫描当前页面（只读，绝不改 DOM） */
export interface ScanPageMsg {
  type: "SCAN_PAGE";
}

export interface ScanPageResult {
  ok: boolean;
  fields?: RawField[];
  error?: string;
  /** Stage 6：页面环境摘要（Pilot 兼容性记录用） */
  environment?: {
    spa: boolean;
    frameworkHints: string[];
    sameOriginIframeCount: number;
    crossOriginIframeCount: number;
    shadowRootCount: number;
    customSelectCount: number;
  };
}

export interface FillItem {
  reference: string;
  kind: string;
  /** input/textarea/select 的目标值；checkbox/radio 用 checked */
  value?: string;
  checked?: boolean;
  /** issue-004 第三道防线：语境判定为非申请控件的项，Writer 一律拒绝执行 */
  contextEligible?: boolean;
  /** 控件所在 frame（跨域 iframe 表单）；缺省 = 主框架 */
  frameId?: number;
}

/**
 * Side Panel → Content：写入用户已确认的字段。
 * Safety Flow Reconciliation：Writer 只接受 ConfirmedFillPlan 载荷——
 * `plan.confirmed !== true` 或 `fields` 为空时 content 侧拒绝执行（第二道防线）。
 */
export interface FillPlanPayload {
  /** 必须为 true（由 buildFillPlan 生成；任何手工构造 false/缺失都会被 Writer 拒绝） */
  confirmed: boolean;
  fields: FillItem[];
}

export interface FillFieldsMsg {
  type: "FILL_FIELDS";
  plan: FillPlanPayload;
}

export interface FillFieldsResult {
  ok: boolean;
  outcomes: FillOutcome[];
  /** 供 Undo：每个被改动字段的原始值（frameId = 该控件所在框架） */
  originals: { reference: string; kind: string; previousValue: string; frameId?: number; undoTag?: string }[];
  /** Writer 门禁拒绝 / 消息处理失败时的原因 */
  error?: string;
}

/** Side Panel → Content：撤销本次填写 */
export interface UndoMsg {
  type: "UNDO_FILL";
  originals: { reference: string; kind: string; previousValue: string; frameId?: number; undoTag?: string }[];
}

export interface UndoResult {
  ok: boolean;
  restored: number;
  failed: number;
  /** 撤销失败 / 来源被拒时的原因（content 侧 catch 分支早就在带这个字段，这里把它写进契约） */
  error?: string;
}

/** Side Panel → Content：滚动定位 + 高亮（不修改） */
export interface LocateFieldMsg {
  type: "LOCATE_FIELD";
  reference: string;
}

export interface LocateFieldResult {
  ok: boolean;
  found: boolean;
  /** 定位失败 / 来源被拒时的原因 */
  error?: string;
}

export interface PingMsg {
  type: "PING";
}

export interface PingResult {
  ok: boolean;
}

/** Side Panel → Content：从当前 JD 页面提取岗位原料（只读 DOM，不做分类） */
export interface CaptureJobMsg {
  type: "CAPTURE_JOB";
}

export interface CaptureJobResult {
  ok: boolean;
  raw?: RawJobPage;
  error?: string;
}

/** Content → 广播：页面结构变化，建议重新扫描 */
export interface PageMutatedMsg {
  type: "PAGE_MUTATED";
  url: string;
}

export type SidePanelToContentMsg =
  | ScanPageMsg
  | FillFieldsMsg
  | UndoMsg
  | LocateFieldMsg
  | CaptureJobMsg;

/* ------------------------------------------------------------------ *
 * Side Panel → Background：按 frame 分发的页面操作
 * 跨域 iframe 里的表单只有那个 frame 自己的 content script 能读写，
 * 所以这些消息统一交给 Background 做 frame 路由（见 background/index.ts）。
 * ------------------------------------------------------------------ */

export interface ScanTargetMsg {
  type: "SCAN_TARGET";
}

export interface FillTargetMsg {
  type: "FILL_TARGET";
  plan: FillPlanPayload;
}

export interface UndoTargetMsg {
  type: "UNDO_TARGET";
  originals: { reference: string; kind: string; previousValue: string; frameId?: number; undoTag?: string }[];
}

export interface LocateTargetMsg {
  type: "LOCATE_TARGET";
  reference: string;
  frameId?: number;
}

export interface CaptureTargetMsg {
  type: "CAPTURE_TARGET";
}

export type SidePanelToBackgroundMsg =
  | EnsureContentScriptMsg
  | ScanTargetMsg
  | FillTargetMsg
  | UndoTargetMsg
  | LocateTargetMsg
  | CaptureTargetMsg;

export type ContentToRuntimeMsg = PageMutatedMsg;

export type RuntimeMessage = SidePanelToContentMsg | SidePanelToBackgroundMsg | PingMsg;
