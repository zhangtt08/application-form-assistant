import type { JobContext } from "../job/schema";
import type { ProfileType } from "../job/profileTypes";
import type { CampusExperienceEntry, InternshipEntry, ProjectEntry } from "../types/profile";
import type { Fact, FactContext, FactType, JobRequirementProfile } from "./types";

/**
 * Prompt 版本（spec Stage 3.5 第十八章）：所有 GenerationResult 记录 promptVersion，
 * Prompt 修改后可通过 Regression Runner 做 v1 vs v2 对比。
 * 修改 prompt 内容时必须同步递增版本号。
 */
export const PROMPT_VERSION = "variant-generator-v1";

/**
 * Fact Context / 需求提取 / Fact 选择 / Prompt 构建（spec 第六~九章）。
 *
 * 原则：
 * - Facts 从 Master Profile 经历的「事实层字段」拆解而来，带稳定 ID
 * - Prompt 只包含当前经历需要的最小事实集合，不发送整份 Master Profile
 * - 需求提取与 Fact 选择第一阶段全部确定性规则，可独立测试
 */

export type ExperienceLike = InternshipEntry | ProjectEntry | CampusExperienceEntry;

/** 技术词表：Technology Guard 与 fact 归类共用 */
export const TECH_TERMS = [
  "Python", "Playwright", "RAG", "LangChain", "Prompt", "LLM", "Agent", "Tool Calling",
  "Function Calling", "MCP", "Workflow", "Dify", "Coze", "OpenAI API", "Embedding",
  "向量检索", "影刀", "RPA", "Claude Code", "Codex", "ChatGPT", "Gemini", "JavaScript",
  "TypeScript", "SQL", "Excel", "Premiere", "After Effects", "剪映", "Lightroom",
  "Midjourney", "Stable Diffusion", "Fish Audio", "GPT-SoVITS", "Suno",
];

const STOPWORDS = new Set([
  "的", "与", "和", "及", "或", "在", "对", "为", "了", "等", "并", "通过", "进行",
  "相关", "岗位", "职位", "职责", "任职", "要求", "优先", "负责", "工作", "能力",
  "熟悉", "了解", "具备", "能够", "以及", "支持", "包括", "以下", "以上", "描述",
]);

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|。|；|;|！|？/)
    .map((s) => s.replace(/^\s*\d+[.、]\s*/, "").trim())
    .filter((s) => s.length >= 4 && s.length <= 120);
}

function hasTechTerm(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of TECH_TERMS) {
    if (lower.includes(term.toLowerCase())) return term;
  }
  return null;
}

function classifyFact(text: string): FactType {
  if (/\d/.test(text)) return "metric";
  if (hasTechTerm(text)) return "technology";
  if (/成果|提升|稳定|支撑|支持\d?|落地/.test(text)) return "result";
  return "responsibility";
}

/**
 * 经历 → FactContext（spec 第六章）。
 * 事实层字段：公司/岗位/时间（context）、职责/内容（responsibility）、
 * 业绩/描述中含数字的句子（metric/result）、关键词与技术词（technology）。
 */
export function buildFactContext(
  experienceId: string,
  experienceLabel: string,
  e: ExperienceLike,
): FactContext {
  const facts: Fact[] = [];
  let n = 0;
  const push = (type: FactType, text: string) => {
    const t = text.trim();
    if (!t) return;
    n += 1;
    facts.push({ id: `fact_${String(n).padStart(3, "0")}`, type, text: t });
  };

  // context：客观信息
  if ("company" in e && e.company) push("context", `公司：${e.company}`);
  if ("position" in e && e.position) push("context", `岗位/职务：${e.position}`);
  if ("name" in e && e.name) push("context", `项目名称：${e.name}`);
  if (e.startDate) push("context", `开始时间：${e.startDate}`);
  if (e.endDate) push("context", `结束时间：${e.endDate}`);

  // responsibility：职责与内容逐句
  for (const s of splitSentences(e.responsibilities)) push(classifyFact(s), s);
  for (const s of splitSentences(e.workContent)) push(classifyFact(s), s);

  // metric/result：业绩逐句（含数字的优先级最高，classify 已按数字优先）
  for (const s of splitSentences(e.achievements)) push(classifyFact(s), s);

  // technology：关键词
  if ("keywords" in e) {
    for (const k of e.keywords) {
      const t = k.replace(/^\s*\d+[.、]\s*/, "").trim();
      if (t) push("technology", `技术/关键词：${t}`);
    }
  }

  // result：默认描述概括（仅第一条，避免 prompt 膨胀）
  const desc = e.descriptionShort || e.descriptionMedium;
  if (desc) push("result", desc);

  return { experienceId, experienceLabel, facts };
}

/**
 * JD 需求提取（spec 第七章）：规则版，确定性输出。
 * 只描述 JD，不做岗位匹配评分。
 */
