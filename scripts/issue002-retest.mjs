/**
 * Issue #002 真机采集 v2：列表页 → 点击「载具策划」→ 详情面板 → 按产品选择器采集。
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../real-validation-results/sessions/2026-09-24-moka-retest-raw.json");

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "--lang=zh-CN"],
});
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  locale: "zh-CN",
});
const page = await context.newPage();
await page.goto("https://app.mokahr.com/campus_apply/shiyuehr/72055?recommendCode=DSz6Rbb2#/jobs", {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
await page.waitForTimeout(8000);

// 找到含「载具策划」的可点击职位条目，打印其结构
const probe = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent?.trim() ?? "";
    if (t.includes("载具策划")) {
      const el = walker.currentNode.parentElement;
      const chain = [];
      let cur = el;
      for (let i = 0; i < 5 && cur; i += 1) {
        chain.push(`${cur.tagName.toLowerCase()}.${String(cur.className).slice(0, 60)}`);
        cur = cur.parentElement;
      }
      hits.push({ text: t.slice(0, 80), chain });
    }
  }
  return hits;
});
console.log("TEXT HITS:", JSON.stringify(probe, null, 1).slice(0, 1200));

// 点击职位条目（Moka 列表项通常是卡片容器）
let clickInfo = "";
try {
  const loc = page.locator("text=载具策划").first();
  await loc.click({ timeout: 8000 });
  clickInfo = "clicked text=载具策划";
} catch (e) {
  clickInfo = "click failed: " + String(e).slice(0, 100);
}
console.log(clickInfo);
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(6000);
console.log("URL AFTER CLICK:", page.url().slice(0, 150));

// 详情面板结构诊断
const detailDiag = await page.evaluate(() => {
  const jn = Array.from(document.querySelectorAll('[class*="job-name" i], [class*="jobName" i]')).map(
    (n) => ({ cls: String(n.className).slice(0, 70), len: (n.textContent ?? "").trim().length, text: (n.textContent ?? "").trim().slice(0, 80) }),
  );
  const h1s = Array.from(document.querySelectorAll("h1")).map((h) => ({ cls: String(h.className).slice(0, 50), text: (h.textContent ?? "").trim().slice(0, 80) }));
  return { jobNameNodes: jn, h1s, bodyLen: (document.body?.innerText ?? "").length };
});
console.log("DETAIL DIAG:", JSON.stringify(detailDiag, null, 1).slice(0, 1600));

// 与 src/content/jobCapture.ts 一致的采集（含 brand/company 信号）
const raw = await page.evaluate(() => {
  const metaContent = (selector) => {
    const el = document.querySelector(selector);
    return el instanceof HTMLMetaElement ? (el.content ?? "").trim() : "";
  };
  const collect = (selector, exclude) => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
      const text = (el.textContent ?? "").trim();
      if (text.length >= 2 && text.length <= 60 && !out.includes(text) && !exclude.includes(text)) out.push(text);
      if (out.length >= 5) break;
    }
    return out;
  };
  const h1Texts = collect("h1", []);
  const jobDetailTitles = collect(
    '[class*="job-name" i], [class*="jobName" i], [class*="job-title" i], [class*="jobTitle" i], [class*="position-name" i], [class*="positionName" i], [data-testid*="job-name" i], [data-testid*="job-title" i], [class*="sd-foundation-heading" i]',
    h1Texts,
  );
  const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => (s.textContent ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
  const logoAlts = Array.from(
    document.querySelectorAll('img[class*="logo" i], img[alt*="招聘"], img[alt*="校招"], header img[alt]'),
  )
    .map((img) => (img instanceof HTMLImageElement ? img.alt.trim() : ""))
    .filter((alt) => alt.length >= 2 && alt.length <= 30)
    .slice(0, 5);
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
    metaCompany:
      metaContent('meta[name="company"]') || metaContent('meta[property="og:site_name"]') || metaContent('meta[property="og:title"]'),
    h1Texts,
    jobDetailTitles,
    bodyText: (document.body?.innerText ?? "").slice(0, 20000),
    metaSiteName: metaSiteName || undefined,
    structuredData: structuredData.length > 0 ? structuredData : undefined,
    logoAlts: logoAlts.length > 0 ? logoAlts : undefined,
    brandTexts: brandTexts.length > 0 ? brandTexts : undefined,
  };
});

fs.writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), raw }, null, 2), "utf-8");
console.log("=== CAPTURED ===");
console.log("url:", raw.url.slice(0, 150));
console.log("pageTitle:", raw.pageTitle);
console.log("h1Texts:", JSON.stringify(raw.h1Texts));
console.log("jobDetailTitles:", JSON.stringify(raw.jobDetailTitles));
console.log("metaCompany:", raw.metaCompany, "| metaSiteName:", raw.metaSiteName);
console.log("brandTexts(sample):", JSON.stringify((raw.brandTexts ?? []).slice(0, 8)));
console.log("bodyText head:", raw.bodyText.slice(0, 240).replace(/\n+/g, " | "));
console.log("SAVED:", OUT);
await browser.close();
