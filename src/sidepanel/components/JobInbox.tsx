import { useEffect, useState } from "react";
import { filterInbox, listJobs } from "../../workspace/jobRepository";
import type { JobRecord } from "../../workspace/types";
import { JOB_STATUS_LABELS, INBOX_VIEW_FILTER, type InboxView } from "../../workspace/types";
import { profileTypeLabel } from "../../job/profileTypes";

const VIEWS: { key: InboxView; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "applying", label: "正在申请" },
  { key: "submitted", label: "已投递" },
  { key: "followup", label: "后续流程" },
  { key: "closed", label: "已结束" },
];

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Job Inbox（spec Stage 5 第五~七章）：列表 + 搜索 + 状态筛选 + 归档 + 统计 */
export function JobInbox(p: {
  onOpenJob: (jobId: string) => void;
  refreshKey: number;
}) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [view, setView] = useState<InboxView>("all");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    void listJobs().then(setJobs);
  }, [p.refreshKey]);

  const filtered = filterInbox(jobs, { view, search, includeArchived });
  const stats = {
    total: jobs.filter((j) => !j.archived).length,
    pending: jobs.filter((j) => INBOX_VIEW_FILTER.pending.includes(j.status)).length,
    applying: jobs.filter((j) => INBOX_VIEW_FILTER.applying.includes(j.status)).length,
    submitted: jobs.filter((j) => INBOX_VIEW_FILTER.submitted.includes(j.status)).length,
    followup: jobs.filter((j) => INBOX_VIEW_FILTER.followup.includes(j.status)).length,
  };

  return (
    <main className="main inbox">
      <div className="inbox-stats muted small">
        岗位 {stats.total} · 待处理 {stats.pending} · 申请中 {stats.applying} · 已投递 {stats.submitted} · 后续流程 {stats.followup}
      </div>

      <div className="toolbar">
        <input
          className="inbox-search"
          placeholder="搜索公司 / 岗位 / 标签"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="toolbar inbox-views">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? "btn-sm primary" : "btn-sm"} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
        <label className="inbox-toggle">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          显示归档
        </label>
      </div>

      {filtered.length === 0 && (
        <div className="banner">
          {jobs.length === 0
            ? "还没有保存的岗位。在招聘网站的职位页打开「投递」页点「开始识别」，识别时会自动把岗位存到这里。"
            : "这个筛选条件下没有岗位。换个筛选，或把下面的归档开关打开。"}
        </div>
      )}

      <div className="inbox-list">
        {filtered.map((job) => (
          <button key={job.id} className="job-card" onClick={() => p.onOpenJob(job.id)}>
            <div className="job-card-head">
              <span className="job-company">{job.company || "（未填公司）"}</span>
              <span className={`job-status st-${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
            </div>
            <div className="job-card-body">
              <span className="job-position">{job.position || "（未填岗位）"}</span>
              <span className="muted small">{profileTypeLabel(job.jobType)}</span>
            </div>
            <div className="job-card-foot muted small">
              {relTime(job.updatedAt)}
              {job.tags.length > 0 && ` · ${job.tags.join(" / ")}`}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
