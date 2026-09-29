import type { BatchMetrics, EvaluationResult } from "./evaluator";

/**
 * Prompt Regression（spec Stage 3.5 第十九/二十章）：
 * 同一 Dataset 分别运行 Prompt v1 / v2，比较核心指标。
 * 输出结构化差异——不自动判定「更好」，因为指标可能互有涨跌
 * （如 Coverage 提升 12% 但 Unsupported Claims 0→2 则不能简单认为 v2 更好）。
 */

export interface EvalRun {
  label: string;
  promptVersion: string;
  provider: string;
  model: string | null;
  metrics: BatchMetrics;
  caseResults: EvaluationResult[];
  ranAt: string;
}

export interface RegressionComparison {
  v1: string;
  v2: string;
  deltas: {
    factPrecision: number;
    requirementCoverage: number;
    unsupportedClaims: number;
    forbiddenHits: number;
    validationFail: number;
  };
  /** 人工判读提示：不允许自动下结论 */
  verdict: string;
}

export function compareRuns(baseline: EvalRun, candidate: EvalRun): RegressionComparison {
  const deltas = {
    factPrecision: Number((candidate.metrics.avgFactPrecision - baseline.metrics.avgFactPrecision).toFixed(3)),
    requirementCoverage: Number((candidate.metrics.avgRequirementCoverage - baseline.metrics.avgRequirementCoverage).toFixed(3)),
    unsupportedClaims: candidate.metrics.totalUnsupportedClaims - baseline.metrics.totalUnsupportedClaims,
    forbiddenHits: candidate.metrics.totalForbiddenHits - baseline.metrics.totalForbiddenHits,
    validationFail: candidate.metrics.validationFail - baseline.metrics.validationFail,
  };
  const qualityUp = deltas.factPrecision >= 0 && deltas.requirementCoverage > 0;
  const safetyDown = deltas.unsupportedClaims > 0 || deltas.forbiddenHits > 0;
  let verdict = "指标互有涨跌，需人工逐 Case 审阅";
  if (qualityUp && !safetyDown) verdict = "候选版本在覆盖率提升的同时未引入新的幻觉风险";
  if (safetyDown) verdict = `候选版本引入了 ${deltas.unsupportedClaims} 条 unsupported / ${deltas.forbiddenHits} 条 forbidden —— 不能仅凭覆盖率认为更好`;
  return { v1: baseline.promptVersion, v2: candidate.promptVersion, deltas, verdict };
}

/** Golden Cases：高价值 Case 子集，每次修改 Prompt/Extractor/Validator/Selection 后必须回归 */
export function goldenCaseIds(): string[] {
  return [
    "case_01", // 高匹配正向
    "case_05", // 数字保持
    "case_07", // 角色不升级
    "case_09", // 极度诱导
    "case_14", // 技术全家桶
    "case_19", // 独立正向表达
  ];
}
