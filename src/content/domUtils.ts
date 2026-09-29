/** DOM 工具：可见性、label 关联、指纹、指纹反查 */

/**
 * realm-safe 控件判定。
 * same-origin iframe 里的元素属于子文档的 realm，`el instanceof HTMLInputElement`
 * （主窗口构造器）恒为 false——扫描层会把它们正常检出，写入层却一律判成「不支持」，
 * 用户逐项确认后 100% 失败。统一按 tagName 判定，跨 realm 与 jsdom 都成立。
 */
export function isInputElement(el: Element | null): el is HTMLInputElement {
  return el?.tagName === "INPUT";
}
export function isTextAreaElement(el: Element | null): el is HTMLTextAreaElement {
  return el?.tagName === "TEXTAREA";
}
export function isSelectElement(el: Element | null): el is HTMLSelectElement {
  return el?.tagName === "SELECT";
}
export function isRadioElement(el: Element | null): el is HTMLInputElement {
  return isInputElement(el) && el.type === "radio";
}
export function isCheckboxElement(el: Element | null): el is HTMLInputElement {
  return isInputElement(el) && el.type === "checkbox";
}
export function isDatePickerElement(el: Element | null): boolean {
  if (!isInputElement(el) || !el.readOnly) return false;
  const ownProbe = [
    el.getAttribute("aria-haspopup") ?? "",
    el.getAttribute("class") ?? "",
    el.id,
    el.getAttribute("name") ?? "",
  ].join(" ");
  if (/date|time|calendar|picker|日期|时间/i.test(ownProbe) || el.getAttribute("aria-haspopup") === "dialog") return true;

  // Element/Ant/北森常把日期语义放在外层 wrapper（如 `.el-date-editor`），
  // 输入框自身只有 readonly + placeholder="请选择"。向上读有限层级，
  // 让这类控件进入 date 策略，而不是被 custom-select/readonly 过滤掉。
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    const probe = `${parent.getAttribute("class") ?? ""} ${parent.id ?? ""} ${parent.getAttribute("role") ?? ""}`;
    if (/date|time|calendar|picker|日期|时间/i.test(probe) || parent.getAttribute("aria-haspopup") === "dialog") return true;
  }
  return false;
}
/** 北森/Element 类 ATS 常用的只读 input 作为自定义下拉触发器。 */
export function isCustomSelectElement(el: Element | null): boolean {
  if (!el) return false;
  if (isInputElement(el) && isDatePickerElement(el)) return false;
  const probe = [
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("role") ?? "",
    el.getAttribute("class") ?? "",
    el.getAttribute("aria-haspopup") ?? "",
  ].join(" ");
  const roleLike = el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox";
  const classLike = /(^|[-_ ])(select|selector|dropdown|cascader)([-_ ]|$)/i.test(el.getAttribute("class") ?? "");
  if (!roleLike && !classLike && !/请选择|选择|select|combobox/i.test(probe)) return false;
  return !isInputElement(el) || el.readOnly || roleLike || classLike;
}
export function isTextFieldElement(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return isInputElement(el) || isTextAreaElement(el);
}

/** 元素自己所在窗口的 getComputedStyle（跨 realm 时主窗口的不一定可用） */
function computedStyleOf(el: Element): CSSStyleDeclaration {
  const view = el.ownerDocument?.defaultView ?? window;
  return view.getComputedStyle(el);
}

