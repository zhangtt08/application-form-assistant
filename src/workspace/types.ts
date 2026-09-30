import type { ProfileType } from "../job/profileTypes";
import type { JobContext } from "../job/schema";

/**
 * Stage 5：Job Inbox & Application Workspace 类型定义。
 *
 * 三层关系：
 *   Job（JobRecord，一个岗位机会）
 *    ├── Session 1（ApplicationSession，一次网申过程）—— Answers / FillPlan / Trace
 *    ├── Session 2
 *    └── Timeline Events（ApplicationEvent）
 *
 * Job 1 → N ApplicationSession；状态机全部由用户手动驱动，插件绝不自动投递/改状态。
 */

export type JobStatus =
  | "saved"
  | "preparing"
  | "applying"
  | "submitted"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "archived";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  saved: "已保存",
  preparing: "准备中",
  applying: "正在申请",
  submitted: "已投递",
  assessment: "笔试",
  interview: "面试",
  offer: "Offer",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  archived: "已归档",
};

/**
 * 岗位卡片上「点进去要做什么」的一句话。
 * 整张卡片本来就可点，但看不出来点了会怎样 —— 把下一步写在行尾，
 * 用户不必先猜「这是个列表项还是按钮」。
 */
export const JOB_NEXT_STEP: Record<JobStatus, string> = {
  saved: "开始申请",
  preparing: "继续准备",
  applying: "继续填写",
  submitted: "查看进度",
  assessment: "去笔试",
  interview: "看面试",
  offer: "查看 Offer",
  rejected: "查看记录",
  withdrawn: "查看记录",
  archived: "查看记录",
};

/** Inbox 视图（spec 第六章） */
export type InboxView = "all" | "pending" | "applying" | "submitted" | "followup" | "closed";

export const INBOX_VIEW_FILTER: Record<Exclude<InboxView, "all">, JobStatus[]> = {
  pending: ["saved", "preparing"],
  applying: ["applying"],
  submitted: ["submitted"],
  followup: ["assessment", "interview", "offer"],
  closed: ["rejected", "withdrawn", "archived"],
};

export interface JobRecord extends JobContext {
  /** 产品层状态（用户手动维护） */
  status: JobStatus;
  /** 来源描述（如「官网」「内推」）；JobContext.source 是 captured/manual，这里用 channel */
  channel?: string;
  tags: string[];
  notes: string;
  lastSessionId: string | null;
  archived: boolean;
  updatedAt: string;
  submittedAt?: string;
}

export type SessionStatus =
  | "created"
  | "scanned"
  | "reviewing"
  | "filled"
  | "completed"
  | "abandoned";

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  created: "已创建",
  scanned: "已扫描",
  reviewing: "确认中",
  filled: "已填写",
  completed: "已完成",
  abandoned: "已放弃",
};

/** Session 未结束（可继续） */
export function isSessionOpen(status: SessionStatus): boolean {
  return status !== "completed" && status !== "abandoned";
}

export interface ApplicationSessionV2 {
  sessionId: string;
  jobId: string;
  jobContextId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string;
  effectiveProfileType: ProfileType;
  /** 摘要级信息（不保存 DOM） */
  detectedFields: number;
  confirmedFields: number;
  generatedAnswers: number;
  fillPlanSummary: string | null;
  traceId: string | null;
  /** Master Profile 变化检测（spec 三十一） */
  masterProfileUpdatedAt: string | null;
}

export type ApplicationEventType =
  | "JOB_CAPTURED"
  | "JOB_UPDATED"
  | "SESSION_CREATED"
  | "SESSION_RESUMED"
  | "FORM_SCANNED"
  | "VARIANT_GENERATED"
  | "ANSWER_GENERATED"
  | "FORM_FILLED"
  | "JOB_SUBMITTED"
  | "STATUS_CHANGED"
  | "NOTE_ADDED";

export interface ApplicationEvent {
  id: string;
  jobId: string;
  sessionId?: string;
  type: ApplicationEventType;
  timestamp: string;
  metadata: Record<string, string | number | boolean | null>;
}

/** 状态变化事件 metadata（spec 十九：from/to/timestamp） */
export interface StatusChangeMetadata extends Record<string, string | number | boolean | null> {
  from: JobStatus;
  to: JobStatus;
}
