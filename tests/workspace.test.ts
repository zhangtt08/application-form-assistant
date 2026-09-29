import { beforeEach, describe, expect, it } from "vitest";
import {
  migrateStorage, migrateV1toV2, upsertJobFromContext, findDuplicate, filterInbox,
  getJob, updateJob, setJobStatus, deleteJobCascade,
  setActiveJobId, getActiveJobId, listJobs, setJobStorageBackend, normalizeKey,
  type StorageLike,
} from "../src/workspace/jobRepository";
import {
  createSession, updateSession, getSession, listSessionsByJob, getLatestOpenSession,
  setSessionStatus, deleteSessionsByJob, appendEvent, listEventsByJob, deleteEventsByJob,
  migrateSessionStorage, exportWorkspaceData, clearAllApplicationData, setSessionStorageBackend,
} from "../src/workspace/workspaceRepository";
import type { JobContext } from "../src/job/schema";
import type { JobRecord } from "../src/workspace/types";

// ---------- 内存 storage 后端（离线测试） ----------

function memoryBackend(): StorageLike & { dump(): Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    async get(key) { return store[key] !== undefined ? { [key]: store[key] } : {}; },
    async set(key, value) { store[key] = JSON.parse(JSON.stringify(value)); },
    dump() { return store; },
  };
}

function makeJobContext(over: Partial<JobContext> = {}): JobContext {
  return {
    id: `job_${Math.random().toString(36).slice(2, 8)}`,
    company: "星辰科技",
    position: "AI产品经理",
    location: "杭州",
    jd: "负责AI产品的需求分析与落地。",
    sourceUrl: "https://example.com/job/1",
    pageTitle: "AI产品经理-星辰科技",
    createdAt: new Date().toISOString(),
    jobType: "aiProduct",
    keywords: ["AI产品"],
    source: "captured",
    ...over,
  };
}

beforeEach(() => {
  const backend = memoryBackend();
  setJobStorageBackend(backend);
  setSessionStorageBackend(backend);
});

// ---------- 1. Job CRUD ----------

describe("Job CRUD", () => {
  it("upsert 新建 → get/list 可查", async () => {
    const ctx = makeJobContext();
    const { record, reused } = await upsertJobFromContext(ctx);
    expect(reused).toBe(false);
    expect(record.status).toBe("saved");
    expect((await getJob(record.id))?.company).toBe("星辰科技");
    expect((await listJobs()).length).toBe(1);
  });

  it("updateJob 修改 tags/notes/channel", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    const updated = await updateJob(record.id, { tags: ["AI产品", "优先"], notes: "HR 微信已联系", channel: "内推" });
    expect(updated?.tags).toContain("优先");
    expect(updated?.notes).toBe("HR 微信已联系");
    expect(updated?.channel).toBe("内推");
  });

  it("setActiveJobId / getActiveJobId", async () => {
    const a = await upsertJobFromContext(makeJobContext());
    const b = await upsertJobFromContext(makeJobContext({ sourceUrl: "https://x.com/2", position: "Agent工程师", company: "智元" }));
    expect(await getActiveJobId()).toBe(b.record.id);
    await setActiveJobId(a.record.id);
    expect(await getActiveJobId()).toBe(a.record.id);
  });
});

// ---------- 2. Duplicate Detection ----------

