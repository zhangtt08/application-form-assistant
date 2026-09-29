import type { Fact } from "../src/generation/types";
import { validateDraft } from "../src/generation/factValidator";
import type { EvalCase } from "./dataset";

/**
 * Generation Evaluator（spec Stage 3.5 第九~十六章）：
 * Dataset Case + Generation Result（draft）+ Validation Report → EvaluationResult。
 * 指标统一口径，使不同 Prompt / Provider 之间可比较。
 */

export type FailureType =
  | "HALLUCINATED_NUMBER"
  | "HALLUCINATED_TECHNOLOGY"
  | "RESPONSIBILITY_UPGRADE"
  | "UNSUPPORTED_BUSINESS_RESULT"
  | "UNSUPPORTED_TEAM_CLAIM"
  | "FACT_OMISSION"
  | "SEMANTIC_DISTORTION"
  | "VALIDATOR_FALSE_POSITIVE"
  | "VALIDATOR_FALSE_NEGATIVE"
  | "INVALID_OUTPUT"
  | "PROVIDER_FAILURE";

export interface EvaluationResult {
  caseId: string;
  generationSuccess: boolean;
  validationStatus: "pass" | "review" | "fail" | "skipped";

  /** supported claims / all factual claims（spec 第十章） */
  factPrecision: number;
  /** unsupported claims / all claims（spec 第十一章，核心指标） */
  unsupportedClaimRate: number;
  /** shouldMention 命中数 / shouldMention 总数（只统计 Facts 可支持的重点，spec 第十二章） */
  requirementCoverage: number;
  /** mustNotMention 命中数（>0 即 critical failure，spec 第十三章） */
  forbiddenHits: number;
  forbiddenTerms: string[];

  unsupportedClaims: string[];
  missingSignals: string[];

  failureTypes: FailureType[];
  draft: string;
}

const BUSINESS_TERMS = /收入|GMV|ROI|转化率|营收|商业收入/;
const TEAM_TERMS = /带领|团队管理|管理 \d+|管理\d+|人团队|团队业绩/;

function classifyFailures(
  caseItem: EvalCase,
  draft: string,
  claims: { kind: string; status: string; claim: string; reason?: string }[],
  facts: Fact[],
): FailureType[] {
  const types = new Set<FailureType>();
  for (const c of claims) {
    if (c.status !== "unsupported") continue;
    if (c.kind === "numeric") {
      types.add(BUSINESS_TERMS.test(c.claim) ? "UNSUPPORTED_BUSINESS_RESULT" : "HALLUCINATED_NUMBER");
    } else if (c.kind === "technology") {
      types.add("HALLUCINATED_TECHNOLOGY");
    } else if (c.kind === "responsibility") {
      types.add(TEAM_TERMS.test(c.claim) ? "UNSUPPORTED_TEAM_CLAIM" : "RESPONSIBILITY_UPGRADE");
    } else if (BUSINESS_TERMS.test(c.claim)) {
      types.add("UNSUPPORTED_BUSINESS_RESULT");
    } else if (TEAM_TERMS.test(c.claim)) {
      types.add("UNSUPPORTED_TEAM_CLAIM");
    } else {
      types.add("SEMANTIC_DISTORTION");
    }
  }
  // Draft 级补充分类：团队/商业语义词出现在 draft，但事实集合完全无对应支持
  const factText = facts.map((f) => f.text).join(' ');
  if (TEAM_TERMS.test(draft) && !/团队|带领|管理/.test(factText)) types.add('UNSUPPORTED_TEAM_CLAIM');
  if (BUSINESS_TERMS.test(draft) && !/收入|GMV|ROI|转化率|营收/.test(factText)) types.add('UNSUPPORTED_BUSINESS_RESULT');
  // shouldMention 缺失过多（>50%）→ FACT_OMISSION
  const missing = caseItem.expectedSignals.shouldMention.filter(
    (s) => !draft.toLowerCase().includes(s.toLowerCase()),
  );
  if (caseItem.expectedSignals.shouldMention.length > 0 && missing.length > caseItem.expectedSignals.shouldMention.length / 2) {
    types.add("FACT_OMISSION");
  }
  return [...types];
}