/** 元素对用户是否可见（扫描过滤用） */
export function isVisible(el: Element): boolean {
  // 只要 HTML 命名空间下的元素（排除 SVG / 文本节点）；不用 instanceof HTMLElement，
  // 那个判定对 same-origin iframe 里的元素恒 false（跨 realm）。
  if (el.nodeType !== 1 || el.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;
  const style = computedStyleOf(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;

  // 祖先链隐藏检查（父容器 display:none 等；jsdom 与真实浏览器均有效）
  let node: Element | null = el.parentElement;
  while (node && node !== el.ownerDocument?.documentElement) {
    const s = computedStyleOf(node);
    if (s.display === "none" || s.visibility === "hidden") return false;
    node = node.parentElement;
  }

  // 布局检查：有布局引擎（真实浏览器）时 rect 全 0 视为不可见；
  // 无布局引擎（jsdom 测试环境）rect 恒 0，不做尺寸判定，避免误杀。
  // 注意：这里绝不能往 document.body 挂探针元素——Scan 阶段对页面零写入是产品红线。
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const ownBody = el.ownerDocument?.body ?? document.body;
    if (ownBody.getBoundingClientRect().width > 0) return false; // 有布局引擎但元素无尺寸 → 隐藏
  }
  return true;
}

/** CSS.escape 兼容（jsdom 未实现时降级） */
export function escapeSelector(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/([^a-zA-Z0-9_\u00A0-\uFFFF-])/g, "\\$1");
}

/** 紧凑文本：压缩空白、截断 */
export function compactText(s: string | null | undefined, maxLen = 120): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** 直接包裹的 <label>（for 属性关联由 getLabelForElement 处理） */
function wrapLabel(el: HTMLElement): string {
  const label = el.closest("label");
  if (!label) return "";
  // 包裹式 label 的文字去掉控件自身 value/placeholder 影响（textContent 已排除 input）
  return compactText(label.textContent);
}

/**
 * 某些 ATS 只把字段名渲染成普通 div/span，不使用 label[for]、placeholder 或 aria。
 * 这类控件在页面上有可见字段名，但 DOM 属性是空的，原先会显示为「未命名字段」。
 * 只在控件附近向上找少量前置兄弟文本，避免读取整页文本造成错配。
 */
export function nearbyLabelText(el: HTMLElement): string {
  const hasControl = (node: Element) =>
    node.matches("input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']") ||
    node.querySelector("input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']") !== null;
  const clean = (value: string): string =>
    compactText(value.replace(/[\u200b\uFEFF]/g, "").replace(/^[*＊\s]+|[*＊\s:：]+$/g, ""), 80);
  const semantic = (node: Element): string => {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute("role") ?? "";
    const hint = `${node.id} ${typeof node.className === "string" ? node.className : ""}`;
    const attributeLabel =
      node.getAttribute("data-label") ||
      node.getAttribute("data-field-label") ||
      node.getAttribute("aria-label") ||
      node.getAttribute("title");
    if (attributeLabel) return clean(attributeLabel);
    if (tag === "label" || role === "label" || /(label|caption|field[-_ ]?name|form[-_ ]?label|title)/i.test(hint)) {
      return clean(node.textContent ?? "");
    }
    return "";
  };

  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 8; depth++) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;

    // 先找有语义标记的前置节点，再接受紧邻控件的短文本节点。
    let sibling = node.previousElementSibling;
    let generic: string | undefined;
    for (let count = 0; sibling && count < 4; count++, sibling = sibling.previousElementSibling) {
      if (hasControl(sibling)) continue;
      const semanticText = semantic(sibling);
      if (semanticText) return semanticText;
      const text = clean(sibling.textContent ?? "");
      if (!generic && text && text.length <= 40) generic = text;
    }
    if (generic) return generic;

    // 字段名和控件是同一容器的直接文本子节点时，例如：<div>姓名<input></div>。
    const directText = clean(
      Array.from(parent.childNodes)
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent ?? "")
        .join(" "),
    );
    if (directText && directText.length <= 40) return directText;

    const parentLabel = semantic(parent);
    if (parentLabel && parentLabel.length <= 80) return parentLabel;

    // 北森字段行常有 5~7 层包装，字段名只存在于唯一控件容器的文本节点中。
    // 只接受「该容器只有一个表单控件」的短文本，避免把整段页面内容当标签。
    const controls = parent.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='combobox']");
    if (controls.length === 1 && !isCustomSelectElement(el)) {
      const containerText = clean(parent.textContent ?? "")
        .replace(clean(el.getAttribute("placeholder") ?? ""), "")
        .replace(clean(el.getAttribute("value") ?? ""), "");
      if (containerText && containerText.length <= 80) return containerText;
    }

    node = parent;
  }
  return "";
}

