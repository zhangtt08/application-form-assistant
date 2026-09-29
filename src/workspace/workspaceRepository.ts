import type { ApplicationEvent, ApplicationEventType, ApplicationSessionV2, SessionStatus } from "./types";
import { defaultStorage, type StorageLike } from "./jobRepository";

/**
 * Session / Event Repository（spec Stage 5 第十一/十五/十六/二十五章）：
 * - ApplicationSessionV2：afa.sessions.v2（v1 由 migration 转换）
 * - ApplicationEvent：afa.events.v1（用户 Timeline，最近 200 条；与 Debug Trace 严格分离）
 */

const SESSIONS_KEY = "afa.sessions.v2";
const SESSIONS_V1_KEY = "afa.sessions.v1";
const EVENTS_KEY = "afa.events.v1";
const MAX_SESSIONS = 20;
const MAX_EVENTS = 200;

export function setSessionStorageBackend(backend: StorageLike): void {
  storage = backend;
}

let storage: StorageLike = defaultStorage;

// ---------- Sessions ----------

interface SessionsV2Storage {
  schemaVersion: 2;
  sessions: ApplicationSessionV2[];
}

export function migrateSessionsV1toV2(
  v1: { sessions?: unknown[] } | null | undefined,
): SessionsV2Storage | null {
  if (!v1 || !Array.isArray(v1.sessions)) return null;
  const sessions: ApplicationSessionV2[] = [];
  for (const raw of v1.sessions) {
    if (typeof raw !== "object" || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.sessionId !== "string" || typeof s.jobContextId !== "string") continue;
    sessions.push({
      sessionId: s.sessionId,
      jobId: s.jobContextId,
      jobContextId: s.jobContextId,
      status: "scanned",
      createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date().toISOString(),
      sourceUrl: "",
      effectiveProfileType: (s.effectiveProfileType as ApplicationSessionV2["effectiveProfileType"]) ?? "general",
      detectedFields: 0,
      confirmedFields: 0,
      generatedAnswers: Array.isArray(s.answers) ? (s.answers as unknown[]).length : 0,
      fillPlanSummary: null,
      traceId: null,
      masterProfileUpdatedAt: null,
    });
  }
  return { schemaVersion: 2, sessions };
}

export async function migrateSessionStorage(): Promise<boolean> {
  const v2raw = await storage.get(SESSIONS_KEY);
  if (v2raw[SESSIONS_KEY]) return false;
  const v1raw = await storage.get(SESSIONS_V1_KEY);
  const migrated = migrateSessionsV1toV2(v1raw[SESSIONS_V1_KEY] as never);
  if (!migrated) return false;
  await storage.set(SESSIONS_KEY, migrated);
  return true;
}

async function loadSessions(): Promise<ApplicationSessionV2[]> {
  await migrateSessionStorage();
  const raw = await storage.get(SESSIONS_KEY);
  const rec = raw[SESSIONS_KEY] as SessionsV2Storage | undefined;
  return rec && Array.isArray(rec.sessions) ? rec.sessions : [];
}

async function saveSessions(sessions: ApplicationSessionV2[]): Promise<void> {
  await storage.set(SESSIONS_KEY, { schemaVersion: 2, sessions: sessions.slice(0, MAX_SESSIONS) });
}

export function newSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(input: {
  jobId: string;
  jobContextId: string;
  effectiveProfileType: ApplicationSessionV2["effectiveProfileType"];
  sourceUrl?: string;
  traceId?: string | null;
  masterProfileUpdatedAt?: string | null;
}): Promise<ApplicationSessionV2> {
  const now = new Date().toISOString();
  const session: ApplicationSessionV2 = {
    sessionId: newSessionId(),
    jobId: input.jobId,
    jobContextId: input.jobContextId,
    status: "created",
    createdAt: now,
    updatedAt: now,
    sourceUrl: input.sourceUrl ?? "",
    effectiveProfileType: input.effectiveProfileType,
    detectedFields: 0,
    confirmedFields: 0,
    generatedAnswers: 0,
    fillPlanSummary: null,
    traceId: input.traceId ?? null,
    masterProfileUpdatedAt: input.masterProfileUpdatedAt ?? null,
  };
  const sessions = await loadSessions();
  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

export async function updateSession(
  sessionId: string,
  patch: Partial<ApplicationSessionV2>,
): Promise<ApplicationSessionV2 | null> {
  const sessions = await loadSessions();
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) return null;
  const prev = sessions[idx];
  if (!prev) return null;
  const updated: ApplicationSessionV2 = {
    sessionId: prev.sessionId,
    jobId: prev.jobId,
    jobContextId: prev.jobContextId,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
    status: patch.status ?? prev.status,
    sourceUrl: patch.sourceUrl ?? prev.sourceUrl,
    effectiveProfileType: patch.effectiveProfileType ?? prev.effectiveProfileType,
    detectedFields: patch.detectedFields ?? prev.detectedFields,
    confirmedFields: patch.confirmedFields ?? prev.confirmedFields,
    generatedAnswers: patch.generatedAnswers ?? prev.generatedAnswers,
    fillPlanSummary: patch.fillPlanSummary ?? prev.fillPlanSummary,
    traceId: patch.traceId ?? prev.traceId,
    masterProfileUpdatedAt: patch.masterProfileUpdatedAt ?? prev.masterProfileUpdatedAt,
  };
  sessions[idx] = updated;
  await saveSessions(sessions);
  return updated;
}

