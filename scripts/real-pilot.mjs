/**
 * Stage 6 真实 Pilot 首验脚本 v2：
 * 加载 dist 扩展 → side panel 驱动 → 真实招聘网站 Capture + Scan（不填写、不提交）。
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const urls = process.argv.slice(2);

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
console.log("EXTENSION-ID:", extensionId);

// side panel 作为普通页面打开（E2E 同款方式）
const sp = await context.newPage();
await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await sp.waitForSelector("text=扫描当前页面", { timeout: 15000 });

const results = [];

for (const url of urls) {
  const record = { url, hostname: "", capture: {}, scan: {}, error: null };
  results.push(record);
  try {
    const u = new URL(url);
    record.hostname = u.hostname;

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    record.title = (await page.title()).slice(0, 80);

    // Capture：side panel 点「捕获当前岗位」（JD 页在前台）
    await page.bringToFront();
    await sp.bringToFront();
    const captureBtn = sp.getByRole("button", { name: /捕获当前岗位|更新/ });
    if ((await captureBtn.count()) > 0) {
      await captureBtn.click();
      await sp.waitForTimeout(2500);
      // 读当前岗位卡内容
      const jobCardText = (await sp.locator(".home-card", { hasText: "当前岗位" }).textContent().catch(() => "")) ?? "";
      record.capture.displayed = jobCardText.replace(/\s+/g, " ").slice(0, 120);
      record.capture.captured = !jobCardText.includes("未关联");
    } else {
      record.capture.skipped = "no-capture-button";
    }

    // Scan：JD 页 bringToFront → 扫描
    await page.bringToFront();
    await sp.getByRole("button", { name: "扫描当前页面" }).click();
    await sp.waitForTimeout(2500);
    const statsText = (await sp.locator(".stats").textContent().catch(() => "")) ?? "";
    record.scan.stats = statsText.replace(/\s+/g, " ").slice(0, 100);
    record.scan.hasFields = statsText.length > 0;

    await page.close();
  } catch (e) {
    record.error = String(e).slice(0, 250);
  }
}

console.log("\n===== REAL PILOT v2 =====");
for (const r of results) {
  console.log(JSON.stringify(r, null, 2));
}

await context.close();
