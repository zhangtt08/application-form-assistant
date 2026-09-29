import { findElementByFingerprint, isVisible } from "../content/domUtils";
import { fillWithVerification, type WriteVerifyResult } from "./writeVerifier";

/**
 * Recovery Manager（spec 第三十~三十一章）：
 * - 不长期保存 HTMLElement 引用，只保存 Field Descriptor（fingerprint）
 * - Fill 时重新 locate；元素消失/被重建 → 通过 Stable Field Identity 重新查找新 DOM 节点
 * - 重写后必须重新验证；仍失败 → WRITE_FAILED（停止，不无限重试）
 */

export interface RecoverOutcome {
  recovered: boolean;
  reason?: "FIELD_DISAPPEARED" | "VALUE_REVERTED" | "MISMATCH" | "UNSUPPORTED";
  verify?: WriteVerifyResult;
}

/** 带恢复的写入：locate 失败先尝试一次重新定位（DOM 可能已重渲染） */
export async function fillWithRecovery(
  fingerprint: string,
  requestedValue: string,
  previousValue: string,
): Promise<RecoverOutcome> {
  let el = findElementByFingerprint(fingerprint);
  if (!el) {
    // FIELD_DISAPPEARED：DOM 重渲染后同 fingerprint 属性元素可能仍在——重新收集并按属性重定位
    el = relocateByFingerprint(fingerprint);
    if (!el) {
      return { recovered: false, reason: "FIELD_DISAPPEARED" };
    }
  }
  const verify = await fillWithVerification(el, requestedValue, previousValue);
  if (verify.status === "success") return { recovered: true, verify };
  if (verify.status === "reverted") {
    // VALUE_REVERTED：alternate strategy 已在 fillWithVerification 中尝试过一次——停止
    return { recovered: false, reason: "VALUE_REVERTED", verify };
  }
  if (verify.status === "unsupported") {
    return { recovered: false, reason: "UNSUPPORTED", verify };
  }
  return { recovered: false, reason: "MISMATCH", verify };
}

/** 按 fingerprint 属性部分在当前 DOM 全量重新查找（复用 domUtils 的消歧逻辑） */
function relocateByFingerprint(fingerprint: string): HTMLElement | null {
  try {
    JSON.parse(fingerprint);
    // findElementByFingerprint 内部会按 idx 消歧——直接复用
    return findElementByFingerprint(fingerprint);
  } catch {
    return null;
  }
}

/** 元素是否仍然可见且可交互（写入前校验，防 hidden 副本） */
export function isWritableTarget(el: HTMLElement): boolean {
  return isVisible(el) && !(el as HTMLInputElement).disabled;
}
