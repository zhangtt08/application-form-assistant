import type { ProfilePack, ProfilePackMatchRules } from "./types";

/**
 * 内置默认资料库（spec 第三章/第七章）。
 * 数据驱动匹配配置——禁止 if/else 散落；用户可自由新建/修改，不写死只能有 6 个。
 * 只含匹配规则/表达版本引用，不含任何事实数据。
 */

type PackSeed = {
  id: string;
  name: string;
  description: string;
  variantType: ProfilePack["variantType"];
  matchRules: ProfilePackMatchRules;
};

export const DEFAULT_PACK_SEEDS: PackSeed[] = [
  {
    id: "pack-agent",
    name: "AI 应用 / Agent",
    description: "Agent / RAG / Prompt / Workflow",
    variantType: "agent",
    matchRules: {
      jobTitles: ["Agent 开发", "AI 应用开发", "AI 开发", "Prompt 工程", "工作流工程", "AI 工程", "智能应用开发", "Agent", "大模型应用"],
      keywords: ["Agent", "RAG", "Prompt", "Workflow", "Python", "Tool", "Automation", "自动化", "Embedding", "MCP", "LLM", "大模型", "智能体", "Function Call"],
      excludeKeywords: ["Java 后端", "算法研究", "CV 算法", "芯片"],
    },
  },
  {
    id: "pack-ai-product",
    name: "AI 产品",
    description: "AI 产品 / 产品运营 / 用户需求",
    variantType: "aiProduct",
    matchRules: {
      jobTitles: ["AI 产品", "AI 产品经理", "智能产品", "AI 产品运营", "产品经理", "产品运营"],
      keywords: ["用户需求", "需求分析", "PRD", "产品设计", "数据分析", "用户研究", "产品迭代", "产品规划", "原型"],
      excludeKeywords: ["Java 后端", "算法研究"],
    },
  },
  {
    id: "pack-ai-operation",
    name: "AI 运营",
    description: "AI 运营 / 产品运营 / 内容运营",
    variantType: "aiOperation",
    matchRules: {
      jobTitles: ["AI 运营", "AI运营", "产品运营", "内容运营", "用户运营", "社群运营"],
      keywords: ["内容运营", "用户增长", "社群", "活动策划", "数据复盘", "新媒体", "公众号", "转化率"],
      excludeKeywords: ["Java 后端"],
    },
  },
  {
    id: "pack-ai-solution",
    name: "AI 解决方案",
    description: "解决方案 / 实施 / 项目交付",
    variantType: "aiSolution",
    matchRules: {
      jobTitles: ["解决方案", "AI 解决方案", "售前", "解决方案工程师", "实施顾问", "项目交付"],
      keywords: ["解决方案", "售前", "交付", "客户需求", "方案设计", "POC", "投标", "项目实施", "客户成功"],
      excludeKeywords: ["芯片"],
    },
  },
  {
    id: "pack-aigc-marketing",
    name: "AIGC / AI 营销",
    description: "AI 创意 / AIGC / AI 营销",
    variantType: "aigcMarketing",
    matchRules: {
      jobTitles: ["AIGC", "AI 创意", "AI营销", "AI 营销", "创意策划", "内容创作"],
      keywords: ["AIGC", "AI 创意", "AI营销", "短视频", "文案", "创意", "内容生产", " Midjourney", "营销策划", "品牌"],
      excludeKeywords: ["Java 后端", "算法研究"],
    },
  },
  {
    id: "pack-general",
    name: "通用",
    description: "通用资料库（无方向偏好）",
    variantType: "general",
    matchRules: {
      jobTitles: [],
      keywords: [],
      excludeKeywords: [],
    },
  },
];

export function buildDefaultPacks(now: string): ProfilePack[] {
  return DEFAULT_PACK_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    description: seed.description,
    enabled: true,
    isDefault: seed.id === "pack-general",
    matchRules: seed.matchRules,
    selectedExperienceIds: [],
    experienceOrder: [],
    variantType: seed.variantType,
    fieldContents: {},
    createdAt: now,
    updatedAt: now,
  }));
}

/** 旧 ProfileType → 对应默认 Pack id（spec 二十四迁移） */
export const PROFILE_TYPE_TO_PACK_ID: Record<string, string> = {
  agent: "pack-agent",
  aiApplication: "pack-agent",
  aiProduct: "pack-ai-product",
  aiOperation: "pack-ai-operation",
  aiSolution: "pack-ai-solution",
  aigcMarketing: "pack-aigc-marketing",
  general: "pack-general",
};
