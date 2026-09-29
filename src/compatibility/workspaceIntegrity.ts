/**
 * Stage 5.5：Workspace Import / Storage Capacity / Data Integrity（spec 第三十七~三十九章）。
 */


import type { ApplicationSessionV2, ApplicationEvent, JobRecord } from "../workspace/types";

export interface WorkspaceExportPayload {
  kind: "application-form-assistant/workspace";
  version: 1;
  exportedAt: string;
  jobs: JobRecord[];
  sessions: ApplicationSessionV2[];
  events: ApplicationEvent[];
}

export interface ImportValidation {
  ok: boolean;
  errors: string[];
  stats?: { jobs: number; sessions: number; events: number };
}

/** Import 前置校验（spec 三十七）：只接受系统自己导出的 JSON + version check */
export function validateWorkspaceImport(payload: unknown): ImportValidation {
  const errors: string[] = [];
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, errors: ["根节点必须是对象"] };
  }
  const rec = payload as Record<string, unknown>;
  if (rec.kind !== "application-form-assistant/workspace") errors.push("kind 必须是 application-form-assistant/workspace");
  if (rec.version !== 1) errors.push("version 必须是 1");
  if (!Array.isArray(rec.jobs)) errors.push("jobs 必须是数组");
  if (!Array.isArray(rec.sessions)) errors.push("sessions 必须是数组");
  if (!Array.isArray(rec.events)) errors.push("events 必须是数组");
  if (errors.length > 0) return { ok: false, errors };
  for (const j of rec.jobs as unknown[]) {
    if (typeof j !== "object" || j === null || typeof (j as JobRecord).id !== "string") {
      errors.push("存在缺少 id 的 job 记录");
      break;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors,
    stats: {
      jobs: (rec.jobs as unknown[]).length,
      sessions: (rec.sessions as unknown[]).length,
      events: (rec.events as unknown[]).length,
    },
  };
}

/** Merge：按 id 去重合并（已有 id 保留本地版本，新增导入）；Replace：清空后导入（绝不删除 Master Profile） */
export function mergeJobRecords(local: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const byId = new Map(local.map((j) => [j.id, j]));
  for (const j of incoming) if (!byId.has(j.id)) byId.set(j.id, j);
  return Array.from(byId.values());
}

export function mergeSessions(local: ApplicationSessionV2[], incoming: ApplicationSessionV2[]): ApplicationSessionV2[] {
  const byId = new Map(local.map((s) => [s.sessionId, s]));
  for (const s of incoming) if (!byId.has(s.sessionId)) byId.set(s.sessionId, s);
  return Array.from(byId.values());
}

export function mergeEvents(local: ApplicationEvent[], incoming: ApplicationEvent[]): ApplicationEvent[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ---------- Storage Capacity（spec 三十八章） ----------

export interface StorageEstimate {
  usedBytes: number;
  quotaBytes: number;
  ratio: number;
  warning: boolean;
}

const WORKSPACE_KEYS = ["afa.jobs.v2", "afa.sessions.v2", "afa.events.v1", "afa.sessions.v1", "afa.jobs.v1", "afa.answer.cache.v1", "afa.generation.settings.v1"];

export async function estimateWorkspaceStorage(): Promise<StorageEstimate> {
  let usedBytes = 0;
  let quotaBytes = 10 * 1024 * 1024;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.getBytesInUse) {
      usedBytes = await new Promise<number>((resolve) => {
        chrome.storage.local.getBytesInUse(WORKSPACE_KEYS, (b) => resolve(b ?? 0));
      });
    }
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && est.quota < quotaBytes) quotaBytes = est.quota;
    }
  } catch {
    // 估算失败保持 0
  }
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
  return { usedBytes, quotaBytes, ratio: Number(ratio.toFixed(4)), warning: ratio > 0.7 };
}

// ---------- Data Integrity（spec 三十九章） ----------

export interface IntegrityIssue {
  code: "ORPHAN_SESSION" | "ORPHAN_EVENT" | "SESSION_JOB_MISMATCH";
  detail: string;
}

/** 启动时轻量检查：孤儿数据只输出 Warning，绝不直接删除 */
export function checkDataIntegrity(
  jobs: JobRecord[],
  sessions: ApplicationSessionV2[],
  events: ApplicationEvent[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const jobIds = new Set(jobs.map((j) => j.id));
  for (const s of sessions) {
    if (!jobIds.has(s.jobId)) {
      issues.push({ code: "ORPHAN_SESSION", detail: `Session ${s.sessionId} 引用了不存在的 Job ${s.jobId}` });
    }
    if (s.jobId !== s.jobContextId) {
      issues.push({ code: "SESSION_JOB_MISMATCH", detail: `Session ${s.sessionId} jobId 与 jobContextId 不一致` });
    }
  }
  for (const e of events) {
    if (!jobIds.has(e.jobId)) {
      issues.push({ code: "ORPHAN_EVENT", detail: `Event ${e.id} 引用了不存在的 Job ${e.jobId}` });
    }
  }
  return issues;
}
