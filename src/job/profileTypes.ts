/**
 * 岗位方向（Profile Type）配置 —— 配置驱动核心。
 * 新增方向时只改这张表（如 prompt_engineer / ai_growth / workflow_engineer），
 * Router / UI / Resolver 全部自动生效，不需要改业务代码。
 */

export const PROFILE_TYPES = [
  "agent",
  "aiApplication",
  "aiProduct",
  "aiOperation",
  "aiSolution",
  "aigcMarketing",
  "general",
] as const;

export type ProfileType = (typeof PROFILE_TYPES)[number];

export interface ProfileTypeConfig {
  type: ProfileType;
  /** UI 展示名 */
  label: string;
  /** 方向说明 */
  description: string;
  /**
   * JD 关键词 → 权重（Router 评分用）。
   * 关键词匹配基于 normalizeText 后的文本（小写、去空白标点）。
   * general 是兜底方向，不配关键词。
   */
  keywords: Record<string, number>;
}

export const PROFILE_CONFIG: Record<ProfileType, ProfileTypeConfig> = {
  agent: {
    type: "agent",
    label: "Agent / AI 应用开发",
    description: "Agent 工作流、RAG、自动化开发类岗位",
    keywords: {
      "agent": 3,
      "智能体": 3,
      "多智能体": 3,
      "rag": 2.5,
      "tool calling": 2.5,
      "function calling": 2.5,
      "langchain": 2.5,
      "mcp": 2.5,
      "dify": 2,
      "coze": 2,
      "扣子": 2,
      "workflow": 1.5,
      "工作流": 1.5,
      "python": 1.5,
      "自动化": 1.5,
      "llm": 1.5,
      "大模型": 1.5,
      "prompt": 1.5,
    },
  },
  aiApplication: {
    type: "aiApplication",
    label: "AI 应用",
    description: "AI 应用落地、业务 AI 化类岗位",
    keywords: {
      "ai应用": 3,
      "ai 应用": 3,
      "ai产品": 1.5,
      "大模型应用": 2.5,
      "落地": 1,
      "ai工具": 2,
      "ai 工具": 2,
      "降本增效": 2,
      "业务流程": 1.5,
      "数字化": 1.5,
      "智能化": 1.5,
      "效率": 1,
    },
  },
  aiProduct: {
    type: "aiProduct",
    label: "AI 产品",
    description: "AI 产品经理、产品设计类岗位",
    keywords: {
      "产品经理": 3,
      "ai产品": 3,
      "ai 产品": 3,
      "prd": 2.5,
      "产品": 1.5,
      "需求分析": 2,
      "原型": 1.5,
      "axure": 2,
      "用户研究": 2,
      "竞品": 1.5,
      "数据分析": 1.5,
      "功能设计": 2,
      "迭代": 1,
      "用户": 1,
    },
  },
  aiOperation: {
    type: "aiOperation",
    label: "AI 运营",
    description: "AI 产品运营、用户运营、数据运营类岗位",
    keywords: {
      "产品运营": 3,
      "运营": 2.5,
      "用户增长": 2.5,
      "拉新": 2,
      "留存": 2,
      "私域": 2,
      "活动策划": 2,
      "数据运营": 2,
      "增长": 1.5,
      "转化": 1.5,
      "社群": 1.5,
      "内容运营": 1.5,
      "用户": 1,
    },
  },
  aiSolution: {
    type: "aiSolution",
    label: "AI 解决方案",
    description: "AI 解决方案、售前、项目交付类岗位",
    keywords: {
      "解决方案": 3,
      "售前": 2.5,
      "poc": 2.5,
      "投标": 2,
      "客户成功": 2,
      "交付": 2,
      "方案": 1.5,
      "实施": 1.5,
      "项目经理": 1.5,
      "客户": 1,
    },
  },
  aigcMarketing: {
    type: "aigcMarketing",
    label: "AIGC / 营销 / 创意",
    description: "AIGC 内容、AI 营销、创意策划类岗位",
    keywords: {
      "aigc": 2.5,
      "营销": 2.5,
      "创意": 2,
      "内容策划": 2,
      "种草": 2,
      "stable diffusion": 2,
      "midjourney": 2,
      "广告": 2,
      "短视频": 1.5,
      "新媒体": 1.5,
      "文案": 1.5,
      "品牌": 1.5,
      "投放": 1.5,
      "剪辑": 1,
    },
  },
  general: {
    type: "general",
    label: "通用",
    description: "未定向的通用表达",
    keywords: {},
  },
};

/** ProfileType → Master Profile variants 键名（general 无变体，用默认表达） */
export const VARIANT_KEY_BY_TYPE: Record<ProfileType, "agent" | "aiApplication" | "aiProduct" | "aiOperation" | "aiSolution" | "aigcMarketing" | null> = {
  agent: "agent",
  aiApplication: "aiApplication",
  aiProduct: "aiProduct",
  aiOperation: "aiOperation",
  aiSolution: "aiSolution",
  aigcMarketing: "aigcMarketing",
  general: null,
};

export function profileTypeLabel(type: ProfileType): string {
  return PROFILE_CONFIG[type]?.label ?? type;
}
