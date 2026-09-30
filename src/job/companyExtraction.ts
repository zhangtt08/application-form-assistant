import type { RawJobPage } from "./schema";

/**
 * Issue #001（Real Regression Batch #1）：Company Extraction Pipeline。
 *
 * CompanyCandidate Extraction → Normalization → Scoring → Selection
 * - Unknown > Wrong：所有候选不可靠时返回空（绝不编造）
 * - KNOWN_ATS_DOMAINS 保护：绝不能把 Moka/Greenhouse/Lever 等厂商名当公司
 * - 确定性评分，无 ML
 */

export type CompanySource =
  | "structured_data"
  | "company_element"
  | "logo_alt"
  | "header"
  | "meta"
  | "title"
  | "domain";

export interface CompanyCandidate {
  value: string;
  source: CompanySource;
  confidence: number;
  rawValue?: string;
}

export interface CompanyExtractionResult {
  company: string;
  source: CompanySource | null;
  confidence: "high" | "medium" | "low";
}

/** 第三方 ATS 域名：domain fallback 时绝不能把这些厂商名当公司 */
export const KNOWN_ATS_DOMAINS = [
  "mokahr.com",
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "taleo.net",
  "jobvite.com",
  "smartrecruiters.com",
  "zhaopin.com",
  "51job.com",
  "liepin.com",
  "lagou.com",
  "zhipin.com",
  "shixiseng.com",
  "nowcoder.com",
];

/** 常见招聘噪音后缀（normalize 时清除） */
const NOISE_SUFFIXES = [
  "招聘官网", "人才招聘", "校园招聘", "社会招聘", "官方招聘", "职位招聘",
  "招聘", "校招", "社招", "人才网", "招聘网", "网申",
  "careers", "career", "jobs", "job", "hiring",
  // logo 的 alt 文案惯例是「<公司> logo」（真机 Lever：alt="Spotify logo"）
  "logo", "标志", "图标",
];

/** 纯导航/栏目词：绝不能当公司名 */
const NAV_ONLY_WORDS = new Set([
  "首页", "职位", "校园", "海归", "登录", "注册", "全部职位", "在招职位", "校招职位",
  "校招流程", "校招介绍", "社会招聘", "校园招聘", "公司招聘", "企业招聘", "更多", "返回职位列表",
  "jobs", "careers", "job", "career", "校园招聘", "社会招聘", "人才招聘", "招聘官网",
]);

/** 通用页面词/问候语：绝不能当公司名（回归：title=「欢迎」的站点不得输出 company=欢迎） */
const GENERIC_PAGE_WORDS =
  /^(欢迎|欢迎光临|欢迎加入|welcome|hello|hi|你好|公告|通知|新闻|资讯|动态|关于我们|联系我们|加入我们|友情链接|版权所有)$/i;

/**
 * 筛选条 / 职位类别 / 城市词：国内招聘官网把筛选面板挂在 class 含 company 的节点上
 * （小红书校招 [class*="company"] 抓到「全部 / 算法 / 研发 / 北京市」），
 * 这类值即使来自高置信来源也绝不是公司名 → 精确匹配即拒绝。
 */
const FILTER_CITY_WORDS = new Set(
  [
    "全部", "更多", "筛选", "清除", "不限", "其他",
    "算法", "研发", "技术", "非技术", "产品", "设计", "运营", "市场", "销售", "职能", "支持",
    "数据", "前端", "后端", "客户端", "测试", "运维", "游戏策划", "项目管理", "硬件",
    "实习", "正式", "校招", "社招", "全职", "兼职", "日常实习",
    "职位方向", "工作地点", "招聘项目", "子方向", "职位类别",
    "北京", "上海", "深圳", "广州", "杭州", "成都", "重庆", "南京", "武汉", "西安",
    "苏州", "长沙", "天津", "郑州", "合肥", "厦门", "青岛", "东莞", "佛山", "宁波",
    "新加坡", "香港", "台北",
  ].map((w) => w.toLowerCase()),
);