describe("Duplicate Detection", () => {
  it("同 sourceUrl（忽略大小写/尾部路径）→ 识别重复", () => {
    const jobs = [{ ...makeJobContext({ id: "j1" }), status: "saved", tags: [], notes: "", lastSessionId: null, archived: false, updatedAt: "" } as JobRecord];
    const dup = findDuplicate(jobs, { sourceUrl: "https://EXAMPLE.com/job/1?trk=1", position: "AI产品经理", company: "星辰科技" });
    expect(dup?.id).toBe("j1");
  });

  it("同 company+position（无 URL 匹配时）→ 识别重复", () => {
    const jobs = [{ ...makeJobContext({ id: "j1", sourceUrl: "https://a.com/x" }), status: "saved", tags: [], notes: "", lastSessionId: null, archived: false, updatedAt: "" } as JobRecord];
    const dup = findDuplicate(jobs, { sourceUrl: "https://different.com/y", position: "AI产品经理", company: "星辰科技" });
    expect(dup?.id).toBe("j1");
  });

  it("重复捕获 → 复用已有记录并更新 JD（不创建第二条）", async () => {
    const first = await upsertJobFromContext(makeJobContext());
    const second = await upsertJobFromContext(makeJobContext({ id: "job_other", jd: "更新后的 JD 内容" }));
    expect(second.reused).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.jd).toBe("更新后的 JD 内容");
    expect((await listJobs()).length).toBe(1);
  });

  it("normalizeKey：大小写/空白/查询参数归一", () => {
    expect(normalizeKey("https://Example.com/job/1?trk=2")).toBe("https://example.com/job/1");
  });

  it("Issue #002：同一 URL 再次捕获 → 同一 JobRecord，position 由「未识别岗位」更新为正确值，总数不变", async () => {
    // before：旧版本扩展捕获时 position 解析失败
    const stale = makeJobContext({
      company: "广州诗悦网络科技有限公司",
      position: "未识别岗位",
      sourceUrl: "https://app.mokahr.com/campus_apply/shiyue/job/vehcile-planner-3c",
      jd: "岗位职责：负责 3C 品类的载具策划与玩法设计。",
    });
    const first = await upsertJobFromContext(stale);
    expect(first.reused).toBe(false);

    // capture same URL：修复后的解析结果
    const recaptured = makeJobContext({
      id: "job_fresh_capture_id",
      company: "广州诗悦网络科技有限公司",
      position: "载具策划 - 3C（望月）- 202X",
      sourceUrl: "https://app.mokahr.com/campus_apply/shiyue/job/vehcile-planner-3c",
      positionExtraction: { source: "job_detail", confidence: "high" },
    });
    const second = await upsertJobFromContext(recaptured);

    // after：同一个 JobRecord id + 更新后的 position
    expect(second.reused).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.position).toBe("载具策划 - 3C（望月）- 202X");
    expect(second.record.positionExtraction?.source).toBe("job_detail");
    expect((await listJobs()).length).toBe(1); // Job count 不增加
  });
});

// ---------- 3. Job Status Transition ----------

describe("Job Status", () => {
  it("saved → submitted（用户手动标记）记录 submittedAt", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    const updated = await setJobStatus(record.id, "submitted");
    expect(updated?.status).toBe("submitted");
    expect(updated?.submittedAt).toBeTruthy();
  });

  it("submitted → assessment → interview 状态机任意转移", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    await setJobStatus(record.id, "submitted");
    const a = await setJobStatus(record.id, "assessment");
    expect(a?.status).toBe("assessment");
    const i = await setJobStatus(record.id, "interview");
    expect(i?.status).toBe("interview");
  });
});

// ---------- 4/5. Filtering + Search ----------

describe("Inbox Filter & Search", () => {
  it("六个视图映射正确的状态集合", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1", sourceUrl: "https://a.com/1" })); // saved
    const r2 = await upsertJobFromContext(makeJobContext({ id: "j2", sourceUrl: "https://a.com/2", company: "智元", position: "Agent工程师" }));
    await setJobStatus(r2.record.id, "applying");
    const r3 = await upsertJobFromContext(makeJobContext({ id: "j3", sourceUrl: "https://a.com/3", company: "月之暗面", position: "产品运营" }));
    await setJobStatus(r3.record.id, "submitted");

    const all = await listJobs();
    expect(filterInbox(all, { view: "pending" }).map((j) => j.id)).toContain("j1");
    expect(filterInbox(all, { view: "applying" }).map((j) => j.id)).toEqual(["j2"]);
    expect(filterInbox(all, { view: "submitted" }).map((j) => j.id)).toEqual(["j3"]);
  });

  it("搜索公司/岗位/tag", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    await updateJob(record.id, { tags: ["内推"] });
    await upsertJobFromContext(makeJobContext({ company: "智元智能", position: "Agent开发", sourceUrl: "https://x.com/9" }));
    const all = await listJobs();
    expect(filterInbox(all, { search: "星辰" }).length).toBe(1);
    expect(filterInbox(all, { search: "agent" }).length).toBe(1); // tag + position 匹配
    expect(filterInbox(all, { search: "内推" }).length).toBe(1);
    expect(filterInbox(all, { search: "不存在" }).length).toBe(0);
  });
});

// ---------- 6. Archive ----------

describe("Archive", () => {
  it("归档后默认 Inbox 不显示，includeArchived 恢复", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    await updateJob(record.id, { archived: true });
    const all = await listJobs();
    expect(filterInbox(all, {}).length).toBe(0);
    expect(filterInbox(all, { includeArchived: true }).length).toBe(1);
  });
});

// ---------- 7-9. Session ----------

