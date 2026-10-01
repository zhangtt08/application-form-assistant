import { useState } from "react";
import type { CandidateField, ContentSourceType } from "../../types/field";
import { RiskBadge } from "./RiskBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import {
  explainCandidate,
  fieldFullLabel,
  getCanonicalFieldDef,
  LEVEL_TEXT,
  type MatchExplanation,
} from "../../core";
import { profileTypeLabel, type ProfileType } from "../../job/profileTypes";

export interface FieldCardProps {
  candidate: CandidateField;
  devMode: boolean;
  /**
   * 紧凑一行（label + 值 + 状态）。
   * 「已按资料库填好」的那批字段不需要每张卡占 150px —— 420px 宽的侧边栏里
   * 14 张卡就是 2000px 滚动，用户看完不知道重点在哪。点开才展开完整卡片。
   */
  compact?: boolean;
  onToggleConfirm: (reference: string) => void;
  onEditValue: (reference: string, value: string) => void;
  onVariantChange: (reference: string, variant: "short" | "medium" | "long") => void;
  onIgnore: (reference: string) => void;
  /** 撤销跳过：回到跳过前的状态（否则用户点错了只能整页重识别） */
  onUnignore?: (reference: string) => void;
  /** 把这一项改挂到次选资料字段上（低置信字段的人工纠正入口） */
  onSwitchField?: (reference: string, fieldId: string) => void;
  onLocate: (reference: string) => void;
  onGenerateAnswer?: (reference: string) => void;
  onRevalidateAnswer?: (reference: string) => void;
}

const STATUS_TEXT: Record<CandidateField["status"], { text: string; cls: string }> = {
  ready: { text: "可填写", cls: "status-ready" },
  "need-confirm": { text: "需要确认", cls: "status-confirm" },
  manual: { text: "请人工填写", cls: "status-manual" },
  unknown: { text: "无法识别", cls: "status-muted" },
  empty: { text: "资料库里没有对应内容", cls: "status-muted" },
  "low-confidence": { text: "把握不足，默认不填", cls: "status-muted" },
  unsupported: { text: "这种网页控件不支持", cls: "status-muted" },
  ignored: { text: "已忽略", cls: "status-muted" },
  filled: { text: "已填写", cls: "status-filled" },
  failed: { text: "填写失败", cls: "status-failed" },
  skipped: { text: "已跳过", cls: "status-muted" },
  excluded: { text: "不属于申请表单，已排除", cls: "status-muted" },
};

/** 内容来源 Badge 文案（spec Stage 2 第十章） */
function sourceBadgeText(candidate: CandidateField): { text: string; cls: string } | null {
  const st: ContentSourceType | undefined = candidate.editedValue != null
    ? "manual"
    : candidate.value?.sourceType;
  if (!st || st === "empty") return null;
  const profileType = candidate.value?.profileType as ProfileType | undefined;
  switch (st) {
    case "fact":
      return { text: "基础资料", cls: "src-fact" };
    case "variant":
      return {
        text: profileType ? `${profileTypeLabel(profileType)}版本` : "方向版本",
        cls: "src-variant",
      };
    case "default":
      return { text: "默认版本", cls: "src-default" };
    case "manual":
      return { text: "手动修改", cls: "src-manual" };
    case "ai_grounded":
      return { text: "AI 生成（有事实依据）", cls: "src-ai-grounded" };
    default:
      return null;
  }
}

const INTENT_LABELS: Record<string, string> = {
  why_company: "选择公司的原因",
  why_role: "申请动机",
  role_fit: "岗位匹配",
  self_introduction: "自我介绍",
  strengths: "个人优势",
  representative_project: "代表项目",
  challenge: "困难与解决",
  career_plan: "职业规划",
  motivation: "补充说明",
  other: "开放问题",
};

/** 开放题事实验证结论（PASS/REVIEW/FAIL 的中文说法，枚举值留在 data-val 上给测试与脚本用） */
const VAL_TEXT = {
  pass: { text: "有依据", cls: "val-pass" },
  review: { text: "需核对", cls: "val-review" },
  fail: { text: "无依据", cls: "val-fail" },
} as const;