/**
 * radio / checkbox 组的组标题（「性别」「语言能力」这类）。
 * 组内每个控件的 label 是选项自己（男 / 英语CET-6），拿它当字段名会让整组识别不到——
 * 这是网申里极常见的一类「字段看得见、就是填不了」。
 * 取值顺序：所在 fieldset 的 legend → 同一行里不含控件的 label/span 文本。
 */
export function groupTitleFor(el: HTMLElement): string {
  const legend = fieldsetLegendText(el);
  if (legend) return legend;

  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 6; depth++) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    const sameKind = parent.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (sameKind.length >= 2) {
      const candidates = Array.from(parent.children).filter(
        (child) => child.querySelector("input, textarea, select") === null,
      );
      for (const child of candidates) {
        const text = compactText(
          (child.getAttribute("aria-label") || child.textContent || "").replace(/[\s:：*＊]+$/, ""),
          40,
        );
        if (text && text.length <= 24) return text;
      }
      const ownLabel = compactText(
        Array.from(parent.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent ?? "")
          .join(" "),
        40,
      );
      if (ownLabel) return ownLabel;
    }
    node = parent;
  }
  return "";
}

/** for= 关联 + 包裹式 label */
function htmlForLabel(el: HTMLElement): string {
  const id = el.id;
  if (id) {
    // 标签属于控件自己的 document；同源 iframe 中不能查主文档。
    const label = el.ownerDocument?.querySelector(`label[for="${escapeSelector(id)}"]`);
    if (label) return compactText(label.textContent);
  }
  return wrapLabel(el) || nearbyLabelText(el);
}

function ariaLabelledbyText(el: HTMLElement): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  const doc = el.ownerDocument ?? document;
  const parts = ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? "")
    .filter(Boolean);
  return compactText(parts.join(" "));
}

/** 最近的 section 标题：只认祖先容器的「直接子元素」heading，避免跨字段污染 */
export function closestHeadingText(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; depth < 8 && node; depth++) {
    for (const child of node.children) {
      if (/^H[1-6]$/.test(child.tagName)) return compactText(child.textContent);
      const hint = `${child.id} ${typeof child.className === "string" ? child.className : ""}`;
      const hasControl = child.querySelector("input, textarea, select, [role='combobox']") !== null;
      if (!hasControl && /(section[-_ ]?title|form[-_ ]?title|panel[-_ ]?title|header|title|heading|caption)/i.test(hint)) {
        const text = compactText(child.textContent, 80);
        if (text) return text;
      }
    }
    node = node.parentElement;
  }
  return "";
}

/** 所属 fieldset 的 legend（仅限本字段所在 fieldset 的直接 legend） */
export function fieldsetLegendText(el: HTMLElement): string {
  const fieldset = el.closest("fieldset");
  if (!fieldset) return "";
  return compactText(fieldset.querySelector(":scope > legend")?.textContent);
}

/**
 * 结构路径：从 body 到该元素的子节点序号链。
 * 大量招聘表单的 input 没有 name/id/aria-label，label 又要靠邻近文本推断（同一份表单里
 * 三个「公司名称」推断出的 label 完全相同）——只用属性 + 同类序号的话，
 * 页面异步插入或删除一个控件，序号就整体漂移，值会写进邻居控件（填错位置）。
 * 属性相同、结构位置不同的控件，靠这条链区分。
 */
export function structuralPathOf(el: HTMLElement): number[] {
  const parts: number[] = [];
  const doc = el.ownerDocument ?? document;
  let node: HTMLElement | null = el;
  for (let depth = 0; node && node !== doc.body && node.parentElement && depth < 24; depth++, node = node.parentElement) {
    parts.unshift(Array.from(node.parentElement.children).indexOf(node));
  }
  return parts;
}

