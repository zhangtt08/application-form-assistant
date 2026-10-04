import type { CandidateField, MatchResult } from "../types/field";
import { confidenceLevel } from "../matching/matcher";
import { fieldFullLabel } from "./fieldLabels";

/**
 * 「为什么匹配到这个字段」的可解释层。
 *
 * Matcher 本来就产出了 `evidence`（命中了哪个信号源、哪个别名、被哪个上下文加成），
 * 过去它只在开发者模式下以 JSON 原样打印——普通用户读不懂 `label=姓名 · section=基本` ，
 * 于是「置信度 92%」对他来说仍然是一个无法核对的黑盒数字。
 *
 * 本模块只做**翻译**，不做任何新判定：结论（填 / 不填 / 拦下）全部来自
 * matcher + riskRules + deriveStatus，这里一个字都不改判。
 * 扩展 UI 与 `agent/tools.mjs` 共用这一份，避免两边各写一套解释口径。
 */

/** 信号源中文名（与 matcher 的 buildSignals 一一对应） */
const SIGNAL_LABELS: Record<string, string> = {
  label: "字段标签",
  aria: "无障碍标签（aria-label）",
  placeholder: "输入框提示文字",
  name: "表单控件 name",
  id: "表单控件 id",
  title: "字段说明（title）",
  prevSibling: "紧邻的前一个元素",
  fieldset: "所属分组标题",
  parent: "附近容器文字",
  section: "所在板块标题",
};

export interface MatchSignal {
  /** 原始信号源键（label/aria/…），给测试与开发者模式用 */
  source: string;
  /** 「字段标签」这样的中文 */
  sourceLabel: string;
  /** 命中的文本（已按 matcher 口径截断） */
  text: string;
}

export interface MatchExplanation {
  /** 匹配到的资料字段中文名；未匹配时为「未匹配到资料」 */
  fieldLabel: string;
  /** HIGH / MEDIUM / LOW —— 与 ConfidenceBadge 同一判据，不另立标准 */
  level: "HIGH" | "MEDIUM" | "LOW";
  /** 百分比（0-100，四舍五入） */
  percent: number;
  /** 一句话结论，直接可以显示 */
  headline: string;
  /** 逐条依据（最多 3 条，与 matcher 保留的 evidence 数一致） */
  signals: MatchSignal[];
  /** 次选候选（存在即说明这一项有歧义，值得让用户核对） */
  alternative?: { fieldLabel: string; percent: number };
  /** 被红线/守卫拦下时的原因（MANUAL_ONLY、语境门禁、选项对不上等） */
  blockedReason?: string;
}

/** 把 matcher 的一条 evidence 串翻成「信号源 + 命中文本」 */
function toSignal(evidence: string): MatchSignal | null {
  const eq = evidence.indexOf("=");
  if (eq <= 0) return null;
  const source = evidence.slice(0, eq);
  const text = evidence.slice(eq + 1);
  if (!text) return null;
  if (source === "options") return { source, sourceLabel: "网页给的选项", text: text.replace(/^\[|\]$/g, "").replace(/\//g, "、") };
  if (source === "autocomplete") return { source, sourceLabel: "网页自己声明的字段类型", text: `autocomplete="${text}"` };
  if (source === "type") return { source, sourceLabel: "网页自己声明的输入类型", text: `type="${text}"` };
  if (source === "siteMemory") {
    return { source, sourceLabel: "站点设定（你人工指定过）", text };
  }
  const sourceLabel = SIGNAL_LABELS[source];
  if (!sourceLabel) return null;
  return { source, sourceLabel, text };
}

/** matcher 的「放弃判定」类证据本身就是给人看的一句话，原样透出 */
function isPlainReason(evidence: string): boolean {
  return !evidence.includes("=") && /[^\x00-\x7F]/.test(evidence);
}

function percentOf(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

export function explainMatchResult(match: MatchResult): MatchExplanation {
  const level = confidenceLevel(match.confidence);
  const percent = percentOf(match.confidence);
  const matched = match.fieldId !== "unknown";

  const signals = match.evidence
    .map(toSignal)
    .filter((s): s is MatchSignal => !!s);
  const plainReasons = match.evidence.filter(isPlainReason);

  let headline: string;
  if (!matched) {
    headline = plainReasons[0] ?? "这个字段没有对上资料库里的任何一项，留给你人工处理。";
  } else if (level === "HIGH") {
    const why = signals[0]
      ? signals[0].source === "siteMemory"
        ? `网页上这栏写着「${signals[0].text}」，它的归属是你在这一站人工指定过的`
        : `${signals[0].sourceLabel}写着「${signals[0].text}」`
      : "多个信号一致";
    headline = `匹配到「${fieldFullLabel(match.fieldId)}」——${why}。`;
  } else if (level === "MEDIUM") {
    headline = `大概率是「${fieldFullLabel(match.fieldId)}」（把握中等），请你过一眼。`;
  } else {
    headline = `可能是「${fieldFullLabel(match.fieldId)}」，但把握不足，扩展没有自动填它。`;
  }

  const explanation: MatchExplanation = {
    fieldLabel: fieldFullLabel(match.fieldId),
    level,
    percent,
    headline,
    signals,
  };
  if (match.runnerUpFieldId && matched) {
    explanation.alternative = {
      fieldLabel: fieldFullLabel(match.runnerUpFieldId),
      percent: percentOf(match.runnerUpConfidence ?? 0),
    };
  }
  return explanation;
}

/**
 * 候选字段卡片的完整解释：匹配依据 + 被拦下的原因。
 * `blockedReason` 优先说红线（MANUAL_ONLY / 语境排除 / 选项对不上 / 超长），
 * 因为这些是「扩展故意不填」，用户最需要知道的就是这一类。
 */
export function explainCandidate(c: CandidateField): MatchExplanation {
  const base = explainMatchResult(c.match);
  const isRedline =
    c.status === "manual" || c.status === "excluded" || c.status === "unsupported" || c.risk === "MANUAL_ONLY";
  if (isRedline && c.riskReason) base.blockedReason = c.riskReason;
  else if (c.status === "low-confidence") base.blockedReason = c.riskReason;
  else if (c.status === "failed" && c.fillDetail) base.blockedReason = c.fillDetail;
  else if (c.status === "empty") base.blockedReason = "资料库里没有这一项的内容，先去「资料」页补上。";
  else if (c.status === "ignored")
    base.blockedReason = c.siteRule
      ? `这一栏按你在 ${c.siteRule.host} 上定过的设定跳过，扩展没有写它。`
      : "你刚才选择了跳过这一项。";
  return base;
}

/** 置信度等级的中文说法（界面文案集中在这里，避免多处各写一遍） */
export const LEVEL_TEXT: Record<MatchExplanation["level"], string> = {
  HIGH: "把握高",
  MEDIUM: "把握中等",
  LOW: "把握不足",
};
