/**
 * 用户提供的真实站点探测：zhaopin.yaoji.cn 职位页
 * Capture + Scan + 表单清点（不填写、不提交）。
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const PRIVATE_SHOTS = path.resolve(__dirname, "../real-validation-results/private");
const url = process.argv[2] ?? "https://zhaopin.yaoji.cn/job/065bf5c4-c421-490e-9b9e-e337d9d6f75f";

const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--lang=zh-CN",
    "--disable-blink-features=AutomationControlled",
  ],
});

let sw = context.serviceWorkers()[0];
if (!sw) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    sw = await Promise.race([
      context.waitForEvent("serviceworker", { timeout: 2000 }),
      new Promise((r) => setTimeout(() => r(undefined), 2100)),
    ]);
    if (sw) break;
  }
}
const extensionId = new URL(sw.url()).host;

const sp = await context.newPage();
await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await sp.waitForSelector("text=扫描当前页面", { timeout: 15000 });

const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(4000);

console.log("TITLE:", await page.title());
console.log("FINAL-URL:", page.url().slice(0, 130));

// 页面正文（判断是否登录墙 / JD 内容 / 申请表单）
const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1200) ?? "");
console.log("BODY:", bodyText.split(String.fromCharCode(10)).join(" | ").slice(0, 700));

// 表单控件清点
const dom = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("input, textarea, select"));
  const visible = els.filter((el) => {
    const r = el.getBoundingClientRect();
    const t = (el.getAttribute("type") ?? "").toLowerCase();
    return r.width > 0 && r.height > 0 && t !== "hidden" && t !== "submit";
  });
  return {
    visible: visible.length,
    samples: visible.slice(0, 25).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") ?? "",
      ph: (el.getAttribute("placeholder") ?? "").slice(0, 20),
      label: (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.name ?? "").trim().slice(0, 24),
    })),
    buttons: Array.from(document.querySelectorAll("button, [role=button], a.btn, .btn"))
      .map((b) => b.textContent?.trim().slice(0, 16))
      .filter(Boolean)
      .slice(0, 20),
  };
});
console.log("DOM:", JSON.stringify(dom, null, 2));

// 若有申请/投递按钮则点击展开表单
const applyLoc = page.getByText("投递简历", { exact: false }).first();
let clicked = false;
if (await applyLoc.isVisible().catch(() => false)) {
  console.log("CLICK-APPLY");
  await applyLoc.click({ force: true });
  clicked = true;
  await page.waitForTimeout(4000);
  console.log("AFTER-URL:", page.url().slice(0, 130));
}

if (clicked) {
  const dom2 = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("input, textarea, select"));
    const visible = els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return {
      visible: visible.length,
      samples: visible.slice(0, 30).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? "",
        ph: (el.getAttribute("placeholder") ?? "").slice(0, 20),
        label: (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.name ?? "").trim().slice(0, 24),
      })),
    };
  });
  console.log("DOM-AFTER-APPLY:", JSON.stringify(dom2, null, 2));
}

// 注入测试 Profile（fixture 假数据，非真实个人信息）——用于 Dry Run 级验证
await sp.evaluate(async () => {
  const existing = await chrome.storage.local.get("afa.profile.v1");
  if (!existing["afa.profile.v1"]?.basic?.name) {
    await chrome.storage.local.set({
      "afa.profile.v1": {
        basic: { name: "测试同学", phone: "13800138000", email: "test@example.com", location: "上海", age: "22" },
        education: [{ school: "测试大学", major: "计算机科学", degree: "本科", start: "2022", end: "2026" }],
        internships: [{ company: "测试公司", title: "测试实习生", start: "2022-01", end: "2024-06", descriptionShort: "测试工作内容", descriptionMedium: "测试工作内容描述", descriptionLong: "测试工作内容描述", variants: {} }],
        projects: [],
        campus: [],
        content: {},
        sensitive: {},
      },
    });
  }
});

// 扩展扫描（注入 profile 后 reload sidepanel 使其加载）
await sp.reload();
await sp.waitForSelector("text=扫描当前页面", { timeout: 15000 });
await page.bringToFront();
await sp.getByRole("button", { name: "扫描当前页面" }).click();
await sp.waitForTimeout(3000);
const statsText = (await sp.locator(".stats").textContent().catch(() => "")) ?? "";
console.log("SCAN-STATS:", statsText.replace(/\s+/g, " ").slice(0, 140));
const cards = await sp.locator(".field-card").count().catch(() => 0);
const cardLabels = await sp.locator(".field-card .field-label, .field-card h4, .field-card strong").allTextContents().catch(() => []);
console.log("FIELD-CARDS:", cards, JSON.stringify(cardLabels.slice(0, 15)));

// Capture
const captureBtn = sp.getByRole("button", { name: /捕获当前岗位|更新/ });
if ((await captureBtn.count()) > 0) {
  await captureBtn.click();
  await sp.waitForTimeout(2500);
  const jobText = (await sp.locator(".home-card", { hasText: "当前岗位" }).textContent().catch(() => "")) ?? "";
  console.log("CAPTURE:", jobText.replace(/\s+/g, " ").slice(0, 150));
}

// Pilot 截图一律落 real-validation-results/private/（已 gitignore）：画面里可能出现用户填写值。
// 入库判据见 docs/TEST_DATA_POLICY.md —— 写入正确性由结构化记录证明，不由截图证明。
await mkdirSync(PRIVATE_SHOTS, { recursive: true });
await page.screenshot({ path: path.join(PRIVATE_SHOTS, "yaoji-pilot.png"), fullPage: false });
await context.close();
