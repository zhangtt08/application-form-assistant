import { extractClaims, type ExtractedClaim } from "./claimExtractor";
import type { ClaimCheck, Fact, ValidationReport } from "./types";

/**
 * Fact Validator（spec 第十二~十五章）：Stage 3 最重要的模块。
 *
 * 规则：
 * - Numeric Guard：Draft 中所有数字必须能在 Facts 文本中找到（禁止仅靠语义相似）
 * - Technology Guard：Draft 中的技术必须在 Facts 中存在；JD 不能成为事实来源
 * - Responsibility Guard：强责任动词（主导/带领/独立…）需要 Facts 同等强度支持；
 *   Facts 只有「参与」时禁止升级为「主导」
 * - Sentence claims：与事实集合做关键词重叠判定 → supported / uncertain
 * 聚合：全部 supported → pass；存在 uncertain → review；存在 unsupported → fail
 */

/** 数字 token 归一：全角→半角、去逗号、统一连字符 */
function normalizeNumberToken(token: string): string {
  return token
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
    .replace(/[,，]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 从事实集合中提取所有数字 token（含区间端点） */
function factNumberTokens(facts: Fact[]): Set<string> {
  const tokens = new Set<string>();
  for (const f of facts) {
    const norm = normalizeNumberToken(f.text);
    for (const m of norm.matchAll(/\d+(?:\.\d+)?/g)) {
      tokens.add(m[0]);
    }
  }
  return tokens;
}

/** 技术词在事实文本中是否存在（忽略大小写） */
function techSupportedByFacts(tech: string, facts: Fact[]): boolean {
  const needle = tech.toLowerCase();
  return facts.some((f) => f.text.toLowerCase().includes(needle));
}

/** 句子 claim 支持判定：与事实做分词重叠（字符 bigram 简易分词，中文友好） */
function sentenceSupport(factTexts: string[], claim: string): { status: "supported" | "uncertain" | "unsupported"; supporting: string[] } {
  const claimBigrams = bigrams(claim.replace(/\s/g, ""));
  if (claimBigrams.length === 0) return { status: "unsupported", supporting: [] };
  const supporting: string[] = [];
  let bestOverlap = 0;
  for (const text of factTexts) {
    const factBigrams = new Set(bigrams(text.replace(/\s/g, "")));
    let overlap = 0;
    for (const bg of claimBigrams) if (factBigrams.has(bg)) overlap += 1;
    const ratio = claimBigrams.length > 0 ? overlap / claimBigrams.length : 0;
    if (ratio > bestOverlap) bestOverlap = ratio;
    if (ratio >= 0.35) supporting.push(text.slice(0, 30));
  }
  if (bestOverlap >= 0.35) return { status: "supported", supporting };
  if (bestOverlap >= 0.15) return { status: "uncertain", supporting };
  return { status: "unsupported", supporting };
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

/** 校验单条 Draft（主入口） */
export function validateDraft(draft: string, facts: Fact[]): ValidationReport {
  const claims: ClaimCheck[] = [];
  const factTexts = facts.map((f) => f.text);
  const numberTokens = factNumberTokens(facts);
  const extracted: ExtractedClaim[] = extractClaims(draft);

  for (const { claim, kind } of extracted) {
    if (kind === "numeric") {
      const norm = normalizeNumberToken(claim);
      const nums = norm.match(/\d+(?:\.\d+)?/g) ?? [];
      const allSupported = nums.length > 0 && nums.every((n) => numberTokens.has(n));
      claims.push({
        claim,
        kind,
        status: allSupported ? "supported" : "unsupported",
        supportingFactIds: allSupported ? facts.filter((f) => nums.some((n) => normalizeNumberToken(f.text).includes(n))).map((f) => f.id) : [],
        reason: allSupported ? undefined : `数字 ${claim} 在事实中不存在`,
      });
      continue;
    }

    if (kind === "technology") {
      const supported = techSupportedByFacts(claim, facts);
      claims.push({
        claim,
        kind,
        status: supported ? "supported" : "unsupported",
        supportingFactIds: supported ? facts.filter((f) => f.text.toLowerCase().includes(claim.toLowerCase())).map((f) => f.id) : [],
        reason: supported ? undefined : `技术 ${claim} 不在经历事实中（JD 要求不能作为事实来源）`,
      });
      continue;
    }

    if (kind === "responsibility") {
      // 强动词需要事实中有同等或更强表达；Facts 只有「参与」时禁止升级（spec Stage 3 第十五章）
      const factHasStrong = factTexts.some((t) =>
        ["主导", "带领", "管理", "独立", "负责", "牵头"].some((w) => t.includes(w)),
      );
      const status = factHasStrong ? "supported" : "unsupported";
      claims.push({
        claim,
        kind,
        status,
        supportingFactIds: status === "supported" ? facts.filter((f) => ["主导", "带领", "管理", "独立", "负责", "牵头"].some((w) => f.text.includes(w))).map((f) => f.id) : [],
        reason:
          status === "supported"
            ? undefined
            : `事实中无对应角色动作，禁止从「参与」升级为「${claim}」`,
      });
      continue;
    }

    // sentence
    const { status, supporting } = sentenceSupport(factTexts, claim);
    claims.push({
      claim,
      kind,
      status,
      supportingFactIds: supporting.length > 0 ? facts.filter((f) => supporting.some((s) => f.text.slice(0, 30) === s)).map((f) => f.id) : [],
      reason: status === "unsupported" ? "该句在事实集合中找不到支持" : undefined,
    });
  }

  const hasUnsupported = claims.some((c) => c.status === "unsupported");
  const hasUncertain = claims.some((c) => c.status === "uncertain");
  const status = hasUnsupported ? "fail" : hasUncertain ? "review" : "pass";
  return { status, claims };
}
