import type { RawJobPage } from "./schema";
import { ATS_BRAND_PATTERN } from "./companyExtraction";

/**
 * Issue #002（Real Regression Batch #2）：Position Extraction Pipeline。
 *
 * 职位名候选 → 来源打分 → 合理性判断 → 选择
 * - 职位关键词词表只做 confidence 信号，不再是 position 成立的唯一门槛
 *   （真实岗位名无法穷举：策划/管培生/项目专员/增长/创意/交付/顾问/实施/战略/业务/运营…）
 * - 合理短标题 + 高可信 DOM source 应允许成立
 * - Unknown > Wrong：全部候选不可靠时返回空（宁空不编造）
 */

/** 职位名候选来源 → 优先级分（明确优先级，不第一个字符串直接返回） */
export const POSITION_SOURCE_SCORES = {
  /** 真实 <h1> */
  h1: 1.0,
  /** 显式职位详情节点（.job-name/.jobTitle 等） */
  job_detail: 0.95,
  /** JSON-LD JobPosting.title */
  structured: 0.95,
  /** 正文「岗位名称：xxx」模式 */
  body: 0.8,
  /** meta（og:title / meta title） */
  meta: 0.8,
  /** 页面 title 切分（白名单词命中） */
  title: 0.65,
  /** 页面 title 剥招聘后缀后的余段（droppedSuffix fallback） */
  dropped_suffix: 0.55,
} as const;

export type PositionSource = keyof typeof POSITION_SOURCE_SCORES;

/** 同分时的稳定次序（数组顺序即 tiebreak 优先级） */
const SOURCE_ORDER: PositionSource[] = [
  "h1",
  "job_detail",
  "structured",
  "body",
  "meta",
  "title",
  "dropped_suffix",
];

/** 来源分 → 展示用置信度 */
export function positionConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 0.95) return "high";
  if (score >= 0.8) return "medium";
  return "low";
}

/**
 * Issue #002：通用招聘页面栏目词黑名单（单一来源，禁止散落多个 if）。
 * 这些词是页面导航/栏目名，绝不能成为 position。
 */
export const GENERIC_JOB_PAGE_LABELS = [
  "职位详情",
  "招聘职位",
  "校园招聘",
  "社会招聘",
  "加入我们",
  "岗位列表",
  "职位列表",
  "招聘官网",
  "所有职位",
  "查看更多职位",
  "招聘公告",
  "招聘信息",
  "全部职位",
  "在招职位",
  "更多职位",
  "职位信息",
  "申请职位",
  "官方公众号",
  "首页",
  "登录",
  "注册",
  "更多",
] as const;

const GENERIC_LABEL_SET = new Set<string>(GENERIC_JOB_PAGE_LABELS);

/** 纯城市名：不能当职位（广州/北京…） */
const CITY_EXACT = new Set([
  "北京", "上海", "深圳", "广州", "杭州", "成都", "重庆", "南京", "武汉", "西安",
  "苏州", "长沙", "天津", "郑州", "合肥", "厦门", "青岛", "东莞", "佛山", "宁波",
]);

/** 纯招聘动作词：不能当职位 */
const RECRUITING_WORD_EXACT =
  /^(招聘|诚聘|急聘|热招|校招|社招|内推|人才招聘|人才引进|招贤纳士)$/i;

/** 明显 JD 段落标记：候选含这些 = 抓到的是正文段落不是标题 */
const JD_PARAGRAPH_MARKERS = /岗位职责|任职要求|职位描述|工作职责|岗位要求|job description|responsibilities|requirements/i;

/** 句子级标点：职位标题里不该出现（出现即段落/标签+值的可能性大） */
const SENTENCE_PUNCTUATION = /[，。；！？,;!?：:]/;

/** 公司样结尾：以「公司/集团」等结尾的候选是公司名不是职位名 */
const COMPANY_LIKE_ENDING = /(有限公司|股份公司|集团公司|控股集团|有限公司|公司|集团|股份)$/;

/**
 * 职位标题合理性判断（Issue #002 第五节）。
 *
 * 接受：2–60 字、非纯导航词、非纯城市、非纯招聘词、非 ATS 品牌、非公司名、非明显长段落。
 * 允许：中文/英文/数字/-/—/∕/()/（）/· 等——「载具策划 - 3C（望月）- 202X」「游戏测试工程师-27届秋招」
 * 这类含年份/项目名/括号的标题绝不能因白名单缺词被误杀。
 */
export function isReasonablePositionTitle(value: string, opts?: { company?: string }): boolean {
  const text = (value ?? "").trim();
  if (text.length < 2 || text.length > 60) return false;

  // 通用栏目词（精确匹配，含去空白后的匹配）
  if (GENERIC_LABEL_SET.has(text) || GENERIC_LABEL_SET.has(text.replace(/\s+/g, ""))) return false;

  // 纯城市 / 纯招聘动作词
  if (CITY_EXACT.has(text.replace(/\s+/g, ""))) return false;
  if (RECRUITING_WORD_EXACT.test(text)) return false;

  // ATS 品牌词（Moka招聘 / Greenhouse 等）
  if (ATS_BRAND_PATTERN.test(text)) return false;

  // 公司名形态：以公司样后缀结尾，或与已提取公司名相同
  if (COMPANY_LIKE_ENDING.test(text)) return false;
  const company = (opts?.company ?? "").trim();
  if (company && text === company) return false;

  // 明显长段落 / JD 片段：句级标点、JD 标记词
  if (SENTENCE_PUNCTUATION.test(text)) return false;
  if (JD_PARAGRAPH_MARKERS.test(text)) return false;

  // 纯数字 / 纯符号
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;

  return true;
}

