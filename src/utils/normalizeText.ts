/** 全角字符 → 半角 */
function toHalfWidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code === 0x3000) {
      out += " "; // 全角空格
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 中文括号统一为半角 */
function normalizeBrackets(s: string): string {
  return s.replace(/[（(]/g, "(").replace(/[）)]/g, ")");
}

/** 移除 required/optional 噪音词（括号已在前面统一为半角） */
function stripNoise(s: string): string {
  return s
    .replace(/\*+/g, "")
    .replace(/\((?:required|optional|必填|选填)\)/gi, "")
    .replace(/必填|选填|required|optional/gi, "");
}

/**
 * 字段识别前统一 Normalize：
 * lowercase、trim、全角半角、括号、去冒号/星号、去必填提示、压缩空白。
 * "* 手机号码：" -> "手机号码"
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let s = toHalfWidth(input.toLowerCase());
  s = normalizeBrackets(s);
  s = stripNoise(s);
  s = s.replace(/[:：]/g, " ");
  s = s.replace(/[\s\u3000]+/g, " ").trim();
  return s;
}

/** 提取字母数字 token（用于 name/id 属性的信号提取） */
export function tokenize(s: string): string[] {
  const norm = normalizeText(s);
  if (!norm) return [];
  // 中英文混合：中文按字切，英文按词切
  return norm
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean)
    .flatMap((seg) => {
      if (/^[\u4e00-\u9fff]+$/.test(seg)) return Array.from(seg);
      return seg.split(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/);
    });
}

/** 驼峰/下划线 name 属性转可读文本："phoneNumber" / "phone_number" / "user-phone" */
export function deCamelize(s: string): string {
  return s
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}
