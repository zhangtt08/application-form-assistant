import type { QuestionIntent } from "./types";

/**
 * Question Classifier（spec Stage 4 第三~五章）：
 * 规则优先——QUESTION_INTENT_CONFIG 关键词匹配 → intent；
 * 明显开放题但无法确定 intent → other（绝不瞎映射成 strengths/why_role）；
 * 非开放题（姓名/学校/经历描述等）→ null（继续走原有确定性路径）。
 * 后续预留 LLMQuestionClassifier（同接口）。
 */

export interface IntentConfigEntry {
  intent: QuestionIntent;
  /** 命中关键词（label/placeholder/上下文 任一包含即命中） */
  keywords: string[];
  /** 强信号：label 直接以此开头/包含 → 直接命中（优先级高于普通关键词） */
  strongKeywords?: string[];
}

export const QUESTION_INTENT_CONFIG: IntentConfigEntry[] = [
  {
    intent: "why_company",
    keywords: ["为什么选择我们", "为什么选择本公司", "为何选择公司", "选择我们的原因", "为什么选择本公司", "为什么选择这家公司", "为什么选择我们公司", "了解我们公司", "对我们公司的了解", "选择公司的原因"],
  },
  {
    intent: "why_role",
    keywords: ["为什么申请", "为何申请", "申请原因", "应聘原因", "申请该岗位", "申请这个岗位", "申请本岗位", "岗位动机", "为什么想做", "为什么应聘"],
  },
  {
    intent: "role_fit",
    keywords: ["岗位匹配", "为什么适合", "胜任", "符合岗位", "匹配点", "匹配度", "你的优势与岗位", "与岗位要求的匹配", "要求匹配", "岗位要求的地方"],
  },
  {
    intent: "representative_project",
    keywords: ["代表性项目", "最有代表性的", "印象最深的项目", "介绍一个项目", "描述一个项目", "最有成就的项目", "代表性经历", "印象最深刻的经历"],
  },
  {
    intent: "challenge",
    keywords: ["遇到困难", "困难", "挑战", "如何解决", "怎么解决", "克服", "挫折"],
  },
  {
    intent: "career_plan",
    keywords: ["职业规划", "职业目标", "未来三年", "未来五年", "未来规划", "发展规划", "职业生涯", "三年规划", "五年规划"],
  },
  {
    intent: "strengths",
    keywords: ["个人优势", "你的优势", "自身优势", "简述优势", "优势是什么", "优点", "特长"],
  },
  {
    intent: "self_introduction",
    keywords: ["自我介绍", "介绍一下自己", "简单介绍自己"],
  },
  {
    intent: "motivation",
    keywords: ["其他补充", "补充说明", "还有什么想", "额外信息", "补充信息", "想说的话"],
  },
];

/** 开放题特征：疑问词 + 表达诉求（用于识别 unknown intent 的开放题） */
const OPEN_QUESTION_MARKERS = [
  "为什么", "请描述", "请说明", "请介绍", "简述", "谈谈", "如何看待", "你的看法", "请补充",
  "介绍一下", "说明一下", "是什么", "有哪些", "怎么理解", "你对",
];

export interface ClassificationInput {
  labelText: string;
  placeholder?: string;
  /** 附近 DOM 文本（section/prev sibling 等） */
  contextText?: string;
}

export interface ClassificationResult {
  /** null = 非开放题，走原有确定性路径 */
  intent: QuestionIntent | null;
  matchedBy: "keyword" | "strong-keyword" | "open-marker" | "none";
}

/** 主入口：分类一个表单字段的开放问题意图 */
export function classifyQuestion(input: ClassificationInput): ClassificationResult {
  const text = normalizeCn(
    [input.labelText, input.placeholder ?? "", input.contextText ?? ""].join(" "),
  );
  if (!text) return { intent: null, matchedBy: "none" };

  for (const entry of QUESTION_INTENT_CONFIG) {
    if (entry.strongKeywords?.some((k) => text.includes(normalizeCn(k)))) {
      return { intent: entry.intent, matchedBy: "strong-keyword" };
    }
  }
  for (const entry of QUESTION_INTENT_CONFIG) {
    if (entry.keywords.some((k) => text.includes(normalizeCn(k)))) {
      return { intent: entry.intent, matchedBy: "keyword" };
    }
  }
  // 开放题但无具体 intent → other（不瞎映射）
  if (OPEN_QUESTION_MARKERS.some((m) => text.includes(m))) {
    return { intent: "other", matchedBy: "open-marker" };
  }
  return { intent: null, matchedBy: "none" };
}

function normalizeCn(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}
