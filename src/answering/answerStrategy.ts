import type { Fact, FactType, JobRequirementProfile } from "../generation/types";
import type { ProfileType } from "../job/profileTypes";
import type { QuestionIntent } from "./types";

/**
 * Answer Strategy（spec Stage 4 第九~十章）+ Fact Selection（第六章）：
 * 不同 intent 对应不同回答结构与事实偏好；personal/company facts 严格分离。
 */

export interface AnswerStrategy {
  intent: QuestionIntent;
  /** 回答结构（按序段落要点，写进 Prompt 约束组织方式） */
  structure: string[];
  /** 个人事实类型偏好（权重） */
  factTypePreference: Partial<Record<FactType, number>>;
  /** 该 intent 是否允许引用公司信息（why_company 专用，且仅限 COMPANY_FACTS 明确内容） */
  allowsCompanyFacts: boolean;
  /** 该 intent 需要 careerPreferences；缺失 → insufficient_context */
  requiresCareerFacts: boolean;
}

export const ANSWER_STRATEGIES: Record<QuestionIntent, AnswerStrategy> = {
  why_role: {
    intent: "why_role",
    structure: ["岗位工作内容", "自己已有的相关实践", "希望继续发展的方向"],
    factTypePreference: { responsibility: 2.5, metric: 2, result: 2, technology: 1.5, context: 0.5 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  why_company: {
    intent: "why_company",
    structure: ["岗位与工作方向", "自己已有相关实践", "希望参与的工作方向"],
    factTypePreference: { responsibility: 2.5, metric: 2, result: 2, technology: 1, context: 0.5 },
    allowsCompanyFacts: true,
    requiresCareerFacts: false,
  },
  role_fit: {
    intent: "role_fit",
    structure: ["能力", "对应事实证据", "与 JD 要求的连接"],
    factTypePreference: { responsibility: 2, metric: 2.5, result: 2.5, technology: 2, context: 0.5 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  representative_project: {
    intent: "representative_project",
    structure: ["背景与问题", "做了什么", "使用什么方法", "结果"],
    factTypePreference: { metric: 2.5, result: 2.5, responsibility: 2, technology: 2, context: 1 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  challenge: {
    intent: "challenge",
    structure: ["问题", "判断", "行动", "结果与学习"],
    factTypePreference: { responsibility: 2.5, result: 2, metric: 2, technology: 1.5, context: 0.5 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  strengths: {
    intent: "strengths",
    structure: ["能力", "具体经历证明"],
    factTypePreference: { result: 2.5, metric: 2.5, responsibility: 2, technology: 1.5, context: 0.5 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  self_introduction: {
    intent: "self_introduction",
    structure: ["基本情况", "代表性实践", "与岗位相关的方向"],
    factTypePreference: { responsibility: 2, result: 2, metric: 2, technology: 1.5, context: 1.5 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  career_plan: {
    intent: "career_plan",
    structure: ["短期方向", "长期目标"],
    factTypePreference: { context: 1, responsibility: 1, result: 1, metric: 1, technology: 1 },
    allowsCompanyFacts: false,
    requiresCareerFacts: true,
  },
  motivation: {
    intent: "motivation",
    structure: ["补充说明的核心内容", "相关事实"],
    factTypePreference: { responsibility: 2, result: 2, metric: 1.5, technology: 1.5, context: 1 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
  other: {
    intent: "other",
    structure: ["直接回应问题", "用事实支撑"],
    factTypePreference: { responsibility: 2, metric: 2, result: 2, technology: 1.5, context: 1 },
    allowsCompanyFacts: false,
    requiresCareerFacts: false,
  },
};

/**
 * Fact Selection（spec Stage 4 第六/七章）：
 * intent 偏好 + JD 关键词重叠打分，取 top N（N=8），保持原序。
 * representative_project：调用方应传入推荐第一名的经历 facts（本函数只做排序筛选）。
 */
export function selectAnswerFacts(
  intent: QuestionIntent,
  requirements: JobRequirementProfile,
  facts: Fact[],
): Fact[] {
  const strategy = ANSWER_STRATEGIES[intent] ?? ANSWER_STRATEGIES.other;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

  const scored = facts.map((fact, index) => {
    let score = strategy.factTypePreference[fact.type] ?? 1;
    const factNorm = norm(fact.text);
    for (const kw of [...requirements.hardSkills, ...requirements.priorityKeywords]) {
      const kwNorm = norm(kw);
      if (kwNorm && (factNorm.includes(kwNorm) || kwNorm.includes(factNorm))) {
        score += 1.5;
        break;
      }
    }
    score += Math.max(0, 0.5 - index * 0.05);
    return { fact, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, 8).map((s) => s.fact);
  const order = new Set(top.map((f) => f.id));
  return facts.filter((f) => order.has(f.id));
}

/**
 * Career Facts（spec Stage 4 第十章）：从 Profile 显式配置的 careerPreferences 提取。
 * 为空 → career_plan 标记 insufficient_context，绝不凭空生成职业目标。
 */
export interface CareerFacts {
  targetDirections: string[];
  preferredWorkTypes: string[];
  developmentGoals: string[];
}

export function careerFactsFrom(careerPreferences: CareerFacts | undefined): Fact[] {
  if (!careerPreferences) return [];
  const facts: Fact[] = [];
  let n = 0;
  const push = (text: string) => {
    const t = text.trim();
    if (!t) return;
    n += 1;
    facts.push({ id: `career_${String(n).padStart(3, "0")}`, type: "context", text: `职业方向：${t}` });
  };
  for (const d of careerPreferences.targetDirections) push(d);
  for (const w of careerPreferences.preferredWorkTypes) push(`偏好工作类型：${w}`);
  for (const g of careerPreferences.developmentGoals) push(`发展目标：${g}`);
  return facts;
}

/**
 * Company Facts（spec Stage 4 第八章）：只允许来自 JobContext 明确文本。
 * 只有公司名 ≠ 有公司事实——名称本身作为唯一 company fact 传递（供 LLM 指代），
 * 绝不允许从岗位/行业推断「行业领先」「企业文化」等。
 */
export function companyFactsFrom(job: { company?: string; position?: string; jd: string }): Fact[] {
  const facts: Fact[] = [];
  if (job.company) facts.push({ id: "company_001", type: "context", text: `公司名称：${job.company}` });
  if (job.position) facts.push({ id: "company_002", type: "context", text: `岗位名称：${job.position}` });
  return facts;
}

/** 当前岗位方向（用于 prompt 中提示表达侧重） */
export function profileTypeHint(profileType: ProfileType): string {
  const hints: Record<ProfileType, string> = {
    agent: "Agent/工作流开发方向",
    aiApplication: "AI 应用落地方向",
    aiProduct: "AI 产品方向",
    aiOperation: "AI 运营方向",
    aiSolution: "AI 解决方案方向",
    aigcMarketing: "AIGC/内容方向",
    general: "通用方向",
  };
  return hints[profileType];
}
