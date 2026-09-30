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
 * 岗位列表 → 详情 → 「开始 / 继续申请」的真实出路：
 * 这一步必须把人带回那个岗位的原页（否则切到「投递」标签时对着的是另一张表），
 * 「来源」也要能直接点开。
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

test("岗位详情能回到岗位原页", async () => {
  const jobUrl = `${FIXTURE_BASE}/job-agent.html`;
  const jobPage = await context.newPage();
  await jobPage.goto(jobUrl);
  await jobPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 20000 });

  await sidePanel.getByRole("button", { name: "岗位", exact: true }).click();
  await sidePanel.locator(".job-card").first().waitFor({ timeout: 15000 });
  await sidePanel.locator(".job-card").first().click();

  // 来源是链接，不是印在面板上的一段死文字
  await expect(sidePanel.locator(".ws-grid a").first()).toHaveAttribute("href", /job-agent\.html/);

  // 关掉原页，再点「开始申请」——扩展应该把这个岗位页面重新打开
  await jobPage.close();
  await sidePanel.getByRole("button", { name: /开始 \/ 继续申请|^开始申请$/ }).click();

  await expect
    .poll(
      async () => {
        const pages = await context.pages();
        return pages.filter((p) => p.url().includes("job-agent.html")).length;
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
});
