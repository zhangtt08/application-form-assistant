import type { JobContext } from "../job/schema";
import type { JobRecord, JobStatus, InboxView } from "./types";
import { INBOX_VIEW_FILTER } from "./types";

/**
 * JobRepository（spec Stage 5 第三/七/八/二十五/二十六章）：
 * JobRecord CRUD + Duplicate Detection + v1→v2 无损迁移 + Inbox 视图/搜索/归档/级联删除。
 * 保留 afa.jobs.v2 key；旧 afa.jobs.v1 启动时自动迁移，绝不丢数据。
 */

const V2_KEY = "afa.jobs.v2";
const V1_KEY = "afa.jobs.v1";
const MAX_JOBS = 50;

interface JobsV2Storage {
  schemaVersion: 2;
  jobs: JobRecord[];
  activeJobId: string | null;
  profileOverride: string | null;
}

export type StorageLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
};

/** chrome.storage 适配器（测试可注入内存实现） */
export const defaultStorage: StorageLike = {
  async get(key) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
    const res = await chrome.storage.local.get(key);
    return res as Record<string, unknown>;
  },
  async set(key, value) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
};

let storage: StorageLike = defaultStorage;
export function setJobStorageBackend(backend: StorageLike): void {
  storage = backend;
}

function toRecord(job: JobContext, now: string): JobRecord {
  return {
    ...job,
    status: "saved",
    tags: [],
    notes: "",
    lastSessionId: null,
    archived: false,
    updatedAt: job.createdAt ?? now,
  };
}

function isRecord(j: unknown): j is JobRecord {
  return typeof j === "object" && j !== null && "id" in j && "status" in j && "tags" in j;
}

/** v1 → v2 无损迁移（spec 二十六）：JobContext[] → JobRecord[]（status=saved） */
export function migrateV1toV2(
  v1: { jobs?: unknown[]; activeJobId?: unknown; profileOverride?: unknown } | null | undefined,
): JobsV2Storage | null {
  if (!v1 || !Array.isArray(v1.jobs)) return null;
  const now = new Date().toISOString();
  const jobs: JobRecord[] = [];
  for (const item of v1.jobs) {
    if (isRecord(item)) {
      jobs.push(item);
      continue;
    }
    const jc = item as Partial<JobContext>;
    if (typeof jc?.id !== "string" || !jc.id) continue;
    jobs.push(toRecord(jc as JobContext, now));
  }
  return {
    schemaVersion: 2,
    jobs,
    activeJobId: typeof v1.activeJobId === "string" ? v1.activeJobId : null,
    profileOverride: typeof v1.profileOverride === "string" ? v1.profileOverride : null,
  };
}

/** 启动迁移：读取 v1（若 v2 不存在）→ 写 v2；返回是否发生迁移 */
export async function migrateStorage(): Promise<boolean> {
  const v2raw = await storage.get(V2_KEY);
  if (v2raw[V2_KEY]) return false; // 已是 v2
  const v1raw = await storage.get(V1_KEY);
  const migrated = migrateV1toV2(v1raw[V1_KEY] as never);
  if (!migrated) return false;
  await storage.set(V2_KEY, migrated);
  return true;
}

async function loadStorage(): Promise<JobsV2Storage> {
  await migrateStorage();
  const raw = await storage.get(V2_KEY);
  const rec = raw[V2_KEY] as JobsV2Storage | undefined;
  if (rec && Array.isArray(rec.jobs)) return rec;
  return { schemaVersion: 2, jobs: [], activeJobId: null, profileOverride: null };
}

async function saveStorage(s: JobsV2Storage): Promise<void> {
  await storage.set(V2_KEY, s);
}

