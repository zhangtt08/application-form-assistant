/**
 * 枚举 Moka 详情页所有 sd-foundation-heading / 语义 heading 候选，评估噪音。
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--lang=zh-CN"],
});
const page = await (
  await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "zh-CN",
  })
).newPage();
await page.goto("https://app.mokahr.com/campus_apply/shiyuehr/72055?recommendCode=DSz6Rbb2#/jobs", {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
await page.waitForTimeout(8000);
await page.locator("text=载具策划").first().click({ timeout: 8000 });
await page.waitForTimeout(6000);

const headings = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[class*="sd-foundation-heading" i], h1, h2, h3')) {
    const text = (el.textContent ?? "").trim();
    if (!text) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 70),
      len: text.length,
      text: text.slice(0, 60),
    });
  }
  return out;
});
console.log(JSON.stringify(headings, null, 1));
await browser.close();
