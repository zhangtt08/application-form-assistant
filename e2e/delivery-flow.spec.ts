import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_BASE,
  setupProfile,
  resetJobStorage,
  launchWithExtension,
  openSidePanel,
} from "./helpers";

/**
 * 交付主流程 E2E —— 目标里那条链路本身：
 *   进入招聘页 → 识别岗位 → 进入网申表单 → 识别字段 → 按岗位一键填入资料库内容
 * 全程没有任何人工逐项确认。断言的不是文案，而是「真实 DOM 里的值是否落到了正确的控件」。
 *
 * 覆盖的失败模式（用户反馈的三类）：
 *  - 能识别却填不进：异步弹层的自定义下拉 / 只读日期面板 / checkbox 组 / contenteditable
 *  - 少填：跨域 iframe 里的字段、资料库有值却没写进去
 *  - 填错位置：同名重复经历块、无 name/id/label 的控件、越界的经历条目
 * 以及红线：承诺 / 声明 / 签名 / 调剂类控件绝不代填，提交按钮绝不被点击。
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

async function openModernAts(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/modern-ats.html`);
  await page.bringToFront();
  return page;
}

/** 读主文档 + 跨域 iframe 内一批选择器的真实值（iframe 用它的 frame locator） */
async function readValues(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const textInputs = [
    "#f-name", "#f-phone", "#f-email", "#f-id", "#f-city", "#f-grad", "#f-school", "#f-major",
    "#f-degree", "#f-advantage", "#f-available", "#f-declare", "#f-sign", "#job-search",
  ];
  for (const sel of textInputs) {
    out[sel] = await page.locator(sel).first().inputValue().catch(() => "<missing>");
  }
  out["#f-selfeval"] = (await page.locator("#f-selfeval").first().textContent().catch(() => "")) ?? "";
  out["#city-display"] = (await page.locator("#city-select .ant-select-selection-item").textContent().catch(() => "")) ?? "";

  const entries = page.locator(".entry");
  const entryCount = await entries.count();
  for (let i = 0; i < entryCount; i++) {
    out[`entry${i}.company`] = await entries.nth(i).locator(".f-company").inputValue();
    out[`entry${i}.position`] = await entries.nth(i).locator(".f-position").inputValue();
  }

  const checks: Record<string, string> = {
    male: 'input[name="gender"][value="male"]',
    female: 'input[name="gender"][value="female"]',
    transferYes: 'input[name="transfer"][value="yes"]',
    transferNo: 'input[name="transfer"][value="no"]',
    cet4: 'input[name="lang"][value="cet4"]',
    cet6: 'input[name="lang"][value="cet6"]',
    toefl: 'input[name="lang"][value="toefl"]',
  };
  for (const [key, sel] of Object.entries(checks)) {
    out[key] = (await page.locator(sel).first().isChecked()) ? "checked" : "unchecked";
  }

  // 跨域 iframe（localhost 与 127.0.0.1 是不同源，走的是真实的 frame 路由）
  const frame = page.frame({ url: /^http:\/\/localhost:4198\/frame-form\.html$/ });
  out["__frameFound"] = frame ? "yes" : "no";
  if (frame) {
    out["frame.portfolio"] = await frame.locator("#q-f-portfolio").inputValue();
    out["frame.industry"] = await frame.locator("#q-f-industry").inputValue();
    out["frame.wechat"] = await frame.locator("#q-f-wechat").inputValue();
    out["frame.empty"] = await frame.locator("#q-f-empty").inputValue();
  }
  return out;
}

