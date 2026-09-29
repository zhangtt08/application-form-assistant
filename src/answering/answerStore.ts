import type { AnswerSnapshot, ApplicationSession } from "./types";

/**
 * Application Session（spec Stage 4 第二十四~二十六章）+ Answer Cache（第二十七章）：
 * - 一次岗位申请对应一个 Session；同一 Job 允许多个 Session；保留最近 20 个
 * - Answer 只写 Session，绝不写 Master Profile
 * - Cache Key = hash(jobContextId + question + facts + promptVersion)；facts/prompt 变化即失效
 */

const SESSIONS_KEY = "afa.sessions.v1";
const CACHE_KEY = "afa.answer.cache.v1";
const MAX_SESSIONS = 20;
const MAX_CACHE = 50;

export function newSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(jobContextId: string, effectiveProfileType: string): Promise<ApplicationSession> {
  const now = new Date().toISOString();
  const session: ApplicationSession = {
    sessionId: newSessionId(),
    jobContextId,
    effectiveProfileType: effectiveProfileType as ApplicationSession["effectiveProfileType"],
    createdAt: now,
    updatedAt: now,
    answers: [],
  };
  const list = await loadSessions();
  list.unshift(session);
  await chrome.storage.local.set({ [SESSIONS_KEY]: list.slice(0, MAX_SESSIONS) });
  return session;
}

export async function loadSessions(): Promise<ApplicationSession[]> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return [];
  try {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    const raw = result[SESSIONS_KEY];
    if (Array.isArray(raw)) return raw as ApplicationSession[];
  } catch {
    // ignore
  }
  return [];
}

export async function getLatestSessionForJob(jobContextId: string): Promise<ApplicationSession | null> {
  const list = await loadSessions();
  return list.find((s) => s.jobContextId === jobContextId) ?? null;
}

export async function saveAnswerToSession(sessionId: string, snapshot: AnswerSnapshot): Promise<void> {
  const list = await loadSessions();
  const session = list.find((s) => s.sessionId === sessionId);
  if (!session) return;
  session.answers.unshift(snapshot);
  session.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [SESSIONS_KEY]: list.slice(0, MAX_SESSIONS) });
}

// ---- Answer Cache ----

/** djb2 hash（稳定、无依赖） */
export function hashKey(parts: string[]): string {
  let h = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      h = ((h << 5) + h + part.charCodeAt(i)) | 0;
    }
  }
  return (h >>> 0).toString(36);
}

export function answerCacheKey(
  jobContextId: string,
  question: string,
  factIds: string[],
  promptVersion: string,
): string {
  return hashKey([jobContextId, question, factIds.slice().sort().join("|"), promptVersion]);
}

export async function getCachedAnswer(key: string): Promise<{ answer: string; status: string } | null> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cache = (result[CACHE_KEY] ?? {}) as Record<string, { answer: string; status: string; createdAt: string }>;
    const hit = cache[key];
    return hit ? { answer: hit.answer, status: hit.status } : null;
  } catch {
    return null;
  }
}

export async function putCachedAnswer(key: string, answer: string, status: string): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cache = (result[CACHE_KEY] ?? {}) as Record<string, { answer: string; status: string; createdAt: string }>;
    const entries = Object.entries(cache);
    if (entries.length >= MAX_CACHE) {
      entries.sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
      for (const [k] of entries.slice(0, entries.length - MAX_CACHE + 1)) delete cache[k];
    }
    cache[key] = { answer, status, createdAt: new Date().toISOString() };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch {
    // ignore
  }
}
