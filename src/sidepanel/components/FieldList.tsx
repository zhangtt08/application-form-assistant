import { useState } from "react";
import type { CandidateField } from "../../types/field";
import { fieldGroup, groupLabel } from "../../core";
import { FieldCard } from "./FieldCard";

export interface FieldListProps {
  candidates: CandidateField[];
  devMode: boolean;
  onToggleConfirm: (reference: string) => void;
  onEditValue: (reference: string, value: string) => void;
  onIgnore: (reference: string) => void;
  onUnignore?: (reference: string) => void;
  onSwitchField?: (reference: string, fieldId: string) => void;
  onConfirmLowConfidence?: (reference: string) => void;
  onBlockOnSite?: (reference: string) => void;
  onUndoSiteRule?: (ruleId: string) => void;
  siteHost?: string;
  onLocate: (reference: string) => void;
  onGenerateAnswer?: (reference: string) => void;
  onRevalidateAnswer?: (reference: string) => void;
}

/**
 * 板块（canonical group）展示顺序；中文名取自 core 的 groupLabel —— 板块名只允许有一处定义。
 * "other" 不在 canonical 分组里，单独给一个界面用词。
 */
const GROUP_ORDER = ["basic", "education", "internship", "campus", "project", "skills", "job", "content"] as const;
const OTHER_GROUP_LABEL = "未识别 / 需人工处理";

const GROUPS: { id: string; label: string }[] = [
  ...GROUP_ORDER.map((id) => ({ id, label: groupLabel(id) ?? id })),
  { id: "other", label: OTHER_GROUP_LABEL },
];

const STATUS_ORDER: Record<string, number> = {
  "need-confirm": 0,
  ready: 1,
  manual: 2,
  failed: 3,
  unsupported: 4,
  unknown: 5,
  "low-confidence": 6,
  empty: 7,
  ignored: 8,
  filled: 9,
  skipped: 10,
};

/** 按「用户要做什么」分桶 —— 这是理解成本最低的分组方式 */
type BucketId = "review" | "auto" | "manual";

const BUCKETS: { id: BucketId; label: string; hint: string }[] = [
  { id: "review", label: "需要你确认", hint: "内容已匹配，但风险等级或识别置信度需要你过一眼" },
  { id: "auto", label: "可直接填写 / 已填写", hint: "内容已匹配到资料库，识别完成后会直接写入页面" },
  { id: "manual", label: "需人工处理", hint: "敏感字段、暂不支持的控件，或资料里没有对应内容" },
];

function bucketOf(c: CandidateField): BucketId {
  // 低置信不是「需人工处理」——资料有、字段也像，缺的只是人点一次头，
  // 所以它和 AI 回答一起归到「需要你确认」那一桶，卡片上就带着放行按钮。
  if (c.status === "need-confirm" || c.status === "low-confidence") return "review";
  if (c.status === "ready" || c.status === "filled") return "auto";
  return "manual";
}

function groupOf(c: CandidateField): string {
  if (c.match.fieldId !== "unknown") {
    return fieldGroup(c.match.fieldId) ?? "other";
  }
  return "other";
}

function sortByStatus(list: CandidateField[]): CandidateField[] {
  return [...list].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
}

/**
 * 字段清单（折叠分桶）。
 * 改造前：9 个板块全部展开，几十张卡片一次性铺满，用户不知道从哪看起；
 * 改造后：默认只展开「需要你确认」，其余折叠成一行标题 + 数量。
 */
export function FieldList(props: FieldListProps) {
  const [mode, setMode] = useState<"action" | "section">("action");
  // Safety Flow：用户点「查看填写预览」= 明确要逐字段 Review → 三个桶默认全展开（可手动收起）
  const [open, setOpen] = useState<Record<string, boolean>>({ review: true, auto: true, manual: true });

  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  /**
   * 哪些卡片压成一行：状态是可填写/已填写、且不是开放题、也不是「用户可改内容的长文本」。
   * 客观信息（姓名、手机号、学校）没什么可看的，一行足够；
   * 长文本与开放题是「值得核对」的内容，保持完整卡片。
   */
  const isCompact = (c: CandidateField): boolean =>
    (c.status === "ready" || c.status === "filled") && !c.openAnswer && c.value?.editable !== true;

  const renderCards = (list: CandidateField[]) =>
    sortByStatus(list).map((c) => (
      <FieldCard
        key={c.raw.reference}
        candidate={c}
        devMode={props.devMode}
        compact={isCompact(c)}
        onToggleConfirm={props.onToggleConfirm}
        onEditValue={props.onEditValue}
        onIgnore={props.onIgnore}
        onUnignore={props.onUnignore}
        onSwitchField={props.onSwitchField}
        onConfirmLowConfidence={props.onConfirmLowConfidence}
        onBlockOnSite={props.onBlockOnSite}
        onUndoSiteRule={props.onUndoSiteRule}
        siteHost={props.siteHost}
        onLocate={props.onLocate}
        onGenerateAnswer={props.onGenerateAnswer}
        onRevalidateAnswer={props.onRevalidateAnswer}
      />
    ));

  // issue-004：被语境门禁排除的控件不进任何填写桶，也绝不显示「请人工填写」——
  // 那会把一个登录框伪装成待填的申请字段（§二十）。Dev 模式下仍可展开看排除原因。
  const excludedCards = props.candidates.filter((c) => c.status === "excluded");
  const pool = props.candidates.filter((c) => c.status !== "excluded");

  const buckets: { key: string; label: string; hint: string; list: CandidateField[] }[] =
    mode === "action"
      ? BUCKETS.map((b) => ({
          key: b.id,
          label: b.label,
          hint: b.hint,
          list: pool.filter((c) => bucketOf(c) === b.id),
        })).filter((b) => b.list.length > 0)
      : GROUPS.map((g) => ({
          key: g.id,
          label: g.label,
          hint: "",
          list: pool.filter((c) => groupOf(c) === g.id),
        })).filter((g) => g.list.length > 0);

  return (
    <div className="field-list">
      <div className="segmented segmented-sm">
        <button
          type="button"
          className={mode === "action" ? "seg-item active" : "seg-item"}
          onClick={() => setMode("action")}
        >
          按状态
        </button>
        <button
          type="button"
          className={mode === "section" ? "seg-item active" : "seg-item"}
          onClick={() => setMode("section")}
        >
          按板块
        </button>
      </div>

      {excludedCards.length > 0 && (
        <div className="fold" data-excluded-count={excludedCards.length}>
          <div className="fold-note">
            已忽略 {excludedCards.length} 个网页控件——它们不属于申请表单（登录 / 搜索 / 导航等全局区域）
          </div>
          {props.devMode && renderCards(excludedCards)}
        </div>
      )}

      {buckets.map((b) => {
        const isOpen = open[b.key] ?? false;
        return (
          <section key={b.key} className="fold">
            <button type="button" className="fold-head" onClick={() => toggle(b.key)}>
              <span className={`fold-caret ${isOpen ? "open" : ""}`}>▸</span>
              <span className="fold-label">{b.label}</span>
              <span className="fold-count">{b.list.length}</span>
            </button>
            {isOpen && (
              <div className="fold-body">
                {b.hint && <p className="fold-hint">{b.hint}</p>}
                {renderCards(b.list)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
