import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_BASE,
  launchWithExtension,
  openSidePanel,
  setupProfile,
  resetJobStorage,
  type BrowserContext,
} from "./helpers";

/**
 * 只有 JD、没有网申表单的页面（真机字节跳动/小红书的职位详情页就是这个形态，投递入口在登录之后）。
 * 面板必须说清「这里没有表单可填」，而不是假装发生过撤销 —— 那是真机上用户第一眼看到的句子。
 */

let context: BrowserContext;
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

test("JD-only 页：岗位识别成功，副标题如实说明这里没有表单", async () => {
  const jobPage = await context.newPage();
  await jobPage.goto(`${FIXTURE_BASE}/job-agent.html`);
  await jobPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 20000 });

  const sub = sidePanel.locator(".header-sub");
  await expect(sub).toHaveText(/没有网申表单字段/, { timeout: 20000 });
  await expect(sub).not.toContainText("已撤销");
  // 主操作给出出路，而不是灰掉的「没有可填写的项」
  await expect(sidePanel.getByRole("button", { name: /投递下一个岗位/ })).toBeVisible();
});