/**
 * 字段指纹：重扫描对齐 + 回写定位。
 * 包含 tagName/type/name/id/label/placeholder/同类序号/结构路径；不依赖动态 class。
 * placeholder 必须入指纹：大量招聘网站表单（如姚记 ATS）的 input 无 name/id/label，
 * 字段之间只靠 placeholder 区分——漏掉它会导致所有指纹雷同、定位/回写命中第一个输入框。
 */
export function fingerprintOf(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type ?? "";
  const name = el.getAttribute("name") ?? "";
  const id = el.id ?? "";
  const label = compactText(htmlForLabel(el) || el.getAttribute("aria-label") || "", 40);
  const placeholder = el.getAttribute("placeholder") ?? "";
  // 注意：idx 口径必须与 findElementByFingerprint 的反查列表完全一致
  // （Stage 5.5：同类元素全量 = 主文档 + open shadowRoot + same-origin iframe）
  const sameKind = collectSameKindElements(tag);
  const idx = sameKind.indexOf(el);
  return JSON.stringify({ tag, type, name, id, label, placeholder, idx, path: structuralPathOf(el) });
}

/**
 * Stage 5.5：同类元素全量收集——主文档 + open shadowRoot（递归）+ same-origin iframe。
 * fingerprintOf 与 findElementByFingerprint 共用同一口径，保证 idx 可对齐；
 * cross-origin iframe / closed shadowRoot 无法访问（fail-safe 跳过）。
 */
export function collectSameKindElements(tag: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  const pushDoc = (doc: Document) => {
    out.push(...(Array.from(doc.querySelectorAll(`body ${tag}`)) as HTMLElement[]));
    // open shadowRoot 递归
    for (const host of Array.from(doc.querySelectorAll("*"))) {
      const root = (host as HTMLElement).shadowRoot;
      if (root) {
        out.push(...(Array.from(root.querySelectorAll(tag)) as HTMLElement[]));
        for (const nested of Array.from(root.querySelectorAll("*"))) {
          const nestedRoot = (nested as HTMLElement).shadowRoot;
          if (nestedRoot) out.push(...(Array.from(nestedRoot.querySelectorAll(tag)) as HTMLElement[]));
        }
      }
    }
    // same-origin iframe 递归
    for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        const child = frame.contentDocument;
        if (child) {
          out.push(...(Array.from(child.querySelectorAll(tag)) as HTMLElement[]));
        }
      } catch {
        // cross-origin：跳过
      }
    }
  };
  pushDoc(document);
  return out;
}

/** 属性部分是否与指纹一致（不含 idx；label/placeholder 按 scan 时相同规则提取） */
function matchesFingerprintAttributes(
  el: HTMLElement,
  parsed: { type: string; name: string; id: string; label: string; placeholder?: string },
): boolean {
  const type = (el as HTMLInputElement).type ?? "";
  const name = el.getAttribute("name") ?? "";
  const id = el.id ?? "";
  const label = compactText(htmlForLabel(el) || el.getAttribute("aria-label") || "", 40);
  const placeholder = el.getAttribute("placeholder") ?? "";
  return (
    type === parsed.type &&
    name === parsed.name &&
    id === parsed.id &&
    label === parsed.label &&
    placeholder === (parsed.placeholder ?? "")
  );
}

/**
 * 按指纹找回元素；找不到返回 null（filler 收到 null 记为 failed，不猜测）。
 * 关键：属性匹配可能命中多个元素（无 name/id/label 的表单很常见），
 * 绝不能返回第一个——先用结构路径消歧，再退到同类序号 idx；两者都无法消歧时返回 null（fail-safe）。
 */
