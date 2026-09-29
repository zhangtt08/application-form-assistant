import { useState } from "react";
import type { JobContext } from "../../job/schema";
import { PROFILE_CONFIG, PROFILE_TYPES, profileTypeLabel, type ProfileType } from "../../job/profileTypes";
import type { ProfileSelection } from "../../profile/profileRouter";
import type { ProfileLibrary } from "../../profile/libraryStore";
import { LibraryPicker } from "./LibraryPicker";

export interface JobCardProps {
  activeJob: JobContext | null;
  routing: ProfileSelection | null;
  /** 当前生效的填写版本（override ?? routed） */
  effectiveType: ProfileType;
  profileOverride: ProfileType | null;
  history: JobContext[];
  /** 资料库（投递页只做切换，管理动作在「资料」页） */
  libraries: ProfileLibrary[];
  activeLibraryId: string;
  onSwitchLibrary: (id: string) => void;
  onSelect: (jobId: string) => void;
  onClear: () => void;
  onOverrideProfile: (type: ProfileType | null) => void;
  onManualSelect: (type: ProfileType) => void;
}

const CONFIDENCE_TEXT: Record<string, string> = {
  high: "方向判断可信",
  medium: "方向基本可信，建议核对",
  low: "方向不确定，建议手动指定",
};

/**
 * 精简岗位条。
 *
 * 改造前：公司/岗位/方向/置信度/原因/关键词/覆盖率/历史/手动选择全部摊开，
 * 一屏塞满解释性文字，用户看不懂「现在到底在用哪套资料」。
 * 改造后：默认只显示「当前岗位 + 采用的方向」两行 + 一个「调整」按钮，
 * 解释性内容（路由依据、历史、手动指定）收进展开区。
 */
export function JobCard(props: JobCardProps) {
  const { activeJob, history, routing, effectiveType, profileOverride, libraries, activeLibraryId } = props;
  const [expanded, setExpanded] = useState(false);

  const overrideActive = profileOverride != null && profileOverride !== routing?.primaryProfile;
  const dirLabel = profileTypeLabel(effectiveType);
  const activeLibName = libraries.find((l) => l.id === activeLibraryId)?.name ?? "默认资料库";

  const directionChips = (
    <div className="chip-row">
      {PROFILE_TYPES.filter((t) => t !== "general").map((t) => (
        <button
          key={t}
          type="button"
          title={PROFILE_CONFIG[t].description}
          className={`chip chip-select ${t === effectiveType ? "active" : ""}`}
          onClick={() => {
            if (activeJob) props.onOverrideProfile(t);
            else props.onManualSelect(t);
          }}
        >
          {PROFILE_CONFIG[t].label}
        </button>
      ))}
      {overrideActive && (
        <button type="button" className="chip chip-select" onClick={() => props.onOverrideProfile(null)}>
          恢复自动判断
        </button>
      )}
    </div>
  );

  if (!activeJob) {
    return (
      <div className="jobbar jobbar-empty">
        <div className="jobbar-main">
          <div className="jobbar-title">未识别到岗位</div>
          <div className="jobbar-sub">
            点「开始识别」时会自动读取当前页面的 JD；也可以直接指定方向，按该方向的经验版本填写。
          </div>
        </div>
        <button type="button" className="btn-sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : "指定方向"}
        </button>
        {expanded && (
          <div className="jobbar-body">
            <div className="jobbar-label">资料库</div>
            <LibraryPicker compact libraries={libraries} activeId={activeLibraryId} onSwitch={props.onSwitchLibrary} />
            {directionChips}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="jobbar">
      <div className="jobbar-main">
        <div className="jobbar-title">
          {activeJob.company ? `${activeJob.company} · ` : ""}
          {activeJob.position}
        </div>
        <div className="jobbar-sub">
          <span className="chip chip-dir">{dirLabel}</span>
          <span className="muted small">
            资料库：{activeLibName}
            {overrideActive ? " · 方向手动指定" : routing ? ` · ${CONFIDENCE_TEXT[routing.routingConfidence]}` : ""}
          </span>
        </div>
      </div>
      <button type="button" className="btn-sm" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "收起" : "调整"}
      </button>

      {expanded && (
        <div className="jobbar-body">
          <div className="jobbar-label">资料库（这一套经历 / 技能从哪个库取）</div>
          <LibraryPicker
            compact
            libraries={libraries}
            activeId={activeLibraryId}
            onSwitch={props.onSwitchLibrary}
          />

          <div className="jobbar-label">填写版本（不同方向用不同的经历表达）</div>
          {directionChips}

          {routing && (
            <>
              <div className="jobbar-label">为什么是这个方向</div>
              <p className="muted small">
                {routing.routingReason}
                {routing.matchedKeywords[routing.primaryProfile]?.length > 0
                  ? ` 命中：${routing.matchedKeywords[routing.primaryProfile].slice(0, 6).join(" / ")}`
                  : ""}
              </p>
            </>
          )}

          {history.length > 0 && (
            <>
              <div className="jobbar-label">历史岗位（{history.length}）</div>
              <div className="jobbar-history">
                {history.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className={`jobbar-history-item ${job.id === activeJob.id ? "active" : ""}`}
                    onClick={() => props.onSelect(job.id)}
                  >
                    <span className="jobbar-history-title">
                      {job.company ? `${job.company} · ` : ""}
                      {job.position}
                    </span>
                    <span className="muted small">{profileTypeLabel(job.jobType)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="jobbar-foot">
            <button type="button" className="btn-sm" onClick={props.onClear}>
              取消关联岗位
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
