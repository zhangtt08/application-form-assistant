import { isVisible } from "../content/domUtils";

/**
 * Site Adapter（spec 第二十七~二十八章）：Generic First。
 * Generic 覆盖 80%；Site-specific 只解决真实使用中明确存在的问题，绝不为网站复制整套 scanner。
 */

export interface SiteAdapter {
  name: string;
  matches(location: Location, doc: Document): boolean;
  /** 扫描前过滤：返回 false 的元素跳过（如已知导航栏假字段） */
  scanFilter?(el: HTMLElement): boolean;
  /** 写入前过滤 */
  writeFilter?(el: HTMLElement, value: string): { ok: boolean; detail?: string };
}

export const GenericSiteAdapter: SiteAdapter = {
  name: "generic",
  matches() {
    return true;
  },
};

/** Custom Select 三级策略（spec 第十二章）：安全优先，unknown 一律 Manual Only */
export type CustomSelectLevel = "native" | "known-custom" | "unknown-custom";

export function classifySelect(el: HTMLElement): CustomSelectLevel {
  if (el instanceof HTMLSelectElement) return "native";
  const role = el.getAttribute("role");
  if (role === "listbox" || role === "combobox") return "known-custom";
  if (el.closest('[role="listbox"], .select2, .select2-container')) return "known-custom";
  return "unknown-custom";
}

/** Hidden Field Rule（spec 第二十~二十九章）：不可交互副本绝不进入自动 Fill */
export function isInteractable(el: HTMLElement): boolean {
  if (!isVisible(el)) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if ((el as HTMLInputElement).disabled) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}
