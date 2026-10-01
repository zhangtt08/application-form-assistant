/**
 * 一次性 UI 自查：用真实扩展环境（Chromium + dist/ 扩展）跑一次识别 + 填写，
 * 把侧边栏截图落到 test-results/（已 gitignore），供人眼核对改版后的
 * 「为什么是这个字段」与「填写结果回执」。不是测试，不入库。
 */
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  FIXTURE_BASE,
  resetJobStorage,
  setupProfile,
  launchWithExtension,
  openSidePanel,
  ensureFilled,
} from "./helpers";

mkdirSync("test-results/ui-shots", { recursive: true });

test("UI-SHOT: 识别 → 回执 → 匹配依据", async () => {
  const { context, extensionId } = await launchWithExtension();
  const sidePanel = await openSidePanel(context, extensionId);
  await resetJobStorage(sidePanel);
  await setupProfile(sidePanel);
  await sidePanel.reload();

  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/application-form.html`);
  await page.bringToFront();

  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });
  await ensureFilled(sidePanel).catch(() => {});
  await page.waitForTimeout(800);

  await sidePanel.screenshot({ path: "test-results/ui-shots/01-receipt.png", fullPage: true });

  // 展开「需要你确认」桶里的一张完整卡片，点开匹配依据
  const why = sidePanel.locator(".why-box").first();
  if (await why.count()) {
    await why.locator(".why-summary").click();
    await page.waitForTimeout(300);
  }
  await sidePanel.screenshot({ path: "test-results/ui-shots/02-why.png", fullPage: true });

  await expect(sidePanel.getByText(/填写完成 ——/)).toBeVisible();
  await context.close();
});
