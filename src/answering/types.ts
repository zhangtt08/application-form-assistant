import type { Fact, JobRequirementProfile } from "../generation/types";
import type { ProfileType } from "../job/profileTypes";

/**
 * Stage 4：Grounded Application Answer Engine 类型定义。
 *
 * 三条表单处理路径：
 * - Direct Field：Field → Master Profile Fact → Preview → Fill（不变）
 * - Experience Field：Field → Job Context → Profile Variant → Preview → Fill（不变）
 * - Open Question：Question → Intent → Facts → Grounded Generation → Validation → Preview → Fill（本阶段）
 *
 * 核心原则不变：LLM 只组织表达；个人事实只能来自 PERSONAL_FACTS，
 * 公司事实只能来自 COMPANY_FACTS；证据不足必须输出 insufficient_context，禁止编造。
 */

export type QuestionIntent =
  | "why_company"
  | "why_role"
  | "role_fit"
  | "self_introduction"
  | "strengths"
  | "representative_project"
  | "challenge"
  | "career_plan"
  | "motivation"
  | "other";

export type AnswerStatus = "generated" | "insufficient_context";

/** LLM 的结构化回答（禁止裸 string，spec 十三） */
export interface StructuredAnswer {
  answer: string;
  usedPersonalFactIds: string[];
  usedCompanyFactIds: string[];
  addressedRequirements: string[];
  unsupportedRequirements: string[];
  status: AnswerStatus;
  /** status=insufficient_context 时列出缺失的上下文（如 career_goal / company_info） */
  missingContext: string[];
}

/** 回答长度约束（spec 十九/二十） */
export interface AnswerLengthConstraint {
  /** 页面 maxlength；无则 null */
  maxLength: number | null;
  /** 无 maxlength 时用户选择的档位 */
  preset?: "short" | "standard" | "detailed";
  /** 实际目标上限（字符）：maxLength ?? preset 目标 */
  targetCharacters: number;
}

/** 个人事实与公司事实严格分离（spec 十一/八） */
export interface AnswerGenerationInput {
  question: string;
  intent: QuestionIntent;
  jobRequirements: JobRequirementProfile;
  personalFacts: Fact[];
  /** 仅允许来自 JobContext 明确文本；只有公司名 ≠ 有公司事实 */
  companyFacts: Fact[];
  length: AnswerLengthConstraint;
  language: "zh-CN";
  tone: "sincere" | "professional";
}

export interface AnswerContext {
  question: string;
  intent: QuestionIntent;
  effectiveProfileType: ProfileType;
  selectedFacts: Fact[];
  maxLength: AnswerLengthConstraint;
  constraints: string[];
}

export interface CompanyClaimCheck {
  claim: string;
  status: "supported" | "unsupported";
  reason?: string;
}

export interface AnswerValidationReport {
  /** 事实约束部分：复用 FactValidator */
  baseStatus: "pass" | "review" | "fail";
  claims: {
    claim: string;
    kind: string;
    status: "supported" | "unsupported" | "uncertain";
    reason?: string;
  }[];
  /** Company Claim Guard（spec 十六） */
  companyClaims: CompanyClaimCheck[];
  /** Career Claim Guard（spec 十七） */
  careerClaims: CompanyClaimCheck[];
  /** Preference Guard（spec 十八） */
  preferenceClaims: CompanyClaimCheck[];
  /** 字数检查（spec 十九）：超长 → review，禁止截断 */
  length: { current: number; target: number; exceeded: boolean };
  overall: "pass" | "review" | "fail";
}

/** 开放问题候选（挂在 CandidateField 上进入 Preview/Fill 流程） */
export interface OpenAnswerMeta {
  intent: QuestionIntent;
  question: string;
  status: "generated" | "insufficient_context" | "not_generated" | "edited";
  validation?: AnswerValidationReport;
  missingContext?: string[];
  /** 生成后缓存的回答内容（进入 confirmedFillPlan 前存 editedValue） */
  answer?: string;
  usedPersonalFactIds?: string[];
  usedCompanyFactIds?: string[];
  lengthConstraint?: AnswerLengthConstraint;
}

/** Application Session（spec 二十四~二十五）：一次岗位申请一个 Session */
export interface ApplicationSession {
  sessionId: string;
  jobContextId: string;
  effectiveProfileType: ProfileType;
  createdAt: string;
  updatedAt: string;
  answers: AnswerSnapshot[];
}

/** Answer Snapshot（spec 二十六）：不含任何敏感字段 */
export interface AnswerSnapshot {
  question: string;
  intent: QuestionIntent;
  answer: string;
  validationStatus: string;
  usedFactIds: string[];
  maxLength: number | null;
  manualEdited: boolean;
  createdAt: string;
}

/** Answer Cache（spec 二十七）：同 job+question+facts+promptVersion 复用 */
export interface AnswerCacheEntry {
  cacheKey: string;
  answer: StructuredAnswer;
  createdAt: string;
}
