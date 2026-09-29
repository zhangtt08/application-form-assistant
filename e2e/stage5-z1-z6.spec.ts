import { test, expect } from "@playwright/test";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview, ensureFilled } from "./helpers";
import type { Page } from "@playwright/test";
// ---- Stage 5 复用的表单流程 helpers（依赖文件内 context/sidePanel/FIXTURE_BASE）----

async function captureJob(jobPath: string): Promise<Page> {
  const jobPage = await context.newPage();
  await jobPage.goto(`${FIXTURE_BASE}/${jobPath}`);
  await jobPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  // Branch-L UI：无独立捕获按钮——「开始识别」内置 autoCaptureJob 完成捕获
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 20000 }); // jobbar 出现 = 捕获成功（各 fixture 公司名不同）
  return jobPage;
}

async function scanApplicationForm(): Promise<Page> {
  const appPage = await context.newPage();
  await appPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  return appPage;
}

async function confirmAllAndFill(): Promise<void> {
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);
}


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

test.afterEach(async () => { await context.close(); });

async function openInbox(): Promise<void> {
  await sidePanel.getByRole("button", { name: "岗位", exact: true }).click();
  await sidePanel.locator(".inbox-list, .banner").first().waitFor({ timeout: 8000 });
}

test("Z1: 捕获 JD → Inbox 出现公司+岗位", async () => {
  await captureJob("job-ai-product.html");
  await openInbox();
  const card = sidePanel.locator(".job-card", { hasText: "星辰科技" });
  await expect(card).toBeVisible();
  await expect(card.getByText("AI产品经理")).toBeVisible();
  await expect(card.getByText("已保存")).toBeVisible();
});

test("Z2: 再次捕获同一岗位 → 无 duplicate", async () => {
  await captureJob("job-ai-product.html");
  await captureJob("job-ai-product.html");
  await openInbox();
  await expect(sidePanel.locator(".job-card")).toHaveCount(1);
});

test("Z3: Inbox 打开岗位 → Workspace → 开始申请 → 投递页关联岗位", async () => {
  const jobPage = await captureJob("job-ai-product.html");
  await openInbox();
  await sidePanel.locator(".job-card", { hasText: "星辰科技" }).click();
  await sidePanel.getByText("岗位概览").waitFor({ timeout: 8000 });
  await expect(sidePanel.getByText("岗位分析")).toBeVisible();
  await expect(sidePanel.getByText("Timeline")).toBeVisible();
  // 捕获时已建 Session → 按钮文案为「开始 / 继续申请」
  await sidePanel.getByRole("button", { name: /申请/ }).click();
  // 回到投递页：扫描后岗位条恢复 Workspace 关联的岗位
  await jobPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await expect(sidePanel.locator(".jobbar-title", { hasText: "星辰科技" })).toBeVisible({ timeout: 15000 });
});

test("Z4: 填写完成 → 手动标记投递 → submitted", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();
  await confirmAllAndFill();
  await sidePanel.getByText(/表单已填写/).waitFor({ timeout: 15000 });
  await openInbox();
  await expect(sidePanel.locator(".job-card", { hasText: "星辰科技" }).getByText("已保存")).toBeVisible();
  // 回投递页：banner 内「我已完成投递」标记 submitted（扩展绝不自己点提交）
  await sidePanel.locator(".tabbar-item", { hasText: "投递" }).click();
  await sidePanel.getByRole("button", { name: "我已完成投递" }).click();
  await sidePanel.getByRole("button", { name: "岗位", exact: true }).click();
  await expect(sidePanel.locator(".job-card", { hasText: "星辰科技" }).getByText("已投递")).toBeVisible();
  void appPage;
});

test("Z5: 重新打开扩展 → Inbox 与 submitted 恢复", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();
  await confirmAllAndFill();
  await sidePanel.getByRole("button", { name: "我已完成投递" }).click();
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  await openInbox();
  await expect(sidePanel.locator(".job-card", { hasText: "星辰科技" }).getByText("已投递")).toBeVisible();
  void appPage;
});

test("Z6: 同一 Job 第二 Session → Workspace 显示 2 个", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();
  await confirmAllAndFill();
  await sidePanel.getByRole("button", { name: "我已完成投递" }).click();
  await appPage.reload();
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  await openInbox();
  await sidePanel.locator(".job-card", { hasText: "星辰科技" }).click();
  await expect(sidePanel.getByText("申请记录（2）")).toBeVisible();
});
