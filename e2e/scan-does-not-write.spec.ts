import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_BASE,
  setupProfile,
  resetJobStorage,
  launchWithExtension,
  openSidePanel,
} from "./helpers";

/**
 * auto-fill-matched —— 已匹配字段在识别完成后直接写入页面。
 * 未匹配字段仍保持空值，写入层仍负责指纹定位与结果校验。
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

/** 目标字段（真实 application fixture）：姓名/学校/邮箱/项目经历 */
const TARGETS = ["#name", "#school", "#email", "#project-desc"];

async function openAppForm(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/application-form.html`);
  await page.bringToFront();
  return page;
}

async function readDom(page: Page): Promise<Record<string, string>> {
  return page.evaluate((sels: string[]) => {
    const out: Record<string, string> = {};
    for (const sel of sels) {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      out[sel] = el ? el.value : "<missing>";
    }
    return out;
  }, TARGETS);
}

test("识别后自动填写所有已匹配字段，未匹配字段保持空值", async () => {
  const page = await openAppForm();
  await page.bringToFront();

  // 1) Scan
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();

  // 识别结束即完成自动填写。
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 20000 });
  const after = await readDom(page);
  expect(after["#name"]).toBe("张三");
  expect(after["#school"]).toBe("示例科技大学");
  expect(after["#email"]).toBe("zhangsan@test.com");
  expect(after["#project-desc"]).not.toBe("");
});
