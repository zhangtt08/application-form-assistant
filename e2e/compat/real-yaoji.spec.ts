import { test, expect } from "@playwright/test";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview } from "../helpers";
import type { Page } from "@playwright/test";

/**
 * Stage 6 真实 Pilot：姚记招聘官网（自建 ATS，游客可投递）。
 * Capture + Scan + Preview 内容来源验证（Dry Run 级——确认预览但不点击真实站点的填写/提交）。
 * 运行：npx playwright test -g "RealYaoji"
 */
let context: any;
let extensionId: string;
let sidePanel: Page;

test.beforeEach(async () => {
  ({ context, extensionId } = await launchWithExtension());
  sidePanel = await openSidePanel(context, extensionId);
  await resetJobStorage(sidePanel);
  await setupProfile(sidePanel);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
});

test.afterEach(async () => {
  await context.close();
});

test("RealYaoji: 自建 ATS 职位页 Capture + 投递表单 Scan/Preview", async () => {
  test.setTimeout(120_000);
  // 真实站点是 SPA，页面自 mutations 会触发 PAGE_MUTATED 提醒横幅（内含「重新识别」），
  // 与主操作按钮同匹配 /开始识别|重新识别/ —— 用 .last() 稳定命中主操作（横幅在主操作之前）。
  const recognizeBtn = sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).last();
  const url = "https://zhaopin.yaoji.cn/job/065bf5c4-c421-490e-9b9e-e337d9d6f75f";
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // 1) Capture（JD 页为 active tab）——Branch-L UI 无独立捕获按钮，「开始识别」内置 autoCaptureJob
  await recognizeBtn.click();
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 30000 });
  const jobText = (await sidePanel.locator(".jobbar-title").textContent().catch(() => "")) ?? "";
  console.log("[PILOT] CAPTURE:", jobText.replace(/\s+/g, " ").slice(0, 130));

  // 2) 点击「投递简历」展开真实表单
  const applyLoc = page.getByText("投递简历", { exact: false }).first();
  await applyLoc.click({ force: true });
  await page.waitForTimeout(4000);

  // 3) 扫描真实表单
  await page.bringToFront();
  await recognizeBtn.click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 20000 });

  const detected = await sidePanel.locator(".field-card").count();
  console.log("[PILOT] DETECTED:", detected);

  // 4) 内容来源分布（Preview 级验证——不点击真实站点的填写）
  const badges = await sidePanel.locator(".source-badge, .badge").allTextContents().catch(() => []);
  console.log("[PILOT] BADGES:", JSON.stringify(badges.slice(0, 20)));

  // 5) 一键确认可填字段数量（不执行真实填写）
  const confirmable = await sidePanel.getByRole("button", { name: /全部确认/ }).textContent().catch(() => "");
  console.log("[PILOT] CONFIRMABLE:", confirmable?.trim().slice(0, 40));

  // 6) 字段清单输出
  const labels = await sidePanel.locator(".field-card").allTextContents().catch(() => []);
  console.log("[PILOT] CARDS:", JSON.stringify(labels.map((l) => l.replace(/\s+/g, " ").slice(0, 60))));

  // 不做真实站点填写/提交——验证到此（Scan + Preview 来源）为止
  expect(detected).toBeGreaterThan(0);
});
