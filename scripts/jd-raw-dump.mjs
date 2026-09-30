// @ts-check
/**
 * 抓取真实 JD 页面的「原料」（RawJobPage 字段），存成 tests/fixtures/jd-*.json 供离线单测复现真机问题。
 * 采集逻辑对齐 src/content/jobCapture.ts；这是诊断脚本，不参与构建。
 *
 *   node scripts/jd-raw-dump.mjs <JD页URL> <fixture名>
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('用法: node scripts/jd-raw-dump.mjs <JD页URL> <fixture名>');
  process.exit(2);
}
const [url, name] = argv;
const SESS = "real-validation-results/sessions";

function findChrome() {
  const root = path.join(process.env.USERPROFILE ?? "", "AppData", "Local", "ms-playwright");
  const dirs = fs.readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const p = path.join(root, d, "chrome-win64", "chrome.exe");
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: proxy ? [`--proxy-server=${proxy}`] : [],
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

const raw = await page.evaluate(() => {
  const metaContent = (sel) => {
    const el = document.querySelector(sel);
    return el instanceof HTMLMetaElement ? (el.content ?? "").trim() : "";
  };
  const DETAIL_HEADING_SELECTOR =
    '[class*="job-name" i], [class*="jobName" i], [class*="job-title" i], [class*="jobTitle" i], ' +
    '[class*="position-name" i], [class*="positionName" i], [data-testid*="job-name" i], [data-testid*="job-title" i], ' +
    '[class*="sd-foundation-heading" i], [class*="posting-headline" i], [class*="posting-title" i], [class*="app-title" i]';
  const collectTexts = (selector, exclude) => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
      const text = (el.textContent ?? "").trim();
      if (text.length >= 2 && text.length <= 60 && !out.includes(text) && !exclude.includes(text)) out.push(text);
      if (out.length >= 5) break;
    }
    return out;
  };
  const h1Texts = collectTexts("h1", []);
  const jobDetailTitles = collectTexts(DETAIL_HEADING_SELECTOR, h1Texts);

  const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => (s.textContent ?? "").trim()).filter(Boolean).slice(0, 5);

  const logoAlts = Array.from(document.querySelectorAll('img[class*="logo" i], [class*="logo" i] img, [class*="brand" i] img, header img[alt], a[href$="/"] img[alt]'))
    .map((img) => img.alt.trim()).filter((a) => a.length >= 2 && a.length <= 30).slice(0, 5);

  const brandTexts = [];
  const brandSelectors = [
    ['[class*="company-name" i], [class*="companyName" i], [data-testid*="company" i], [aria-label*="公司" i]', "company_element"],
    ["header span, header div, header a", "header"],
    ['[class*="brand" i] span, [class*="brand" i], [class*="logo-text" i]', "company_element"],
    ["footer span, footer p, footer div", "header"],
  ];
  for (const [selector, source] of brandSelectors) {
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
      const text = (el.textContent ?? "").trim();
      if (text.length >= 2 && text.length <= 30 && !brandTexts.some((b) => b.endsWith(`|${text}`))) brandTexts.push(`${source}|${text}`);
    }
  }

  const metaSiteName = metaContent('meta[property="og:site_name"]') || metaContent('meta[name="application-name"]');
  return {
    url: location.href,
    pageTitle: document.title ?? "",
    metaTitle: metaContent('meta[property="og:title"]') || metaContent('meta[name="title"]'),
    metaCompany:
      metaContent('meta[name="company"]') ||
      metaContent('meta[property="og:site_name"]') ||
      metaContent('meta[name="application-name"]'),
    h1Texts,
    jobDetailTitles: jobDetailTitles.length > 0 ? jobDetailTitles : undefined,
    bodyText: (document.body?.innerText ?? "").slice(0, 20000),
    metaSiteName: metaSiteName || undefined,
    structuredData: structuredData.length > 0 ? structuredData : undefined,
    logoAlts: logoAlts.length > 0 ? logoAlts : undefined,
    brandTexts: brandTexts.length > 0 ? brandTexts : undefined,
  };
});

fs.mkdirSync(SESS, { recursive: true });
const out = path.join(SESS, `2026-09-30-${name}-raw.json`);
fs.writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), source: "scripts/jd-raw-dump.mjs", raw }, null, 2), "utf8");
console.log(`写出 ${out}`);
console.log("pageTitle:", raw.pageTitle);
console.log("h1Texts:", JSON.stringify(raw.h1Texts));
console.log("jobDetailTitles:", JSON.stringify(raw.jobDetailTitles));
console.log("brandTexts:", JSON.stringify(raw.brandTexts));
console.log("logoAlts:", JSON.stringify(raw.logoAlts));
console.log("metaSiteName:", raw.metaSiteName, "| metaCompany:", raw.metaCompany);
await browser.close();