/** Duplicate Detection（spec 第八章）：优先 normalized sourceUrl，其次 company+position */
export function normalizeKey(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

export function findDuplicate(
  jobs: JobRecord[],
  job: Pick<JobContext, "sourceUrl" | "position" | "company">,
): JobRecord | null {
  const url = normalizeKey(job.sourceUrl);
  if (url) {
    const byUrl = jobs.find((j) => normalizeKey(j.sourceUrl) === url);
    if (byUrl) return byUrl;
  }
  const company = (job.company ?? "").toLowerCase().replace(/\s+/g, "");
  const position = (job.position ?? "").toLowerCase().replace(/\s+/g, "");
  if (company && position) {
    return (
      jobs.find(
        (j) =>
          (j.company ?? "").toLowerCase().replace(/\s+/g, "") === company &&
          (j.position ?? "").toLowerCase().replace(/\s+/g, "") === position,
      ) ?? null
    );
  }
  return null;
}

export interface UpsertResult {
  record: JobRecord;
  /** true = 复用已有岗位（重复捕获），false = 新建 */
  reused: boolean;
}

/** 保存/更新岗位（捕获入口）：去重；命中重复则更新 JD 并返回已有记录 */
export async function upsertJobFromContext(job: JobContext): Promise<UpsertResult> {
  const s = await loadStorage();
  const now = new Date().toISOString();
  const dup = findDuplicate(s.jobs, job);
  if (dup) {
    const updated: JobRecord = {
      ...dup,
      ...job,
      id: dup.id, // 重复捕获：保留原 Job id，只更新内容
      status: dup.status,
      tags: dup.tags,
      notes: dup.notes,
      lastSessionId: dup.lastSessionId,
      archived: dup.archived,
      submittedAt: dup.submittedAt,
      updatedAt: now,
    };
    s.jobs = s.jobs.map((j) => (j.id === dup.id ? updated : j));
    s.activeJobId = dup.id;
    await saveStorage(s);
    return { record: updated, reused: true };
  }
  const record = toRecord(job, now);
  s.jobs.unshift(record);
  s.jobs = s.jobs.slice(0, MAX_JOBS);
  s.activeJobId = record.id;
  await saveStorage(s);
  return { record, reused: false };
}

export async function listJobs(): Promise<JobRecord[]> {
  return (await loadStorage()).jobs;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  return (await loadStorage()).jobs.find((j) => j.id === jobId) ?? null;
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
  const s = await loadStorage();
  const job = s.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const updated: JobRecord = { ...job, ...patch, id: job.id, updatedAt: new Date().toISOString() };
  s.jobs = s.jobs.map((j) => (j.id === jobId ? updated : j));
  await saveStorage(s);
  return updated;
}

/** 状态变化（只由用户动作触发；spec 第四章：禁止自动修改） */
export async function setJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | null> {
  const patch: Partial<JobRecord> = { status };
  if (status === "submitted") patch.submittedAt = new Date().toISOString();
  return updateJob(jobId, patch);
}

export async function setActiveJobId(jobId: string): Promise<void> {
  const s = await loadStorage();
  s.activeJobId = jobId;
  await saveStorage(s);
}

export async function getActiveJobId(): Promise<string | null> {
  return (await loadStorage()).activeJobId;
}

export async function getActiveJobRecord(): Promise<JobRecord | null> {
  const s = await loadStorage();
  return s.jobs.find((j) => j.id === s.activeJobId) ?? null;
}

export async function setProfileOverrideV2(type: string | null): Promise<void> {
  const s = await loadStorage();
  s.profileOverride = type;
  await saveStorage(s);
}

export async function getProfileOverrideV2(): Promise<string | null> {
  return (await loadStorage()).profileOverride;
}

/** Inbox 视图过滤 + 搜索（spec 二十二/二十三）：公司/岗位/tag 客户端搜索 */
export function filterInbox(
  jobs: JobRecord[],
  options: { view?: InboxView; search?: string; profileType?: string; includeArchived?: boolean },
): JobRecord[] {
  let out = jobs;
  if (!options.includeArchived) out = out.filter((j) => !j.archived);
  if (options.view && options.view !== "all") {
    const statuses = INBOX_VIEW_FILTER[options.view];
    out = out.filter((j) => statuses.includes(j.status));
  }
  if (options.profileType) out = out.filter((j) => j.jobType === options.profileType);
  if (options.search) {
    const q = options.search.toLowerCase().replace(/\s+/g, "");
    out = out.filter((j) =>
      [j.company, j.position, ...(j.tags ?? [])].some((t) =>
        (t ?? "").toLowerCase().replace(/\s+/g, "").includes(q),
      ),
    );
  }
  return out;
}

/** 级联删除（spec 三十六）：删除 Job 同时删除其 Sessions/Events（由调用方组合） */
export async function deleteJobCascade(jobId: string): Promise<void> {
  const s = await loadStorage();
  s.jobs = s.jobs.filter((j) => j.id !== jobId);
  if (s.activeJobId === jobId) s.activeJobId = null;
  await saveStorage(s);
  await purgeLegacyJob(jobId);
}

/**
 * 投递页顶部的「当前关联岗位」读的是旧键 afa.jobs.v1，岗位库/Session 用 afa.jobs.v2。
 * 删岗位时只清 v2 的话，那个岗位在投递页仍然是 active job —— 于是下一次识别会拿错岗位的
 * 方向和资料去填表（幽灵关联）。删除/清空必须同时落到 v1。
 */
export async function purgeLegacyJob(jobId: string): Promise<void> {
  const raw = (await storage.get(V1_KEY))[V1_KEY] as
    | { jobs?: { id?: string }[]; activeJobId?: string | null; profileOverride?: string | null }
    | undefined;
  if (!raw || !Array.isArray(raw.jobs)) return;
  const jobs = raw.jobs.filter((j) => j?.id !== jobId);
  const activeJobId = raw.activeJobId === jobId ? null : raw.activeJobId ?? null;
  await storage.set(V1_KEY, { ...raw, jobs, activeJobId, profileOverride: activeJobId ? raw.profileOverride ?? null : null });
}

/** 清空全部岗位（v1 + v2）：投递页与岗位库都不留关联 */
export async function clearAllJobs(): Promise<void> {
  await storage.set(V2_KEY, { schemaVersion: 2, jobs: [], activeJobId: null, profileOverride: null });
  await storage.set(V1_KEY, { jobs: [], activeJobId: null, profileOverride: null });
}
