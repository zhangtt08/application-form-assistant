/**
 * Moka 校招列表 Pilot：列表页 → 首个在招职位 → 投递表单 → 扩展扫描（不填写）。
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
/** Pilot 截图落 private/（已 gitignore）：判据见 docs/TEST_DATA_POLICY.md，不再往仓库根丢图 */
const PRIVATE_SHOTS = path.resolve(__dirname, "../real-validation-results/private");
mkdirSync(PRIVATE_SHOTS, { recursive: true });
const listUrl = process.argv[2] ?? "https://app.mokahr.com/campus_apply/geekplus/168533?recommendCode=&fromSocial=1";

const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--lang=zh-CN",
  ],
});

let sw = context.serviceWorkers()[0];
if (!sw) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    sw = await Promise.race([
      context.waitForEvent("serviceworker", { timeout: 2000 }),
      new Promise((r) => setTimeout(() => r(undefined), 2100)),
    ]);
    if (sw) break;
  }
}
const extensionId = new URL(sw.url()).host;

const sp = await context.newPage();
await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await sp.waitForSelector("text=扫描当前页面", { timeout: 15000 });

const page = await context.newPage();
await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

// 列表页：点第一个职位
const jobCards = page.locator("a[href*='/job/'], [class*='job'] a, [class*='position'] a");
const cardCount = await jobCards.count().catch(() => 0);
console.log("JOB-CARD-COUNT:", cardCount);
const bodyHint = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? "");
console.log("BODY:", bodyHint.split("\n").join(" | ").slice(0, 350));

let formPage = page;
if (cardCount > 0) {
  await jobCards.first().click();
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);
  console.log("AFTER-CLICK-TITLE:", await page.title());
  console.log("AFTER-CLICK-URL:", page.url().slice(0, 120));

  // 详情页找投递按钮
  const allBtns = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim().slice(0, 20) ?? "").filter(Boolean));
  console.log("ALL-BUTTONS:", JSON.stringify(allBtns));
  // 关掉隐私协议弹窗（若有）
  const okBtn = page.getByRole("button", { name: "好的" });
  if (await okBtn.isVisible().catch(() => false)) { await okBtn.click().catch(() => {}); await page.waitForTimeout(800); }
  const applyBtn = page.locator(".apply-panel--jobs button, [class*=apply] button").filter({ hasText: /投递|申请/ }).first();
  if (await applyBtn.isVisible().catch(() => false)) {
    const pagesBefore = context.pages().length;
    await applyBtn.click({ force: true });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(PRIVATE_SHOTS, "moka-after-apply.png"), fullPage: false });
    const panelText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "");
    console.log("AFTER-APPLY-BODY:", panelText.split(String.fromCharCode(10)).join(" | ").slice(0, 400));
    const pagesAfter = context.pages();
    console.log("PAGES-BEFORE-AFTER:", pagesBefore, pagesAfter.length);
    for (const p of pagesAfter) console.log("PAGE-URL:", p.url().slice(0, 110));
    // 若新开 tab 则切过去
    formPage = pagesAfter.length > pagesBefore ? pagesAfter[pagesAfter.length - 1] : page;
    await formPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await formPage.waitForTimeout(2000);
  } else {
    console.log("NO-APPLY-BTN");
  }

  // DOM 表单统计
  const domStats = await formPage.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    const visible = inputs.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return {
      total: inputs.length,
      visible: visible.length,
      samples: visible.slice(0, 18).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? "",
        ph: (el.getAttribute("placeholder") ?? "").slice(0, 20),
        label: (el.labels?.[0]?.textContent ?? el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 22),
      })),
    };
  });
  console.log("DOM-STATS:", JSON.stringify(domStats, null, 2));

  // 扩展扫描
  await formPage.bringToFront();
  await sp.getByRole("button", { name: "扫描当前页面" }).click();
  await sp.waitForTimeout(3000);
  const statsText = (await sp.locator(".stats").textContent().catch(() => "")) ?? "";
  console.log("SCAN-STATS:", statsText.replace(/\s+/g, " ").slice(0, 140));

  // Capture
  // 保持 JD 页为 active tab（不要把 sidepanel 置前）
  await formPage.bringToFront();
  const captureBtn = sp.getByRole("button", { name: /捕获当前岗位|更新/ });
  if ((await captureBtn.count()) > 0) {
    await captureBtn.click();
    await sp.waitForTimeout(2500);
    const jobText = (await sp.locator(".home-card", { hasText: "当前岗位" }).textContent().catch(() => "")) ?? "";
    console.log("CAPTURE:", jobText.replace(/\s+/g, " ").slice(0, 150));
  }
} else {
  console.log("NO-JOB-CARDS");
}

await context.close();
