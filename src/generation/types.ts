/**
 * Stage 3：Fact-grounded Variant Generator 类型定义。
 *
 * 核心原则（spec 二十八）：
 * - LLM 是表达生成器，不是事实来源
 * - Master Profile Facts 是唯一可信事实源
 * - 生成与保存分离；Validation Fail 不得保存；用户编辑后必须重新验证
 */

import type { ProfileType } from "../job/profileTypes";
import type { JobContext } from "../job/schema";

/** 事实类别 */
export type FactType =
  | "metric"         // 数字/规模/比率（日处理量、准确率）
  | "responsibility" // 职责/角色动作
  | "technology"     // 技术栈/工具
  | "result"         // 成果
  | "context";       // 公司/岗位/时间等上下文

/** 带稳定 ID 的单条事实（spec 第六章） */
export interface Fact {
  id: string;       // fact_001 ...
  type: FactType;
  text: string;
}

/** 经历的最小事实集合（Prompt 只发这个，不发整份 Master Profile） */
export interface FactContext {
  experienceId: string;
  experienceLabel: string;
  facts: Fact[];
}

/** JD 岗位需求画像（描述 JD，不做匹配评分，spec 第七章） */
export interface JobRequirementProfile {
  hardSkills: string[];
  responsibilities: string[];
  softSignals: string[];
  priorityKeywords: string[];
}

/** 结构化生成请求（UI → Service） */
export interface VariantGenerationInput {
  jobContext: JobContext;
  effectiveProfileType: ProfileType;
  /** 经历在 Profile 中的定位（internships | projects | campus + index） */
  experienceRef: { collection: "internships" | "projects" | "campus"; index: number };
  /** 目标变体键（与 effectiveProfileType 对应） */
  targetVariant: string;
}

/** LLM Provider 统一接口（spec 第三章） */
export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  /** 期望返回 JSON 结构的提示（provider 实现自行决定如何约束） */
  expectJson: boolean;
}

export interface LLMResponse {
  text: string;
}

export interface LLMProvider {
  readonly name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}

/** LLM 的结构化生成结果（spec 第十章，禁止裸 string） */
export interface StructuredDraft {
  draft: string;
  usedFactIds: string[];
  emphasizedRequirements: string[];
  unsupportedRequirements: string[];
}

/** 单条 Claim 的验证结论 */
export type ClaimStatus = "supported" | "unsupported" | "uncertain";

export interface ClaimCheck {
  claim: string;
  kind: "sentence" | "numeric" | "technology" | "responsibility";
  status: ClaimStatus;
  supportingFactIds: string[];
  /** unsupported 时的原因（数值无来源/技术不在事实/角色被拔高等） */
  reason?: string;
}

export interface ValidationReport {
  status: "pass" | "review" | "fail";
  claims: ClaimCheck[];
}

export type GenerationErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "INVALID_STRUCTURED_OUTPUT"
  | "EMPTY_GENERATION"
  | "CLAIM_EXTRACTION_FAILED"
  | "FACT_VALIDATION_FAILED"
  | "UNSUPPORTED_CLAIM"
  | "SAVE_BLOCKED_BY_VALIDATION";

/** 最终生成结果（spec Stage 3 第十六章，生成后必须进 Review，绝不直接写 Profile） */
export interface VariantGenerationResult {
  generationId: string;
  jobContextId: string;
  experienceId: string;
  profileType: ProfileType;
  targetVariant: string;

  draft: string;
  usedFactIds: string[];
  requirements: JobRequirementProfile;

  validation: ValidationReport;
  selectedFacts: Fact[];

  /** Stage 3.5：可追溯性 */
  promptVersion: string;
  provider: string;
  model: string | null;
  durationMs: number | null;
  usage: { inputTokens: number | null; outputTokens: number | null };

  createdAt: string;
}

/** Generation Snapshot（spec Stage 3 第二十一章 + Stage 3.5 第二十六章） */
export interface GenerationSnapshot {
  generationId: string;
  jobContextId: string;
  experienceId: string;
  profileType: string;
  originalDraft: string;
  finalDraft: string;
  validationStatus: string;
  saved: boolean;
  createdAt: string;
  provider?: string;
  model?: string | null;
  promptVersion?: string;
}
