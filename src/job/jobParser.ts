import type { JobContext, RawJobPage } from "./schema";
import { makeJobId } from "./schema";
import { PROFILE_CONFIG, PROFILE_TYPES, type ProfileType } from "./profileTypes";
import { normalizeText } from "../utils/normalizeText";
import { extractCompanyWithMetadata } from "./companyExtraction";
import { extractPositionWithMetadata } from "./positionExtraction";

/**
 * JobParser：JD 页面原料 → JobContext。
 *
 * 接口面向未来：第一阶段只有 RuleBasedJobParser（DOM 文本 + 规则分类 + 关键词匹配），
 * 后续可新增 LLMJobParser 实现同一接口，业务代码零改动。
 */
export interface JobParser {
  parse(input: RawJobPage): Promise<JobContext>;
}

const MAX_JD_LENGTH = 6000;

const JD_SECTION_MARKERS = [
  "岗位职责", "职位描述", "工作职责", "任职要求", "职位要求", "岗位要求", "工作内容",
  "responsibilities", "requirements", "job description", "about the role",
];

/** Issue #002：JD 尾部页脚/站点噪音标记——JD 正文在其最早出现处截断 */
const JD_FOOTER_MARKERS = [
  "官方公众号", "微信公众号", "更多资讯", "©", "Copyright",
  "ICP备", "公网安备", "友情链接", "联系方式",
];

const CITY_LIST = [
  "北京", "上海", "深圳", "广州", "杭州", "成都", "重庆", "南京", "武汉", "西安",
  "苏州", "长沙", "天津", "郑州", "合肥", "厦门", "青岛", "东莞", "佛山", "宁波",
];

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

/** 关键词评分 → 每个方向的原始分与命中词 */
export function classifyJobType(text: string): {
  scores: Record<ProfileType, number>;
  matchedKeywords: string[];
} {
  const norm = normalizeText(text);
  const scores = Object.fromEntries(PROFILE_TYPES.map((t) => [t, 0])) as Record<ProfileType, number>;
  const matched: { word: string; weight: number; type: ProfileType }[] = [];

  for (const type of PROFILE_TYPES) {
    const { keywords } = PROFILE_CONFIG[type];
    for (const [word, weight] of Object.entries(keywords)) {
      const occurrences = countOccurrences(norm, normalizeText(word));
      if (occurrences > 0) {
        scores[type] += Math.min(occurrences, 5) * weight; // 同词封顶 5 次，防长 JD 刷分
        matched.push({ word, weight, type });
      }
    }
  }

  matched.sort((a, b) => b.weight - a.weight);
  return {
    scores,
    matchedKeywords: Array.from(new Set(matched.map((m) => m.word))).slice(0, 12),
  };
}

/** Issue #002：position 提取迁移到 positionExtraction.ts（候选 → 来源打分 → 合理性判断 → 选择） */

/** Issue #001：Company Extraction Pipeline（候选 → normalize → 打分 → 选择） */
function extractCompanyV2(raw: RawJobPage): { company: string; extraction: JobContext["companyExtraction"] } {
  // 旧信号优先级保留（显式 metaCompany / 正文「公司：」为高质量来源）
  if (raw.metaCompany && !/招聘|人才|直聘|jobs|zhaopin|liepin|51job|官网/i.test(raw.metaCompany)) {
    const v = raw.metaCompany.trim();
    if (v) return { company: v, extraction: { source: "meta", confidence: "high" } };
  }
  const bodyMatch = raw.bodyText.match(/(?:公司名称|公司)[:：]\s*([^\n]{2,30})/);
  if (bodyMatch?.[1]) {
    const v = bodyMatch[1].trim();
    if (v) return { company: v, extraction: { source: "company_element", confidence: "high" } };
  }
  // 正文版权行「© 2026 公司名」（姚记 footer 模式）
  // Issue #002 真机修正：①「© 2026-2027 公司名」年份区间；②「网」终止符加负向断言，
  //   防止「广州诗悦网络科技有限公司」被截断成「广州诗悦」；③「\n」也是合法终止（footer 后接 ICP 备案行）。
  const copyright = raw.bodyText.match(
    /(?:©|Copyright)\s*©?\s*\d{4}(?:\s*[-—~至]\s*\d{4})?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,20}?)(?:人力资源|人力|招聘|网(?![\u4e00-\u9fa5A-Za-z])|\n|$| |　)/,
  );
  if (copyright?.[1] && !/^(京|沪|粤|苏|浙|ICP|备)/.test(copyright[1])) {
    const v = copyright[1].trim();
    if (v && v.length >= 2) return { company: v, extraction: { source: "header", confidence: "medium" } };
  }
  // Pipeline（structured_data / logo_alt / header / meta / title / domain）
  const result = extractCompanyWithMetadata(raw);
  if (result.company) {
    return { company: result.company, extraction: { source: result.source ?? "title", confidence: result.confidence } };
  }
  return { company: "", extraction: undefined };
}