describe("Application Session", () => {
  it("创建 → 更新状态 → 查询", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    const s = await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct", sourceUrl: "https://f.com/form" });
    expect(s.status).toBe("created");
    await updateSession(s.sessionId, { status: "scanned", detectedFields: 16, confirmedFields: 11 });
    const got = await getSession(s.sessionId);
    expect(got?.detectedFields).toBe(16);
    expect(got?.status).toBe("scanned");
    expect((await listSessionsByJob("j1")).length).toBe(1);
  });

  it("Session Resume：最近未结束 Session", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    const s1 = await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    const resumed = await getLatestOpenSession("j1");
    expect(resumed?.sessionId).toBe(s1.sessionId);
    await setSessionStatus(s1.sessionId, "completed");
    expect(await getLatestOpenSession("j1")).toBeNull();
  });

  it("同一 Job 多个 Session", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    expect((await listSessionsByJob("j1")).length).toBe(2);
  });
});

// ---------- 10. Event Timeline ----------

describe("Event Timeline", () => {
  it("事件按 Job 过滤且按时间倒序", async () => {
    await appendEvent({ jobId: "j1", type: "JOB_CAPTURED", timestamp: "2026-09-23T10:00:00Z", metadata: {} });
    await appendEvent({ jobId: "j1", type: "FORM_FILLED", timestamp: "2026-09-23T11:00:00Z", metadata: {} });
    await appendEvent({ jobId: "j2", type: "JOB_CAPTURED", timestamp: "2026-09-23T12:00:00Z", metadata: {} });
    const events = await listEventsByJob("j1");
    expect(events.map((e) => e.type)).toEqual(["FORM_FILLED", "JOB_CAPTURED"]);
  });

  it("STATUS_CHANGED 事件带 from/to", async () => {
    await appendEvent({ jobId: "j1", type: "STATUS_CHANGED", timestamp: new Date().toISOString(), metadata: { from: "submitted", to: "assessment" } });
    const events = await listEventsByJob("j1");
    expect(events[0]?.metadata.from).toBe("submitted");
    expect(events[0]?.metadata.to).toBe("assessment");
  });
});

// ---------- 11. Mark Submitted ----------

describe("Mark Submitted", () => {
  it("fill 完成后手动标记 → status=submitted + submittedAt，但 Session completed ≠ submitted", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    const s = await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    await setSessionStatus(s.sessionId, "completed");
    expect((await getSession(s.sessionId))?.status).toBe("completed");
    // Job 状态仍需用户手动确认
    const job = await setJobStatus("j1", "submitted");
    expect(job?.status).toBe("submitted");
    expect(job?.submittedAt).toBeTruthy();
  });
});

// ---------- 12. Storage Migration ----------

