import type { JobContext } from "./schema";
import { parseJobContext } from "./schema";
import type { ProfileType } from "./profileTypes";

/**
 * 岗位存储：chrome.storage.local 持久化。
 * - jobs：最近 20 条捕获/手动岗位（新在前，避免无限增长）
 * - activeJobId：当前申请岗位（跨域名/标签页保留 —— 网申页常与 JD 页不同域）
 * - profileOverride：用户手动切换的填写版本（spec Stage 2 第三章）；
 *   只影响 effectiveProfileType，绝不篡改 JobContext.jobType；切换岗位时重置。
 */

const STORAGE_KEY = "afa.jobs.v1";
const MAX_JOBS = 20;

interface JobStorage {
  jobs: JobContext[];
  activeJobId: string | null;
  profileOverride: ProfileType | null;
}

const EMPTY: JobStorage = { jobs: [], activeJobId: null, profileOverride: null };

async function load(): Promise<JobStorage> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (!raw) return { ...EMPTY };
  const parsed = parseJobStorage(raw);
  return parsed ?? { ...EMPTY };
}

function parseJobStorage(raw: unknown): JobStorage | null {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { jobs?: unknown }).jobs)) {
    return null;
  }
  const rec = raw as { jobs: unknown[]; activeJobId?: unknown; profileOverride?: unknown };
  const jobs: JobContext[] = [];
  for (const item of rec.jobs) {
    const parsed = parseJobContext(item);
    if (parsed.ok) jobs.push(parsed.job);
  }
  const activeJobId = typeof rec.activeJobId === "string" ? rec.activeJobId : null;
  const profileOverride =
    typeof rec.profileOverride === "string" ? (rec.profileOverride as ProfileType) : null;
  return { jobs, activeJobId, profileOverride };
}

async function save(storage: JobStorage): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
}

/** 保存岗位并设为 Active；同 URL+岗位去重（更新已有记录并置顶）；重置 override */
export async function rememberJob(job: JobContext): Promise<void> {
  const storage = await load();
  const dedupIdx = storage.jobs.findIndex(
    (j) => j.sourceUrl && j.sourceUrl === job.sourceUrl && j.position === job.position,
  );
  if (dedupIdx >= 0) storage.jobs.splice(dedupIdx, 1);
  storage.jobs.unshift(job);
  storage.jobs = storage.jobs.slice(0, MAX_JOBS);
  storage.activeJobId = job.id;
  storage.profileOverride = null; // 新岗位：填写版本回到路由结果
  await save(storage);
}

export async function setActiveJob(jobId: string): Promise<void> {
  const storage = await load();
  if (storage.jobs.some((j) => j.id === jobId)) {
    storage.activeJobId = jobId;
    storage.profileOverride = null; // 切换岗位：override 重置
    await save(storage);
  }
}

/** 手动切换填写版本（不修改 JobContext.jobType） */
export async function setProfileOverride(type: ProfileType | null): Promise<void> {
  const storage = await load();
  storage.profileOverride = type;
  await save(storage);
}

export async function getProfileOverride(): Promise<ProfileType | null> {
  return (await load()).profileOverride;
}

export async function clearActiveJob(): Promise<void> {
  const storage = await load();
  storage.activeJobId = null;
  storage.profileOverride = null;
  await save(storage);
}

/** 删除岗位；若是 Active 岗位一并清除 */
export async function deleteJob(jobId: string): Promise<void> {
  const storage = await load();
  storage.jobs = storage.jobs.filter((j) => j.id !== jobId);
  if (storage.activeJobId === jobId) storage.activeJobId = null;
  await save(storage);
}

export async function getJobHistory(): Promise<JobContext[]> {
  return (await load()).jobs;
}

export async function getActiveJob(): Promise<JobContext | null> {
  const storage = await load();
  if (!storage.activeJobId) return null;
  return storage.jobs.find((j) => j.id === storage.activeJobId) ?? null;
}

/** 订阅变化（多个 Side Panel 实例同步） */
export function subscribeJobChanges(cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && STORAGE_KEY in changes) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
