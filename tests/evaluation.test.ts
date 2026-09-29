import { describe, expect, it } from "vitest";
import { EVAL_DATASET, ADVERSARIAL_CASES, DATASET_VERSION } from "../evaluation/dataset";
import { evaluateGeneration, summarizeBatch } from "../evaluation/evaluator";
import { numericMutations, responsibilityMutations, technologyMutations, runMutationTests, makeRng } from "../evaluation/mutations";
import { evaluateValidator, LABELED_CLAIMS } from "../evaluation/validatorEval";
import { compareRuns, goldenCaseIds, type EvalRun } from "../evaluation/regression";
import { validateDraft } from "../src/generation/factValidator";

// ---------- Dataset 结构（spec 二十九：20 cases + adversarial ≥10） ----------

describe("Generation Dataset", () => {
  it("至少 20 个 Case，覆盖 6 个岗位方向", () => {
    expect(EVAL_DATASET.length).toBeGreaterThanOrEqual(20);
    const types = new Set(EVAL_DATASET.map((c) => c.profileType));
    expect(types.size).toBeGreaterThanOrEqual(6);
  });

  it("Adversarial 子集至少 10 个", () => {
    expect(ADVERSARIAL_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it("每个 Case 有 expectedSignals 且无敏感个人信息", () => {
    for (const c of EVAL_DATASET) {
      expect(c.expectedSignals.shouldMention.length + c.expectedSignals.mustNotMention.length).toBeGreaterThan(0);
      // 不含真实手机号/邮箱/身份证模式
      expect(c.experienceFacts.map((f) => f.text).join(" ")).not.toMatch(/1[3-9]\d{9}|\d{17}[0-9Xx]|@/);
    }
  });

  it("datasetVersion 存在", () => {
    expect(DATASET_VERSION).toMatch(/^eval-dataset-v\d+$/);
  });
});

// ---------- Evaluator 指标（spec 九~十三） ----------

const CASE = EVAL_DATASET.find((c) => c.id === "case_01")!;

describe("Generation Evaluator", () => {
  it("全部事实支持的 draft → precision 1 / unsupported 0", () => {
    const draft = "完成需求梳理与流程拆解，日处理量 5000-6000 条，准确率稳定 90% 以上，使用 Playwright 与 Python。";
    const r = evaluateGeneration(CASE, draft);
    expect(r.generationSuccess).toBe(true);
    expect(r.factPrecision).toBe(1);
    expect(r.unsupportedClaimRate).toBe(0);
    expect(r.forbiddenHits).toBe(0);
    expect(r.failureTypes).toHaveLength(0);
  });

  it("含编造数字 → unsupported + HALLUCINATED_NUMBER", () => {
    const draft = "完成需求梳理，日处理量 8000 条。";
    const r = evaluateGeneration(CASE, draft);
    expect(r.unsupportedClaimRate).toBeGreaterThan(0);
    expect(r.failureTypes).toContain("HALLUCINATED_NUMBER");
  });

  it("mustNotMention 命中 → forbiddenHits + SEMANTIC_DISTORTION", () => {
    const draft = "使用 LangChain 构建 Agent 流程，需求梳理到位。";
    const r = evaluateGeneration(CASE, draft);
    expect(r.forbiddenHits).toBeGreaterThan(0);
    expect(r.forbiddenTerms).toContain("LangChain");
  });

  it("shouldMention 大面积缺失 → FACT_OMISSION", () => {
    const draft = "完成了相关工作。";
    const r = evaluateGeneration(CASE, draft);
    expect(r.requirementCoverage).toBeLessThan(0.5);
    expect(r.failureTypes).toContain("FACT_OMISSION");
  });

  it("空 draft → generationSuccess=false + INVALID_OUTPUT", () => {
    const r = evaluateGeneration(CASE, "");
    expect(r.generationSuccess).toBe(false);
    expect(r.failureTypes).toContain("INVALID_OUTPUT");
  });

  it("团队/商业术语分类正确", () => {
    const r = evaluateGeneration(CASE, "带领 10 人团队实现 ROI 提升。");
    expect(r.failureTypes).toContain("UNSUPPORTED_TEAM_CLAIM");
    expect(r.failureTypes).toContain("UNSUPPORTED_BUSINESS_RESULT");
  });

  it("summarizeBatch 汇总指标", () => {
    const batch = summarizeBatch([
      evaluateGeneration(CASE, "完成需求梳理，日处理量 5000-6000 条。"),
      evaluateGeneration(CASE, "带领团队实现 ROI 提升。"),
    ]);
    expect(batch.cases).toBe(2);
    expect(batch.validationFail).toBe(1);
    expect(batch.totalForbiddenHits).toBeGreaterThanOrEqual(1);
  });
});

// ---------- Mutation Tests（spec 二十二~二十四，固定 seed） ----------

describe("Mutation Tests", () => {
  it("固定 seed 可重复", () => {
    const rng1 = makeRng(42);
    const rng2 = makeRng(42);
    expect(rng1()).toBe(rng2());
    expect(technologyMutations(makeRng(42)).map((m) => m.mutation))
      .toEqual(technologyMutations(makeRng(42)).map((m) => m.mutation));
  });

  it("Numeric Mutation 全部被 Validator 拦截", () => {
    for (const m of numericMutations(makeRng(42))) {
      expect(validateDraft(m.mutatedDraft, m.facts).status).toBe("fail");
    }
  });

  it("Responsibility Mutation 全部被拦截或标记 uncertain（不放过为 supported）", () => {
    for (const m of responsibilityMutations(makeRng(42))) {
      expect(validateDraft(m.mutatedDraft, m.facts).status).not.toBe("pass");
    }
  });

  it("Technology Mutation 全部被拦截", () => {
    for (const m of technologyMutations(makeRng(42))) {
      expect(validateDraft(m.mutatedDraft, m.facts).status).toBe("fail");
    }
  });

  it("runMutationTests：拦截率 100%（漏检即 FALSE_NEGATIVE）", () => {
    const r = runMutationTests(42);
    expect(r.total).toBeGreaterThanOrEqual(15);
    expect(r.missed).toHaveLength(0);
  });
});

// ---------- Validator 评测（spec 十四/十五） ----------

describe("Validator 评测（人工标注集）", () => {
  it("标注集规模 ≥ 12 条且三类状态都有覆盖", () => {
    expect(LABELED_CLAIMS.length).toBeGreaterThanOrEqual(12);
    const statuses = new Set(LABELED_CLAIMS.map((l) => l.expected));
    expect(statuses.has("supported")).toBe(true);
    expect(statuses.has("unsupported")).toBe(true);
  });

  it("明显 unsupported claim 的拦截率 = 100%（FALSE_NEGATIVE 为 0）", () => {
    const r = evaluateValidator();
    expect(r.falseNegatives).toHaveLength(0);
    expect(r.interceptRate).toBe(1);
  });

  it("语义等价改写不得误杀（false positive 白名单）", () => {
    // Fact「独立开发自动化工具」→ Draft「独立完成自动化工具开发」语义相同，应 supported
    const r = evaluateValidator();
    const fp = r.falsePositives.find((f) => f.claim.includes("独立开发自动化工具"));
    expect(fp).toBeUndefined();
  });

  it("falsePositiveRate 有基线记录（当前 ≤ 0.2）", () => {
    const r = evaluateValidator();
    expect(r.falsePositiveRate).toBeLessThanOrEqual(0.2);
  });
});

// ---------- Prompt Regression（spec 十八~二十） ----------

describe("Regression Runner", () => {
  const makeRun = (label: string, version: string, precision: number, coverage: number, unsupported: number): EvalRun => ({
    label,
    promptVersion: version,
    provider: "mock",
    model: "mock",
    metrics: {
      cases: 20, generationSuccess: 20, validationPass: 17, validationReview: 2, validationFail: 1,
      totalUnsupportedClaims: unsupported, totalForbiddenHits: 0,
      avgFactPrecision: precision, avgRequirementCoverage: coverage,
    },
    caseResults: [],
    ranAt: new Date().toISOString(),
  });

  it("v2 覆盖率提升但 unsupported 增加 → 不允许自动判定更好", () => {
    const v1 = makeRun("v1", "variant-generator-v1", 0.97, 0.7, 0);
    const v2 = makeRun("v2", "variant-generator-v2", 0.97, 0.82, 2);
    const cmp = compareRuns(v1, v2);
    expect(cmp.deltas.requirementCoverage).toBeCloseTo(0.12, 1);
    expect(cmp.deltas.unsupportedClaims).toBe(2);
    expect(cmp.verdict).toContain("不能仅凭覆盖率");
  });

  it("v2 全面更好 → 给出正向判读", () => {
    const v1 = makeRun("v1", "variant-generator-v1", 0.9, 0.7, 2);
    const v2 = makeRun("v2", "variant-generator-v2", 0.97, 0.82, 0);
    const cmp = compareRuns(v1, v2);
    expect(cmp.verdict).toContain("未引入新的幻觉风险");
  });

  it("Golden Cases 固定 6 个高价值 Case", () => {
    expect(goldenCaseIds()).toHaveLength(6);
  });
});

// ---------- Stage 4：Answer Evaluation Dataset ----------

import { ANSWER_DATASET, ANSWER_DATASET_VERSION, evaluateAnswerCase, summarizeAnswerEval } from "../evaluation/answerDataset";

describe("Answer Evaluation Dataset", () => {
  it("10-15 个 Case，含 insufficient 场景", () => {
    expect(ANSWER_DATASET.length).toBeGreaterThanOrEqual(10);
    expect(ANSWER_DATASET.length).toBeLessThanOrEqual(15);
    expect(ANSWER_DATASET.filter((c) => c.expected.expectInsufficient).length).toBeGreaterThanOrEqual(2);
  });

  it("evaluateAnswerCase：该拒绝时拒绝 → insufficientCorrect", () => {
    const c = ANSWER_DATASET.find((x) => x.id === "ans_03")!;
    const r = evaluateAnswerCase(c, { answer: "", status: "insufficient_context" });
    expect(r.insufficientCorrect).toBe(true);
    const bad = evaluateAnswerCase(c, { answer: "未来三年希望成为 CTO。", status: "generated" });
    expect(bad.insufficientCorrect).toBe(false);
  });

  it("该回答时回答 → correct；forbidden 命中统计", () => {
    const c = ANSWER_DATASET.find((x) => x.id === "ans_01")!;
    const good = evaluateAnswerCase(c, { answer: "岗位需要需求梳理能力，我的项目日处理量 5000-6000 条。", status: "generated" });
    expect(good.insufficientCorrect).toBe(true);
    expect(good.forbiddenHits).toBe(0);
    const bad = evaluateAnswerCase(c, { answer: "我精通 LangChain。", status: "generated" });
    expect(bad.forbiddenHits).toBe(1);
  });

  it("summarizeAnswerEval：Insufficient Context Accuracy 汇总", () => {
    const c3 = ANSWER_DATASET.find((x) => x.id === "ans_03")!;
    const c1 = ANSWER_DATASET.find((x) => x.id === "ans_01")!;
    const summary = summarizeAnswerEval([
      evaluateAnswerCase(c3, { answer: "", status: "insufficient_context" }),
      evaluateAnswerCase(c1, { answer: "需求梳理，5000-6000 条。", status: "generated" }),
    ]);
    expect(summary.insufficientContextAccuracy).toBe(1);
    expect(summary.cases).toBe(2);
  });

  it("answerDatasetVersion 存在", () => {
    expect(ANSWER_DATASET_VERSION).toMatch(/^answer-dataset-v\d+$/);
  });
});

// ---------- Stage 4：Answer Evaluation Dataset ----------


describe("Answer Evaluation Dataset", () => {
  it("10-15 个 Case，含 insufficient 场景", () => {
    expect(ANSWER_DATASET.length).toBeGreaterThanOrEqual(10);
    expect(ANSWER_DATASET.length).toBeLessThanOrEqual(15);
    expect(ANSWER_DATASET.filter((c) => c.expected.expectInsufficient).length).toBeGreaterThanOrEqual(2);
  });

  it("evaluateAnswerCase：该拒绝时拒绝 → insufficientCorrect", () => {
    const c = ANSWER_DATASET.find((x) => x.id === "ans_03")!;
    const r = evaluateAnswerCase(c, { answer: "", status: "insufficient_context" });
    expect(r.insufficientCorrect).toBe(true);
    const bad = evaluateAnswerCase(c, { answer: "未来三年希望成为 CTO。", status: "generated" });
    expect(bad.insufficientCorrect).toBe(false);
  });

  it("该回答时回答 → correct；forbidden 命中统计", () => {
    const c = ANSWER_DATASET.find((x) => x.id === "ans_01")!;
    const good = evaluateAnswerCase(c, { answer: "岗位需要需求梳理能力，我的项目日处理量 5000-6000 条。", status: "generated" });
    expect(good.insufficientCorrect).toBe(true);
    expect(good.forbiddenHits).toBe(0);
    const bad = evaluateAnswerCase(c, { answer: "我精通 LangChain。", status: "generated" });
    expect(bad.forbiddenHits).toBe(1);
  });

  it("summarizeAnswerEval：Insufficient Context Accuracy 汇总", () => {
    const c3 = ANSWER_DATASET.find((x) => x.id === "ans_03")!;
    const c1 = ANSWER_DATASET.find((x) => x.id === "ans_01")!;
    const summary = summarizeAnswerEval([
      evaluateAnswerCase(c3, { answer: "", status: "insufficient_context" }),
      evaluateAnswerCase(c1, { answer: "需求梳理，5000-6000 条。", status: "generated" }),
    ]);
    expect(summary.insufficientContextAccuracy).toBe(1);
    expect(summary.cases).toBe(2);
  });

  it("answerDatasetVersion 存在", () => {
    expect(ANSWER_DATASET_VERSION).toMatch(/^answer-dataset-v\d+$/);
  });
});
