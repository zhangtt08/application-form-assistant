import { useEffect, useState } from "react";
import { getJob, updateJob, setJobStatus, deleteJobCascade, getProfileOverrideV2 } from "../../workspace/jobRepository";
import { listSessionsByJob, listEventsByJob, deleteEventsByJob, deleteSessionsByJob } from "../../workspace/workspaceRepository";
import {
  SESSION_STATUS_LABELS, JOB_STATUS_LABELS,
  type JobRecord, type JobStatus, type ApplicationSessionV2, type ApplicationEvent,
} from "../../workspace/types";
import { profileTypeLabel, type ProfileType } from "../../job/profileTypes";

const ALL_STATUSES: JobStatus[] = [
  "saved", "preparing", "applying", "submitted", "assessment", "interview", "offer", "rejected", "withdrawn",
];

const EVENT_LABELS: Record<string, string> = {
  JOB_CAPTURED: "捕获岗位",
  JOB_UPDATED: "更新岗位",
  SESSION_CREATED: "开始申请",
  SESSION_RESUMED: "继续申请",
  FORM_SCANNED: "扫描表单",
  VARIANT_GENERATED: "生成 Variant",
  ANSWER_GENERATED: "生成回答",
  FORM_FILLED: "填写完成",
  JOB_SUBMITTED: "标记已投递",
  STATUS_CHANGED: "状态变更",
  NOTE_ADDED: "添加备注",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Job Workspace（spec Stage 5 第九~十四章）：概览/分析/准备/Session/Timeline/Notes/Tags/状态 */
export function JobWorkspace(p: {
  jobId: string;
  onBack: () => void;
  onStartApplication: (jobId: string) => void;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<JobRecord | null>(null);
  const [sessions, setSessions] = useState<ApplicationSessionV2[]>([]);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [override, setOverride] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = async () => {
    const j = await getJob(p.jobId);
    setJob(j);
    if (j) {
      setNotes(j.notes ?? "");
      setTagsText((j.tags ?? []).join(", "));
    }
    setSessions(await listSessionsByJob(p.jobId));
    setEvents(await listEventsByJob(p.jobId));
    setOverride(await getProfileOverrideV2());
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.jobId]);

  if (!job) {
    return (
      <main className="main">
        <div className="banner">岗位不存在或已删除。</div>
        <button onClick={p.onBack}>← 返回岗位列表</button>
      </main>
    );
  }

  const saveNotes = async () => {
    if (notes === (job.notes ?? "")) return;
    await updateJob(job.id, { notes });
    if (notes.trim()) {
      const { appendEvent } = await import("../../workspace/workspaceRepository");
      await appendEvent({ jobId: job.id, type: "NOTE_ADDED", timestamp: new Date().toISOString(), metadata: { preview: notes.slice(0, 30) } });
    }
    void reload();
    p.onChanged();
  };

  const changeStatus = async (status: JobStatus) => {
    const from = job.status;
    await setJobStatus(job.id, status);
    const { appendEvent } = await import("../../workspace/workspaceRepository");
    await appendEvent({
      jobId: job.id,
      type: "STATUS_CHANGED",
      timestamp: new Date().toISOString(),
      metadata: { from, to: status },
    });
    void reload();
    p.onChanged();
  };

  const toggleArchive = async () => {
    await updateJob(job.id, { archived: !job.archived });
    void reload();
    p.onChanged();
  };

  const deleteJob = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteSessionsByJob(job.id);
    await deleteEventsByJob(job.id);
    await deleteJobCascade(job.id);
    p.onChanged();
    p.onBack();
  };

  return (
    <main className="main workspace">
      <button className="btn-sm" onClick={p.onBack}>← 返回岗位列表</button>

      <section className="ws-section">
        <h3>岗位概览</h3>
        <div className="ws-grid">
          <span className="muted small">公司</span><span>{job.company || "—"}</span>
          <span className="muted small">岗位</span><span>{job.position || "—"}</span>
          <span className="muted small">地点</span><span>{job.location || "—"}</span>
          <span className="muted small">来源</span><span className="muted small">{job.sourceUrl}</span>
          <span className="muted small">状态</span>
          <span>
            <select value={job.status} onChange={(e) => void changeStatus(e.target.value as JobStatus)}>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
            {job.submittedAt && <span className="muted small">（{fmtTime(job.submittedAt)} 投递）</span>}
          </span>
        </div>
        <div className="ws-tags muted small">标签：{job.tags.length > 0 ? job.tags.join(" / ") : "（无）"}</div>
      </section>

      <section className="ws-section">
        <h3>岗位分析</h3>
        <div className="ws-grid">
          <span className="muted small">识别方向</span><span>{profileTypeLabel(job.jobType)}</span>
          <span className="muted small">填写版本</span>
          <span>{profileTypeLabel(job.jobType)}{override ? `（手动覆盖：${profileTypeLabel(override as ProfileType)}）` : ""}</span>
          <span className="muted small">关键词</span><span>{job.keywords.length > 0 ? job.keywords.join(" / ") : "—"}</span>
        </div>
      </section>

      <section className="ws-section">
        <h3>申请记录（{sessions.length}）</h3>
        {sessions.length === 0 && <div className="muted small">还没有申请记录。</div>}
        <ul className="ws-list">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              {fmtTime(s.createdAt)} · {SESSION_STATUS_LABELS[s.status]} · 识别 {s.detectedFields} 字段
              {s.generatedAnswers > 0 && ` · ${s.generatedAnswers} 个生成回答`}
            </li>
          ))}
        </ul>
        <button className="primary" onClick={() => p.onStartApplication(job.id)}>
          {sessions.length > 0 ? "开始 / 继续申请" : "开始申请"}
        </button>
      </section>

      <section className="ws-section">
        <h3>Timeline</h3>
        <ul className="ws-timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="muted small">{fmtTime(e.timestamp)}</span> {EVENT_LABELS[e.type] ?? e.type}
              {e.type === "STATUS_CHANGED" && `：${JOB_STATUS_LABELS[e.metadata.from as JobStatus] ?? e.metadata.from} → ${JOB_STATUS_LABELS[e.metadata.to as JobStatus] ?? e.metadata.to}`}
            </li>
          ))}
          {events.length === 0 && <li className="muted small">（暂无记录）</li>}
        </ul>
      </section>

      <section className="ws-section">
        <h3>备注与标签</h3>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="面试信息 / HR 联系 / 岗位备注…" />
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="标签，逗号分隔（如：Agent, 杭州, 内推）" />
        <button className="btn-sm" onClick={() => void saveNotes()}>保存备注与标签</button>
      </section>

      <section className="ws-section ws-danger">
        <button className="btn-sm" onClick={() => void toggleArchive()}>
          {job.archived ? "取消归档" : "归档该岗位"}
        </button>
        <button className="btn-sm danger" onClick={() => void deleteJob()}>
          {confirmDelete ? `再次确认：将同时删除 ${sessions.length} 次申请记录` : "删除岗位"}
        </button>
        {confirmDelete && <div className="banner banner-error">该岗位包含 {sessions.length} 次申请记录，删除将同时删除对应 Session / Event，且不可恢复。</div>}
      </section>
    </main>
  );
}
