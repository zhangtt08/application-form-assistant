import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_BASE,
  setupProfile,
  resetJobStorage,
  launchWithExtension,
  openSidePanel,
  revealPreview,
  setAutoFill,
} from "./helpers";

/**
 * Safety Flow E2E —— 一键填写形态下的安全边界。
 *
 * 产品口径已经从「逐项确认后写入」改为「识别即按资料库填写」，所以这里守的不是确认流程，
 * 而是这条链路上仍然不能越过的线：
 *   1. 写入的是资料库里的原文，实际 DOM === 期望值（不允许假成功）
 *   2. 资料库里没有的字段保持空，绝不猜着填
 *   3. 承诺 / 声明 / 签名 / 调剂 这类「替用户做保证」的控件一律不写
 *   4. 非申请表控件（登录 / 搜索 / 导航）不写
 *   5. 用户点「忽略」的字段不写
 *   6. 用户手工编辑过的值，重新填写时写入编辑后的值
 *   7. 撤销能把写进去的值恢复掉
 *   8. 提交按钮永远不会被点击
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

async function openForm(file = "application-form.html"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/${file}`);
  await page.bringToFront();
  return page;
}

async function recognize(): Promise<void> {
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });
}

function card(label: string) {
  return sidePanel.locator(".field-card", { hasText: label }).first();
}

test("写入值 === 资料库原文（多字段），资料库没有的字段保持空", async () => {
  const page = await openForm();
  await recognize();

  await expect(page.locator("#name")).toHaveValue("张三");
  await expect(page.locator("#phone")).toHaveValue("13800001234");
  await expect(page.locator("#email")).toHaveValue("zhangsan@test.com");
  await expect(page.locator("#school")).toHaveValue("示例科技大学");
  await expect(page.locator("#major")).toHaveValue("测试专业");

  // 资料库空的字段：识别到了也不能编一个值填进去
  await expect(page.locator("#salary")).toHaveValue("");
  // 没点 AI 生成时，开放题保持空（不自动写作）
  await expect(page.locator("#why-role")).toHaveValue("");
});

test("承诺 / 签名 / 调剂类控件永不代填，提交按钮永不被点击", async () => {
  const page = await openForm("modern-ats.html");
  await page.evaluate(() => {
    document.getElementById("submit-btn")?.addEventListener("click", () => {
      document.getElementById("submit-btn")?.setAttribute("data-clicked", "1");
    });
  });
  await recognize();

  await expect(page.locator("#f-declare")).toHaveValue("");
  await expect(page.locator("#f-sign")).toHaveValue("");
  await expect(page.locator('input[name="transfer"][value="yes"]')).not.toBeChecked();
  await expect(page.locator('input[name="transfer"][value="no"]')).not.toBeChecked();
  await expect(page.locator("#job-search")).toHaveValue("");
  expect(await page.locator("#submit-btn").getAttribute("data-clicked")).not.toBe("1");
});

test("点「忽略」的字段不写入，其余照常", async () => {
  // 这条走的是「先看清单再填」的节奏：先关掉识别后自动填写
  await setAutoFill(sidePanel, false);
  const page = await openForm();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 20000 });

  await card("姓名").getByRole("button", { name: /忽略/ }).click();
  await sidePanel.getByRole("button", { name: /填写确认的|确认并填写/ }).click();
  await sidePanel.locator(".dialog .primary", { hasText: "确认填写" }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  await expect(page.locator("#name")).toHaveValue("");
  await expect(page.locator("#email")).toHaveValue("zhangsan@test.com");
});

test("手工编辑值后重新填写，写入的是编辑后的值", async () => {
  const page = await openForm();
  await recognize();
  await revealPreview(sidePanel);

  const desc = card("项目描述");
  await desc.locator(".value-input").fill("SafetyE2E-手工编辑的值");
  await sidePanel.getByRole("button", { name: /填写确认的|确认并填写/ }).click();
  await sidePanel.locator(".dialog .primary", { hasText: "确认填写" }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  await expect(page.locator("#project-desc")).toHaveValue("SafetyE2E-手工编辑的值");
});

test("撤销把写入的值全部恢复", async () => {
  const page = await openForm();
  await recognize();

  await sidePanel.getByRole("button", { name: /撤销本次填写/ }).click();
  await sidePanel.getByText(/已撤销本次填写/).waitFor({ timeout: 30_000 });

  await expect(page.locator("#name")).toHaveValue("");
  await expect(page.locator("#school")).toHaveValue("");
  await expect(page.locator("#email")).toHaveValue("");
});

test("写入过程不新增/删除页面控件（只改值）", async () => {
  const page = await openForm();
  const before = await page.evaluate(() => document.querySelectorAll("input, textarea, select").length);
  await recognize();
  const after = await page.evaluate(() => document.querySelectorAll("input, textarea, select").length);
  expect(after).toBe(before);

  // 提交按钮没有被点击过，页面也没有跳转
  expect(page.url()).toContain("application-form.html");
});
