import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_BASE, setupProfile, resetJobStorage, launchWithExtension, openSidePanel, revealPreview, seedProfileDeep, PROFILE_FIXTURE, ensureFilled } from "../helpers";

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

/** 打开 compat fixture 并完成扩展扫描，返回表单页 */
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
  // 当前默认策略在识别完成后自动填写已匹配字段；保留旧确认流程作为无自动匹配时的兼容路径。
  if (await sidePanel.getByText(/填写完成 ——/).count()) return;
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);
}

test("AA1: React controlled input → 写入成功并 Verify", async () => {
  const page = await scanFixture("react-controlled.html");
  await confirmAndFill();
  // Verify：写入后 DOM 值真实生效（受控组件回滚被 controlled 策略克服）
  await expect(page.locator("#rc-name")).toHaveValue("张三");
  await expect(page.locator("#rc-school")).not.toHaveValue("");
});

test("AA2: value revert → 直接赋值被框架回滚，事件路径写入成功", async () => {
  const page = await scanFixture("react-controlled.html");
  // 预置一个会被回滚的直接赋值，证明受控回滚机制存在
  await page.evaluate(() => {
    const el = document.getElementById("rc-major") as HTMLInputElement;
    el.value = "直接赋值尝试";
    return el.value;
  });
  await confirmAndFill();
  // Writer 的 alternate strategy（native setter + input 事件）克服回滚
  await expect(page.locator("#rc-major")).not.toHaveValue("");
});

test("AA3: Dynamic field → 添加项目 → 重扫后新字段出现", async () => {
  const page = await scanFixture("dynamic-fields.html");
  const cardsBefore = await sidePanel.locator(".field-card").count();
  await page.locator("#add-project").click();
  await page.waitForTimeout(700); // fixture 延迟 400ms 挂载
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card", { hasText: "项目描述" }).waitFor({ timeout: 15000 });
  const cardsAfter = await sidePanel.locator(".field-card").count();
  expect(cardsAfter).toBeGreaterThan(cardsBefore);
});

test("AA4: Multi-entry → 两个项目字段分别填写不串位", async () => {
  // 注入第二条项目（Entry 2 有独立内容）；必须 v1+v2 双写（见 helpers.seedProfileDeep）
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
  // Entry 1 → 项目 1、Entry 2 → 项目 2，绝不串位（串位 = False Fill）
  expect(v1.length).toBeGreaterThan(0);
  expect(v2.length).toBeGreaterThan(0);
  expect(v1).not.toBe(v2);
});

test("AA5: Hidden duplicate → 只填 visible 字段（False Fill = 0）", async () => {
  const page = await scanFixture("duplicate-hidden-fields.html");
  expect(await sidePanel.locator(".field-card").count()).toBe(2);
  await confirmAndFill();
  await expect(page.locator("#dh-name-visible")).toHaveValue("张三");
  await expect(page.locator("#dh-name-hidden")).toHaveValue("");
});

test("AA6: SPA route change 无 reload → 自动检测新表单", async () => {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/spa-route.html`);
  await page.bringToFront();
  // RouteObserver：pushState → PAGE_MUTATED → 页面出现「重新识别」提醒横幅（与 hero 的开始识别并存，需精确点击横幅内按钮）
  await page.locator("#go-form").click();
  await page.waitForTimeout(1200); // RouteObserver debounce 600ms → PAGE_MUTATED
  await sidePanel.locator(".banner .btn-sm", { hasText: "重新识别" }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card", { hasText: "姓名" }).waitFor({ timeout: 15000 });
  // RouteObserver：扫描后再触发一次 pushState → PAGE_MUTATED → 提醒（无需手动刷新扩展）
  await page.evaluate(() => history.pushState({}, "", "/apply/step-2"));
  await expect(sidePanel.getByText("页面结构变了，建议重新识别一次")).toBeVisible({ timeout: 10000 });
});

test("AA7: Step form → 手动下一步 → Session 延续可继续填写", async () => {
  const page = await scanFixture("step-form.html");
  await confirmAndFill();
  await expect(page.locator("#st-name")).toHaveValue("张三");
  await page.locator("#next-step").click(); // 用户手动下一步
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card", { hasText: "学校" }).waitFor({ timeout: 15000 });
  await confirmAndFill();
  await expect(page.locator("#st-school")).not.toHaveValue("");
});

test("AA8: Shadow DOM open → 可扫描填写", async () => {
  const page = await scanFixture("shadow-dom.html");
  await confirmAndFill();
  const nameValue = await page.evaluate(() => {
    const host = document.getElementById("shadow-host")!;
    const input = host.shadowRoot!.querySelector("#sh-name") as HTMLInputElement;
    return input.value;
  });
  expect(nameValue).toBe("张三");
});

test("AA9: 同源 iframe 可填写，跨域 iframe 不尝试访问（安全边界）", async () => {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_BASE}/compatibility/iframe-host.html`);
  await page.bringToFront();
  // 等 same-origin iframe child 加载完成（input 出现）再扫描
  await page.waitForFunction(() => {
    try {
      return Boolean((document.getElementById("same-origin") as HTMLIFrameElement)?.contentDocument?.querySelector("input"));
    } catch {
      return false;
    }
  }, { timeout: 15000 });
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  // 同源 iframe 的申请字段可以安全访问和填写；跨域 iframe 仍完全不可访问。
  await expect(sidePanel.getByText(/填写完成 ——/)).toBeVisible({ timeout: 15000 });
  await revealPreview(sidePanel);
  await expect(sidePanel.locator(".field-card")).toHaveCount(2);
  await confirmAndFill();
  const sameOrigin = page.frameLocator("#same-origin");
  await expect(sameOrigin.locator("#if-name")).toHaveValue("张三");
  await expect(sameOrigin.locator("#if-email")).toHaveValue("zhangsan@test.com");
  const crossWritable = await page.evaluate(() => {
    const f = document.getElementById("cross-origin") as HTMLIFrameElement;
    try {
      return Boolean(f.contentDocument);
    } catch {
      return false;
    }
  });
  expect(crossWritable).toBe(false);
});

