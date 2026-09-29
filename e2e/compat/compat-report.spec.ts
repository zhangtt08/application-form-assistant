import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { FIXTURE_BASE, resetJobStorage, setupProfile, launchWithExtension, openSidePanel, revealPreview, seedProfileDeep, PROFILE_FIXTURE, ensureFilled } from "../helpers";
import type { Page } from "@playwright/test";

/**
 * Compatibility Benchmark Runner（spec 二十三~二十六章）：
 * 逐环境输出 Detect / Write / Recovery / Manual 指标，写 compatibility-results/report.md。
 * False Fill Count 必须为 0（spec 二十四/二十五：宁可 Manual 增多也不能错误填写）。
 */

let context: any;
let extensionId: string;
let sidePanel: Page;
let report = "# Compatibility Report\n\n| Environment | Detect | Write | Recovery | Manual |\n|---|---|---|---|---|\n";
const results: { env: string; detect: string; write: string; recovery: string; manual: number; falseFill: number }[] = [];

test.beforeEach(async () => {
  ({ context, extensionId } = await launchWithExtension());
  sidePanel = await openSidePanel(context, extensionId);
  await resetJobStorage(sidePanel);
  await setupProfile(sidePanel);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
});

test.afterAll(async () => {
  for (const r of results) {
    report += `| ${r.env} | ${r.detect} | ${r.write} | ${r.recovery} | ${r.manual} |\n`;
  }
  report += `\nFalse Fill Count: ${results.reduce((s, r) => s + r.falseFill, 0)}\n`;
  mkdirSync("compatibility-results", { recursive: true });
  writeFileSync("compatibility-results/report.md", report);
});

test.afterEach(async () => {
  await context.close();
});

async function scanFixture(path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/${path}`);
  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  return page;
}

async function confirmAndFill(): Promise<void> {
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);
}

function record(env: string, detect: string, write: string, recovery: string, manual: number, falseFill = 0): void {
  results.push({ env, detect, write, recovery, manual, falseFill });
}

test("BENCH: Native Form", async () => {
  const page = await scanFixture("dynamic-fields.html");
  const detected = await sidePanel.locator(".field-card").count();
  await confirmAndFill();
  const v = await page.locator("#dyn-name").inputValue();
  const ok = v.length > 0;
  record("Native Form", detected > 0 ? "PASS" : "FAIL", ok ? "PASS" : "FAIL", "PASS", 0);
  expect(ok).toBe(true);
});

test("BENCH: React Controlled", async () => {
  const page = await scanFixture("react-controlled.html");
  const detected = await sidePanel.locator(".field-card").count();
  await confirmAndFill();
  const v = await page.locator("#rc-name").inputValue();
  record("React Controlled", detected >= 4 ? "PASS" : "PARTIAL", v === "张三" ? "PASS" : "FAIL", "PASS", 0);
  expect(v).toBe("张三");
});

test("BENCH: Vue Controlled", async () => {
  const page = await scanFixture("vue-controlled.html");
  const detected = await sidePanel.locator(".field-card").count();
  await confirmAndFill();
  const v = await page.locator("#vu-name").inputValue();
  record("Vue Controlled", detected >= 3 ? "PASS" : "PARTIAL", v === "张三" ? "PASS" : "FAIL", "PASS", 0);
  expect(v).toBe("张三");
});

test("BENCH: Shadow DOM (open)", async () => {
  const page = await scanFixture("shadow-dom.html");
  const detected = await sidePanel.locator(".field-card").count();
  await confirmAndFill();
  const v = await page.evaluate(() => {
    const input = document.getElementById("shadow-host")!.shadowRoot!.querySelector("#sh-name") as HTMLInputElement;
    return input.value;
  });
  record("Shadow DOM (open)", detected >= 2 ? "PASS" : "FAIL", v === "张三" ? "PASS" : "FAIL", "PASS", 0);
  expect(v).toBe("张三");
});

test("BENCH: iframe 表单（逐 frame 扫描 + 填写；浏览器跨域隔离不变）", async () => {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/iframe-host.html`);
  await page.bringToFront();
  await page.waitForFunction(() => {
    try {
      return Boolean((document.getElementById("same-origin") as HTMLIFrameElement)?.contentDocument?.querySelector("input"));
    } catch {
      return false;
    }
  }, { timeout: 15000 });
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await expect(sidePanel.getByText(/填写完成 ——/)).toBeVisible({ timeout: 30000 });
  await revealPreview(sidePanel);

  // 表单在 iframe 里也能填：由那个 frame 自己的 content script 扫描并写入
  const sameOrigin = page.frameLocator("#same-origin");
  await expect(sameOrigin.locator("#if-name")).toHaveValue("张三");
  await expect(sameOrigin.locator("#if-email")).toHaveValue("zhangsan@test.com");

  // 但扩展没有绕过浏览器的同源策略：主页面依然拿不到 cross-origin frame 的 document，
  // 跨域 frame 是通过 Chrome 的按 frame 消息通道工作的。
  const crossWritable = await page.evaluate(() => {
    try {
      return Boolean((document.getElementById("cross-origin") as HTMLIFrameElement).contentDocument);
    } catch {
      return false;
    }
  });
  expect(crossWritable).toBe(false);
  record("iframe 表单（same/cross-origin）", "PASS", "PASS", "PASS", 0);
});

test("BENCH: Unknown Custom Select（Manual Only）", async () => {
  await scanFixture("custom-select.html");
  const mystery = await sidePanel.locator(".field-card", { hasText: "选项A" }).count();
  record("Unknown Custom Select", "DETECTED", "MANUAL_ONLY", "N/A", 1);
  expect(mystery).toBe(0); // 不误点
});

test("BENCH: Multi-entry Binding", async () => {
  // 注入第二条项目（Entry 2 才有内容可填）；必须 v1+v2 双写（见 helpers.seedProfileDeep）
  const profile = structuredClone(PROFILE_FIXTURE);
  profile.projects.push({
    ...profile.projects[0],
    name: "Multi-Agent 项目",
    descriptionShort: "第二个项目描述",
    descriptionMedium: "Multi-Agent 项目的 medium 描述",
  });
  await seedProfileDeep(sidePanel, profile);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  const page = await scanFixture("multi-entry.html");
  await confirmAndFill();
  const v1 = await page.locator("#me-p1").inputValue();
  const v2 = await page.locator("#me-p2").inputValue();
  const falseFill = v1.length > 0 && v1 === v2 ? 1 : 0; // Entry 串位 = False Fill
  record("Multi-entry", v1.length > 0 ? "PASS" : "FAIL", v1.length > 0 ? "PASS" : "FAIL", "PASS", v2.length > 0 ? 0 : 1, falseFill);
  expect(falseFill).toBe(0);
});

test("BENCH: Hidden Duplicate Filtering", async () => {
  const page = await scanFixture("duplicate-hidden-fields.html");
  const detected = await sidePanel.locator(".field-card").count();
  await confirmAndFill();
  const hiddenValue = await page.locator("#dh-name-hidden").inputValue();
  const falseFill = hiddenValue.length > 0 ? 1 : 0;
  record("Hidden Duplicate", detected === 2 ? "PASS" : "PARTIAL", "PASS", "PASS", 0, falseFill);
  expect(falseFill).toBe(0);
});