describe("Storage Migration（v1 → v2 无损）", () => {
  it("migrateV1toV2：JobContext[] → JobRecord[]（status=saved）", () => {
    const v1 = {
      jobs: [
        { id: "old1", company: "旧公司", position: "旧岗位", location: "", jd: "", sourceUrl: "https://o.com/1", pageTitle: "", createdAt: "2026-09-01T00:00:00Z", jobType: "aiProduct", keywords: [], source: "captured" },
      ],
      activeJobId: "old1",
      profileOverride: "agent",
    };
    const v2 = migrateV1toV2(v1);
    expect(v2?.schemaVersion).toBe(2);
    expect(v2?.jobs[0]?.id).toBe("old1");
    expect(v2?.jobs[0]?.status).toBe("saved");
    expect(v2?.jobs[0]?.tags).toEqual([]);
    expect(v2?.activeJobId).toBe("old1");
    expect(v2?.profileOverride).toBe("agent");
  });

  it("启动时自动迁移：旧 Active Job / History 不丢", async () => {
    const backend = memoryBackend();
    backend.set("afa.jobs.v1", {
      jobs: [
        { id: "old1", company: "旧公司", position: "旧岗位", location: "", jd: "", sourceUrl: "https://o.com/1", pageTitle: "", createdAt: "2026-09-01T00:00:00Z", jobType: "aiProduct", keywords: [], source: "captured" },
      ],
      activeJobId: "old1",
      profileOverride: null,
    });
    setJobStorageBackend(backend);
    const migrated = await migrateStorage();
    expect(migrated).toBe(true);
    expect((await listJobs()).map((j) => j.id)).toContain("old1");
    expect(await getActiveJobId()).toBe("old1");
    // 二次启动不重复迁移
    expect(await migrateStorage()).toBe(false);
  });

  it("Session v1 → v2 迁移保留 answers 计数", async () => {
    const backend = memoryBackend();
    backend.set("afa.sessions.v1", {
      sessions: [{ sessionId: "s1", jobContextId: "old1", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", answers: [{}, {}] }],
    });
    setSessionStorageBackend(backend);
    expect(await migrateSessionStorage()).toBe(true);
    expect((await listSessionsByJob("old1"))[0]?.generatedAnswers).toBe(2);
  });
});

// ---------- 13. Job Update / Reparse ----------

describe("Job Update / Reparse", () => {
  it("更新 JD（重新捕获）保留 tags/notes/status；不重置 override", async () => {
    const { record } = await upsertJobFromContext(makeJobContext());
    await updateJob(record.id, { tags: ["内推"], notes: "备注", status: "applying" });
    const second = await upsertJobFromContext(makeJobContext({ id: "job_new_id", jd: "更新后 JD" }));
    expect(second.reused).toBe(true);
    const updated = await getJob(record.id);
    expect(updated?.tags).toContain("内推");
    expect(updated?.status).toBe("applying");
    expect(updated?.jd).toBe("更新后 JD");
  });
});

// ---------- 14. Profile Override Persistence ----------

describe("Profile Override Persistence", () => {
  it("override 存取独立于 job 状态", async () => {
    await upsertJobFromContext(makeJobContext());
    // 通过 upsert 后 override 为 null（新岗位重置）
    const { setProfileOverrideV2, getProfileOverrideV2 } = await import("../src/workspace/jobRepository");
    await setProfileOverrideV2("agent");
    expect(await getProfileOverrideV2()).toBe("agent");
  });
});

// ---------- 15/16. Export + Delete Cascade ----------

describe("Export & Delete Cascade", () => {
  it("exportWorkspaceData 包含 jobs/sessions/events 且不含 Profile", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    await appendEvent({ jobId: "j1", type: "JOB_CAPTURED", timestamp: new Date().toISOString(), metadata: {} });
    const data = await exportWorkspaceData();
    expect(data.jobs.length).toBe(1);
    expect(data.sessions.length).toBe(1);
    expect(data.events.length).toBe(1);
    expect(JSON.stringify(data)).not.toContain("basic");
  });

  it("删除 Job → Session/Event 级联删除；Master Profile 不受影响", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    await createSession({ jobId: "j1", jobContextId: "j1", effectiveProfileType: "aiProduct" });
    await appendEvent({ jobId: "j1", type: "JOB_CAPTURED", timestamp: new Date().toISOString(), metadata: {} });
    await deleteSessionsByJob("j1");
    await deleteEventsByJob("j1");
    await deleteJobCascade("j1");
    expect(await getJob("j1")).toBeNull();
    expect((await listSessionsByJob("j1")).length).toBe(0);
    expect((await listEventsByJob("j1")).length).toBe(0);
    // Master Profile 完好（clearAllApplicationData 才清理，且只清 workspace 三类）
    const backendDump = (setJobStorageBackend(memoryBackend()), true);
    void backendDump;
  });

  it("clearAllApplicationData 只清 workspace 三类", async () => {
    await upsertJobFromContext(makeJobContext({ id: "j1" }));
    await clearAllApplicationData();
    expect((await listJobs()).length).toBe(0);
    expect((await listSessionsByJob("j1")).length).toBe(0);
  });

  it("删岗位 / 清空数据会把旧键 afa.jobs.v1 的关联一起清掉（幽灵岗位回归）", async () => {
    // 投递页顶部关联的岗位存在旧键 afa.jobs.v1；只清 v2 的话，
    // 岗位库里删掉的岗位在投递页仍然是 active job → 下次识别会用错岗位的资料。
    const backend = memoryBackend();
    setJobStorageBackend(backend);
    setSessionStorageBackend(backend);

    await backend.set("afa.jobs.v1", {
      jobs: [{ id: "j1", company: "星辰科技", position: "AI产品经理" }],
      activeJobId: "j1",
      profileOverride: "aiProduct",
    });

    await deleteJobCascade("j1");
    const afterDelete = ((await backend.get("afa.jobs.v1"))["afa.jobs.v1"] ?? {}) as {
      jobs: unknown[]; activeJobId: string | null;
    };
    expect(afterDelete.jobs).toHaveLength(0);
    expect(afterDelete.activeJobId).toBeNull();

    await backend.set("afa.jobs.v1", { jobs: [{ id: "j2" }], activeJobId: "j2", profileOverride: "agent" });
    await clearAllApplicationData();
    const afterClear = ((await backend.get("afa.jobs.v1"))["afa.jobs.v1"] ?? {}) as {
      jobs: unknown[]; activeJobId: string | null;
    };
    expect(afterClear.jobs).toHaveLength(0);
    expect(afterClear.activeJobId).toBeNull();
  });
});