/** JD 正文提取：定位到岗位职责等标记词的起始处，截断 */
function extractJdBody(bodyText: string): string {
  const norm = bodyText;
  let start = -1;
  for (const marker of JD_SECTION_MARKERS) {
    const idx = norm.indexOf(marker);
    if (idx !== -1 && (start === -1 || idx < start)) start = idx;
  }
  let base = start >= 0 ? norm.slice(start) : norm;
  // Issue #002 真机修正：Moka 详情页的 bodyText 在 JD 之后跟着页脚
  // （官方公众号/微信公众号/© 版权行/ICP 备案等）——不截断会污染 JD，
  // 使 Pack 匹配误命中「公众号」类关键词。在最早的页脚标记处截断。
  let end = base.length;
  for (const marker of JD_FOOTER_MARKERS) {
    const idx = base.indexOf(marker);
    if (idx !== -1 && idx < end) end = idx;
  }
  base = base.slice(0, end);
  return base.slice(0, MAX_JD_LENGTH).trim();
}

function extractLocation(raw: RawJobPage): string {
  const meta = `${raw.metaTitle}\n${raw.pageTitle}`;
  const cityPattern = new RegExp(`(${CITY_LIST.join("|")})`);
  const metaMatch = meta.match(cityPattern);
  if (metaMatch?.[1]) return metaMatch[1];
  const head = raw.bodyText.slice(0, 1200);
  const bodyMatch = head.match(cityPattern);
  if (bodyMatch?.[1]) return bodyMatch[1];
  return "";
}

/**
 * 规则版解析器：DOM 文本 + 启发式提取 + 关键词分类。
 * 所有提取失败的字段留空 —— 宁可信息少，不编造。
 */
export class RuleBasedJobParser implements JobParser {
  async parse(input: RawJobPage): Promise<JobContext> {
    // Issue #002：company 先提取，position 候选可与公司名互斥（公司名不能当职位，反之亦然）
    const { company, extraction } = extractCompanyV2(input);
    const { position, extraction: positionExtraction } = extractPositionWithMetadata(input, { company });
    const location = extractLocation(input);
    const jd = extractJdBody(input.bodyText);

    const classificationText = [position, input.pageTitle, input.metaTitle, jd].join("\n");
    const { scores, matchedKeywords } = classifyJobType(classificationText);

    // 无任何命中 → general
    let jobType: ProfileType = "general";
    let best = 0;
    for (const type of PROFILE_TYPES) {
      if (type !== "general" && scores[type] > best) {
        best = scores[type];
        jobType = type;
      }
    }

    return {
      id: makeJobId(),
      company,
      position: position || "未识别岗位",
      location,
      jd,
      sourceUrl: input.url,
      pageTitle: input.pageTitle || input.metaTitle,
      createdAt: new Date().toISOString(),
      jobType,
      keywords: matchedKeywords,
      source: "captured",
      ...(extraction ? { companyExtraction: extraction } : {}),
      ...(positionExtraction ? { positionExtraction } : {}),
    };
  }
}

/** 无 JD 兜底：用户手选方向 → Manual JobContext（spec 第九章，禁止猜岗位） */
export function makeManualJobContext(jobType: ProfileType, sourceUrl = ""): JobContext {
  return {
    id: makeJobId(),
    company: "",
    position: `手动选择：${PROFILE_CONFIG[jobType].label}`,
    location: "",
    jd: "",
    sourceUrl,
    pageTitle: "",
    createdAt: new Date().toISOString(),
    jobType,
    keywords: [],
    source: "manual",
  };
}