export function findElementByFingerprint(fp: string): HTMLElement | null {
  try {
    const parsed = JSON.parse(fp) as {
      tag: string; type: string; name: string; id: string; label: string; placeholder?: string; idx: number;
      path?: number[];
    };
    // 与 fingerprintOf 相同口径：同类元素全量列表（主文档 + shadowRoot + same-origin iframe）
    const sameKind = collectSameKindElements(parsed.tag);
    const matched = sameKind.filter((el) => matchesFingerprintAttributes(el, parsed));
    if (matched.length === 0) {
      // 属性零命中：只有「本来就没有任何可辨识属性」的控件才允许按同类序号兜底。
      // 有 name/id/label 却匹配不上 = 那个字段已经消失，此时按序号猜会把值写进邻居控件
      // （值串位是真实 Pilot 的停止条件），宁可 failed 让用户重新识别。
      const hasIdentity = Boolean(parsed.name || parsed.id || parsed.label || parsed.placeholder);
      if (hasIdentity) return null;
      const byIdx = sameKind[parsed.idx];
      if (!byIdx) return null;
      const kindOf = (e: HTMLElement) => ((e as HTMLInputElement).type ?? "").toLowerCase();
      return kindOf(byIdx) === (parsed.type ?? "").toLowerCase() ? byIdx : null;
    }
    if (matched.length === 1) return matched[0] ?? null;

    // 多命中：结构路径唯一命中 → 用它（同名同 label 的重复块靠这个区分）
    if (parsed.path && parsed.path.length > 0) {
      const byPath = matched.filter((el) => {
        const p = structuralPathOf(el);
        return p.length === parsed.path!.length && p.every((v, i) => v === parsed.path![i]);
      });
      if (byPath.length === 1) return byPath[0] ?? null;
      if (byPath.length > 1) return null;
    }
    const byIdx = sameKind[parsed.idx];
    if (byIdx && matched.includes(byIdx)) return byIdx;
    return null;
  } catch {
    return null;
  }
}

export { htmlForLabel, ariaLabelledbyText };

/* ------------------------------------------------------------------ *
 * 写入层共用工具：等待异步回显 / 读回用户看得见的值
 * ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 轮询等待页面把结果画出来，直到 predicate 返回真值。
 * 自定义下拉、日期面板、受控组件的选中态都是异步渲染的，
 * 点击后同步读值读到的是老值——这是「明明填上了却报失败」的根因。
 * 用 setTimeout 轮询而非 rAF：后台标签页里 rAF 会被节流到 1s 一次。
 */
export async function waitFor<T>(
  predicate: () => T | null | false,
  timeout = 400,
  interval = 40,
): Promise<T | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value as T;
    if (Date.now() >= deadline) return null;
    await sleep(interval);
  }
}

