/**
 * Scanner 忽略规则与全局安全限制。
 * 这些规则决定哪些 DOM 元素不进入扫描结果。
 */

/** 无论如何不得触发 click 的动作（全局安全限制，代码中不存在任何提交逻辑） */
export const BLOCKED_ACTIONS = ["submit", "final-submit", "confirm-submit"] as const;

/** 直接跳过的 input type */
export const IGNORED_INPUT_TYPES = new Set([
  "password", "file", "submit", "button", "image", "hidden", "reset",
]);

/** name/id/placeholder/label 命中即忽略（搜索框、验证码等） */
export const IGNORE_KEYWORDS: string[] = [
  "search", "搜索", "查找",
  "captcha", "验证码", "verification code", "图形验证", "安全码",
  "password", "密码", "确认密码", "再次输入密码",
  "upload", "附件", "上传",
];

/** 单选/复选组常见法律选项：即使识别也不能替用户勾选 */
export const MANUAL_ONLY_OPTION_TEXTS: string[] = [
  "我已阅读", "本人已阅读", "同意", "我同意", "已知晓", "接受", "agree", "i agree", "已阅读并同意",
];

export function isIgnoredByKeyword(text: string): boolean {
  const norm = text.toLowerCase();
  return IGNORE_KEYWORDS.some((kw) => norm.includes(kw.toLowerCase()));
}
