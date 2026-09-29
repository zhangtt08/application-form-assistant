import { test } from "@playwright/test";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview } from "./helpers";
import type { Page } from "@playwright/test";

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
  await sidePanel.evaluate(() =>
    chrome.storage.local.remove(["afa.jobs.v2", "afa.jobs.v1", "afa.sessions.v1", "afa.sessions.v2", "afa.events.v1"]),
  );
});

test("dbg X", async () => {
  const jobPage = await context.newPage();
  await jobPage.goto(`${FIXTURE_BASE}/job-ai-product.html`);
  await jobPage.bringToFront();
  // Branch-L UI：无独立捕获按钮——「开始识别」内置 autoCaptureJob 完成捕获
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 20000 }); // jobbar 出现 = 捕获成功（各 fixture 公司名不同）
  const appPage = await context.newPage();
  await appPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  const card = sidePanel.locator(".field-card", { hasText: "为什么申请这个岗位" });
  await card.locator(".open-answer-block button", { hasText: "AI 生成回答" }).click();
  await sidePanel.waitForTimeout(3000);
  console.log("CARD-STATE:", (await card.textContent())?.slice(0, 300));
  await card.locator(".diff-textarea").fill("基于示例流程自动化项目经验，希望申请该岗位。带领 5 人团队完成交付。");
  await sidePanel.waitForTimeout(500);
  console.log("AFTER-EDIT:", (await card.textContent())?.includes("内容已修改，验证已失效") ? "DIRTY-SHOWN" : "DIRTY-MISSING:" + (await card.textContent())?.slice(0, 200));
}, 90000);
