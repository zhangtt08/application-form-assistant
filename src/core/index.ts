/**
 * `src/core` —— 扩展与本地 Agent 共用的**纯逻辑**层（单一事实源）。
 *
 * 为什么要有这一层：这个项目的判断逻辑（字段匹配、风险分级、状态推导、填写计划门禁、
 * Profile 校验、岗位解析）全部是确定性纯函数，过去只能从各自的相对路径 import。
 * 一旦要在扩展之外复用（`agent/` 跑在 Node 里），最容易发生的事就是「在那边再写一遍」——
 * 两份 matcher 迟早给出两份不同的置信度，而用户看到的是同一个界面。
 *
 * 因此这里只做**再导出**，不放新逻辑（新逻辑进 `fieldLabels.ts` / `explainMatch.ts`，
 * 它们同样是纯函数）。扩展侧的调用方逐步改从这里 import；
 * `agent/tools.mjs` 通过 Node 直接加载同一批 `.ts` 源文件，不重写、不降级。
 *
 * 边界：DOM 读写（`src/content/*`）、chrome.* 存储（`*Store.ts`）、网络（`generation/provider.ts`）
 * 都**不在**这一层——它们不是纯逻辑，Agent 侧要用得自己提供真实环境，不能靠这个门面假装能跑。
 */

/* ---------- 文本规范化与相似度 ---------- */
export { normalizeText, deCamelize, tokenize } from "../utils/normalizeText";
export { normalizedLevenshtein, tokenOverlap } from "../utils/similarity";

/* ---------- 字段规则表 ---------- */
export {
  CANONICAL_FIELDS,
  getCanonicalFieldDef,
  isCanonicalFieldId,
} from "../rules/canonicalFields";
export { FIELD_ALIASES } from "../rules/fieldAliases";
export { IGNORE_KEYWORDS, IGNORED_INPUT_TYPES, isIgnoredByKeyword } from "../rules/ignoreRules";
export { polarityMatches, polarityOf, polarityTerms } from "../rules/yesNoAnswers";

/* ---------- 匹配与风险 ---------- */
export { confidenceLevel, explicitExperienceGroupOf, matchField } from "../matching/matcher";
export type { ConfidenceLevel } from "../matching/matcher";
export {
  assessRisk,
  assessTextRisk,
  riskOfFieldId,
  type RiskAssessment,
} from "../rules/riskRules";

/* ---------- 语境门禁与开放题分类 ---------- */
export { classifyApplicationContext } from "../context/applicationContext";
export { classifyQuestion, QUESTION_INTENT_CONFIG } from "../answering/questionClassifier";

/* ---------- 取值与扫描管线 ---------- */
export { chooseVariant, resolveValue, type ResolveOptions } from "../profile/profileResolver";
export {
  adaptValueToNumberControl,
  applySiteMapping,
  deriveStatus,
  numberValueFitsStep,
  optionSetCoversValue,
  runScanPipeline,
  type ScanPipelineOptions,
} from "../pipeline/scanPipeline";

/* ---------- 站点记忆（只记站点文字与人工判断，不记资料值） ---------- */
export {
  MAX_SITE_RULES,
  buildRule,
  describeRule,
  emptySiteMemory,
  fieldMatchCandidates,
  hostFromUrl,
  makeRuleId,
  matchSiteRule,
  removeRule,
  rulesForHost,
  sanitizeRule,
  upsertRule,
  type SiteFieldRule,
  type SiteMemory,
  type SiteRuleKind,
} from "../site/siteMemory";

/* ---------- 填写计划（写入门禁的唯一入口） ---------- */
export {
  buildFillPlan,
  summarizeFillOutcome,
  type FillSummary,
} from "../pipeline/fillPlan";

/* ---------- 资料模型与校验 ---------- */
export { validateProfile, type ValidationResult } from "../profile/schema";
export { defaultProfile } from "../profile/defaultProfile";
export { profileHasContent } from "../profile/profileStore";
export {
  assembleProfile,
  emptyContent,
  emptyShared,
  splitProfile,
  repairProfileShape,
  type LibraryContent,
  type ProfileLibrary,
  type ProfileStore,
  type SharedProfile,
} from "../profile/libraryStore";
export { mapResumeJsonToProfile } from "../profile/importMapper";
export { parseResumeText } from "../profile/resumeTextParser";
export {
  EXPERIENCE_VARIANT_KEYS,
  YES_NO_PREFERENCE_KEYS,
  emptyVariants,
  type Profile,
  type YesNoPreferenceKey,
} from "../types/profile";

/* ---------- 岗位解析（zod schema 在这一层） ---------- */
export {
  JobContextSchema,
  JobSourceSchema,
  JobTypeSchema,
  makeJobId,
  parseJobContext,
  type JobContext,
  type RawJobPage,
} from "../job/schema";
export { RuleBasedJobParser, makeManualJobContext, type JobParser } from "../job/jobParser";
export {
  PROFILE_CONFIG,
  PROFILE_TYPES,
  profileTypeLabel,
  type ProfileType,
} from "../job/profileTypes";
export { effectiveProfileType, routeJob, calculateProfileCoverage, type ProfileSelection } from "../profile/profileRouter";
export { extractCompanyWithMetadata, isAtsDomain, normalizeCompanyName } from "../job/companyExtraction";
export { extractPositionWithMetadata } from "../job/positionExtraction";

/* ---------- 匹配策略（Profile Pack） ---------- */
export { computeConfidence, matchPacks, scorePack } from "../profile/pack/matcher";

/* ---------- 本层新增的可读性与解释 ---------- */
export * from "./fieldLabels";
export * from "./explainMatch";
