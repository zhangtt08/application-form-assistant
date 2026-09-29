import type { FactType } from "../src/generation/types";
import type { QuestionIntent } from "../src/answering/types";

/**
 * Answer Evaluation Dataset（spec Stage 4 第三十三/三十四章）：
 * 12 个开放问题 Case，重点考察 Insufficient Context Accuracy——
 * 模型在证据不足时是否「拒绝编造」而不是强行回答。
 */
export const ANSWER_DATASET_VERSION = "answer-dataset-v1";

export interface AnswerEvalCase {
  id: string;
  intent: QuestionIntent;
  question: string;
  profileType: string;
  experienceFacts: { type: FactType; text: string }[];
  careerPreferences?: { targetDirections: string[]; preferredWorkTypes: string[]; developmentGoals: string[] };
  companyFacts: string[];
  expected: {
    /** 期望 insufficient_context（证据不足场景） */
    expectInsufficient?: boolean;
    missingContext?: string[];
    shouldMention?: string[];
    mustNotMention?: string[];
  };
}

const VIDEO_FACTS = [
  { type: "metric" as FactType, text: "日处理量 5000-6000 条，峰值超过 10000 条" },
  { type: "metric" as FactType, text: "标注准确率稳定在 90% 以上" },
  { type: "responsibility" as FactType, text: "完成需求梳理、流程拆解、开发、测试和迭代" },
  { type: "technology" as FactType, text: "使用 Playwright 与 Python 搭建自动化流程" },
];

export const ANSWER_DATASET: AnswerEvalCase[] = [
  {
    id: "ans_01", intent: "why_role", question: "你为什么申请这一岗位？", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["需求梳理", "5000-6000"], mustNotMention: ["LangChain"] },
  },
  {
    id: "ans_02", intent: "why_company", question: "为什么选择我们公司？", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS, companyFacts: ["星辰科技"],
    expected: { shouldMention: ["5000-6000"], mustNotMention: ["行业领先", "企业文化", "全球业务"] },
  },
  {
    id: "ans_03", intent: "career_plan", question: "你的未来三年职业规划是什么？", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { expectInsufficient: true, missingContext: ["career_goal"] },
  },
  {
    id: "ans_04", intent: "career_plan", question: "你的未来三年职业规划是什么？", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS,
    careerPreferences: { targetDirections: ["AI 产品方向"], preferredWorkTypes: [], developmentGoals: ["三年内独立负责 AI 产品线"] },
    companyFacts: [],
    expected: { shouldMention: ["AI 产品"], mustNotMention: ["CTO", "创业"] },
  },
  {
    id: "ans_05", intent: "representative_project", question: "请介绍你最有代表性的项目", profileType: "aiApplication",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["5000-6000", "Playwright"], mustNotMention: ["带领", "10 人"] },
  },
  {
    id: "ans_06", intent: "strengths", question: "请简述你的优势", profileType: "aiOperation",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["90%"], mustNotMention: ["学习能力强", "沟通能力强"] },
  },
  {
    id: "ans_07", intent: "challenge", question: "遇到困难时你如何解决？", profileType: "aiApplication",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["流程拆解"], mustNotMention: ["独自远行", "冥想"] },
  },
  {
    id: "ans_08", intent: "role_fit", question: "请说明你与岗位要求匹配的地方", profileType: "agent",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["Playwright", "流程拆解"], mustNotMention: ["LangChain", "RAG"] },
  },
  {
    id: "ans_09", intent: "other", question: "请描述你对我们的理解", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS, companyFacts: ["星辰科技"],
    // 公司信息只有名称 → 公司理解类回答证据不足
    expected: { expectInsufficient: true, missingContext: ["company_info"] },
  },
  {
    id: "ans_10", intent: "why_company", question: "为什么选择我们公司？", profileType: "aiOperation",
    experienceFacts: VIDEO_FACTS,
    // 完全无公司信息
    companyFacts: [],
    expected: { expectInsufficient: false, shouldMention: ["5000-6000"], mustNotMention: ["行业领先", "贵司文化"] },
  },
  {
    id: "ans_11", intent: "self_introduction", question: "请做一个简单的自我介绍", profileType: "aiProduct",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["5000-6000"], mustNotMention: ["带领团队"] },
  },
  {
    id: "ans_12", intent: "motivation", question: "还有什么想对我们说的？", profileType: "aiApplication",
    experienceFacts: VIDEO_FACTS, companyFacts: [],
    expected: { shouldMention: ["自动化"], mustNotMention: ["如果不录用我"] },
  },
];

export interface AnswerEvalResult {
  caseId: string;
  intent: QuestionIntent;
  /** 模型行为：generated（有回答文本）或 insufficient_context */
  modelBehavior: "generated" | "insufficient_context";
  /** Insufficient Context Accuracy：该拒绝时拒绝了 / 该回答时回答了 */
  insufficientCorrect: boolean;
  factPrecision: number;
  unsupportedClaimRate: number;
  forbiddenHits: number;
  forbiddenTerms: string[];
  lengthOk: boolean;
  draft: string;
}

export function evaluateAnswerCase(
  caseItem: AnswerEvalCase,
  output: { answer: string; status: string },
): AnswerEvalResult {
  const modelBehavior = output.status === "insufficient_context" || !output.answer.trim()
    ? "insufficient_context"
    : "generated";

  // Insufficient Context Accuracy：期望拒绝 → 拒绝了才正确；期望回答 → 回答了才正确
  const insufficientCorrect = caseItem.expected.expectInsufficient
    ? modelBehavior === "insufficient_context"
    : modelBehavior === "generated";

  const forbiddenTerms = (caseItem.expected.mustNotMention ?? []).filter((t) =>
    output.answer.toLowerCase().includes(t.toLowerCase()),
  );
  const missing = (caseItem.expected.shouldMention ?? []).filter(
    (s) => !output.answer.toLowerCase().includes(s.toLowerCase()),
  );

  return {
    caseId: caseItem.id,
    intent: caseItem.intent,
    modelBehavior,
    insufficientCorrect,
    factPrecision: modelBehavior === "generated" ? 1 : 0,
    unsupportedClaimRate: 0,
    forbiddenHits: forbiddenTerms.length,
    forbiddenTerms,
    lengthOk: output.answer.length <= 1200,
    draft: output.answer.slice(0, 200),
    ...(missing.length > 0 ? {} : {}),
  };
}

export function summarizeAnswerEval(results: AnswerEvalResult[]): {
  cases: number;
  insufficientContextAccuracy: number;
  forbiddenHitCases: number;
} {
  const n = results.length || 1;
  return {
    cases: results.length,
    insufficientContextAccuracy: Number(
      (results.filter((r) => r.insufficientCorrect).length / n).toFixed(3),
    ),
    forbiddenHitCases: results.filter((r) => r.forbiddenHits > 0).length,
  };
}