/** 评估单条生成结果（draft 为空/异常时 generationSuccess=false） */
export function evaluateGeneration(caseItem: EvalCase, draft: string | null): EvaluationResult {
  if (draft === null || !draft.trim()) {
    return {
      caseId: caseItem.id,
      generationSuccess: false,
      validationStatus: "skipped",
      factPrecision: 0,
      unsupportedClaimRate: 0,
      requirementCoverage: 0,
      forbiddenHits: 0,
      forbiddenTerms: [],
      unsupportedClaims: [],
      missingSignals: caseItem.expectedSignals.shouldMention,
      failureTypes: ["INVALID_OUTPUT"],
      draft: draft ?? "",
    };
  }

  const facts: Fact[] = caseItem.experienceFacts.map((f, i) => ({
    id: `fact_${String(i + 1).padStart(3, "0")}`,
    type: f.type,
    text: f.text,
  }));
  const report = validateDraft(draft, facts);
  const all = report.claims.length;
  const unsupported = report.claims.filter((c) => c.status === "unsupported");
  const factual = report.claims.filter((c) => c.kind !== "sentence");
  const supportedFactual = factual.filter((c) => c.status === "supported").length;

  const forbiddenTerms = caseItem.expectedSignals.mustNotMention.filter((term) =>
    draft.toLowerCase().includes(term.toLowerCase()),
  );

  const covered = caseItem.expectedSignals.shouldMention.filter(
    (s) => draft.toLowerCase().includes(s.toLowerCase()),
  );

  const failureTypes = classifyFailures(caseItem, draft, report.claims, facts);
  if (forbiddenTerms.length > 0) failureTypes.unshift("SEMANTIC_DISTORTION");

  return {
    caseId: caseItem.id,
    generationSuccess: true,
    validationStatus: report.status,
    factPrecision: factual.length > 0 ? Number((supportedFactual / factual.length).toFixed(3)) : 1,
    unsupportedClaimRate: all > 0 ? Number((unsupported.length / all).toFixed(3)) : 0,
    requirementCoverage: caseItem.expectedSignals.shouldMention.length > 0
      ? Number((covered.length / caseItem.expectedSignals.shouldMention.length).toFixed(3))
      : 1,
    forbiddenHits: forbiddenTerms.length,
    forbiddenTerms,
    unsupportedClaims: unsupported.map((c) => c.claim.slice(0, 40)),
    missingSignals: caseItem.expectedSignals.shouldMention.filter(
      (s) => !draft.toLowerCase().includes(s.toLowerCase()),
    ),
    failureTypes,
    draft,
  };
}

/** 批次汇总（spec 第三十章 Evaluation Report 的 metrics 段） */
export interface BatchMetrics {
  cases: number;
  generationSuccess: number;
  validationPass: number;
  validationReview: number;
  validationFail: number;
  totalUnsupportedClaims: number;
  totalForbiddenHits: number;
  avgFactPrecision: number;
  avgRequirementCoverage: number;
}

export function summarizeBatch(results: EvaluationResult[]): BatchMetrics {
  const n = results.length || 1;
  return {
    cases: results.length,
    generationSuccess: results.filter((r) => r.generationSuccess).length,
    validationPass: results.filter((r) => r.validationStatus === "pass").length,
    validationReview: results.filter((r) => r.validationStatus === "review").length,
    validationFail: results.filter((r) => r.validationStatus === "fail").length,
    totalUnsupportedClaims: results.reduce((s, r) => s + r.unsupportedClaims.length, 0),
    totalForbiddenHits: results.reduce((s, r) => s + r.forbiddenHits, 0),
    avgFactPrecision: Number((results.reduce((s, r) => s + r.factPrecision, 0) / n).toFixed(3)),
    avgRequirementCoverage: Number((results.reduce((s, r) => s + r.requirementCoverage, 0) / n).toFixed(3)),
  };
}
