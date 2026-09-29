import type { ContextAncestorSignal, FieldKind, RawField, RawFieldContext } from "../types/field";
import { collectZoneHits } from "../context/applicationContext";
import {
  ariaLabelledbyText,
  closestHeadingText,
  compactText,
  escapeSelector,
  fieldsetLegendText,
  fingerprintOf,
  groupTitleFor,
  htmlForLabel,
  isCustomSelectElement,
  isDatePickerElement,
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "./domUtils";

/** 语境信号最多往上采 6 层，且不越过 body/html（§十一：绝不以 document.body 全文为准）。
 *  真机依据：Moka 登录面板把「获取验证码 / 手机号登录」放在第 4–6 层的 .sd-Modal-content 上，
 *  只采 3 层会完全看不见认证语境（Batch #4 真机验证抓出的缺陷）。 */
const CONTEXT_ANCESTOR_DEPTH = 6;
/** 容器文本超过这个长度就不再算"局部容器"，只取它自己的标题，避免把整页文本当成近邻信号 */
const CONTEXT_LOCAL_TEXT_LIMIT = 600;
/** 通用语义 class/id 片段（§十二：generic patterns，不绑定任何具体站点） */
const CONTEXT_HINT_RE =
  /(login|sign|regist|auth|verif|captch|passw|sms|otp|search|filter|nav|menu|header|footer|toolbar|cookie|banner|sidebar|form|field|apply|resume|profil|applicant|dialog|modal|drawer|panel)/i;

/** 容器「自己的」标题文本：直接子文本 + 直属标题/legend/label，不含整棵子树 */
function ownTitleText(el: HTMLElement): string {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) parts.push(node.textContent ?? "");
  }
  for (const head of Array.from(el.children)) {
    const tag = head.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === "legend" || tag === "label" || /title|heading|caption/i.test(String(head.className))) {
      parts.push(head.textContent ?? "");
    }
  }
  return parts.join(" ");
}

/** 由近及远采集祖先结构信号。近处读整块文本（那就是面板本身），远处只读它自己的标题 */
function collectAncestorSignals(el: HTMLElement): ContextAncestorSignal[] {
  const out: ContextAncestorSignal[] = [];
  let cur = el.parentElement;
  for (let depth = 1; cur && depth <= CONTEXT_ANCESTOR_DEPTH; depth++) {
    const tag = cur.tagName.toLowerCase();
    const role = cur.getAttribute("role") ?? "";
    const clsId = `${typeof cur.className === "string" ? cur.className : ""} ${cur.id ?? ""}`;
    const hints = [
      ...new Set(
        clsId
          .split(/[^A-Za-z0-9]+/)
          .filter((t) => t.length >= 4 && CONTEXT_HINT_RE.test(t))
          .map((t) => t.toLowerCase().slice(0, 24)),
      ),
    ].slice(0, 6);
    // body/html 永远只取它自己的标题：否则「页面上别处有登录二字」会变成这个控件的近邻信号。
    // 其余容器只要文本量不大就读全文——认证/申请语境常常写在祖先 div 的整块文本里。
    const isRoot = tag === "body" || tag === "html";
    const fullText = cur.textContent ?? "";
    const scopeText = !isRoot && fullText.length <= CONTEXT_LOCAL_TEXT_LIMIT ? fullText : ownTitleText(cur);
    out.push({ depth, tag, role, hints, hits: collectZoneHits(scopeText) });
    if (["form", "fieldset", "section", "article", "dialog"].includes(tag) || role === "dialog" || role === "search") break;
    if (isRoot) break;
    cur = cur.parentElement;
  }
  return out;
}

/** 语义 landmark：兄弟采集到这一层就停，再往上就是"整页字段都算共现"的污染（§十一） */
const SIBLING_STOP_TAGS = new Set(["body", "html", "main", "header", "footer", "nav", "aside"]);
/** 容器里控件多到这个数就不再算"同区共现"——那是页面级大杂烩 */
const SIBLING_MAX_CONTROLS = 12;

/** 同容器内其他控件的 label/placeholder —— 「典型申请字段共现」这条最强正向信号的来源（§九） */
function collectSiblingLabels(el: HTMLElement): string[] {
  let container = el.parentElement;
  for (let hop = 0; hop < 2 && container; hop++) {
    if (SIBLING_STOP_TAGS.has(container.tagName.toLowerCase()) || ["navigation", "banner", "contentinfo", "main"].includes(container.getAttribute("role") ?? "")) {
      break;
    }
    const controls = Array.from(container.querySelectorAll("input, textarea, select"));
    if (controls.length >= 2 && controls.length <= SIBLING_MAX_CONTROLS) {
      const labels: string[] = [];
      for (const c of controls) {
        if (c === el) continue;
        const t =
          htmlForLabel(c as HTMLElement) ||
          c.getAttribute("placeholder") ||
          c.getAttribute("aria-label") ||
          c.getAttribute("name") ||
          "";
        const cut = compactText(t, 24);
        if (cut) labels.push(cut);
      }
      return [...new Set(labels)].slice(0, 10);
    }
    container = container.parentElement;
  }
  return [];
}

