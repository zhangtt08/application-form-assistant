/**
 * 本地日志：关键步骤事件码 + Profile 值默认脱敏。
 * 禁止记录：完整身份证号、完整手机号、完整邮箱。
 */

const LOG_PREFIX = "[AFA]";

export const LogEvent = {
  SCAN_START: "SCAN_START",
  FIELD_DETECTED: "FIELD_DETECTED",
  FIELD_MATCHED: "FIELD_MATCHED",
  FIELD_SKIPPED: "FIELD_SKIPPED",
  ROUTER_DECISION: "ROUTER_DECISION",
  CONTENT_RESOLVER: "CONTENT_RESOLVER",
  PREVIEW_OVERRIDE: "PREVIEW_OVERRIDE",
  FILL_PLAN: "FILL_PLAN",
  FILL_START: "FILL_START",
  FILL_SUCCESS: "FILL_SUCCESS",
  FILL_FAILED: "FILL_FAILED",
  UNDO_START: "UNDO_START",
  UNDO_SUCCESS: "UNDO_SUCCESS",
  PROFILE_SAVED: "PROFILE_SAVED",
  QUESTION_CLASSIFY: "QUESTION_CLASSIFY",
  ANSWER_FACT_SELECT: "ANSWER_FACT_SELECT",
  ANSWER_GENERATE: "ANSWER_GENERATE",
  ANSWER_VALIDATE: "ANSWER_VALIDATE",
  ANSWER_SAVE_TO_SESSION: "ANSWER_SAVE_TO_SESSION",
  PROFILE_IMPORTED: "PROFILE_IMPORTED",
  PROFILE_IMPORT_REJECTED: "PROFILE_IMPORT_REJECTED",
} as const;

export type LogEventCode = (typeof LogEvent)[keyof typeof LogEvent];

/** 完全隐藏（日志中连部分形态都不出现）：身份证、紧急联系人 */
const FULLY_HIDDEN_FIELD_IDS = new Set([
  "risk.idNumber",
  "sensitive.idNumber",
  "sensitive.emergencyContact",
]);

/** 手机号：138****1234 */
function maskPhoneLike(v: string): string {
  if (v.length >= 7) return `${v.slice(0, 3)}****${v.slice(-4)}`;
  return "*".repeat(v.length);
}

/** 邮箱：z***@domain */
function maskEmail(v: string): string {
  const at = v.indexOf("@");
  if (at <= 0) return "*".repeat(Math.min(v.length, 4));
  return `${v[0]}***${v.slice(at)}`;
}

/** 默认脱敏：中段打码 */
function maskGeneric(v: string): string {
  if (v.length <= 4) return "*".repeat(v.length);
  return `${v.slice(0, 1)}****${v.slice(-1)}`;
}

export function maskValue(fieldId: string, value: string): string {
  if (!value) return "";
  if (FULLY_HIDDEN_FIELD_IDS.has(fieldId) || /idnumber|id_number/i.test(fieldId)) {
    return "***";
  }
  if (/phone|mobile|tel/i.test(fieldId)) return maskPhoneLike(value);
  if (/email/i.test(fieldId)) return maskEmail(value);
  return maskGeneric(value);
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, event: LogEventCode | undefined, message: string, data?: unknown): void {
  const tag = `${LOG_PREFIX}${event ? `[${event}]` : ""}`;
  const line = `${tag} ${message}`;
  // eslint-disable-next-line no-console
  if (data !== undefined) console[level](line, data);
  // eslint-disable-next-line no-console
  else console[level](line);
}

export const logger = {
  debug: (message: string, data?: unknown) => emit("debug", undefined, message, data),
  info: (message: string, data?: unknown) => emit("info", undefined, message, data),
  warn: (message: string, data?: unknown) => emit("warn", undefined, message, data),
  error: (message: string, data?: unknown) => emit("error", undefined, message, data),
  event: (code: LogEventCode, message: string, data?: unknown) =>
    emit(code === LogEvent.FILL_FAILED ? "warn" : "info", code, message, data),
  maskValue,
};
