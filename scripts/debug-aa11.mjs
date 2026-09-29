/**
 * AA11 调试：custom-select.html 扫描 → sidepanel 实际状态。
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const PROFILE = JSON.parse(path.resolve(__dirname, "../e2e/helpers.ts") ? "{}" : "{}"); // placeholder

const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=zh-CN",
  ],
});
let sw = context.serviceWorkers()[0];
if (!sw) {
  for (let i = 0; i < 10 && !sw; i++) {
    sw = await Promise.race([
      context.waitForEvent("serviceworker", { timeout: 2000 }).catch(() => undefined),
      new Promise((r) => setTimeout(() => r(undefined), 2100)),
    ]);
  }
}
const extensionId = new URL(sw.url()).host;

const sp = await context.newPage();
await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await sp.waitForSelector(".tabbar-item", { timeout: 15000 });

// seed profile（与 helpers.PROFILE_FIXTURE 一致的最小版：basic + education + projects）
const profile = {
  basic: { name: "张三", email: "zhangsan@test.com", phone: "13800001234", city: "杭州", gender: "男", englishName: "", birthDate: "", age: "22", wechat: "", qq: "", portfolio: "" },
  education: [{ school: "示例科技大学", college: "", major: "测试专业", degree: "本科", educationLevel: "本科", startDate: "2023.09", endDate: "2027.06", gpa: "", rank: "" }],
  internships: [],
  projects: [],
  campus: [],
  skills: [],
  careerPreferences: {},
};
await sp.evaluate((p) => chrome.storage.local.set({ "afa.profile.v1": p }), profile);
await sp.reload();
await sp.waitForSelector(".tabbar-item", { timeout: 15000 });

const page = await context.newPage();
await page.goto("http://localhost:4198/compatibility/custom-select.html").catch(async () => {
  // webServer 可能没起，手动静态服务不行就直接 file://? content script 不注入 file://
});
await page.bringToFront();
await sp.getByRole("button", { name: /开始识别|重新识别/ }).click();
await sp.waitForTimeout(8000);

const state = await sp.evaluate(() => document.body.innerText.slice(0, 1200));
console.log("=== SIDE PANEL TEXT ===");
console.log(state);
const cards = await sp.locator(".field-card").count();
console.log("field-card count:", cards);
const cta = await sp.getByRole("button", { name: "查看填写预览" }).count();
console.log("CTA count:", cta);
// 模拟 spec 的 revealPreview：点击 CTA 后再数卡片
await sp.getByRole("button", { name: "查看填写预览" }).click({ timeout: 8000 }).catch((e) => console.log("CTA click failed:", String(e).slice(0, 120)));
await sp.waitForTimeout(1500);
console.log("field-card count after reveal:", await sp.locator(".field-card").count());
console.log("sidepanel text after reveal:", (await sp.evaluate(() => document.body.innerText.slice(0, 500))).replace(/\n+/g, " | "));
await context.close();
