/**
 * 控件写入原语（唯一允许触碰目标页面值的路径）。
 *
 * 每个写入都是「通知框架 + 等页面自己确认」两步：
 * native setter / click 之后必须轮询读回真实 DOM，读到期望值才算成功。
 * 自定义下拉与日期面板的弹层和选中值都由框架在下一帧之后异步渲染，
 * 点击后同步读值必然读到老值——那会把填写成功的字段报成失败（少填的直接来源）。
 */

import {
  getCheckboxGroup,
  getRadioGroup,
  htmlForLabel,
  isCheckboxElement,
  isInputElement,
  isRadioElement,
  isSelectElement,
  isTextAreaElement,
  normalizeChoice,
  normalizeDate,
  polarityMatches,
  readDisplayValue,
  valueMatchesRequested,
  waitFor,
} from "./domUtils";

export interface SetTextResult {
  ok: boolean;
  detail?: string;
  actual?: string;
}

/** 原生 value setter（绕过 React/Vue 劫持的实例 setter）；跨 realm 元素取自己窗口的原型 */
function nativeValueSetter(el: HTMLElement): ((v: string) => void) | null {
  const view = el.ownerDocument?.defaultView ?? window;
  const proto = isTextAreaElement(el)
    ? view.HTMLTextAreaElement.prototype
    : isInputElement(el)
      ? view.HTMLInputElement.prototype
      : null;
  if (!proto) return null;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  return desc?.set ?? null;
}

function fire(el: HTMLElement, Ctor: new (type: string, init?: object) => Event, type: string, init?: object): void {
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init } as EventInit));
}

/**
 * 写入一个文本值：native setter → input → change。
 * 站点自己把值改掉（受控组件重渲染、输入格式化）时以最终读回值为准，交由上层校验。
 */
