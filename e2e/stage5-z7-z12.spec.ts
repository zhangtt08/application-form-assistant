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
  await sidePanel.getByRole('button', { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
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

test("Z7: 未完成 Session → 刷新后扫描显示继续提示", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();
  await appPage.reload();
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.getByText(/这个岗位有一份没走完的申请/).waitFor({ timeout: 15000 });
  await expect(sidePanel.getByRole("button", { name: "继续上次" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "重新开始" })).toBeVisible();
});

test("Z8: submitted → assessment → interview → Timeline 显示", async () => {
  await captureJob("job-ai-product.html");
  await openInbox();
  await sidePanel.locator(".job-card", { hasText: "星辰科技" }).click();
  const statusSelect = sidePanel.locator(".ws-section", { hasText: "岗位概览" }).locator("select");
  await statusSelect.selectOption("submitted");
  await statusSelect.selectOption("assessment");
  await statusSelect.selectOption("interview");
  const timeline = sidePanel.locator(".ws-timeline");
  await expect(timeline.getByText(/已投递 → 笔试/)).toBeVisible();
  await expect(timeline.getByText(/笔试 → 面试/)).toBeVisible();
});

test("Z9: Archive → 默认 Inbox 消失 → 显示归档恢复", async () => {
  await captureJob("job-ai-product.html");
  await openInbox();
  await sidePanel.locator(".job-card", { hasText: "星辰科技" }).click();
  // 归档 / 删除收在「更多操作」折叠里：先展开（与用户真实动作一致）
  await sidePanel.locator(".ws-more > summary").click();
  await sidePanel.getByRole("button", { name: "归档该岗位" }).click();
  await sidePanel.getByRole("button", { name: "← 返回岗位列表" }).click();
  await expect(sidePanel.locator(".job-card")).toHaveCount(0);
  await sidePanel.getByText("显示归档").click();
  await expect(sidePanel.locator(".job-card", { hasText: "星辰科技" })).toBeVisible();
});

test("Z10: 旧 afa.jobs.v1 → 启动自动迁移 v2", async () => {
  await sidePanel.evaluate(() =>
    chrome.storage.local.set({
      "afa.jobs.v1": {
        jobs: [
          {
            id: "old_job_1", company: "旧公司", position: "旧岗位", location: "", jd: "旧 JD",
            sourceUrl: "https://old.example.com/1", pageTitle: "", createdAt: "2026-09-01T00:00:00Z",
            jobType: "aiProduct", keywords: [], source: "captured",
          },
        ],
        activeJobId: "old_job_1",
        profileOverride: null,
      },
    }),
  );
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  await openInbox();
  await expect(sidePanel.locator(".job-card", { hasText: "旧公司" })).toBeVisible();
  await sidePanel.locator(".job-card", { hasText: "旧公司" }).click();
  await expect(sidePanel.getByText("旧岗位")).toBeVisible();
});

test("Z11: 搜索公司名 → 只显示匹配 Job", async () => {
  await captureJob("job-ai-product.html");
  await captureJob("job-agent.html");
  await openInbox();
  await expect(sidePanel.locator(".job-card")).toHaveCount(2);
  await sidePanel.locator(".inbox-search").fill("智元");
  await expect(sidePanel.locator(".job-card")).toHaveCount(1);
  await expect(sidePanel.locator(".job-card", { hasText: "智元智能" })).toBeVisible();
});

test("Z12: 删除带 Session 的 Job → 二次确认 → 全删且 Profile 不受影响", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();
  await confirmAllAndFill();
  await openInbox();
  await sidePanel.locator(".job-card", { hasText: "星辰科技" }).click();
  await sidePanel.locator(".ws-more > summary").click();
  await sidePanel.getByRole("button", { name: "删除岗位" }).click();
  await expect(sidePanel.getByText(/删除将同时删除对应 Session \/ Event/)).toBeVisible();
  await sidePanel.getByRole("button", { name: /再次确认/ }).click();
  await sidePanel.waitForTimeout(500);
  await expect(sidePanel.locator(".job-card")).toHaveCount(0);
  // Master Profile 不受影响：直接验证 storage
  const profileRaw = (await sidePanel.evaluate(() => chrome.storage.local.get("afa.profile.v1"))) as Record<string, { basic: { name: string } }>;
  expect(profileRaw["afa.profile.v1"].basic.name).toBe("张三");
});