/** 开放问题卡片区块（spec Stage 4 第二十一章） */
function OpenAnswerBlock(p: {
  candidate: CandidateField;
  onGenerateAnswer?: (reference: string) => void;
  onRevalidateAnswer?: (reference: string) => void;
  onOpenAnswerEdit: (reference: string, value: string) => void;
}) {
  const open = p.candidate.openAnswer!;
  const display = p.candidate.editedValue ?? open.answer ?? "";
  const v = open.validation;
  const guardUnsupported =
    (v?.companyClaims.filter((c) => c.status === "unsupported").length ?? 0) +
    (v?.careerClaims.filter((c) => c.status === "unsupported").length ?? 0) +
    (v?.preferenceClaims.filter((c) => c.status === "unsupported").length ?? 0);
  const val = v ? VAL_TEXT[v.overall] ?? VAL_TEXT.review : null;
  return (
    <div className="open-answer-block">
      <div className="field-row">
        <span className="field-k">类型</span>
        <span className="open-intent-badge">{INTENT_LABELS[open.intent] ?? "开放问题"}</span>
        {val && (
          <span className={`val-badge ${val.cls}`} data-val={v!.overall} title={`事实验证：${v!.overall}`}>
            {val.text}
          </span>
        )}
      </div>

      {open.status === "not_generated" && (
        <div className="field-row">
          <button className="btn-sm" onClick={() => p.onGenerateAnswer?.(p.candidate.raw.reference)}>
            AI 生成回答
          </button>
        </div>
      )}

      {open.status === "insufficient_context" && (
        <div className="fallback-warning">
          ⚠ 信息不足（{open.missingContext?.join("、") ?? "上下文"}），系统拒绝编造。请在 Profile 补充相关配置后重试。
        </div>
      )}

      {(open.status === "generated" || open.status === "edited") && (
        <>
          {open.status === "edited" && (
            <div className="fallback-warning">⚠ 内容已修改，验证已失效，请重新验证。</div>
          )}
          {v && guardUnsupported > 0 && (
            <div className="fallback-warning">
              ⚠ {guardUnsupported} 条公司/职业/偏好表达缺少事实支持（禁止填入）。
            </div>
          )}
          <div className="field-row">
            <span className="field-k">回答</span>
            <textarea
              className="diff-textarea"
              value={display}
              rows={4}
              onChange={(e) => p.onOpenAnswerEdit(p.candidate.raw.reference, e.target.value)}
            />
          </div>
          {v && (
            <div className="field-row">
              <span className="field-k">字数</span>
              <span className={`field-v ${v.length.exceeded ? "length-exceeded" : "muted"}`}>
                {v.length.current} / {v.length.target}
                {v.length.exceeded ? "（超长，禁止截断）" : ""}
              </span>
            </div>
          )}
          {open.status === "edited" && (
            <div className="field-row">
              <button className="btn-sm" onClick={() => p.onRevalidateAnswer?.(p.candidate.raw.reference)}>
                重新验证
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 站点表单上这个控件叫什么（用户认得的就是它，不是 canonical id） */
function labelOf(raw: CandidateField["raw"]): string {
  return raw.context.labelText || raw.context.placeholder || raw.context.name || raw.context.id || "(未命名字段)";
}

/**
 * 「为什么是这个字段」——普通用户可见的匹配依据（不再只在开发者模式里以 JSON 出现）。
 *
 * 理由：Matcher 一直产出 evidence，但界面上只留一个百分比。用户看到「92%」并不能核对
 * 什么——他要的是「它凭什么说这一栏是我的手机号」。现在把同一批依据翻成人话摊开，
 * 并把次选候选露出来：低置信时用户可以一键改挂，而不是只能整项跳过或去网页上手打。
 * 结论仍由 matcher + riskRules + deriveStatus 决定，这里一个字都不改判。
 */
function WhyMatchedBlock(p: {
  explain: MatchExplanation;
  candidate: CandidateField;
  onSwitchField?: (reference: string, fieldId: string) => void;
}) {
  const { explain, candidate } = p;
  const switchable =
    !!explain.alternative &&
    !!p.onSwitchField &&
    candidate.match.fieldId !== "unknown" &&
    (candidate.status === "ready" || candidate.status === "need-confirm" || candidate.status === "filled");
  return (
    <details className="why-box" data-level={explain.level}>
      <summary className="why-summary">
        为什么是「{explain.fieldLabel}」
        <span className={`why-level level-${explain.level}`} data-level={explain.level}>
          {LEVEL_TEXT[explain.level]}
        </span>
      </summary>
      <p className="why-headline">{explain.headline}</p>
      {explain.signals.length > 0 && (
        <ul className="why-signals">
          {explain.signals.map((s, i) => (
            <li key={i}>
              <span className="why-src">{s.sourceLabel}</span>
              <span className="why-text">{s.text}</span>
            </li>
          ))}
        </ul>
      )}
      {explain.alternative && (
        <div className="why-alt">
          也可能是「{explain.alternative.fieldLabel}」（把握 {explain.alternative.percent}%）
          {switchable && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => p.onSwitchField?.(candidate.raw.reference, candidate.match.runnerUpFieldId!)}
            >
              改用这一项
            </button>
          )}
        </div>
      )}
      {explain.blockedReason && <div className="why-blocked">{explain.blockedReason}</div>}
    </details>
  );
}

export function FieldCard(props: FieldCardProps) {
  const { candidate, devMode } = props;
  const { raw, match, risk, status } = candidate;
  const [showEvidence, setShowEvidence] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const explain = explainCandidate(candidate);

  const statusInfo = STATUS_TEXT[status];
  // 内容框：主观/长文本类字段即使已经写入也允许就地改后重写（改完不回写资料库）
  const isReviewEditable =
    (status === "need-confirm" || status === "ready" || status === "filled") && candidate.value?.editable === true;
  const displayValue = candidate.editedValue ?? candidate.value?.value ?? "";
  const def = match.fieldId !== "unknown" ? getCanonicalFieldDef(match.fieldId) : undefined;
  const manualLike = status === "manual" || status === "unsupported";
  const sourceBadge = sourceBadgeText(candidate);

  // 字数约束（不自动截断，仅提醒）
  const maxLen = raw.context.maxLength;
  const lengthInfo =
    maxLen != null && displayValue
      ? { current: displayValue.length, max: maxLen, exceeded: displayValue.length > maxLen }
      : null;

  const confirmable =
    (status === "ready" || status === "need-confirm") && !!candidate.value && risk !== "MANUAL_ONLY";

  const cardCls =
    status === "manual"
      ? "field-card card-manual"
      : status === "need-confirm"
        ? "field-card card-review"
        : status === "ready" || status === "filled"
          ? "field-card card-safe"
          : "field-card card-muted";

  const handleVariant = (variant: string) => {
    if (variant === "short" || variant === "medium" || variant === "long") {
      props.onVariantChange(raw.reference, variant);
    }
  };

  // 紧凑一行：已按资料库填好的客观信息只需要「哪个字段、填了什么、内容从哪来」。
  // 点开才看完整卡片（编辑、定位、调试信息）。
  if (props.compact && !expanded) {
    return (
      <button
        type="button"
        className="field-card field-line"
        data-status={status}
        data-field-id={match.fieldId}
        onClick={() => setExpanded(true)}
        aria-label={`展开这一项：${labelOf(raw)}`}
        title="点开查看 / 修改这一项"
      >
        <span className={`line-dot dot-${status}`} aria-hidden="true" />
        <span className="field-label line-label">{labelOf(raw)}</span>
        <span className="line-value">{displayValue || "—"}</span>
        {sourceBadge && <span className={`source-badge ${sourceBadge.cls}`}>{sourceBadge.text}</span>}
        {devMode && <span className="line-id">{match.fieldId}</span>}
        <span className="line-open">展开</span>
      </button>
    );
  }

  return (
    <div className={cardCls} data-status={status} data-field-id={match.fieldId}>
      <div className="field-head">
        <div className="field-label" title={raw.context.name || raw.context.id}>
          {labelOf(raw)}
        </div>
        <RiskBadge risk={manualLike ? "MANUAL_ONLY" : risk} />
      </div>

      {props.compact && (
        <button type="button" className="line-collapse" onClick={() => setExpanded(false)}>
          收起
        </button>
      )}

      {status === "failed" && candidate.fillDetail && (
        <p className="hint">没填进去：{candidate.fillDetail}</p>
      )}
      {raw.frameId != null && raw.frameId !== 0 && (
        <p className="hint small">该字段在页面内嵌框架里，已按框架单独写入</p>
      )}

      <div className="field-body">
        {candidate.openAnswer && (
          <OpenAnswerBlock
            candidate={candidate}
            onGenerateAnswer={props.onGenerateAnswer}
            onRevalidateAnswer={props.onRevalidateAnswer}
            onOpenAnswerEdit={(ref, val) => {
              props.onEditValue(ref, val);
            }}
          />
        )}
        {!candidate.openAnswer && (
          <>
            {isReviewEditable ? (
              <input
                className="field-value value-input"
                aria-label={`写入内容：${labelOf(raw)}`}
                value={displayValue}
                onChange={(e) => props.onEditValue(raw.reference, e.target.value)}
              />
            ) : (
              <div className={`field-value${displayValue ? "" : " value-empty"}`}>
                {status === "empty" ? "资料库里未找到可用内容，请人工填写" : displayValue || "—"}
              </div>
            )}

            <div className="field-meta">
              <span className={statusInfo.cls} data-status={status}>
                {statusInfo.text}
              </span>
              {sourceBadge && (
                <>
                  <span className="field-meta-sep">·</span>
                  <span className={`source-badge ${sourceBadge.cls}`}>{sourceBadge.text}</span>
                </>
              )}
              <span className="field-meta-sep">·</span>
              {/* 用户看的是中文资料名（「教育经历 · 学校」），canonical id 与百分比留在开发者模式。
                  真机教训：界面上写 basic.name / 99% 时用户既核对不了也复制不了，只会更困惑。 */}
              <span className="field-meta-label" data-field-id={match.fieldId}>
                {fieldFullLabel(match.fieldId)}
              </span>
              {candidate.value && candidate.value.entryCount && candidate.value.entryCount > 1 ? (
                <span className="muted small">（第{(candidate.value.entryIndex ?? 0) + 1}/{candidate.value.entryCount}条）</span>
              ) : null}
              {devMode && (
                <>
                  <span className="field-meta-sep">·</span>
                  <ConfidenceBadge confidence={match.confidence} />
                </>
              )}
              {lengthInfo && (
                <>
                  <span className="field-meta-sep">·</span>
                  <span className={lengthInfo.exceeded ? "meta-warn" : ""}>
                    {lengthInfo.current} / {lengthInfo.max} 字
                    {lengthInfo.exceeded ? "（超出上限，不会自动截断）" : ""}
                  </span>
                </>
              )}
            </div>

            {def?.variants && candidate.value?.editable && (
              <div className="field-row">
                <span className="field-k">版本</span>
                <select
                  className="variant-select"
                  aria-label="选择这段内容的长度版本"
                  value={candidate.value.variant}
                  onChange={(e) => handleVariant(e.target.value)}
                >
                  <option value="short">短（≤120字）</option>
                  <option value="medium">中（121-350字）</option>
                  <option value="long">长（&gt;350字）</option>
                </select>
                <span className="muted small">{displayValue.length} 字</span>
              </div>
            )}

            {candidate.value?.fallbackUsed && (
              <div className="fallback-warning">
                ⚠ {candidate.value.profileType ? `${profileTypeLabel(candidate.value.profileType as ProfileType)}版本未配置，` : ""}
                已使用默认表达。可在 Profile 页补写该方向的岗位方向变体。
              </div>
            )}

            {manualLike && <div className="manual-note">{candidate.riskReason}</div>}
          </>
        )}

        {/* 匹配依据：非开放题、且确实给出了结论（匹配到字段 / 被拦下）时才值得露出。
            开放题已经有自己的事实验证区块，不再叠一层。 */}
        {!candidate.openAnswer && (match.fieldId !== "unknown" || explain.blockedReason) && (
          <WhyMatchedBlock explain={explain} candidate={candidate} onSwitchField={props.onSwitchField} />
        )}
      </div>

      <div className="field-actions">
        {confirmable && (
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={candidate.confirmed ?? false}
              onChange={() => props.onToggleConfirm(raw.reference)}
            />
            确认填写
          </label>
        )}
        <button className="btn-sm" onClick={() => props.onLocate(raw.reference)}>
          定位字段
        </button>
        {status === "ignored" ? (
          /* 跳过得能撤销：否则用户点错一下「忽略」，唯一的出路就是整页重新识别 */
          <button className="btn-sm" onClick={() => props.onUnignore?.(raw.reference)}>
            撤销忽略
          </button>
        ) : (
          status !== "filled" && (
            <button className="btn-sm" onClick={() => props.onIgnore(raw.reference)}>
              忽略这一项
            </button>
          )
        )}
        {status === "filled" && candidate.editedValue != null && (
          /* 改过值又已经填过一次：必须给出「把新值再写进去」的入口，否则改动只活在侧边栏里 */
          <button
            className="btn-sm"
            onClick={() => {
              props.onToggleConfirm(raw.reference);
            }}
          >
            勾选以重写这一项
          </button>
        )}
        <span className="spacer" />
        {devMode && (
          <button className="btn-sm" onClick={() => setShowEvidence((v) => !v)}>
            {showEvidence ? "隐藏调试" : "调试信息"}
          </button>
        )}
      </div>

      {devMode && showEvidence && (
        <pre className="dev-info">
          {JSON.stringify(
            {
              reference: raw.reference,
              kind: raw.kind,
              type: raw.context.inputType,
              maxLength: raw.context.maxLength,
              name: raw.context.name,
              id: raw.context.id,
              signals: {
                label: raw.context.labelText,
                aria: raw.context.ariaLabel,
                placeholder: raw.context.placeholder,
                section: raw.context.sectionTitle,
                fieldset: raw.context.fieldsetLabel,
              },
              match,
              risk,
              riskReason: candidate.riskReason,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