export function writeNativeValue(el: HTMLElement, value: string): SetTextResult {
  const input = isInputElement(el) || isTextAreaElement(el) ? el : null;
  if (!input) return { ok: false, detail: "不是可写入的文本控件" };
  if (input.disabled) return { ok: false, detail: "控件 disabled" };
  // 只读文本框是站点自己管的（比如自动计算项）；日期/下拉触发器走各自的点击路径
  if (input.readOnly) return { ok: false, detail: "控件 readonly" };

  const setter = nativeValueSetter(input);
  if (!setter) return { ok: false, detail: "无法获取原生 value setter" };
  try {
    input.focus();
    fire(input, FocusEvent, "focus");
    setter.call(input, value);
    fire(input, Event, "input");
    fire(input, Event, "change");
    input.blur();
    fire(input, FocusEvent, "blur");
    return { ok: true, actual: input.value };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

/** contenteditable 写入：textContent → input/change（框架按 input 事件同步 state） */
export function setContentEditableText(el: HTMLElement, value: string): SetTextResult {
  if (el.isContentEditable !== true) return { ok: false, detail: "不是可编辑区域" };
  try {
    el.focus();
    fire(el, FocusEvent, "focus");
    el.textContent = value;
    fire(el, InputEvent, "input", { inputType: "insertText", data: value });
    fire(el, Event, "change");
    el.blur();
    fire(el, FocusEvent, "blur");
    return { ok: true, actual: (el.textContent ?? "").trim() };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

/**
 * 原生 select 写入：value 命中优先，其次可见文本，最后归一化包含。
 * 只改 selected 再派发 change，绝不 click 选项（原生下拉点不开）。
 */
export async function setSelectValue(el: HTMLSelectElement, value: string): Promise<SetTextResult> {
  if (el.disabled) return { ok: false, detail: "控件 disabled" };
  const wanted = value.trim();
  const norm = normalizeChoice(wanted);
  const byValue = Array.from(el.options).find((o) => o.value === wanted);
  const byText = Array.from(el.options).find((o) => normalizeChoice(o.textContent ?? "") === norm);
  // 「是/否」答案 vs 「可以接受 / 不接受」选项：同极性精确写法，放在包含式匹配之前
  // （包含式会把「不接受」当成「接受」，那是填错位置而不是少填）
  const byPolarity = Array.from(el.options).find(
    (o) => polarityMatches(wanted, o.textContent ?? "") || polarityMatches(wanted, o.value ?? ""),
  );
  const byPartial = Array.from(el.options).filter((o) => {
    const t = normalizeChoice(o.textContent ?? "");
    return t.length > 1 && (t.includes(norm) || norm.includes(t));
  });
  const target = byValue ?? byText ?? byPolarity ?? (byPartial.length === 1 ? byPartial[0] : undefined);
  if (!target) return { ok: false, detail: `select 中没有匹配选项: ${wanted.slice(0, 20)}` };

  try {
    el.focus();
    Array.from(el.options).forEach((o) => (o.selected = o === target));
    fire(el, Event, "input");
    fire(el, Event, "change");
    el.blur();
    fire(el, FocusEvent, "blur");
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  const settled = await waitFor(() => valueMatchesRequested(el, wanted), 300, 40);
  const actual = readDisplayValue(el);
  return settled
    ? { ok: true, actual }
    : { ok: false, detail: `select 写入后值不匹配: ${actual.slice(0, 20)}`, actual };
}

/** radio 组写入：按 value / label / aria-label 归一化匹配 */
export async function setRadioValue(el: HTMLInputElement, value: string): Promise<SetTextResult> {
  if (!isRadioElement(el)) return { ok: false, detail: "不是 radio 控件" };
  const group = getRadioGroup(el);
  const norm = normalizeChoice(value);
  const choice =
    group.find((item) =>
      [item.value, htmlForLabel(item), item.getAttribute("aria-label") ?? "", item.getAttribute("title") ?? ""]
        .some((text) => normalizeChoice(text) === norm),
    ) ??
    // 资料里的「是」vs 站点的「可以接受」：只在同极性精确写法里找，不做包含匹配
    group.find((item) =>
      [item.value, htmlForLabel(item), item.getAttribute("aria-label") ?? "", item.getAttribute("title") ?? ""].some(
        (text) => polarityMatches(value, text),
      ),
    );
  if (!choice) return { ok: false, detail: `radio 中没有匹配选项: ${value}` };
  try {
    choice.click();
    if (!choice.checked) choice.checked = true;
    fire(choice, Event, "input");
    fire(choice, Event, "change");
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  const settled = await waitFor(() => valueMatchesRequested(el, value), 300, 40);
  return settled ? { ok: true, actual: readDisplayValue(el) } : { ok: false, detail: "radio 选择未生效" };
}

/**
 * checkbox 组写入：把资料值按分隔符拆成词条，逐个勾选文本命中的项。
 * 只做精确/唯一包含命中，命不中就整体失败——猜着勾比不勾更容易造成错填。
 * 原有勾选保持不变（撤销时按原值恢复）。
 */
export async function setCheckboxValues(el: HTMLElement, value: string): Promise<SetTextResult> {
  const group = getCheckboxGroup(el as HTMLInputElement);
  if (group.length === 0) return { ok: false, detail: "不是 checkbox 控件" };
  const terms = value
    .split(/[、,，;；/\n]+/)
    .map((t) => normalizeChoice(t))
    .filter((t) => t.length > 0);
  if (terms.length === 0) return { ok: false, detail: "勾选值为空" };

  const picked: HTMLInputElement[] = [];
  const missing: string[] = [];
  for (const term of terms) {
    const exact = group.find((item) =>
      [item.value, htmlForLabel(item), item.getAttribute("aria-label") ?? ""].some((t) => normalizeChoice(t) === term),
    );
    // 「是/否」答案的同极性写法优先于包含式匹配（包含式会把「不接受」当成「接受」）
    const samePolarity = exact
      ? undefined
      : group.find((item) =>
          [item.value, htmlForLabel(item), item.getAttribute("aria-label") ?? ""].some((t) => polarityMatches(term, t)),
        );
    const partial = exact || samePolarity
      ? undefined
      : group.filter((item) => {
          const t = normalizeChoice(htmlForLabel(item) || item.value || "");
          return t.length > 1 && (t.includes(term) || term.includes(t));
        });
    const hit = exact ?? samePolarity ?? (partial && partial.length === 1 ? partial[0] : undefined);
    if (!hit) missing.push(term);
    else if (!picked.includes(hit)) picked.push(hit);
  }
  if (picked.length === 0) {
    return { ok: false, detail: `checkbox 中没有匹配选项: ${value.slice(0, 24)}` };
  }
  try {
    for (const item of picked) {
      if (item.checked) continue;
      item.click();
      if (!item.checked) item.checked = true;
      fire(item, Event, "input");
      fire(item, Event, "change");
    }
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  const settled = await waitFor(() => picked.every((item) => item.checked), 300, 40);
  return settled
    ? { ok: true, actual: readDisplayValue(el) }
    : { ok: false, detail: "checkbox 勾选未生效" };
}

/** 找到自定义下拉真正可点击的触发器（readonly input 的点击常常不弹窗） */
/**
 * 找到自定义下拉真正可点击的触发器。
 *
 * 只允许往上找到「小的」控件容器：姚记真机踩过一次——把 probe.parentElement 也当触发器点，
 * 结果点到了整段的折叠标题，表单当场收起，后面十几个字段全部「从页面消失」。
 * 容器里控件超过 2 个、或带标题节点的，一律不认为是触发器。
 */
function selectTriggerOf(el: HTMLElement): HTMLElement {
  const INNER =
    '.ant-select-selector, .el-select__wrapper, .el-select, .ivu-select-selection, ' +
    '[class*="select-selector"], [class*="selection-item"], [role="combobox"]';
  const innerOf = (node: HTMLElement) => {
    const hit = node.querySelector<HTMLElement>(INNER);
    return hit && hit !== el ? hit : null;
  };

  const own = isInputElement(el) || isTextAreaElement(el) ? innerOf(el) : null;
  if (own) return own;

  const probe = el.closest<HTMLElement>(
    '[class*="select"], [class*="Select"], [class*="picker"], [class*="Picker"], [class*="cascader"], [class*="dropdown"], [role="combobox"], [role="listbox"]',
  );
  if (probe && probe !== el) {
    const tight = innerOf(probe);
    if (tight) return tight;
    const controls = probe.querySelectorAll("input, textarea, select, [role=combobox]");
    const isHeading = probe.querySelector("h1, h2, h3, h4, summary, [class*=\"title\"], [class*=\"header\"]") !== null;
    if (controls.length <= 2 && !isHeading) return probe;
  }
  return el;
}

/** 弹层里的候选项（各 UI 库的公共并集，只做可见性过滤） */
function popupOptions(doc: Document): HTMLElement[] {
  const selector =
    '[role="option"], [role="listbox"] li, [role="menuitem"], [class*="select"] li, [class*="dropdown"] li, ' +
    '[class*="select-item"], [class*="select-option"], [class*="select-dropdown__item"], [class*="dropdown__item"], ' +
    '[class*="option"], [class*="cascader"] [class*="node"], [class*="picker-item"], [class*="menu-item"], ' +
    '[data-value]:not([data-value=""]), [data-key]:not([data-key=""])';
  return Array.from(doc.querySelectorAll(selector)).filter((node) => {
    const view = node.ownerDocument?.defaultView ?? window;
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) return false;
    const rect = (node as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return !node.closest('[aria-hidden="true"]');
  }) as HTMLElement[];
}

/**
 * 同页多个弹层同时可见时（真机见过：上一个下拉没关就点下一个），
 * 只按文本在全 document 里找选项会点到**另一个**下拉里的同名项 —— 那是错填。
 * 排序：① 点自己触发器之后才出现的优先（就是本次这个弹层）；② 离触发器近的优先。
 */
function rankPopupOptions(options: HTMLElement[], trigger: Element, before: Set<Element>): HTMLElement[] {
  const ancestors = new Set<Element>();
  for (let p: Element | null = trigger; p; p = p.parentElement) ancestors.add(p);
  const distance = (node: Element): number => {
    let d = 0;
    for (let p: Element | null = node; p; p = p.parentElement) {
      if (ancestors.has(p)) return d;
      d += 1;
    }
    return Number.MAX_SAFE_INTEGER;
  };
  return [...options].sort((a, b) => {
    const freshness = (before.has(a) ? 1 : 0) - (before.has(b) ? 1 : 0);
    if (freshness !== 0) return freshness;
    return distance(a) - distance(b);
  });
}

function chooseOption(options: HTMLElement[], target: string): HTMLElement | undefined {
  const norm = normalizeChoice(target);
  const exact = options.find((node) => normalizeChoice(node.textContent ?? "") === norm);
  if (exact) return exact;
  const byTitle = options.find((node) => normalizeChoice(node.getAttribute("title") ?? "") === norm);
  if (byTitle) return byTitle;
  // 「是/否」答案的同极性写法（只认精确写法，绝不包含式：「不接受」里有「接受」二字）
  const byPolarity = options.find(
    (node) =>
      polarityMatches(target, node.textContent ?? "") || polarityMatches(target, node.getAttribute("title") ?? "") ||
      polarityMatches(target, node.getAttribute("data-value") ?? ""),
  );
  if (byPolarity) return byPolarity;
  const partial = options.filter((node) => {
    const t = normalizeChoice(node.textContent ?? "");
    return t.length > 1 && (t.includes(norm) || norm.includes(t));
  });
  return partial.length === 1 ? partial[0] : undefined;
}

/** 派发一个鼠标/指针动作事件（Ant 监听 mousedown、react-select 监听 pointerdown） */
function press(node: Element, type: string): void {
  const PointerCtor = (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  const Ctor: new (t: string, o?: object) => Event =
    type.startsWith("pointer") && PointerCtor ? PointerCtor : MouseEvent;
  try {
    node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true }));
  } catch {
    /* 老内核不认识该事件类型 */
  }
}

/** 把搜索文本敲进 combobox：react-select / 可搜索下拉只在收到输入后才拉取选项 */
function typeIntoCombobox(el: HTMLElement, text: string): void {
  if (!isInputElement(el)) return;
  const view = el.ownerDocument?.defaultView ?? window;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
  try {
    el.focus();
    fire(el, FocusEvent, "focus");
    if (setter) setter.call(el, text);
    else el.value = text;
    fire(el, InputEvent, "input", { inputType: "insertText", data: text });
    fire(el, Event, "change");
  } catch {
    /* 站点自己拦了就当没输入 */
  }
}

/**
 * 视觉上进在那个坐标上的节点：站点的下拉触发器常常不是 input 自己，也不是它的 class 容器，
 * 而是叠在上面的一层遮罩/图标 span —— elementFromPoint 拿到的才是用户真正会按的节点。
 */
function centerTarget(el: HTMLElement): HTMLElement | null {
  const doc = el.ownerDocument ?? document;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as HTMLElement | null;
  return hit && hit !== el ? hit : null;
}

/**
 * 控件子树里静态存在的选项（自研下拉常把选项一直写在 DOM 里，靠 CSS 显隐）。
 * 只接受文本精确命中的节点，点完仍要等回显验证，所以不会因此填错值。
 */
function staticOptionUnder(scope: HTMLElement, target: string): HTMLElement | undefined {
  const norm = normalizeChoice(target);
  const nodes = Array.from(
    scope.querySelectorAll<HTMLElement>('[role="option"], li, [class*="option"], [class*="item"], [data-value]'),
  );
  return (
    nodes.find((node) => normalizeChoice(node.textContent ?? "") === norm) ??
    nodes.find((node) => normalizeChoice(node.getAttribute("data-value") ?? "") === norm) ??
    // 「是/否」答案 vs 站点写成「可以接受 / 不接受」的同极性选项文本
    nodes.find(
      (node) =>
        polarityMatches(target, node.textContent ?? "") || polarityMatches(target, node.getAttribute("data-value") ?? ""),
    )
  );
}

/**
 * 自定义下拉（北森 / Element / Ant / iView / react-select / 自研）：
 * 1) 点触发器（pointer + mouse + click 全序列：很多组件只监听 pointerdown）
 * 2) 等弹层渲染；等不到就把目标文本敲进搜索框再等（可搜索下拉只在输入后出选项）
 * 3) 还没有就点用户视觉上会去按的那个节点，再找子树里的静态选项
 * 4) 点目标项 → 等选中值回显
 * 全程只点击「文本匹配上的那个节点」，命不中判失败——绝不退化成点第一项。
 */
export async function setCustomSelectValue(el: HTMLElement, value: string): Promise<SetTextResult> {
  const doc = el.ownerDocument ?? document;
  const target = value.trim();
  if (!target) return { ok: false, detail: "下拉目标值为空" };
  const trigger = selectTriggerOf(el);
  const scope = trigger.parentElement ?? trigger;
  const pressAll = (node: Element) => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) press(node, type);
  };

  const waitForOptions = (timeout: number) =>
    waitFor(() => {
      const found = popupOptions(doc);
      return found.length > 0 ? found : null;
    }, timeout, 40);

  // 点触发器**之前**已经可见的选项：属于别的弹层或静态列表，优先级排到后面
  const beforeOpen = new Set(popupOptions(doc));
  const pick = (options: HTMLElement[] | null | undefined) =>
    options ? chooseOption(rankPopupOptions(options, trigger, beforeOpen), target) : undefined;

  const tryOnce = async (): Promise<boolean> => {
    try {
      trigger.focus?.();
      fire(trigger, FocusEvent, "focus");
    } catch {
      /* 站点 focus 里报错也不影响后续点击 */
    }
    pressAll(trigger);
    let options = await waitForOptions(400);
    let picked = pick(options);
    if (!picked) {
      // 可搜索 combobox（react-select / antd showSearch）：选项要在输入之后才出现
      typeIntoCombobox(el, target);
      pressAll(trigger);
      options = await waitForOptions(450);
      picked = pick(options);
    }
    if (!picked) {
      // 点用户视觉上真正会按到的那个节点（遮罩层 / 图标层），再找一次弹层
      const hit = centerTarget(el);
      if (hit) {
        pressAll(hit);
        options = await waitForOptions(350);
        picked = pick(options);
      }
    }
    if (!picked) picked = staticOptionUnder(scope, target);
    if (!picked) return false; // 命不中就什么都不点，绝不退化成点第一项
    try {
      picked.click();
      press(picked, "mousedown");
      press(picked, "mouseup");
    } catch {
      /* ignore */
    }
    return !!(await waitFor(() => valueMatchesRequested(el, target), 500, 40));
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (await tryOnce()) return { ok: true, actual: readDisplayValue(el) };
    // 只按 Escape 收起可能残留的弹层。绝不做「点 body 空白处」这种全局点击：
    // 姚记真机实测发现，那一下会把承载整张表单的抽屉/弹层关掉，
    // 后面每个字段都变成「字段已从页面消失」，一屏 13 个字段全部填不上。
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    } catch {
      /* ignore */
    }
  }
  return {
    ok: false,
    detail: `下拉未能选中「${target.slice(0, 24)}」（弹层选项未出现或无匹配项）`,
    actual: readDisplayValue(el),
  };
}

/** 只读日期选择器：先走站点自己的日历面板，面板里没有等价日期再直接写值 */
export async function setDatePickerValue(el: HTMLInputElement, value: string): Promise<SetTextResult> {
  const doc = el.ownerDocument ?? document;
  const target = normalizeDate(value);
  const variants = [...new Set([value, value.replace(/\./g, "-"), value.replace(/\./g, "/"), value.replace(/\./g, "")])];

  const visibleCells = () => Array.from(
    doc.querySelectorAll<HTMLElement>('[data-date], [data-value], [role="gridcell"], [role="option"], td[class*="cell"]'),
  ).filter((node) => {
    const view = node.ownerDocument?.defaultView ?? window;
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  /** 页面上有没有「就是这个日期」的面板节点 */
  const findDateCell = (): HTMLElement | undefined =>
    visibleCells().find((node) => {
      const text = [
        node.getAttribute("data-date"),
        node.getAttribute("data-value"),
        node.getAttribute("aria-label"),
        node.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      const n = normalizeDate(text);
      return !!n && (n === target || n.startsWith(target) || target.startsWith(n));
    });

  if (!el.readOnly) {
    const res = writeNativeValue(el, variants[0] ?? value);
    if (!res.ok) return res;
    const settled = await waitFor(() => normalizeDate(el.value) === target, 300, 40);
    return settled ? { ok: true, actual: el.value } : { ok: false, detail: `日期写入后值不匹配: ${el.value}`, actual: el.value };
  }

  const trigger = selectTriggerOf(el) ?? el;
  try {
    el.focus();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) press(trigger, type);
    press(trigger, "click");
  } catch {
    /* ignore */
  }

  // 只等「就是这个日期」的面板节点：页面上常同时存在别的下拉/选项节点，
  // 只要弹层里有任何节点就往下走，会把日期写到无关控件里。
  const picked = await waitFor(() => findDateCell(), 600, 40);
  if (picked) {
    try {
      picked.click();
      press(picked, "mousedown");
      press(picked, "mouseup");
    } catch {
      /* ignore */
    }
    const settled = await waitFor(() => normalizeDate(el.value) === target, 400, 40);
    if (settled) return { ok: true, actual: el.value };
  }

  const setter = nativeValueSetter(el);
  if (!setter) return { ok: false, detail: "无法获取日期控件原生 setter" };
  try {
    for (const candidate of variants) {
      setter.call(el, candidate);
      fire(el, Event, "input");
      fire(el, Event, "change");
      if (normalizeDate(el.value) === normalizeDate(candidate)) {
        el.blur();
        fire(el, FocusEvent, "blur");
        const settled = await waitFor(() => normalizeDate(el.value) === target, 300, 40);
        return settled
          ? { ok: true, actual: el.value }
          : { ok: false, detail: `日期写入后值不匹配: ${el.value}`, actual: el.value };
      }
    }
    el.blur();
    fire(el, FocusEvent, "blur");
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  return { ok: false, detail: `日期控件未能写入: ${value}`, actual: el.value };
}

/**
 * 撤销：恢复到填写前的值。
 * 填写前是「没选任何一项」（空值）时，要把整组清干净——
 * 否则撤销后 radio/checkbox 还留在我们勾的那一项上，等于没撤销成功。
 */
export async function restoreValue(el: HTMLElement, previousValue: string, kind: string): Promise<SetTextResult> {
  if (!previousValue || !previousValue.trim()) {
    if (isRadioElement(el)) {
      for (const item of getRadioGroup(el)) {
        if (item.checked) {
          item.checked = false;
          fire(item, Event, "change");
        }
      }
      return { ok: true };
    }
    if (isCheckboxElement(el)) {
      for (const item of getCheckboxGroup(el)) {
        if (item.checked) {
          item.checked = false;
          fire(item, Event, "change");
        }
      }
      return { ok: true };
    }
  }
  if (isCheckboxElement(el)) return setCheckboxValues(el, previousValue);
  if (isSelectElement(el)) return setSelectValue(el, previousValue);
  if (isRadioElement(el)) return setRadioValue(el, previousValue);
  if (el.isContentEditable) return setContentEditableText(el, previousValue);
  if (kind === "custom-select") return setCustomSelectValue(el, previousValue);
  if (kind === "date" && isInputElement(el) && el.readOnly) return setDatePickerValue(el, previousValue);
  if (isInputElement(el) || isTextAreaElement(el)) {
    const res = writeNativeValue(el, previousValue);
    if (!res.ok) return res;
    const settled = await waitFor(() => (el as HTMLInputElement).value === previousValue, 300, 40);
    return settled ? { ok: true } : { ok: false, detail: "控件值未恢复" };
  }
  return { ok: false, detail: "控件类型无法恢复" };
}

export { htmlForLabel };
