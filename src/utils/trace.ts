import { logger } from "./logger";

/**
 * ApplicationTrace（spec Stage 2.5 第十七~二十章）：
 * 一次网申流程（capture/scan → fill 完成）共享一个 traceId 的轻量执行轨迹。
 * 用途：接入 LLM 后快速定位错误属于哪一层（capture/parse/route/scan/resolve/plan/write）。
 *
 * 脱敏红线：metadata 禁止记录完整手机号/邮箱/身份证/个人描述；
 * 只允许 fieldType、sourceType、confidence、risk、count、success/fail 等结构化信息。
 * 本模块对 metadata 做强制白名单清洗（含敏感词的 key 直接剥除）。
 */

export type TraceStage =
  | "JOB_CAPTURE"
  | "JOB_PARSE"
  | "PROFILE_ROUTE"
  | "FORM_SCAN"
  | "FIELD_MATCH"
  | "CONTENT_RESOLVE"
  | "PREVIEW_READY"
  | "FILL_PLAN_CREATE"
  | "FIELD_WRITE"
  | "FILL_COMPLETE";

export type TraceStatus = "success" | "failed" | "info";

export interface TraceEvent {
  traceId: string;
  timestamp: string;
  /** TraceStage 或 `${stage}_FAILED` 等失败后缀 */
  stage: string;
  status: TraceStatus;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface TraceRecord {
  traceId: string;
  startedAt: string;
  events: TraceEvent[];
}

const STORAGE_KEY = "afa.trace.v1";
const MAX_EVENTS = 200;

/** metadata 白名单：只放行确定非敏感的 key（spec Stage 2.5 第十七/十九章） */
const METADATA_BLOCKLIST = /value|text|content|desc|jd|phone|mobile|email|idnumber|id_number|secret|token|name/i;

export function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (METADATA_BLOCKLIST.test(k)) continue; // 敏感 key 整个剥除，不打码（宁可少记不可泄漏）
    if (typeof v === "string" && v.length > 60) continue; // 超长字符串不进 trace
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function newTraceId(): string {
  return `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- 内存 + chrome.storage 持久化（刷新后 Dev Trace Viewer 仍可查看最近一次）----

let current: TraceRecord | null = null;

function storageAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

export function startTrace(traceId = newTraceId()): string {
  current = { traceId, startedAt: new Date().toISOString(), events: [] };
  void persist();
  return traceId;
}

export function getTraceId(): string | null {
  return current?.traceId ?? null;
}

export function currentTrace(): TraceRecord | null {
  return current;
}

/** 记录事件；chrome 环境不可用时（单测）只保留内存 */
export async function trace(
  stage: string,
  status: TraceStatus,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!current) startTrace();
  const event: TraceEvent = {
    traceId: current!.traceId,
    timestamp: new Date().toISOString(),
    stage,
    status,
    message,
    metadata: sanitizeMetadata(metadata),
  };
  current!.events.push(event);
  if (current!.events.length > MAX_EVENTS) current!.events.shift();
  if (status === "failed") {
    logger.warn(`[TRACE] ${stage} failed: ${message}`);
  }
  await persist();
}

async function persist(): Promise<void> {
  if (!storageAvailable() || !current) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: current });
  } catch {
    // 持久化失败不影响主流程（trace 是观测设施）
  }
}

export async function loadTrace(): Promise<TraceRecord | null> {
  if (!storageAvailable()) return current;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { traceId?: unknown }).traceId === "string" &&
      Array.isArray((raw as { events?: unknown }).events)
    ) {
      return raw as TraceRecord;
    }
  } catch {
    // fallthrough
  }
  return current;
}

export async function clearTrace(): Promise<void> {
  current = null;
  if (storageAvailable()) {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