/** 行政区划词（「北京市」「广东省」）：工作地点筛选条的典型形态 */
const ADMIN_DIVISION_PATTERN = /^[\u4e00-\u9fa5]{1,6}(市|省|自治区)$/;

/** 职位词：candidate 含这些词降权（很可能是岗位名不是公司名） */
const JOB_LIKE_PATTERN = /工程师|经理|专员|助理|实习|主管|总监|运营|设计|开发|产品|算法|测试|策划|岗$|岗位|职位|hiring|intern|engineer|manager/i;

/** ATS 品牌词：候选值里出现即拒绝（不论当前域名是否 ATS，例：header 里的「Moka招聘平台」） */
export const ATS_BRAND_PATTERN =
  /moka|greenhouse|lever|workday|myworkdayjobs|taleo|jobvite|smartrecruiters|zhaopin|51job|liepin|lagou|zhipin|shixiseng|nowcoder/i;

/** 公司样后缀：候选值以此结尾视为真公司名（轻度加分） */
const COMPANY_SUFFIX_PATTERN = /(有限公司|股份|集团|控股|公司|科技|信息技术)$/i;

/** 域名 fallback 仅认「招聘域名」：host 分段需含招聘信号词（jobs.example-co.com ✓，裸 example.com ✗） */
const CAREERS_HOST_WORDS = new Set([
  "jobs", "job", "career", "careers", "recruit", "recruitment", "hiring",
  "zhaopin", "hr", "campus", "apply", "talent",
]);

/** 低于该分的候选直接不产出（职位词降权后的 0.2 分候选属于「疑似岗位名」） */
const MIN_SELECTION_SCORE = 0.3;

export function isAtsDomain(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const ats of KNOWN_ATS_DOMAINS) {
    if (host === ats || host.endsWith(`.${ats}`)) return ats;
  }
  return null;
}

/**
 * normalizeCompanyName：清除招聘噪音后缀（循环剥），保留公司名主体。
 * 姚记科技招聘官网 → 姚记科技；XX集团校园招聘 → XX集团；XX科技招聘 → XX科技
 */
