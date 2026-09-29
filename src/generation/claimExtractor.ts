import { TECH_TERMS } from "./promptBuilder";
import type { ClaimCheck } from "./types";

/**
 * Claim Extraction（spec 第十一章）：
 * 从 Draft 中抽取可验证的 Claim——句子级声明 + 数字声明 + 技术声明 + 责任强度声明。
 * 独立接口：第一阶段规则提取，后续可替换/叠加 LLM 版本。
 * 不信任模型自报的 usedFactIds，一切以本模块输出 + FactValidator 为准。
 */

export interface ExtractedClaim {
  claim: string;
  kind: ClaimCheck["kind"];
}

/** 强责任动词：出现即需要事实支持同等强度（spec 第十五章） */
export const STRONG_ACTION_WORDS = ["主导", "带领", "管理", "独立完成", "独立负责", "独立开发", "负责", "牵头"];
/** 弱责任动词：事实中只有弱动词时，draft 的强动词不可支持 */
export const WEAK_ACTION_WORDS = ["参与", "协助", "配合", "支持", "辅助"];

/** 提取数字声明（含上下文单位，如「5000-6000 条」「90%+」「4 小时」「10 人」） */
export function extractNumericClaims(draft: string): string[] {
  const claims: string[] = [];
  const pattern = /\d+(?:\.\d+)?\s*(?:[-–~至]\s*\d+(?:\.\d+)?)?\s*(?:%|％|条|人|万|小时|分钟|天|倍|个|次|款|篇|场)?\s*(?:[+＋]|以上)?/g;
  for (const m of draft.matchAll(pattern)) {
    const token = m[0].trim();
    // 纯序号（句首「1.」）与年份上下文弱化：仍保留，由 validator 对 facts 判定
    if (token && /\d/.test(token)) claims.push(token);
  }
  return claims;
}

/** 提取技术声明：draft 中出现的技术词 */
export function extractTechnologyClaims(draft: string): string[] {
  const found: string[] = [];
  const lower = draft.toLowerCase();
  for (const term of TECH_TERMS) {
    if (lower.includes(term.toLowerCase())) found.push(term);
  }
  return found;
}

/** 提取责任强度声明：draft 中出现的强/弱动词 */
export function extractResponsibilityClaims(draft: string): { strong: string[]; weak: string[] } {
  return {
    strong: STRONG_ACTION_WORDS.filter((w) => draft.includes(w)),
    weak: WEAK_ACTION_WORDS.filter((w) => draft.includes(w)),
  };
}

/** 句子级声明切分 */
export function extractSentenceClaims(draft: string): string[] {
  return draft
    .split(/。|；|;|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** 汇总提取：返回待验证的 Claim 列表（kind 标注来源类型） */
export function extractClaims(draft: string): ExtractedClaim[] {
  if (!draft.trim()) {
    const err = new Error("empty draft") as Error & { code?: string };
    err.code = "CLAIM_EXTRACTION_FAILED";
    throw err;
  }
  const claims: ExtractedClaim[] = [];
  for (const n of extractNumericClaims(draft)) claims.push({ claim: n, kind: "numeric" });
  for (const t of extractTechnologyClaims(draft)) claims.push({ claim: t, kind: "technology" });
  const resp = extractResponsibilityClaims(draft);
  for (const w of resp.strong) claims.push({ claim: w, kind: "responsibility" });
  for (const s of extractSentenceClaims(draft)) claims.push({ claim: s, kind: "sentence" });
  return claims;
}