interface PositionCandidate {
  value: string;
  source: PositionSource;
  score: number;
}

function pushCandidate(list: PositionCandidate[], value: string, source: PositionSource): void {
  const text = (value ?? "").trim();
  if (!text) return;
  if (list.some((c) => c.value === text)) return;
  list.push({ value: text, source, score: POSITION_SOURCE_SCORES[source] });
}

/** 从 JSON-LD 抽 JobPosting.title */
function candidatesFromStructuredData(blocks: string[], list: PositionCandidate[]): void {
  for (const block of blocks) {
    try {
      const parsed: unknown = JSON.parse(block);
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const n = node as { "@type"?: unknown; title?: unknown };
        const isJobPosting = n?.["@type"] === "JobPosting" || (Array.isArray(n?.["@type"]) && (n["@type"] as string[]).includes("JobPosting"));
        if (isJobPosting && typeof n.title === "string" && n.title.trim()) {
          pushCandidate(list, n.title, "structured");
        }
      }
    } catch {
      // 非法 JSON-LD 忽略
    }
  }
}

/** meta/title 渠道：分段 → 尾部剥招聘后缀 → 余段判定 */
function candidatesFromTitle(
  title: string,
  list: PositionCandidate[],
): void {
  const segments = title.split(/[-_｜|【】\[\]()（）]/).map((s) => s.trim()).filter(Boolean);
  let droppedSuffix = false;
  while (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (last === undefined) break;
    if (
      /(招聘|招聘网|人才网|官网)$/.test(last) ||
      GENERIC_LABEL_SET.has(last)
    ) {
      segments.pop();
      droppedSuffix = true;
    } else {
      break;
    }
  }
  const joined = segments.join("-");
  // 职位判定（title 渠道较弱，仍需职位信号辅助）：白名单词命中，或尾部确实剥掉了招聘后缀。
  const whitelistHit =
    /岗位|职位|经理|专员|工程师|实习|运营|产品|开发|设计|策划|测试|算法|助理|主管|总监|hiring|intern/i.test(joined);
  const jobLike =
    (whitelistHit || droppedSuffix) &&
    !/招聘网|人才网|拉勾|boss直聘|前程无忧|智联|猎聘|BOSS/i.test(joined);
  if (joined.length >= 2 && joined.length <= 40 && jobLike) {
    // 白名单命中（0.65）优先于 droppedSuffix fallback（0.55）——前者是更强的职位信号
    pushCandidate(list, joined, whitelistHit ? "title" : "dropped_suffix");
  }
}

/**
 * 主入口：RawJobPage 全部信号 → 候选（带来源分）→ 合理性过滤 → 按分选择。
 * 返回 position（空串 = 无可靠候选）+ extraction 元数据。
 */
export function extractPositionWithMetadata(
  raw: RawJobPage,
  opts?: { company?: string },
): { position: string; extraction?: { source: PositionSource; confidence: "high" | "medium" | "low" } } {
  const candidates: PositionCandidate[] = [];

  // 1. 真实 h1（1.0）
  for (const t of raw.h1Texts ?? []) pushCandidate(candidates, t, "h1");
  // 2. 显式职位详情节点（0.95）
  for (const t of raw.jobDetailTitles ?? []) pushCandidate(candidates, t, "job_detail");
  // 3. JSON-LD JobPosting.title（0.95）
  candidatesFromStructuredData(raw.structuredData ?? [], candidates);

  // 4. meta og:title / meta title（0.8）与 pageTitle（0.65/0.55 渠道）
  const metaTitle = raw.metaTitle || "";
  if (metaTitle) candidatesFromTitle(metaTitle, candidates);
  const pageTitle = raw.pageTitle || "";
  if (pageTitle && pageTitle !== metaTitle) candidatesFromTitle(pageTitle, candidates);

  // 5. 正文「岗位名称：xxx」模式（0.8）
  const bodyMatch = raw.bodyText.match(/(?:岗位名称|职位名称|招聘岗位)[:：]\s*([^\n]{2,40})/);
  if (bodyMatch?.[1]) pushCandidate(candidates, bodyMatch[1], "body");

  // 按（分数，来源固定次序）排序 → 第一个通过合理性判断的候选胜出
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
  });

  for (const c of sorted) {
    if (isReasonablePositionTitle(c.value, opts)) {
      return {
        position: c.value,
        extraction: { source: c.source, confidence: positionConfidence(c.score) },
      };
    }
  }
  return { position: "", extraction: undefined };
}