/** 提取 input/textarea/select 的上下文信号（全部只读） */
export function extractContext(el: HTMLElement, groupLabelOverride = ""): RawFieldContext {
  // 元素可能来自同源 iframe；不能用主窗口的 instanceof 判断。
  const input = isInputElement(el) ? el : null;
  const textarea = isTextAreaElement(el) ? el : null;
  const select = isSelectElement(el) ? el : null;

  const labelText = htmlForLabel(el);
  const ariaLabel =
    el.getAttribute("aria-label") ?? ariaLabelledbyText(el) ?? "";
  const placeholder = el.getAttribute("placeholder") ?? "";
  const name = el.getAttribute("name") ?? "";
  const id = el.id ?? "";
  const title = el.getAttribute("title") ?? "";

  // 前一个有文本的兄弟节点（跳过纯装饰元素）
  let prevSiblingText = "";
  let prev = el.previousElementSibling as HTMLElement | null;
  for (let hop = 0; hop < 3 && prev; hop++) {
    const t = compactText(prev.textContent, 60);
    if (t) {
      prevSiblingText = t;
      break;
    }
    prev = prev.previousElementSibling as HTMLElement | null;
  }

  // 近距离父容器文字（向上 2 层，截断；用于 Level 3 综合判断，噪音权重低）
  const parentText = compactText(el.parentElement?.parentElement?.textContent, 200);

  // 只读地取 number 控件步长（读属性而非 IDL，避免默认值口径分歧）：
  // 非数字控件 = undefined（不适用）；step="any" = null（不设限）；其余按属性值，缺省/非法按 HTML 默认 1
  let step: number | null | undefined;
  if (input?.type === "number") {
    const rawStep = (input.getAttribute("step") ?? "").trim().toLowerCase();
    if (rawStep === "any") step = null;
    else {
      const parsed = Number(rawStep);
      step = rawStep === "" || !Number.isFinite(parsed) || parsed <= 0 ? 1 : parsed;
    }
  }

  return {
    // radio/checkbox 组：组标题（「性别」「语言能力」）才是字段名，
    // 选项文本（男 / CET-6）走 options 信号，不能当 label 用。
    labelText: groupLabelOverride || labelText,
    groupLabel: groupLabelOverride,
    placeholder,
    ariaLabel,
    name,
    id,
    title,
    fieldsetLabel: fieldsetLegendText(el),
    sectionTitle: closestHeadingText(el),
    prevSiblingText,
    parentText,
    autocomplete: el.getAttribute("autocomplete") ?? "",
    inputType: isDatePickerElement(el)
      ? "date-picker"
      : isCustomSelectElement(el)
      ? "custom-select"
      : input?.type ?? (textarea ? "textarea" : select ? "select-one" : "contenteditable"),
    // input 与 textarea 都支持 maxlength 属性（此前漏了 textarea，导致字数约束检查失效）
    maxLength:
      (input ?? textarea) && (input ?? textarea)!.maxLength > 0 ? (input ?? textarea)!.maxLength : null,
    step,
    required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
    disabled: input?.disabled ?? textarea?.disabled ?? select?.disabled ?? false,
    readOnly: input?.readOnly ?? textarea?.readOnly ?? false,
    currentValue: input?.value ?? textarea?.value ?? select?.value ?? (isCustomSelectElement(el) ? (el.textContent ?? "").trim() : ""),
    ancestorSignals: collectAncestorSignals(el),
    siblingLabels: collectSiblingLabels(el),
  };
}

/** select 的 option 文本列表（跳过空值占位项） */
export function extractSelectOptions(select: HTMLSelectElement): string[] {
  return Array.from(select.options)
    .filter((o) => o.value !== "" && o.textContent)
    .map((o) => compactText(o.textContent, 40))
    .filter(Boolean);
}

/** radio/checkbox 组：同 name 的所有 input，选项文本取各自 label */
export function radioGroupElements(input: HTMLInputElement): HTMLInputElement[] | null {
  const name = input.getAttribute("name");
  if (!name) return null;
  const doc = input.ownerDocument ?? document;
  const group = Array.from(
    doc.querySelectorAll(`input[type="${input.type}"][name="${escapeSelector(name)}"]`),
  ) as HTMLInputElement[];
  return group.length > 0 ? group : null;
}

export function radioGroupOptions(group: HTMLInputElement[]): string[] {
  return group.map((el) => {
    const label = htmlForLabel(el);
    return compactText(label || el.value || el.getAttribute("aria-label") || "", 40);
  });
}

/** 判定元素种类 */
export function detectKind(el: HTMLElement): FieldKind {
  if (isDatePickerElement(el)) return "date";
  if (isCustomSelectElement(el)) return "custom-select";
  if (isTextAreaElement(el)) return "textarea";
  if (isSelectElement(el)) return "select";
  if (isInputElement(el)) {
    const t = el.type;
    if (t === "radio") return "radio";
    if (t === "checkbox") return "checkbox";
    if (t === "email") return "email";
    if (t === "tel") return "tel";
    if (t === "number") return "number";
    if (t === "date") return "date";
    return "text";
  }
  const ce = el.getAttribute("contenteditable");
  if (ce === "true" || ce === "" || ce === "plaintext-only") return "contenteditable";
  return "unsupported";
}

/** 组装 RawField（含指纹与选项）；radio/checkbox 以组为单位返回一个 RawField */
export function buildRawField(el: HTMLElement): RawField | null {
  const kind = detectKind(el);
  if (kind === "unsupported") return null;

  let representative: HTMLElement = el;
  let options: string[] = [];
  let groupLabel = "";

  if (kind === "radio" || kind === "checkbox") {
    const input = el as HTMLInputElement;
    const group = radioGroupElements(input);
    if (!group || !group[0]) return null;
    representative = group[0];
    options = radioGroupOptions(group);
    groupLabel = groupTitleFor(representative);
  } else if (kind === "select" && isSelectElement(el)) {
    options = extractSelectOptions(el);
  }

  // 指纹必须基于组代表（radio 组内每个 input 都指向同一指纹）
  return {
    reference: fingerprintOf(representative),
    kind,
    context: extractContext(representative, groupLabel),
    options,
  };
}