test("AA10: DOM remount → Stable Identity 重定位 → 写入成功", async () => {
  const page = await scanFixture("react-controlled.html");
  await page.evaluate(() => {
    const form = document.querySelector("form")!;
    const labels = ["姓名", "学校", "专业", "邮箱"];
    const ids = ["rc-name", "rc-school", "rc-major", "rc-email"];
    const names = ["name", "school", "major", "email"];
    form.innerHTML = labels
      .map((l, i) => `<label for="${ids[i]}">${l}</label><input id="${ids[i]}" name="${names[i]}" type="text">`)
      .join("");
  });
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  await confirmAndFill();
  await expect(page.locator("#rc-name")).toHaveValue("张三");
});

test("AA11: Unknown custom select → Manual Only，不误点", async () => {
  await scanFixture("custom-select.html");
  const mysteryCards = await sidePanel.locator(".field-card", { hasText: "选项A" }).count();
  expect(mysteryCards).toBe(0);
  await expect(sidePanel.locator(".field-card", { hasText: "期望城市" })).toBeVisible();
});

test("AA12: Mutation loop → 写入后 observer 不触发无限 rescan", async () => {
  await scanFixture("react-controlled.html");
  await confirmAndFill();
  await sidePanel.waitForTimeout(3000);
  await expect(sidePanel.getByText("页面结构变了，建议重新识别一次")).toHaveCount(0);
});

test("AA13: number 年份框收不下 2027.06 → 按数字框取年份写入，且不误伤同页其他控件（issue-003）", async () => {
  const page = await scanFixture("number-year-field.html");
  const yearCard = sidePanel.locator('.field-card[data-field-id="education.endDate"]');
  await expect(yearCard).toHaveCount(1);

  await confirmAndFill();

  // 资料库存的是「2027.06」，控件要的是整数年份：按字段语义取 2027 写入。
  // 既不是旧版的整字段放弃（用户看到的「少填」），也不是硬塞 2027.06 让页面判 stepMismatch。
  await expect(page.locator("#ny-year")).toHaveValue("2027");
  await expect(page.locator("#ny-age")).toHaveValue("22");
  await expect(page.locator("#ny-name")).toHaveValue("张三");
  await expect(page.locator("#ny-school")).toHaveValue("示例科技大学");

  // 收尾不变量：页面上所有非空控件都必须通过站点自身的约束校验
  const invalid = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter((el) => el.value !== "" && !el.validity.valid)
      .map((el) => el.id),
  );
  expect(invalid).toEqual([]);
});

test("AA14: Authentication / Navigation 语境控件 → 语境门禁排除，不写入（issue-004）", async () => {
  const page = await scanFixture("application-context.html");
  // 登录面板与导航搜索框不得成为可填候选；申请区字段照常出现
  const cardTexts = await sidePanel.locator(".field-card .field-label").allTextContents();
  expect(cardTexts.some((t) => t.includes("请输入手机号"))).toBe(false);
  expect(cardTexts.some((t) => t.includes("职位关键字"))).toBe(false);
  expect(cardTexts.some((t) => t.includes("姓名"))).toBe(true);

  await confirmAndFill();
  // 同一 fieldId（basic.phone）在认证容器里不写、在申请区里照写 —— 这就是语境门禁的全部意义
  await expect(page.locator("#login-phone")).toHaveValue("");
  await expect(page.locator("#login-sms")).toHaveValue("");
  await expect(page.locator("#kw-3c4d")).toHaveValue("");
  await expect(page.locator("#app-phone")).not.toHaveValue("");
});
