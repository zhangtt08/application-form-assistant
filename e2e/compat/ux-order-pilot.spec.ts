import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview, seedProfileDeep, PROFILE_FIXTURE, ensureFilled } from "../helpers";
import type { Page as PWPage } from "@playwright/test";

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

/** 注入第二条项目（v1+v2 双写，见 helpers.seedProfileDeep；B 的描述带独立标记） */
async function seedSecondProject(): Promise<void> {
  const profile = structuredClone(PROFILE_FIXTURE);
  profile.projects.push({
    ...profile.projects[0],
    name: "Multi-Agent 项目",
    descriptionShort: "E2E标记-PROJECT-B 短描述",
    descriptionMedium: "E2E标记-PROJECT-B 的 medium 描述",
  });
  await seedProfileDeep(sidePanel, profile);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
}

test("UX11: Multi-entry → 两个项目条目按资料顺序分别填入，不串位", async () => {
  // 旧版「ProfilePack experienceOrder 决定条目顺序」已随 Pack 体系移除；
  // 现语义：多段经历按资料库内顺序（projects[0] → 表单第 1 条）一一对应，绝不串位。
  await seedSecondProject();

  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/multi-entry.html`);
  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);

  // #1 = projects-0（A，默认描述），#2 = projects-1（B，E2E标记）——顺序映射且内容各异
  const v1 = await page.locator("#me-p1").inputValue();
  const v2 = await page.locator("#me-p2").inputValue();
  expect(v1).toBe("项目中描述（默认）");
  expect(v2).toContain("E2E标记-PROJECT-B");
  expect(v1).not.toBe(v2);
});

test("UX12: 默认无 Dev 噪音；设置开启「显示执行轨迹」后出现且持久化", async () => {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/react-controlled.html`);
  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  // 默认：填写页无 Dev/Trace 噪音（旧 Pilot Mode / Dry Run 面板已移除）
  await expect(sidePanel.locator(".trace-viewer, .trace-panel")).toHaveCount(0);
  await expect(sidePanel.locator(".dry-run-report, .pilot-tools")).toHaveCount(0);
  await expect(sidePanel.locator(".field-card .btn-sm", { hasText: "调试信息" })).toHaveCount(0);
  // 首页保持：岗位条 + 单一主动作
  await expect(sidePanel.getByRole("button", { name: /重新识别/ })).toBeVisible();

  // 设置 → 开发者 → 开启「显示执行轨迹与字段调试信息」
  await sidePanel.locator(".tabbar-item", { hasText: "设置" }).click();
  const devToggle = sidePanel.getByRole("checkbox", { name: /显示执行轨迹/ });
  await devToggle.check();
  await expect(sidePanel.locator(".trace-viewer")).toBeVisible();

  // 刷新后持久化恢复
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  await sidePanel.locator(".tabbar-item", { hasText: "设置" }).click();
  await expect(sidePanel.locator(".trace-viewer")).toBeVisible();

  // 关闭 → 再次消失
  await sidePanel.getByRole("checkbox", { name: /显示执行轨迹/ }).uncheck();
  await expect(sidePanel.locator(".trace-viewer")).toHaveCount(0);
});
