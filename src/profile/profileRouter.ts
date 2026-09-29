import type { JobContext } from "../job/schema";
import { PROFILE_CONFIG, PROFILE_TYPES, VARIANT_KEY_BY_TYPE, type ProfileType } from "../job/profileTypes";
import type { Profile } from "../types/profile";
import { normalizeText } from "../utils/normalizeText";

/**
 * Profile Router（spec Stage 2 第四/五章）：
 * JobContext → ProfileSelection（含置信度与可解释原因）。
 * 独立纯函数模块，不碰 UI / DOM / storage。
 *
 * 置信度规则（确定性，无统计模型）：
 * - 无关键词命中 → low（general 兜底，禁止猜岗位）
 * - top1 与 top2 原始分差比例 ≥ 0.35 且命中词 ≥ 2 → high
 * - 分差比例 ≥ 0.25 → medium
 * - 其余（含两方向接近）→ low
 */

export type RoutingConfidence = "high" | "medium" | "low";

export interface ProfileSelection {
  primaryProfile: ProfileType;
  /** 0-1 归一化分数（相对最高分方向） */
  scores: Record<ProfileType, number>;
  /** 原始加权分 */
  rawScores: Record<ProfileType, number>;
  /** 每个方向命中的关键词（可解释：「为什么判断为 AI 产品」） */
  matchedKeywords: Record<ProfileType, string[]>;
  routingConfidence: RoutingConfidence;
  /** 人话版判断依据 */
  routingReason: string;
  /**
   * 推荐使用的经历 id 顺序：有「当前方向变体」的经历排前，其余按 Profile 原序。
   * 经历条目用 index 序号（exp-0 / exp-1 ...，internships+projects+campus 拼接序）。
   */
  recommendedExperienceIds: string[];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count += 1;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
}

function hasVariant(profile: Profile, entryIndex: number, type: ProfileType): boolean {
  const all = [...profile.internships, ...profile.projects, ...profile.campus];
  const entry = all[entryIndex];
  const variants = entry && "variants" in entry ? entry.variants : undefined;
  if (!variants) return false;
  const key = VARIANT_KEY_BY_TYPE[type];
  if (!key) return false;
  return Boolean(variants[key]);
}

function emptyKeywordMap(): Record<ProfileType, string[]> {
  const out = {} as Record<ProfileType, string[]>;
  for (const t of PROFILE_TYPES) out[t] = [];
  return out;
}

/** 计算路由置信度与原因（确定性规则，可测试） */
export function computeRoutingConfidence(
  rawScores: Record<ProfileType, number>,
  matchedKeywords: Record<ProfileType, string[]>,
): { confidence: RoutingConfidence; reason: string } {
  const ranked = [...PROFILE_TYPES]
    .filter((t) => t !== "general")
    .sort((a, b) => rawScores[b] - rawScores[a]);
  const top = ranked[0] as ProfileType;
  const second = (ranked[1] ?? top) as ProfileType;
  const topScore = rawScores[top];
  const secondScore = rawScores[second];

  if (topScore <= 0) {
    return {
      confidence: "low",
      reason: "JD 中没有命中任何方向关键词，使用通用版本；建议手动选择申请方向。",
    };
  }

  const topKeywords = matchedKeywords[top].length;
  const gapRatio = secondScore > 0 ? (topScore - secondScore) / topScore : 1;

  if (gapRatio >= 0.35 && topKeywords >= 2) {
    return {
      confidence: "high",
      reason: `命中 ${PROFILE_CONFIG[top].label} 关键词 ${topKeywords} 个，与次优方向分差明显。`,
    };
  }
  if (gapRatio >= 0.25) {
    return {
      confidence: "medium",
      reason: `命中 ${PROFILE_CONFIG[top].label} 关键词 ${topKeywords} 个；次优为 ${PROFILE_CONFIG[second].label}，建议核对填写版本。`,
    };
  }
  return {
    confidence: "low",
    reason: `${PROFILE_CONFIG[top].label} 与 ${PROFILE_CONFIG[second].label} 得分接近，方向判断不确定，建议确认填写版本。`,
  };
}

