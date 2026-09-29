import {
  writeNativeValue,
  setContentEditableText,
  setCustomSelectValue,
  setCheckboxValues,
  setDatePickerValue,
  setRadioValue,
  setSelectValue,
} from "../content/eventDispatcher";
import {
  isCheckboxElement,
  isCustomSelectElement,
  isDatePickerElement,
  isInputElement,
  isRadioElement,
  isSelectElement,
  isTextAreaElement,
  readDisplayValue,
  valueMatchesRequested,
  waitFor,
} from "../content/domUtils";

/**
 * Write Strategy + Write Verification + Safe Retry。
 * 绝不认为 `element.value = xxx` 执行成功就等于填写成功——写后必须读回真实 DOM 里
 * 用户看得见的那个值。读回是异步等待的：受控组件、自定义下拉、日期面板的回显
 * 都在下一帧之后才出现，同步读值会把已经填上的字段误判成失败。
 */

export type WriteStatus = "success" | "mismatch" | "reverted" | "unsupported";

export interface WriteVerifyResult {
  status: WriteStatus;
  requestedValue: string;
  actualValue: string;
  strategy: string;
  attempts: number;
  detail?: string;
}

export type WriteStrategyName =
  | "native-input"
  | "react-controlled"
  | "contenteditable"
  | "custom-select"
  | "radio"
  | "checkbox"
  | "date-picker"
  | "select"
  | "unsupported";

/** 由 DOM Adapter 选择写策略（不在主 Writer 堆 if else） */
export function chooseStrategy(el: HTMLElement): WriteStrategyName {
  // realm-safe 判定：same-origin iframe 里的控件 instanceof 主窗口构造器为 false
  if (isRadioElement(el)) return "radio";
  if (isCheckboxElement(el)) return "checkbox";
  if (isDatePickerElement(el)) return "date-picker";
  if (isSelectElement(el)) return "select";
  if (isCustomSelectElement(el)) return "custom-select";
  if (el.isContentEditable) return "contenteditable";
  if (isInputElement(el)) {
    const bad = ["file", "password", "submit", "button", "reset", "image", "hidden"];
    if (bad.includes(el.type)) return "unsupported";
    return "react-controlled"; // native setter 路径对普通 input 同样有效
  }
  if (isTextAreaElement(el)) return "react-controlled";
  return "unsupported";
}

/** 单策略写入（不验证） */
async function applyStrategy(el: HTMLElement, value: string, strategy: WriteStrategyName) {
  switch (strategy) {
    case "select":
      return setSelectValue(el as HTMLSelectElement, value);
    case "custom-select":
      return setCustomSelectValue(el, value);
    case "radio":
      return setRadioValue(el as HTMLInputElement, value);
    case "checkbox":
      return setCheckboxValues(el, value);
    case "date-picker":
      return setDatePickerValue(el as HTMLInputElement, value);
    case "native-input":
    case "react-controlled":
      return writeNativeValue(el, value);
    case "contenteditable":
      return setContentEditableText(el, value);
    default:
      return { ok: false, detail: "网页控件暂不支持自动填写，请人工填写" };
  }
}

/**
 * 写入 + 验证。
 * **每一次尝试都真正通知页面**（native setter + input/change/blur，或点击站点自己的选项节点），
 * 写完再等真实 DOM 回显。
 *
 * 为什么不再「先直接赋值试探」：React 的 value tracker 会在 input 实例上定义自己的 value setter，
 * 直接赋值会立刻读回新值，于是「验证通过」——但框架 state 只有收到 input 事件才更新。
 * 站点随后重渲染或提交，送出的是空值/旧值，而面板却显示填写成功。
 * 这是本扩展最不能接受的失败模式（假成功），宁可报失败。
 *
 * 两次尝试之间先等页面稳定：受控组件常在 focus/blur 引发的一次重渲染里把值冲掉，
 * 重放一次能覆盖这种时序。仍失败 → WRITE_FAILED（禁止无限重试）。
 */
export async function fillWithVerification(
  el: HTMLElement,
  requestedValue: string,
  previousValue: string,
): Promise<WriteVerifyResult> {
  const strategy = chooseStrategy(el);
  if (strategy === "unsupported") {
    return { status: "unsupported", requestedValue, actualValue: readDisplayValue(el), strategy, attempts: 0 };
  }

  const maxAttempts = 2;
  let actual = "";
  let detail: string | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await applyStrategy(el, requestedValue, strategy);
    detail = res.detail;
    // 策略内部已按各自的回显语义等过；这里再给框架一次统一的重绘窗口
    const settled = await waitFor(() => valueMatchesRequested(el, requestedValue), 350, 50);
    if (settled) {
      return { status: "success", requestedValue, actualValue: readDisplayValue(el), strategy, attempts: i + 1 };
    }
    actual = readDisplayValue(el);
    if (i === 0) await new Promise((r) => setTimeout(r, 120));
  }
  return {
    status: actual === previousValue ? "reverted" : "mismatch",
    requestedValue,
    actualValue: actual,
    strategy,
    attempts: maxAttempts,
    detail,
  };
}

/** Recovery：写入前元素消失（DOM_REMOUNTED）→ 交由调用方用 fingerprint 重新定位后再次 fillWithVerification */
export const RECOVERY_CODES = [
  "DOM_REMOUNTED",
  "FIELD_DISAPPEARED",
  "VALUE_REVERTED",
  "ROUTE_CHANGED",
  "SESSION_FIELD_STALE",
  "WRITE_FAILED",
] as const;
export type RecoveryCode = (typeof RECOVERY_CODES)[number];
