import { validateDraft } from "../src/generation/factValidator";
import type { Fact, ClaimStatus } from "../src/generation/types";

/**
 * Validator 评测（spec Stage 3.5 第十四/十五章）：
 * 人工标注的 Claim 标注集（每条 claim 配对**专属事实组**——spec 十四示例语义：
 * 「Facts：参与项目开发 → 主导项目开发 = unsupported」是相对该事实组的判定）。
 * 统计 Validator 的拦截率（False Negative）与误杀率（False Positive）。
 * 目标不是完美数字，而是建立可重复评测基线。
 */

export interface LabeledClaim {
  claim: string;
  /** 人工标记的真实状态 */
  expected: ClaimStatus;
  /** 该 claim 对应的专属事实组 */
  facts: Fact[];
}

const PARTICIPATION_FACTS: Fact[] = [{ id: "fact_001", type: "responsibility", text: "参与项目开发与测试工作" }];
const INDEPENDENT_FACTS: Fact[] = [{ id: "fact_001", type: "responsibility", text: "独立开发自动化工具" }];
const METRIC_FACTS: Fact[] = [
  { id: "fact_001", type: "metric", text: "日处理量 5000-6000 条" },
  { id: "fact_002", type: "metric", text: "准确率稳定 90%+" },
];
const TECH_FACTS: Fact[] = [{ id: "fact_001", type: "technology", text: "使用 Playwright" }];

export const LABELED_CLAIMS: LabeledClaim[] = [
  // supported：与事实组一致
  { claim: "参与项目开发", expected: "supported", facts: PARTICIPATION_FACTS },
  { claim: "独立开发自动化工具", expected: "supported", facts: INDEPENDENT_FACTS },
  { claim: "独立完成自动化工具开发", expected: "supported", facts: INDEPENDENT_FACTS },
  { claim: "日处理量 5000-6000 条", expected: "supported", facts: METRIC_FACTS },
  { claim: "准确率 90%", expected: "supported", facts: METRIC_FACTS },
  { claim: "使用 Playwright", expected: "supported", facts: TECH_FACTS },
  // unsupported：明确编造 / 强度升级（spec 十四/十五示例）
  { claim: "主导项目开发", expected: "unsupported", facts: PARTICIPATION_FACTS },
  { claim: "负责项目开发", expected: "unsupported", facts: PARTICIPATION_FACTS },
  { claim: "带领 5 人团队", expected: "unsupported", facts: PARTICIPATION_FACTS },
  { claim: "日处理量 8000 条", expected: "unsupported", facts: METRIC_FACTS },
  { claim: "使用 LangChain", expected: "unsupported", facts: TECH_FACTS },
  { claim: "准确率 95%", expected: "unsupported", facts: METRIC_FACTS },
  // uncertain：部分重叠（语义近似但措辞扩展）
  { claim: "参与项目开发与跨团队协作", expected: "uncertain", facts: PARTICIPATION_FACTS },
];

export interface ValidatorEvalResult {
  total: number;
  correct: number;
  /** 事实支持但 Validator 判 unsupported（spec 第十五章） */
  falsePositives: { claim: string; got: string }[];
  /** 明显 unsupported 但 Validator 未拦截（spec 第十四章） */
  falseNegatives: { claim: string; got: string }[];
  /** uncertain 判定差异（不计数为 FP/FN，单独记录） */
  uncertainMismatches: { claim: string; expected: string; got: string }[];
  interceptRate: number;
  falsePositiveRate: number;
}

/** 运行 Validator 评测：每条标注 claim 在其专属事实组上走 validateDraft */
export function evaluateValidator(): ValidatorEvalResult {
  let correct = 0;
  const falsePositives: { claim: string; got: string }[] = [];
  const falseNegatives: { claim: string; got: string }[] = [];
  const uncertainMismatches: { claim: string; expected: string; got: string }[] = [];
  let unsupportedExpected = 0;
  let unsupportedIntercepted = 0;

  for (const labeled of LABELED_CLAIMS) {
    const draft = `${labeled.claim}。`;
    const report = validateDraft(draft, labeled.facts);
    // 定位与标注 claim 最相关的检查项：类型 claim（numeric/tech/responsibility）优先，
    // 因为 sentence claim 的文本恰为整句时总与 labeled.claim 相同，但类型判定更精确
    const relevant =
      report.claims.find((c) => c.kind !== "sentence" && labeled.claim.includes(c.claim)) ??
      report.claims.find((c) => c.claim === labeled.claim) ??
      report.claims[0];
    const got = relevant?.status ?? "unsupported";
    if (labeled.expected === "unsupported") {
      unsupportedExpected += 1;
      if (got === "unsupported") unsupportedIntercepted += 1;
      else falseNegatives.push({ claim: labeled.claim, got });
    } else if (got === labeled.expected) {
      correct += 1;
    } else if (labeled.expected === "supported" && got === "unsupported") {
      falsePositives.push({ claim: labeled.claim, got });
    } else {
      uncertainMismatches.push({ claim: labeled.claim, expected: labeled.expected, got });
    }
  }

  return {
    total: LABELED_CLAIMS.length,
    correct,
    falsePositives,
    falseNegatives,
    uncertainMismatches,
    interceptRate: unsupportedExpected > 0 ? Number((unsupportedIntercepted / unsupportedExpected).toFixed(3)) : 1,
    falsePositiveRate: Number((falsePositives.length / LABELED_CLAIMS.length).toFixed(3)),
  };
}
