import { z } from "zod";
import { PROFILE_TYPES } from "./profileTypes";

/**
 * JobContext：一次岗位申请的上下文（spec 第六章）。
 * source=captured → 来自 JD 页面捕获；source=manual → 无 JD 时用户手选方向。
 */

export const JobSourceSchema = z.enum(["captured", "manual"]);

export const JobTypeSchema = z.enum(PROFILE_TYPES);

export const JobContextSchema = z.object({
  id: z.string().min(1),
  /** 公司名（manual 来源可为空） */
  company: z.string(),
  /** 岗位名（manual 来源为「手动选择」+ 方向名） */
  position: z.string(),
  location: z.string(),
  /** JD 正文（捕获失败可为空） */
  jd: z.string(),
  /** JD/网申页面 URL */
  sourceUrl: z.string(),
  pageTitle: z.string(),
  /** ISO datetime */
  createdAt: z.string(),
  jobType: JobTypeSchema,
  /** 分类命中的关键词（用于展示与调试） */
  keywords: z.array(z.string()),
  source: JobSourceSchema,
  /** Stage 6.7（Issue #001）：company 提取来源与置信度（Dev/Pilot 调试用，普通 UI 不展示） */
  companyExtraction: z
    .object({
      source: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .optional(),
  /** Issue #002：position 提取来源与置信度（h1 / job_detail / structured / meta / body / title / dropped_suffix） */
  positionExtraction: z
    .object({
      source: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .optional(),
});

export type JobContext = z.infer<typeof JobContextSchema>;

/** content script 从 JD 页面提取的原始原料（解析交给 jobParser，保持 DOM 层薄） */
export interface RawJobPage {
  url: string;
  pageTitle: string;
  /** document.title */
  metaTitle: string;
  /** og:site_name 等 */
  metaCompany: string;
  h1Texts: string[];
  /** Issue #002：职位详情类名节点文本（.job-name/.jobTitle 等，Moka 等 SPA 面板结构；真实 h1 之外的职位名信号） */
  jobDetailTitles?: string[];
  /** body innerText（content 层已截断） */
  bodyText: string;
  /** Stage 6.7（Issue #001）：公司名提取扩展信号 */
  /** og:site_name（与 metaCompany 分开记录，来源不同置信度不同） */
  metaSiteName?: string;
  /** JSON-LD 文本块（application/ld+json） */
  structuredData?: string[];
  /** logo img 的 alt 候选 */
  logoAlts?: string[];
  /** header/footer/brand 区短文本候选（限定区域，不做全文模糊） */
  brandTexts?: string[];
}

export function parseJobContext(raw: unknown): { ok: true; job: JobContext } | { ok: false; errors: string[] } {
  const result = JobContextSchema.safeParse(raw);
  if (result.success) return { ok: true, job: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5),
  };
}

export function makeJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
