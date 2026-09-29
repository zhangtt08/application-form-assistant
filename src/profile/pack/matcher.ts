import type { JobContext } from "../../job/schema";
import type { MatchConfidence, PackMatch, PackMatchResult, ProfilePack } from "./types";

/**
 * ProfilePackMatcher（spec 第六~八章）：完全确定性规则，不调用 LLM。
 * 输入 JobContext → 输出 matches（按分排序）+ recommendedPackId + confidence。
 */

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "");
}

/** 单 Pack 评分：岗位标题命中（权重 3）+ 关键词命中（权重 1）− 排除关键词（−2/个） */
export function scorePack(pack: ProfilePack, job: Pick<JobContext, "position" | "jd" | "keywords">): PackMatch {
  const position = normalize(job.position);
  const jd = normalize(job.jd);
  const haystack = `${position} ${jd}`;
  const jobKeywords = (job.keywords ?? []).map(normalize);

  const matchedJobTitles: string[] = [];
  for (const title of pack.matchRules.jobTitles) {
    const t = normalize(title);
    if (t && (position.includes(t) || jobKeywords.some((k) => k.includes(t)))) {
      matchedJobTitles.push(title);
    }
  }

  const matchedKeywords: string[] = [];
  for (const kw of pack.matchRules.keywords) {
    const k = normalize(kw);
    if (k && (haystack.includes(k) || jobKeywords.some((jk) => jk.includes(k)))) {
      matchedKeywords.push(kw);
    }
  }

  const excludedKeywords: string[] = [];
  for (const ex of pack.matchRules.excludeKeywords) {
    const e = normalize(ex);
    if (e && (position.includes(e) || jd.includes(e) || jobKeywords.some((jk) => jk.includes(e)))) {
      excludedKeywords.push(ex);
    }
  }

  const score = matchedJobTitles.length * 3 + matchedKeywords.length - excludedKeywords.length * 2;
  return {
    profilePackId: pack.id,
    score,
    matchedJobTitles,
    matchedKeywords,
    excludedKeywords,
  };
}

/** Confidence（spec 第八章）：Top1 明显高于 Top2 → high；接近 → low；中间 → medium */
export function computeConfidence(sorted: PackMatch[]): MatchConfidence {
  if (sorted.length === 0) return "low";
  const top = sorted[0]!.score;
  if (top <= 0) return "low";
  const second = sorted[1]?.score ?? 0;
  if (top - second >= 3) return "high";
  if (top - second >= 1) return "medium";
  return "low";
}

export function matchPacks(
  packs: ProfilePack[],
  job: Pick<JobContext, "position" | "jd" | "keywords">,
): PackMatchResult {
  const matches = packs
    .filter((p) => p.enabled)
    .map((p) => scorePack(p, job))
    .sort((a, b) => b.score - a.score);

  const confidence = computeConfidence(matches);
  const top = matches[0];
  const recommendedProfilePackId = top && top.score > 0 ? top.profilePackId : null;
  return { matches, recommendedProfilePackId, confidence };
}
