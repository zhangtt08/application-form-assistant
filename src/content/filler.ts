import type { FillPlanPayload } from "../types/message";
import type { FillOutcome } from "../types/field";
import { findElementByFingerprint, isCheckboxElement, isRadioElement, readDisplayValue } from "./domUtils";
import { restoreValue } from "./eventDispatcher";
import { fillWithVerification } from "../compatibility/writeVerifier";
import { LogEvent, logger, maskValue } from "../utils/logger";

/**
 * Form Filler —— 唯一正式写入口：只接受 ConfirmedFillPlan 载荷。
 * 运行时门禁（Defense in depth 第二道防线）：`plan.confirmed !== true` 或
 * `plan.fields` 为空 → 直接拒绝执行，绝不触碰 DOM。
 * 只写入计划内的 (reference, value) 对。
 * 写入后必须经 Write Verification 读真实 DOM 验证；仍失败 → WRITE_FAILED（禁止无限重试）。
 * 支持控件：input（文本/数字/邮箱/电话）、textarea、select、radio、checkbox 组、
 * 自定义下拉、日期选择器、contenteditable。
 * 全局安全限制：不存在任何 submit / 同意协议点击逻辑（BLOCKED_ACTIONS 见 ignoreRules）。
 */
/**
 * 写入时给元素打一个撤销用的标记。
 *
 * 为什么不能只靠指纹找回：填完值之后，站点常常会把校验提示 / 已填值插进 DOM，
 * 邻居文本一变，label 推断结果和结构路径都变了 → 撤销时按指纹找不到原元素，
 * 姚记真机实测「撤销恢复 0 个字段」。写入阶段本来就允许动 DOM，
 * 打一个 data-* 标记是最稳的回查手段（扫描阶段仍然零写入）。
 */
const UNDO_ATTR = "data-afa-undo";
let undoSeq = 0;

export async function fillFields(plan: FillPlanPayload): Promise<{
  outcomes: FillOutcome[];
  originals: { reference: string; kind: string; previousValue: string; undoTag?: string }[];
}> {
  // —— ConfirmedFillPlan Gate（第二道防线）——
  if (!plan || plan.confirmed !== true) {
    logger.event(LogEvent.FILL_FAILED, "FILL_FIELDS rejected: plan not confirmed");
    throw new Error("写入被拒绝：填写计划未经用户确认");
  }
  const items = plan.fields ?? [];
  if (items.length === 0) {
    logger.event(LogEvent.FILL_FAILED, "FILL_FIELDS rejected: empty plan");
    throw new Error("写入被拒绝：填写计划为空");
  }
  // —— Application Context Gate（第三道防线，issue-004）——
  // 计划里出现「语境判定非申请控件」的项，说明上游已经出错：整份拒绝，也不把手机号写进登录框。
  const ineligible = items.filter((f) => f.contextEligible === false);
  if (ineligible.length > 0) {
    logger.event(LogEvent.FILL_FAILED, `FILL_FIELDS rejected: ${ineligible.length} non-application control(s) in plan`);
    throw new Error("写入被拒绝：填写计划包含非申请表控件（登录 / 搜索 / 导航）");
  }

  const outcomes: FillOutcome[] = [];
  const originals: { reference: string; kind: string; previousValue: string; undoTag?: string }[] = [];
  // 连续找不到字段 = 页面在填写过程中被改结构（折叠、分步、路由）。
  // 继续硬试只会把剩下每个字段都报成失败；这里停下来说清原因，让用户重新识别一次。
  let missingStreak = 0;

  for (const item of items) {
    logger.event(LogEvent.FILL_START, `开始写入 ${item.reference.slice(0, 50)}`);

    if (missingStreak >= 3) {
      outcomes.push({ reference: item.reference, status: "failed", detail: "页面结构在填写过程中变化，请点「重新识别」后再填" });
      continue;
    }

    const el = findElementByFingerprint(item.reference);
    if (!el) {
      missingStreak++;
      outcomes.push({ reference: item.reference, status: "failed", detail: "字段已从页面消失，请重新扫描" });
      logger.event(LogEvent.FILL_FAILED, `找不到元素 ${item.reference.slice(0, 50)}`);
      continue;
    }
    missingStreak = 0;

    if (item.value === undefined) continue;
    const previousValue = readDisplayValue(el);

    const verify = await fillWithVerification(el, item.value, previousValue);
    if (verify.status === "success") {
      const undoTag = `a${++undoSeq}`;
      el.setAttribute(UNDO_ATTR, undoTag);
      originals.push({ reference: item.reference, kind: item.kind, previousValue, undoTag });
      outcomes.push({ reference: item.reference, status: "filled" });
      logger.event(LogEvent.FILL_SUCCESS, `写入成功（verified, attempts=${verify.attempts}） ${maskValue(item.kind, item.value)}`);
    } else if (verify.status === "unsupported") {
      outcomes.push({ reference: item.reference, status: "failed", detail: "网页控件暂不支持自动填写，请人工填写" });
      logger.event(LogEvent.FILL_FAILED, `unsupported ${item.reference.slice(0, 50)}`);
    } else {
      outcomes.push({
        reference: item.reference,
        status: "failed",
        detail:
          verify.detail ??
          (verify.status === "reverted" ? "写入被页面回滚（受控组件），请人工填写" : "写入未生效，请人工填写"),
      });
      logger.event(
        LogEvent.FILL_FAILED,
        `WRITE_FAILED status=${verify.status} strategy=${verify.strategy} attempts=${verify.attempts}`,
      );
    }
  }

  return { outcomes, originals };
}

/** Undo：把控件恢复成填写前的值，走和写入完全一样的「通知框架 + 等回显 + 重试」路径 */
export async function undoFill(
  originals: { reference: string; kind: string; previousValue: string; undoTag?: string }[],
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  for (const rec of originals) {
    const el =
      (rec.undoTag
        ? document.querySelector<HTMLElement>(`[${UNDO_ATTR}="${rec.undoTag.replace(/["\\]/g, "")}"]`)
        : null) ?? findElementByFingerprint(rec.reference);
    if (!el) {
      failed++;
      continue;
    }
    // 单选/多选「原来什么都没选」的恢复是取消勾选，不是写值
    const isClearChoice = (isRadioElement(el) || isCheckboxElement(el)) && !rec.previousValue.trim();
    const result = isClearChoice
      ? await restoreValue(el, rec.previousValue, rec.kind)
      : (await fillWithVerification(el, rec.previousValue, readDisplayValue(el))).status === "success"
        ? { ok: true }
        : { ok: false };
    if (result.ok) {
      restored++;
      el.removeAttribute(UNDO_ATTR);
    } else {
      failed++;
    }
  }
  return { restored, failed };
}

/** 定位字段：scrollIntoView + 短暂高亮（只读视觉反馈，不改值） */
export function locateField(reference: string): boolean {
  const el = findElementByFingerprint(reference);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prevOutline = el.style.outline;
  const prevBoxShadow = el.style.boxShadow;
  el.style.outline = "2px solid #2563eb";
  el.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.25)";
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.boxShadow = prevBoxShadow;
  }, 2000);
  return true;
}