export function extractJobRequirements(job: JobContext): JobRequirementProfile {
  const jd = `${job.position}\n${job.jd}`;
  const sentences = splitSentences(jd);

  const hardSkills = new Set<string>();
  for (const term of TECH_TERMS) {
    if (jd.toLowerCase().includes(term.toLowerCase())) hardSkills.add(term);
  }

  const ACTION_WORDS = /负责|参与|完成|设计|开发|搭建|分析|优化|撰写|推动|维护|管理|规划|评估|梳理|支持|落地|构建|实现|协调|执行/;
  const responsibilities = sentences.filter((s) => ACTION_WORDS.test(s)).slice(0, 6);

  const softSignals = new Set<string>();
  for (const s of sentences) {
    if (/沟通|协作|团队合作|学习能力|责任心|抗压/.test(s)) softSignals.add(s.slice(0, 24));
  }

  // priorityKeywords：高频中文 2-4 字词（去停用词）
  const freq = new Map<string, number>();
  const words = jd.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const priorityKeywords = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  return {
    hardSkills: [...hardSkills],
    responsibilities,
    softSignals: [...softSignals].slice(0, 4),
    priorityKeywords,
  };
}

/** 各岗位方向的 fact 类型偏好权重（确定性规则，spec 第八章） */
const TYPE_PREFERENCE: Record<ProfileType, Partial<Record<FactType, number>>> = {
  agent: { technology: 2.5, metric: 2, responsibility: 1.5, result: 1.5, context: 0.5 },
  aiApplication: { technology: 2, metric: 2, responsibility: 2, result: 1.5, context: 0.5 },
  aiProduct: { responsibility: 2.5, metric: 2, result: 2, technology: 1, context: 1 },
  aiOperation: { responsibility: 2.5, result: 2, metric: 2, technology: 0.5, context: 1 },
  aiSolution: { responsibility: 2, metric: 2, result: 2, technology: 1.5, context: 1 },
  aigcMarketing: { result: 2.5, responsibility: 2, metric: 1.5, technology: 0.5, context: 0.5 },
  general: { responsibility: 1.5, metric: 1.5, result: 1.5, technology: 1.5, context: 1 },
};

/**
 * Fact 选择（spec 第八章）：确定性规则——
 * 方向类型偏好 + JD 关键词重叠打分，取 top N（N=8），保持原顺序输出。
 */
export function selectRelevantFacts(
  requirements: JobRequirementProfile,
  factContext: FactContext,
  profileType: ProfileType,
): Fact[] {
  const pref = TYPE_PREFERENCE[profileType] ?? {};

  const scored = factContext.facts.map((fact, index) => {
    let score = pref[fact.type] ?? 1;
    const factNorm = normalizeCn(fact.text);
    for (const kw of [...requirements.hardSkills, ...requirements.priorityKeywords]) {
      const kwNorm = normalizeCn(kw);
      if (kwNorm && (factNorm.includes(kwNorm) || kwNorm.includes(factNorm))) {
        score += 1.5;
        break;
      }
    }
    // 位置微加成：靠前的事实（时间线更早记录的）稳定优先
    score += Math.max(0, 0.5 - index * 0.05);
    return { fact, score };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.fact);
  const order = new Set(top.map((f) => f.id));
  return factContext.facts.filter((f) => order.has(f.id));
}

function normalizeCn(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** 生成 Prompt（spec 第九章）：系统约束 + 结构化事实块 + 输出格式 */
export function buildVariantPrompt(input: {
  requirementProfile: JobRequirementProfile;
  selectedFacts: Fact[];
  experienceLabel: string;
  profileType: ProfileType;
  existingVariant: string;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "你正在根据已验证的个人经历事实，生成针对岗位方向的经历表达。",
    "你只能使用提供的 FACTS。",
    "禁止：",
    "- 添加不存在的数字",
    "- 添加不存在的技术",
    "- 添加不存在的职责",
    "- 添加不存在的团队规模",
    "- 添加不存在的商业结果",
    "- 添加不存在的客户",
    "- 添加不存在的项目范围",
    "允许：",
    "- 重新排序、概括、压缩、合并、改变措辞",
    "- 根据 JD 强调不同事实",
    "如果无法支持某个 JD 要求：忽略该要求。",
    "禁止为了贴合岗位而编造经历。",
    "必须输出 JSON：{\"draft\": string, \"usedFactIds\": string[], \"emphasizedRequirements\": string[], \"unsupportedRequirements\": string[]}",
  ].join("\n");

  const req = input.requirementProfile;
  const factLines = input.selectedFacts.map((f) => `${f.id} | ${f.type} | ${f.text}`);

  const userPrompt = [
    `目标岗位方向：${input.profileType}`,
    `经历：${input.experienceLabel}`,
    "[JOB_REQUIREMENTS]",
    `hardSkills: ${req.hardSkills.join("、") || "（无）"}`,
    `responsibilities: ${req.responsibilities.join("；") || "（无）"}`,
    `priorityKeywords: ${req.priorityKeywords.join("、") || "（无）"}`,
    "[FACTS_BEGIN]",
    ...factLines,
    "[FACTS_END]",
    input.existingVariant ? `[EXISTING_VARIANT]\n${input.existingVariant}` : "[EXISTING_VARIANT]\n（无）",
    "[OUTPUT_FORMAT]",
    '只输出 JSON：{"draft": "...", "usedFactIds": ["fact_001", ...], "emphasizedRequirements": [...], "unsupportedRequirements": [...]}',
  ].join("\n");

  return { systemPrompt, userPrompt };
}
