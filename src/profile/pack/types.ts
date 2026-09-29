import type { ProfileType } from "../../job/profileTypes";

/**
 * Stage 6.5：Profile Pack（资料库）数据模型。
 *
 * 哲学：Master Profile 是唯一事实源；Profile Pack 只是「使用配置层」——
 * 选哪些经历、什么顺序、用哪个岗位表达版本、常用字段内容、匹配规则。
 * 绝不复制公司/学校/时间/数字/真实项目事实。
 *
 * 优先级：Manual Selection > Deterministic Rule Match > Default Pack > AI Suggestion（仅建议）。
 */

export interface ProfilePackMatchRules {
  /** 岗位标题关键词（命中加分） */
  jobTitles: string[];
  /** JD 关键词（命中加分） */
  keywords: string[];
  /** 排除关键词（命中直接降权/排除） */
  excludeKeywords: string[];
}

/** 固定字段内容（可选覆盖；缺省 fallback Master Profile / 现有 resolver 路径） */
export interface ProfilePackFieldContents {
  selfIntroduction?: string;
  strengths?: string;
  skills?: string;
  portfolio?: string;
  /** Stage 6.6：常用补充说明 */
  extraNote?: string;
  /** Stage 6.6：常用开放题基础回答 */
  commonSupplement?: string;
}

/** Stage 6.6：资料库偏好（高级设置区；allowAIAssist 为预留位） */
export interface ProfilePackPreferences {
  answerTone?: 'concise' | 'balanced' | 'detailed';
  allowAIAssist?: boolean;
  notes?: string;
}

export interface ProfilePack {
  id: string;
  name: string;
  description?: string;

  enabled: boolean;
  /** 系统始终保留一个 default pack（删除 active pack 时 fallback） */
  isDefault: boolean;

  matchRules: ProfilePackMatchRules;

  /** 选中的经历（Master Profile 的 internships/projects/campus 引用 id），空 = 全部 */
  selectedExperienceIds: string[];
  /** 填写顺序（多段经历按此顺序映射 Entry 1..N） */
  experienceOrder: string[];

  /** 岗位表达版本（引用现有 experience.variants.*，不复制数据） */
  variantType: ProfileType;

  fieldContents: ProfilePackFieldContents;
  preferences?: ProfilePackPreferences;

  createdAt: string;
  updatedAt: string;
}

export interface ProfilePackStorage {
  schemaVersion: 1;
  packs: ProfilePack[];
  /** 当前使用中的资料库（一级状态：无 Job/无 AI 也可独立工作） */
  activeProfilePackId: string;
  /**
   * Selection Source（显式来源；禁止用「active 是否为 general/default」推断手选）：
   * - manual：用户手动选择（含推荐 banner 点「切换」——用户确认即 manual）
   * - matched：deterministic matcher 生效（「恢复自动匹配」后）
   * - default：首次启动，无 override
   * - migration：旧 profileOverride 迁移（视为 manual 锁定）
   */
  selectionSource: ProfilePackSelectionSource;
}

export type ProfilePackSelectionSource = "manual" | "matched" | "default" | "migration";

/** 匹配置信度（spec 第八章）：不假装确定 */
export type MatchConfidence = "high" | "medium" | "low";

export interface PackMatch {
  profilePackId: string;
  score: number;
  matchedJobTitles: string[];
  matchedKeywords: string[];
  excludedKeywords: string[];
}

export interface PackMatchResult {
  matches: PackMatch[];
  recommendedProfilePackId: string | null;
  confidence: MatchConfidence;
}