export function routeJob(job: JobContext, profile: Profile): ProfileSelection {
  // 评分文本不含 job.keywords——那是 parser 分类命中的词列表，再次拼入会对已命中词重复计分
  const text = normalizeText([job.position, job.jd, job.pageTitle].join("\n"));

  const rawScores = Object.fromEntries(PROFILE_TYPES.map((t) => [t, 0])) as Record<ProfileType, number>;
  const matchedKeywords = emptyKeywordMap();

  for (const type of PROFILE_TYPES) {
    for (const [word, weight] of Object.entries(PROFILE_CONFIG[type].keywords)) {
      const occurrences = countOccurrences(text, normalizeText(word));
      if (occurrences > 0) {
        rawScores[type] += Math.min(occurrences, 5) * weight;
        matchedKeywords[type].push(word);
      }
    }
  }

  // 已捕获 JD 自带的分类分作为先验加成（captured 时 parser 已评过一次）
  if (job.jobType !== "general" && rawScores[job.jobType] > 0) {
    rawScores[job.jobType] += rawScores[job.jobType] * 0.3;
  }

  const maxRaw = Math.max(...PROFILE_TYPES.map((t) => rawScores[t]));

  // 无任何命中 → general 兜底（禁止猜岗位）
  if (maxRaw <= 0) {
    return {
      primaryProfile: "general",
      scores: Object.fromEntries(PROFILE_TYPES.map((t) => [t, t === "general" ? 1 : 0])) as Record<ProfileType, number>,
      rawScores,
      matchedKeywords,
      routingConfidence: "low",
      routingReason: "JD 中没有命中任何方向关键词，使用通用版本；建议手动选择申请方向。",
      recommendedExperienceIds: [],
    };
  }

  const scores = Object.fromEntries(
    PROFILE_TYPES.map((t) => [t, Number((rawScores[t] / maxRaw).toFixed(2))]),
  ) as Record<ProfileType, number>;

  let primaryProfile: ProfileType = "general";
  let best = -1;
  for (const type of PROFILE_TYPES) {
    if (rawScores[type] > best) {
      best = rawScores[type];
      primaryProfile = type;
    }
  }

  const { confidence, reason } = computeRoutingConfidence(rawScores, matchedKeywords);

  // 推荐经历：有当前方向变体的经历排前
  const totalEntries = profile.internships.length + profile.projects.length + profile.campus.length;
  const withVariant: string[] = [];
  const withoutVariant: string[] = [];
  for (let i = 0; i < totalEntries; i += 1) {
    (hasVariant(profile, i, primaryProfile) ? withVariant : withoutVariant).push(`exp-${i}`);
  }

  return {
    primaryProfile,
    scores,
    rawScores,
    matchedKeywords,
    routingConfidence: confidence,
    routingReason: reason,
    recommendedExperienceIds: [...withVariant, ...withoutVariant],
  };
}

/**
 * Effective Profile（spec Stage 2 第三章）：
 * effectiveProfileType = profileOverride ?? routedProfileType
 * Override 只是临时填写偏好，绝不篡改 JobContext.jobType。
 */
export function effectiveProfileType(selection: ProfileSelection, override: ProfileType | null): ProfileType {
  return override ?? selection.primaryProfile;
}

/**
 * Profile Coverage（spec Stage 2 第十五章）：
 * 当前方向下有多少条经历配置了专属表达。纯逻辑，供 UI 展示与引导补写。
 */
export interface ProfileCoverage {
  totalExperiences: number;
  completedVariants: number;
  /** 缺失变体的经历（exp-N 序号） */
  missingVariants: string[];
  coverage: number;
}

export function calculateProfileCoverage(profile: Profile, profileType: ProfileType): ProfileCoverage {
  const total = profile.internships.length + profile.projects.length + profile.campus.length;
  if (profileType === "general" || total === 0) {
    return { totalExperiences: total, completedVariants: 0, missingVariants: [], coverage: 0 };
  }
  const missingVariants: string[] = [];
  let completed = 0;
  for (let i = 0; i < total; i += 1) {
    if (hasVariant(profile, i, profileType)) completed += 1;
    else missingVariants.push(`exp-${i}`);
  }
  return {
    totalExperiences: total,
    completedVariants: completed,
    missingVariants,
    coverage: total > 0 ? Number((completed / total).toFixed(2)) : 0,
  };
}
