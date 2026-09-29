import type { ApplicationEvent, ApplicationSessionV2, JobRecord } from "../workspace/types";
import { mergeEvents, mergeJobRecords, mergeSessions } from "./workspaceIntegrity";
import type { StorageLike } from "../workspace/jobRepository";

/**
 * Workspace Import Restore（spec Stage 5.5 第三十七章）：
 * 只接受系统自己导出的 JSON（validateWorkspaceImport 已校验）；
 * Merge：按 id 去重合并；Replace：清空 workspace 三类后导入（绝不删除 Master Profile）。
 */

const JOBS_KEY = "afa.jobs.v2";
const SESSIONS_KEY = "afa.sessions.v2";
const EVENTS_KEY = "afa.events.v1";

export async function importWorkspaceData(
  storage: StorageLike,
  payload: { jobs: JobRecord[]; sessions: ApplicationSessionV2[]; events: ApplicationEvent[] },
  mode: "merge" | "replace",
): Promise<{ jobs: number; sessions: number; events: number }> {
  if (mode === "replace") {
    await storage.set(JOBS_KEY, { schemaVersion: 2, jobs: payload.jobs, activeJobId: payload.jobs[0]?.id ?? null, profileOverride: null });
    await storage.set(SESSIONS_KEY, { schemaVersion: 2, sessions: payload.sessions });
    await storage.set(EVENTS_KEY, payload.events);
    return { jobs: payload.jobs.length, sessions: payload.sessions.length, events: payload.events.length };
  }

  // Merge
  const jobsRaw = await storage.get(JOBS_KEY);
  const localJobs = ((jobsRaw[JOBS_KEY] as { jobs?: JobRecord[] } | undefined)?.jobs ?? []) as JobRecord[];
  const mergedJobs = mergeJobRecords(localJobs, payload.jobs);
  await storage.set(JOBS_KEY, {
    schemaVersion: 2,
    jobs: mergedJobs,
    activeJobId: (jobsRaw[JOBS_KEY] as { activeJobId?: string | null } | undefined)?.activeJobId ?? null,
    profileOverride: (jobsRaw[JOBS_KEY] as { profileOverride?: string | null } | undefined)?.profileOverride ?? null,
  });

  const sessionsRaw = await storage.get(SESSIONS_KEY);
  const localSessions = ((sessionsRaw[SESSIONS_KEY] as { sessions?: ApplicationSessionV2[] } | undefined)?.sessions ?? []) as ApplicationSessionV2[];
  const mergedSessions = mergeSessions(localSessions, payload.sessions);
  await storage.set(SESSIONS_KEY, { schemaVersion: 2, sessions: mergedSessions });

  const eventsRaw = await storage.get(EVENTS_KEY);
  const localEvents = (eventsRaw[EVENTS_KEY] as ApplicationEvent[] | undefined) ?? [];
  const mergedEvents = mergeEvents(localEvents, payload.events);
  await storage.set(EVENTS_KEY, mergedEvents);

  return { jobs: mergedJobs.length, sessions: mergedSessions.length, events: mergedEvents.length };
}
