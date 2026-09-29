import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview, ensureFilled } from "../helpers";
import type { Page as PWPage } from "@playwright/test";

/**
 * ProfilePack / 资料库 UX 回归（Safety Flow Reconciliation 对齐到资料库化新 UI）。
 *
 * 语义保留（旧版「推荐横幅 + pack-card 网格」UI 已随资料库化重构移除，断言迁移到现 UI）：
 * - UX1: 首启默认资料库存在 + 无大块说明文案 + 单一主 CTA
 * - UX4: 方向路由是「建议」——不强切用户资料库（Scan Never Writes 之外的另一条：Router Never Overrides）
 * - UX5: 手动指定方向 → 填写内容随之切换
 * - UX8: 新建资料库 → 切换 → 填写成功
 * - UX9: 删除当前库 → 兜底回默认资料库
 */

let context: any;
let extensionId: string;
let sidePanel: PWPage;

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

/** 向 afa.jobs.v1 种一个 active Job（JobContext 形状，JobCard 的 activeJob 读这个 key） */
async function seedAgentJob(): Promise<void> {
  await sidePanel.evaluate(() => {
    const job = {
      id: "job-agent-test",
      company: "智元智能",
      position: "AI Agent 应用开发工程师",
      location: "",
      jd: "负责 Agent 与 RAG 系统开发，使用 Python 构建 Workflow 自动化。",
      sourceUrl: "https://x.com/1",
      pageTitle: "",
      createdAt: "2026-09-24T00:00:00Z",
      jobType: "agent",
      keywords: ["Agent", "RAG"],
      source: "captured",
    };
    return chrome.storage.local.set({
      "afa.jobs.v1": { jobs: [job], activeJobId: "job-agent-test", profileOverride: null },
    });
  });
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
}

async function openProfileTab(): Promise<void> {
  await sidePanel.locator(".tabbar-item", { hasText: "资料" }).click();
}

test("UX1: 首启默认资料库存在 + 无大块说明文案 + 单一主 CTA", async () => {
  await openProfileTab();
  await expect(sidePanel.locator(".libbar .chip-select", { hasText: "默认资料库" })).toBeVisible();
  // 回填写页：无旧大块说明
  await sidePanel.locator(".tabbar-item", { hasText: "投递" }).click();
  await expect(sidePanel.getByText("扩展只识别与预览，写入前需你逐项确认")).toHaveCount(0);
  // 单一主 CTA
  await expect(sidePanel.getByRole("button", { name: /开始识别|重新识别/ })).toBeVisible();
});

test("UX4: Agent JD → 方向路由为建议（显示 Agent 方向，但不强切用户资料库）", async () => {
  await seedAgentJob();
  const formPage = await context.newPage();
  await formPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await formPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  // 路由建议可见：岗位条显示 Agent 方向（建议性）
  await expect(sidePanel.locator(".chip-dir", { hasText: "Agent" })).toBeVisible();
  // 但资料库仍是用户当前的默认库——Router 绝不强切
  await expect(sidePanel.getByText(/资料库：默认资料库/)).toBeVisible();
});

test("UX5: 手动指定方向（AIGC）→ 填写内容随之切换为 AIGC 版本", async () => {
  await seedAgentJob();
  const formPage = await context.newPage();
  await formPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await formPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  // 手动指定方向：岗位条「调整」→ AIGC 方向 chip
  await sidePanel.getByRole("button", { name: "调整" }).click();
  await sidePanel.locator(".chip-select", { hasText: "AIGC / 营销 / 创意" }).first().click();
  // 填写内容随之切换（source badge + 实际写入值）
  await expect(sidePanel.locator(".source-badge", { hasText: "AIGC / 营销 / 创意版本" }).first()).toBeVisible({ timeout: 15000 });

  // 项目描述是 REVIEW（默认不勾）——勾选后确认填写，写入 AIGC 变体
  const desc = sidePanel.locator(".field-card", { hasText: "项目描述" }).first();
  await desc.locator(".confirm-check input").check();
  await ensureFilled(sidePanel, 25000);
  await expect(formPage.locator("#project-desc")).toHaveValue(/E2E标记-AIGC/);
});

test("UX8: 新建资料库 → 切换 → 填写成功", async () => {
  await openProfileTab();
  await sidePanel.getByRole("button", { name: "+ 新建" }).click();
  await sidePanel.locator(".libbar-form input").first().fill("我的定制库");
  await sidePanel.getByRole("button", { name: "创建" }).click();
  // 新建成功 → 列表出现
  await expect(sidePanel.locator(".libbar .chip-select", { hasText: "我的定制库" })).toBeVisible();

  // 切换到新库（资料页 chip 即切库；active 库即时生效）
  await sidePanel.locator(".libbar .chip-select", { hasText: "我的定制库" }).click();
  await expect(sidePanel.locator(".libbar .chip-select.active", { hasText: "我的定制库" })).toBeVisible();

  const formPage = await context.newPage();
  await formPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await formPage.bringToFront();
  await sidePanel.locator(".tabbar-item", { hasText: "投递" }).click();

  // 扫描 → 预览 → 确认填写 → 成功
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);
  await expect(formPage.locator("#name")).toHaveValue("张三");
});

test("UX9: 删除当前资料库 → 兜底回默认资料库", async () => {
  await openProfileTab();
  // 新建一个待删除库
  await sidePanel.getByRole("button", { name: "+ 新建" }).click();
  await sidePanel.locator(".libbar-form input").first().fill("待删除库");
  await sidePanel.getByRole("button", { name: "创建" }).click();
  await expect(sidePanel.locator(".libbar .chip-select", { hasText: "待删除库" })).toBeVisible({ timeout: 15000 });

  // 切到待删除库再删除（window.confirm 需要 accept）
  await sidePanel.locator(".libbar .chip-select", { hasText: "待删除库" }).click();
  sidePanel.on("dialog", (d) => void d.accept());
  await sidePanel.getByRole("button", { name: "删除", exact: true }).click();

  // fallback：active 回到 默认资料库，待删除库消失
  await expect(sidePanel.locator(".libbar .chip-select.active", { hasText: "默认资料库" })).toBeVisible({ timeout: 15000 });
  await expect(sidePanel.locator(".libbar .chip-select", { hasText: "待删除库" })).toHaveCount(0);
});