export function normalizeCompanyName(raw: string): string {
  let value = raw.trim();
  let changed = true;
  while (changed && value) {
    changed = false;
    const lower = value.toLowerCase();
    for (const suffix of NOISE_SUFFIXES) {
      if (lower.endsWith(suffix) && value.length > suffix.length) {
        value = value.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return value;
}

function makeCandidate(value: string, source: CompanySource, confidence: number): CompanyCandidate | null {
  const normalized = normalizeCompanyName(value);
  if (!normalized || normalized.length < 2 || normalized.length > 30) return null;
  // 纯导航词直接拒绝
  if (NAV_ONLY_WORDS.has(normalized.toLowerCase()) || NAV_ONLY_WORDS.has(normalized)) return null;
  // 通用页面词/问候语拒绝
  if (GENERIC_PAGE_WORDS.test(normalized)) return null;
  // 筛选条 / 职位类别 / 城市词拒绝（不论来源置信度）
  if (FILTER_CITY_WORDS.has(normalized.toLowerCase())) return null;
  if (ADMIN_DIVISION_PATTERN.test(normalized)) return null;
  // 纯「招聘」类词拒绝
  if (/^(招聘|校招|社招|人才|官网|网申)+$/.test(normalized)) return null;
  return { value: normalized, source, confidence, rawValue: value.trim() };
}

function scoreCandidate(c: CompanyCandidate, hostAts: string | null): number {
  let score = c.confidence;

  // 含职位词 → 强降权（大概率是岗位名）
  if (JOB_LIKE_PATTERN.test(c.value)) score -= 0.45;

  // 含「招聘/校招」等噪音（normalize 后仍含——嵌在公司名内部的合法字符不扣，前缀噪音扣）
  if (/(招聘|校招|社招)$/.test(c.value) === false && /(人才网|招聘网|招聘平台)/.test(c.value)) score -= 0.2;

  // 长度惩罚：超长（>14）或过短（<2 已过滤）
  if (c.value.length > 14) score -= 0.1;

  // 公司样后缀加成：示例科技有限公司/姚记科技 这类形态更可信
  if (COMPANY_SUFFIX_PATTERN.test(c.value)) score += 0.1;

  // ATS 品牌词绝不能当公司：不论当前域名（候选值含 moka/greenhouse 等一律拒绝）
  if (ATS_BRAND_PATTERN.test(c.value)) score = -1;

  // 宿主域名为 ATS 时，值含宿主品牌段同样拒绝（双保险）
  if (hostAts) {
    const brand = (hostAts ?? "").split(".")[0] ?? "";
    if (brand && c.value.toLowerCase().includes(brand)) score = -1;
  }

  // 纯英文小写导航词
  if (/^(home|about|contact|login|sign ?in|register)$/i.test(c.value)) score = -1;

  return score;
}

/** 从 JSON-LD 抽 hiringOrganization/Organization name */
function candidatesFromStructuredData(blocks: string[]): CompanyCandidate[] {
  const out: CompanyCandidate[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      const org =
        parsed?.hiringOrganization?.name ??
        parsed?.hiringOrganization?.alternateName ??
        (parsed?.["@type"] === "Organization" ? parsed?.name : undefined) ??
        (Array.isArray(parsed) ? parsed.find((x) => x?.hiringOrganization)?.hiringOrganization?.name : undefined);
      if (typeof org === "string" && org.trim()) {
        const c = makeCandidate(org, "structured_data", 1.0);
        if (c) out.push(c);
      }
    } catch {
      // 非法 JSON-LD 忽略
    }
  }
  return out;
}

function candidatesFromDomain(url: string): CompanyCandidate[] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const ats = isAtsDomain(host);
    if (ats) return []; // 第三方 ATS 域名：绝不生成候选（防 company=Moka）
    // jobs.company.com / careers.company.com / company.jobs → 取主品牌段
    const parts = host.replace(/\.(com|cn|net|co|io|org|com\.cn|co\.uk)$/i, "").split(".");
    const skip = new Set(["jobs", "career", "careers", "job", "recruit", "recruitment", "zhaopin", "hr", "www", "m", "app", "campus", "social", "apply"]);
    // Issue #001：domain fallback 仅限「招聘域名」——host 分段含招聘信号词才可信；
    // 裸企业域名（www.example.com）多半是官网，用域名当公司就是编造。
    if (!parts.some((p) => CAREERS_HOST_WORDS.has(p))) return [];
    const brand = parts.filter((p) => !skip.has(p)).pop();
    if (brand && brand.length >= 2 && !/^\d+$/.test(brand)) {
      const c = makeCandidate(brand, "domain", 0.4);
      return c ? [c] : [];
    }
  } catch {
    // 非法 URL 忽略
  }
  return [];
}

/**
 * 主入口：从 RawJobPage 全部信号生成候选 → 打分 → 选最优。
 * 无可靠候选 → company=""（Unknown > Wrong）。
 */
