import type { CandidateField, ConfirmedFillPlan, FillOutcome } from "../types/field";

/**
 * Confirmed Fill Plan（spec Stage 2 第二十/二十一章；Safety Flow Reconciliation 收紧）：
 * 只有用户点击「确认填写」后生成；Field Writer 只读取本计划。
 * 规则：仅 confirmed + 可填写状态（ready / need-confirm）+ 有内容 + 非 MANUAL_ONLY。
 * 用户选择不再为已匹配内容停留在风险/置信度确认；敏感 MANUAL_ONLY、empty、unknown 仍不得进入。
 * issue-004 第二道防线：语境判定为「非申请表控件」的字段一律不进计划，
 * 即使上游（deriveStatus / runScanPipeline）出 bug 放它过来也一样拦下。
 * Safety 不变量：Scan 阶段绝不允许调用本函数写 DOM——它只应由「确认填写」用户动作触发。
 */
export function buildFillPlan(
  candidates: CandidateField[],
  jobContextId: string | null,
  effectiveProfileType: string | null,
): ConfirmedFillPlan {
  const fields = candidates
    .filter(
      (c) =>
        c.confirmed === true &&
        (c.status === "ready" || c.status === "need-confirm") &&
        !!c.value &&
        c.risk !== "MANUAL_ONLY" &&
        c.applicationContext?.eligible !== false,
    )
    .map((c) => ({
      reference: c.raw.reference,
      fieldId: c.match.fieldId,
      value: c.editedValue ?? c.value!.value,
      kind: c.raw.kind,
      approved: true as const,
      contextEligible: c.applicationContext ? c.applicationContext.eligible : true,
      // 跨域 iframe 的表单控件要发给它自己所在的 frame 才能写进去
      frameId: c.raw.frameId ?? 0,
    }));

  return {
    confirmed: true,
    jobContextId,
    effectiveProfileType,
    createdAt: new Date().toISOString(),
    fields,
  };
}

export interface FillSummary {
  filled: number;
  failed: number;
  skipped: number;
  /** 高风险（MANUAL_ONLY）未填写字段数 */
  manualBlocked: number;
}

/** 填写结果汇总（spec Stage 2 第二十一章：成功/跳过/失败/高风险未填写） */
export function summarizeFillOutcome(
  plan: ConfirmedFillPlan,
  outcomes: FillOutcome[],
  candidates: CandidateField[],
): FillSummary {
  const filled = outcomes.filter((o) => o.status === "filled").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = plan.fields.length - filled - failed;
  const manualBlocked = candidates.filter((c) => c.status === "manual").length;
  return { filled, failed, skipped: Math.max(skipped, 0), manualBlocked };
}
