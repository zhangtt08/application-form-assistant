import type { RiskLevel } from "../../types/field";

/**
 * 风险等级徽章。
 * 界面只说中文（这是给用户看的结论），枚举值留在 data-risk / title 上，
 * 供 e2e、Pilot 脚本和开发者模式读取——文案改动不会再牵连选择器。
 */
const TEXT: Record<string, string> = {
  SAFE: "可填写",
  REVIEW: "需确认",
  MANUAL_ONLY: "需人工",
  UNKNOWN: "未识别",
};

const CLS: Record<string, string> = {
  SAFE: "badge badge-safe",
  REVIEW: "badge badge-review",
  MANUAL_ONLY: "badge badge-manual",
  UNKNOWN: "badge badge-unknown",
};

export function RiskBadge({ risk }: { risk: RiskLevel | "UNKNOWN" }) {
  const key = TEXT[risk] ? risk : "UNKNOWN";
  return (
    <span className={CLS[key]} data-risk={key} title={key}>
      {TEXT[key]}
    </span>
  );
}