test("一键流程：识别即按资料库填写，值落在正确的控件里", async () => {
  test.setTimeout(180_000);
  const page = await openModernAts();

  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  const v = await readValues(page);

  // —— 基础文本 / 邮箱 / 电话 ——
  expect(v["#f-name"]).toBe("张三");
  expect(v["#f-phone"]).toBe("13800001234");
  expect(v["#f-email"]).toBe("zhangsan@test.com");
  expect(v["#f-city"]).toBe("杭州");

  // —— radio 组：落在「男」，不碰「女」 ——
  expect(v.male).toBe("checked");
  expect(v.female).toBe("unchecked");

  // —— 异步弹层的自定义下拉（Ant 风格，值在兄弟节点里） ——
  expect(v["#city-display"]).toBe("杭州");

  // —— 只读日期面板：点站点自己的日历格子，回显等价日期 ——
  expect(v["#f-grad"]).toBe("2027-06");

  // —— 原生 option 的只读下拉 ——
  expect(v["#f-degree"]).toBe("本科");

  // —— checkbox 组：只勾资料里有的那一项 ——
  expect(v.cet6).toBe("checked");
  expect(v.cet4).toBe("unchecked");
  expect(v.toefl).toBe("unchecked");

  // —— 教育经历 ——
  expect(v["#f-school"]).toBe("示例科技大学");
  expect(v["#f-major"]).toBe("测试专业");

  // —— contenteditable 富文本框 ——
  expect((v["#f-selfeval"] ?? "").trim().length).toBeGreaterThan(0);

  // —— 同名重复块：第 1 条经历有值，资料库里没有第 2 条 → 第 2 块必须留空（不重复填）——
  expect(v["entry0.company"]).toBe("示例科技有限公司");
  expect(v["entry0.position"]).toBe("AI 应用实习生");
  expect(v["entry1.company"]).toBe("");
  expect(v["entry1.position"]).toBe("");

  // —— 红线：承诺 / 声明 / 签名 / 调剂 一律不代填 ——
  expect(v["#f-declare"]).toBe("");
  expect(v["#f-sign"]).toBe("");
  expect(v.transferYes).toBe("unchecked");
  expect(v.transferNo).toBe("unchecked");

  // —— 红线：导航区搜索框不是申请表控件，不写 ——
  expect(v["#job-search"]).toBe("");

  // —— 提交按钮从未被点击（页面自己打的标记） ——
  expect(await page.locator("#submit-btn").getAttribute("data-clicked")).not.toBe("1");
});

test("跨域 iframe 表单：识别得到，也填得进去", async () => {
  test.setTimeout(180_000);
  const page = await openModernAts();

  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  const v = await readValues(page);
  expect(v.__frameFound).toBe("yes");
  // 资料库里的个人主页与期望行业要落进 iframe 内的那两个框
  expect(v["frame.portfolio"]).toBe("https://portfolio.example.com");
  expect(v["frame.industry"]).toBe("人工智能");
  // 资料库里没有的项保持空（不猜）
  expect(v["frame.empty"]).toBe("");
});

test("字段卡片显示写入结果，失败项给出可读原因", async () => {
  test.setTimeout(180_000);
  const page = await openModernAts();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  const filled = sidePanel.locator('.field-card[data-status="filled"]');
  expect(await filled.count()).toBeGreaterThan(5);

  // 承诺类字段应作为「需人工处理」出现，而不是被填上
  const declare = sidePanel.locator(".field-card", { hasText: "本人承诺" }).first();
  await expect(declare).toHaveCount(1);
  await expect(declare).not.toHaveAttribute("data-status", "filled");
  void page;
});

test("撤销：填写过的控件全部恢复为空", async () => {
  test.setTimeout(180_000);
  const page = await openModernAts();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.getByText(/填写完成 ——/).waitFor({ timeout: 60_000 });

  await sidePanel.getByRole("button", { name: /撤销本次填写/ }).click();
  await sidePanel.getByText(/已撤销本次填写/).waitFor({ timeout: 30_000 });

  expect(await page.locator("#f-name").inputValue()).toBe("");
  expect(await page.locator("#f-school").inputValue()).toBe("");
  expect(await page.locator('input[name="gender"][value="male"]').isChecked()).toBe(false);
});
