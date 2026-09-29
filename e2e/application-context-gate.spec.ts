import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_BASE, setupProfile, resetJobStorage, launchWithExtension, openSidePanel, revealPreview, ensureFilled } from "./helpers";

/**
 * issue-004 浏览器层回归：Application Context Gate。
 *
 * 真实背景：Moka 未登录页上，登录手机号被判 basic.phone、导航职位搜索框被判 internship.position，
 * 两者 SAFE 且能进 ConfirmedFillPlan。本文件在真实 Chromium + 真实扩展里验证：
 * 同一个 fieldId（basic.phone）在认证容器里就不写、在申请区里照写。
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

async function openAndScan(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/application-context.html`);
  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  return page;
}

async function confirmAndFill(): Promise<void> {
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {});
  await ensureFilled(sidePanel);
}

test("CTX-A: 登录面板与导航搜索框不进候选、不进计划、写完仍为空", async () => {
  const page = await openAndScan();

  // 卡片层面：认证/导航控件不出现在可填清单里，只以一行统计存在（§十八/§二十）
  await expect(sidePanel.locator(".fold-note")).toContainText("已忽略");
  const cardTexts = await sidePanel.locator(".field-card .field-label").allTextContents();
  expect(cardTexts.some((t) => t.includes("职位关键字"))).toBe(false); // 导航搜索框未成为候选
  expect(cardTexts.some((t) => t.includes("请输入手机号"))).toBe(false); // 登录手机号未成为候选

  await confirmAndFill();

  // 关键断言：登录手机号与「短信校验码」（刻意改写措辞，绕过关键词忽略层）一个字节都没被写
  await expect(page.locator("#login-phone")).toHaveValue("");
  await expect(page.locator("#login-sms")).toHaveValue("");
  await expect(page.locator("#kw-3c4d")).toHaveValue("");
});

test("CTX-B: 申请区的手机号 / 期望职位照常写入（不能一刀切封死）", async () => {
  const page = await openAndScan();
  await confirmAndFill();

  await expect(page.locator("#app-name")).not.toHaveValue("");
  await expect(page.locator("#app-phone")).not.toHaveValue("");
  await expect(page.locator("#app-email")).not.toHaveValue("");
  await expect(page.locator("#app-school")).not.toHaveValue("");
  // 「期望职位」含「职位」二字，但它是申请字段，必须被填而不是被当搜索框排除
  await expect(page.locator("#app-position")).not.toHaveValue("");
});

test("CTX-C: 同页并存时，搜索框被忽略而申请区手机号照写（同一 fieldId 两种命运）", async () => {
  const page = await openAndScan();
  await confirmAndFill();

  const loginPhone = await page.locator("#login-phone").inputValue();
  const appPhone = await page.locator("#app-phone").inputValue();
  expect(loginPhone).toBe("");
  expect(appPhone.length).toBeGreaterThan(0);

  // 撤销只应还原申请区，认证区本来就没被碰过
  await sidePanel.getByRole("button", { name: "撤销本次填写" }).click();
  await sidePanel.getByText(/已撤销本次填写/).waitFor({ timeout: 10000 });
  await expect(page.locator("#app-phone")).toHaveValue("");
  await expect(page.locator("#login-phone")).toHaveValue("");
});
