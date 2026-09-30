import type { RawJobPage } from "../job/schema";

/**
 * JD 页面原料提取（只读 DOM）。
 * 只负责收集原料（标题/meta/h1/正文全文），岗位名/公司/分类等解析全部在 jobParser 侧完成，
 * 保证解析逻辑可脱离 DOM 单测。
 */

const MAX_BODY_TEXT = 20000;

function metaContent(selector: string): string {
  const el = document.querySelector(selector);
  return el instanceof HTMLMetaElement ? (el.content ?? "").trim() : "";
}

export function extractRawJobPage(): RawJobPage {
  // Issue #001/#002：职位名信号分两路采集，供 parser 做来源打分（real h1 > detail node）。
  //   - h1Texts：真实 <h1>（最高可信）
  //   - jobDetailTitles：职位详情类名节点（.job-name/.jobTitle 等，Moka 等 SPA 面板结构）
  //     + sd-foundation-heading（Moka 设计系统标题节点——2026-09 真机详情页的职位名在此，无 h1/.job-name）
  // 两者都做 2..60 长度过滤——职位列表大容器（textContent 超长）被长度过滤自然排除。
  const DETAIL_HEADING_SELECTOR =
    '[class*="job-name" i], [class*="jobName" i], [class*="job-title" i], [class*="jobTitle" i], ' +
    '[class*="position-name" i], [class*="positionName" i], [data-testid*="job-name" i], [data-testid*="job-title" i], ' +
    '[class*="sd-foundation-heading" i], ' +
    // 真机 Lever 的职位名在 `<div class="posting-headline"><h2>Android Engineer - Experience</h2>`，页面没有 h1
    '[class*="posting-headline" i], [class*="posting-title" i], [class*="app-title" i]';

  const collectTexts = (selector: string, exclude: string[]): string[] => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
      const text = (el.textContent ?? "").trim();
      if (text.length >= 2 && text.length <= 60 && !out.includes(text) && !exclude.includes(text)) {
        out.push(text);
      }
      if (out.length >= 5) break;
    }
    return out;
  };

  const h1Texts = collectTexts("h1", []);
  const jobDetailTitles = collectTexts(DETAIL_HEADING_SELECTOR, h1Texts);

  // Stage 6.7（Issue #001）：公司名提取扩展信号
  const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => (s.textContent ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);

  // Issue #009：og:title 是**这一页的标题**（Greenhouse 上就是职位名），不是公司名。
  // 以前把它当 metaCompany 用，结果是 company=「Software Engineer, Data Platform」，
  // 而 position 又因为「公司名不能当职位」的互斥规则被自己挤掉 → 岗位条两头都错。
  const metaCompany =
    metaContent('meta[name="company"]') || metaContent('meta[property="og:site_name"]') || metaContent('meta[name="application-name"]');

  // 招聘站的 logo 常挂在 a/div.logo 里而不是 img 自己有 class（真机 Lever：`<a class="main-header-logo"><img alt="Spotify logo">`）
  const logoAlts = Array.from(
    document.querySelectorAll('img[class*="logo" i], [class*="logo" i] img, [class*="brand" i] img, header img[alt], a[href$="/"] img[alt]'),
  )
    .map((img) => (img as HTMLImageElement).alt.trim())
    .filter((alt) => alt.length >= 2 && alt.length <= 30)
    .slice(0, 5);

  // 限定 header/footer/brand 区域的短文本（格式 "source|text" 供 parser 区分来源）
  const brandTexts: string[] = [];
  const brandSelectors: Array<[string, string]> = [
    ['[class*="company-name" i], [class*="companyName" i], [data-testid*="company" i], [aria-label*="公司" i]', "company_element"],
    ["header span, header div, header a", "header"],
    ['[class*="brand" i] span, [class*="brand" i], [class*="logo-text" i]', "company_element"],
    ["footer span, footer p, footer div", "header"],
  ];
  for (const [selector, source] of brandSelectors) {
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
      const text = (el.textContent ?? "").trim();
      if (text.length >= 2 && text.length <= 30 && !brandTexts.some((b) => b.endsWith(`|${text}`))) {
        brandTexts.push(`${source}|${text}`);
      }
    }
  }

  const metaSiteName = metaContent('meta[property="og:site_name"]') || metaContent('meta[name="application-name"]');

  return {
    url: location.href,
    pageTitle: document.title ?? "",
    metaTitle: metaContent('meta[property="og:title"]') || metaContent('meta[name="title"]'),
    metaCompany,
    h1Texts,
    jobDetailTitles: jobDetailTitles.length > 0 ? jobDetailTitles : undefined,
    bodyText: (document.body?.innerText ?? "").slice(0, MAX_BODY_TEXT),
    metaSiteName: metaSiteName || undefined,
    structuredData: structuredData.length > 0 ? structuredData : undefined,
    logoAlts: logoAlts.length > 0 ? logoAlts : undefined,
    brandTexts: brandTexts.length > 0 ? brandTexts : undefined,
  };
}
