/**
 * Greenhouse 真实申请表单 Pilot：Scan 字段识别 vs 人工清点（不填写）。
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const urls = [
  "https://job-boards.greenhouse.io/generalmatter/jobs/5412538008",
  "https://job-boards.greenhouse.io/factored/jobs/4514946008",
];

const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
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

for (const url of urls) {
  console.log("\n=== ", url.slice(0, 60));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 人工清点口径：可见表单控件（含 select），不含 submit/checkbox 协议
  const ground = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("input, textarea, select"));
    const visible = els.filter((el) => {
      const r = el.getBoundingClientRect();
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      return r.width > 0 && r.height > 0 && type !== "hidden" && type !== "submit" && type !== "file-hidden";
    });
    return {
      total: visible.length,
      byTag: visible.reduce((m, el) => { const t = el.tagName.toLowerCase(); m[t] = (m[t] ?? 0) + 1; return m; }, {}),
      samples: visible.slice(0, 30).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? el.tagName.toLowerCase(),
        label: (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.name ?? "").trim().slice(0, 26),
      })),
    };
  });
  console.log("GROUND-TRUTH:", JSON.stringify(ground, null, 2));

  // 扩展扫描
  await page.bringToFront();
  await sp.getByRole("button", { name: "扫描当前页面" }).click();
  await sp.waitForTimeout(3000);
  const statsText = (await sp.locator(".stats").textContent().catch(() => "")) ?? "";
  console.log("SCAN-STATS:", statsText.replace(/\s+/g, " ").slice(0, 140));
  // field-card 明细
  const cards = await sp.locator(".field-card").count().catch(() => 0);
  console.log("FIELD-CARDS:", cards);

  // Capture
  await page.bringToFront();
  const captureBtn = sp.getByRole("button", { name: /捕获当前岗位|更新/ });
  if ((await captureBtn.count()) > 0) {
    await captureBtn.click();
    await sp.waitForTimeout(2500);
    const jobText = (await sp.locator(".home-card", { hasText: "当前岗位" }).textContent().catch(() => "")) ?? "";
    console.log("CAPTURE:", jobText.replace(/\s+/g, " ").slice(0, 130));
  }
  await page.close();
}

await context.close();