export async function getSession(sessionId: string): Promise<ApplicationSessionV2 | null> {
  return (await loadSessions()).find((s) => s.sessionId === sessionId) ?? null;
}

export async function listSessionsByJob(jobId: string): Promise<ApplicationSessionV2[]> {
  return (await loadSessions()).filter((s) => s.jobId === jobId);
}

/** Session Resume（spec 十三）：该 Job 最近一个未结束 Session */
export async function getLatestOpenSession(jobId: string): Promise<ApplicationSessionV2 | null> {
  const sessions = await loadSessions();
  return (
    sessions.find(
      (s) => s.jobId === jobId && s.status !== "completed" && s.status !== "abandoned",
    ) ?? null
  );
}

export async function setSessionStatus(sessionId: string, status: SessionStatus): Promise<ApplicationSessionV2 | null> {
  return updateSession(sessionId, { status });
}

export async function deleteSessionsByJob(jobId: string): Promise<void> {
  const sessions = await loadSessions();
  await saveSessions(sessions.filter((s) => s.jobId !== jobId));
}

// ---------- Events（用户 Timeline） ----------

export function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendEvent(event: Omit<ApplicationEvent, "id">): Promise<ApplicationEvent> {
  const full: ApplicationEvent = { ...event, id: newEventId() };
  const raw = await storage.get(EVENTS_KEY);
  const list = Array.isArray(raw[EVENTS_KEY]) ? (raw[EVENTS_KEY] as ApplicationEvent[]) : [];
  list.unshift(full);
  await storage.set(EVENTS_KEY, list.slice(0, MAX_EVENTS));
  return full;
}

export async function listEventsByJob(jobId: string): Promise<ApplicationEvent[]> {
  const raw = await storage.get(EVENTS_KEY);
  const list = Array.isArray(raw[EVENTS_KEY]) ? (raw[EVENTS_KEY] as ApplicationEvent[]) : [];
  return list.filter((e) => e.jobId === jobId);
}

export async function deleteEventsByJob(jobId: string): Promise<void> {
  const raw = await storage.get(EVENTS_KEY);
  const list = Array.isArray(raw[EVENTS_KEY]) ? (raw[EVENTS_KEY] as ApplicationEvent[]) : [];
  await storage.set(EVENTS_KEY, list.filter((e) => e.jobId !== jobId));
}

/** 导出求职数据（spec 三十七）：Jobs + Sessions + Events（不含 Profile/API Key） */
export async function exportWorkspaceData(): Promise<{
  exportedAt: string;
  jobs: unknown[];
  sessions: ApplicationSessionV2[];
  events: ApplicationEvent[];
}> {
  const jobsRaw = await storage.get("afa.jobs.v2");
  const jobs = (jobsRaw["afa.jobs.v2"] as { jobs?: unknown[] } | undefined)?.jobs ?? [];
  return {
    exportedAt: new Date().toISOString(),
    jobs,
    sessions: await loadSessions(),
    events: (await storage.get(EVENTS_KEY))[EVENTS_KEY] as ApplicationEvent[] ?? [],
  };
}

/** 清空申请数据（spec 三十八）：只清 Job/Session/Event，绝不动 Master Profile */
export async function clearAllApplicationData(): Promise<void> {
  await storage.set(V2_KEY_CLEAR, { schemaVersion: 2, jobs: [], activeJobId: null, profileOverride: null });
  await storage.set(SESSIONS_KEY, { schemaVersion: 2, sessions: [] });
  await storage.set(EVENTS_KEY, []);
  // 投递页顶部关联的岗位存在旧键 afa.jobs.v1；不清它的话「清空申请数据」之后
  // 投递页还挂着刚才那个岗位，下次识别会用错岗位的方向与资料。
  await storage.set("afa.jobs.v1", { jobs: [], activeJobId: null, profileOverride: null });
}

const V2_KEY_CLEAR = "afa.jobs.v2";
export type { ApplicationEventType };


/** 供 UI 完整性检查读取全部 sessions（LoadSessions 公开包装） */
export function loadSessionsPublic(): Promise<import("./types").ApplicationSessionV2[]> {
  return loadSessions();
}