/** 选项文本比较口径：去空白、小写、全角括号转半角、去「（必填）」这类修饰 */
export function normalizeChoice(s: string): string {
  return (s ?? "")
    .replace(/[\u200b\u200c\ufeff]/g, "")
    .replace(/[（(]\s*(必填|选填)\s*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[：:；;。.、,，*＊]/g, "")
    .toLowerCase()
    .trim();
}

/** 日期归一：`2026.06` / `2026年6月` / `2026-06-01` 都收成 `2026-06`（补零、去分隔符差异） */
export function normalizeDate(s: string): string {
  const raw = (s ?? "").replace(/[\u5e74\u6708\u65e5/\.\s]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(raw);
  if (!m) return raw;
  const y = m[1] ?? "";
  const mo = m[2] ? m[2].padStart(2, "0") : "";
  const d = m[3] ? m[3].padStart(2, "0") : "";
  return mo ? `${y}-${mo}${d ? `-${d}` : ""}` : y;
}

/** radio / checkbox 组：同 name 的全部控件（跨 realm 用元素自己的 document） */
export function getRadioGroup(el: HTMLInputElement): HTMLInputElement[] {
  const name = el.getAttribute("name");
  if (!name) return [el];
  const doc = el.ownerDocument ?? document;
  const escaped = name.replace(/"/g, '\\"');
  const group = Array.from(doc.querySelectorAll(`input[type="radio"][name="${escaped}"]`)) as HTMLInputElement[];
  return group.length > 0 ? group : [el];
}

export function getCheckboxGroup(el: HTMLInputElement): HTMLInputElement[] {
  const name = el.getAttribute("name");
  const doc = el.ownerDocument ?? document;
  if (!name) {
    // 无 name 的独立勾选框（「接受调剂」「是否同意」这类单项勾选）
    return isCheckboxElement(el) ? [el] : [];
  }
  const escaped = name.replace(/"/g, '\\"');
  const group = Array.from(doc.querySelectorAll(`input[type="checkbox"][name="${escaped}"]`)) as HTMLInputElement[];
  return group.length > 0 ? group : isCheckboxElement(el) ? [el] : [];
}

/** 自定义下拉真正回显给用户的那段文字（各 UI 库的选中态容器并集） */
function customSelectDisplayText(el: HTMLElement): string {
  const fromValue = isInputElement(el) ? el.value.trim() : "";
  if (fromValue) return fromValue;
  const scope =
    el.closest<HTMLElement>('[class*="select"], [class*="Select"], [class*="picker"], [class*="cascader"], [role="combobox"]') ??
    el.parentElement;
  if (scope) {
    const item = scope.querySelector<HTMLElement>(
      '.ant-select-selection-item, .el-select__placeholder:not(.is-transparent), .el-select__selected-item, ' +
        '.ivu-select-selected-value, [class*="selection-item"], [class*="selection__value"], [class*="select-value"]',
    );
    const text = item?.getAttribute("title") || compactText(item?.textContent ?? "", 60);
    if (text) return text;
  }
  return compactText(el.textContent ?? "", 60) || (el.getAttribute("aria-label") ?? "");
}

/**
 * 读回「用户在这个控件上看得见的值」。
 * 写入成功与否一律以此为准：只读 input 驱动的自定义下拉，它的值在兄弟节点的文本里，
 * 读 input.value 恒为空，于是真机上一大批下拉全部被判成填写失败。
 */
export function readDisplayValue(el: HTMLElement): string {
  if (isRadioElement(el)) {
    const checked = getRadioGroup(el).find((item) => item.checked);
    return checked ? htmlForLabel(checked) || checked.value : "";
  }
  if (isCheckboxElement(el)) {
    const group = getCheckboxGroup(el);
    const checked = group.filter((item) => item.checked);
    const own = isCheckboxElement(el) && el.checked ? [el] : [];
    const list = checked.length > 0 ? checked : own;
    return list.map((item) => htmlForLabel(item) || item.value).filter(Boolean).join("、");
  }
  if (isSelectElement(el)) {
    const selected = Array.from(el.selectedOptions).map((o) => compactText(o.textContent ?? "", 60)).filter(Boolean);
    return selected.length > 0 ? selected.join("、") : el.value;
  }
  if (isInputElement(el) || isTextAreaElement(el)) {
    // 只读 input 驱动的自定义下拉：值在兄弟节点的文本里，input.value 恒为空
    if (!el.value && isCustomSelectElement(el)) return customSelectDisplayText(el);
    return el.value;
  }
  if (el.isContentEditable) return compactText(el.textContent ?? "", 2000);
  if (isCustomSelectElement(el)) return customSelectDisplayText(el);
  return customSelectDisplayText(el);
}

/** 页面当前显示的值是否已经等于要填的值（日期按日期语义比，其余按归一化文本） */
export function valueMatchesRequested(el: HTMLElement, requested: string): boolean {
  const want = normalizeChoice(requested);
  // 原生 select 的「值」是 option 的 value，用户看到的是文本，两者都算填对了
  if (isSelectElement(el)) {
    const selected = el.selectedOptions[0];
    if (selected) {
      if (selected.value === requested.trim()) return true;
      if (normalizeChoice(selected.textContent ?? "") === want) return true;
    }
  }
  const actual = readDisplayValue(el);
  const got = normalizeChoice(actual);
  if (got === want) return true;
  if (isDatePickerElement(el)) {
    const nd = normalizeDate(requested);
    if (nd && normalizeDate(actual) === nd) return true;
  }
  // 自定义下拉/单选的显示文本常带注释（「本科（普通全日制）」「杭州市」），
  // 只有这类控件允许包含式判定；普通文本框必须精确相等，否则会把写错的值报成成功。
  const displayLike = isCustomSelectElement(el) || isRadioElement(el) || isSelectElement(el);
  if (displayLike && want.length >= 2 && got.includes(want)) return true;
  return false;
}