export function extractCompanyWithMetadata(raw: RawJobPage): CompanyExtractionResult {
  let hostAts: string | null = null;
  try {
    hostAts = isAtsDomain(new URL(raw.url, "https://placeholder.invalid").hostname);
  } catch {
    hostAts = null;
  }

  const candidates: CompanyCandidate[] = [];

  // 1. Structured Data（JSON-LD hiringOrganization）——机器产出，最高信任；ATS 宿主页也保留
  candidates.push(...candidatesFromStructuredData(raw.structuredData ?? []));

  // Issue #001 Case E/F：第三方 ATS 宿主页的 title/header/meta 都是 ATS 模板噪音
  // （boards.greenhouse.io 的 title=职位名、mokahr 的 title=栏目名）→ 只信招聘方自己写的内容。
  // Logo alt 属于这一类：真机 Greenhouse 的 `<img alt="General Matter Logo">` 是租户自己填的，
  // 而厂商名（Lever/Greenhouse/Moka）在 scoreCandidate 里已被 ATS_BRAND_PATTERN 一律拒绝。
  if (hostAts) {
    for (const alt of raw.logoAlts ?? []) {
      const c = makeCandidate(alt, "logo_alt", 0.9);
      if (c) candidates.push(c);
    }
  }

  if (!hostAts) {
    // 2. 明确公司节点（capture 端从 class/id/data-testid/aria-label 收集）
    for (const text of raw.brandTexts ?? []) {
      // capture 端已经限定区域并带 data-source 标记格式 "source|text"
      const sep = text.indexOf("|");
      if (sep === -1) continue;
      const source = text.slice(0, sep) as CompanySource;
      const value = text.slice(sep + 1);
      const base = source === "company_element" ? 0.95 : source === "header" ? 0.8 : 0.6;
      const c = makeCandidate(value, source, base);
      if (c) candidates.push(c);
    }

    // 3. Logo alt（姚记科技招聘 → 姚记科技）
    for (const alt of raw.logoAlts ?? []) {
      const c = makeCandidate(alt, "logo_alt", 0.9);
      if (c) candidates.push(c);
    }

    // 5. Meta（og:site_name / metaCompany）
    if (raw.metaSiteName) {
      const c = makeCandidate(raw.metaSiteName, "meta", 0.85);
      if (c) candidates.push(c);
    }
    if (raw.metaCompany && raw.metaCompany !== raw.metaSiteName) {
      const c = makeCandidate(raw.metaCompany, "meta", 0.75);
      if (c) candidates.push(c);
    }

    // 6. Title fallback（旧逻辑候选化：title 通常 =「职位 - 公司招聘」或「公司招聘官网」）
    //    倒序采集：国内官网通行格式是「职位 - 团队 - 公司」，末段才是公司
    //    （真机回归：jobs.bytedance.com「Android开发工程师 - 移动OS - 字节跳动」曾取到「移动OS」）。
    //    同分候选按插入顺序胜出，岗位词候选已被降权过滤，所以两种「公司-职位」顺序都不会取错。
    const meta = raw.metaTitle || raw.pageTitle;
    if (meta) {
      const segments = meta
        .split(/[-_｜|【】\[\]()（）]/)
        .map((s) => normalizeCompanyName(s.trim()))
        .filter(Boolean);
      for (const seg of [...segments].reverse()) {
        const c = makeCandidate(seg, "title", 0.65);
        if (c) candidates.push(c);
      }
    }
  }

  // 7. Domain fallback（最低优先级；ATS 域名已拦截；仅招聘域名）
  const domainCandidates = candidatesFromDomain(raw.url);
  const brandSupplied = (raw.brandTexts?.length ?? 0) + (raw.logoAlts?.length ?? 0) > 0;
  let useDomain = true;
  if (brandSupplied && domainCandidates.length > 0) {
    // Issue #001：header/logo 采样过但全部候选不可靠 → 站点自有品牌信号缺失，
    // domain 兜底只会产出噪音（例：header 全是「首页/全部职位/登录」的站点）→ 放弃兜底。
    const nonDomainSurvived = candidates.some((c) => scoreCandidate(c, hostAts) > 0);
    useDomain = nonDomainSurvived;
  }
  if (useDomain) candidates.push(...domainCandidates);

  // 打分排序 + 选择阈值（职位词降权到 0.2 的「疑似岗位名」不允许胜出）
  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, hostAts) }))
    .filter((c) => c.score >= MIN_SELECTION_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) {
    return { company: "", source: null, confidence: "low" };
  }

  const confidence: CompanyExtractionResult["confidence"] = top.score >= 0.85 ? "high" : top.score >= 0.55 ? "medium" : "low";
  return { company: top.value, source: top.source, confidence };
}
