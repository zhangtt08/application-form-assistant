import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_BASE,
  launchWithExtension,
  openSidePanel,
  setupProfile,
  resetJobStorage,
  readStorage,
  seedProfileDeep,
  PROFILE_FIXTURE,
  revealPreview,
  ensureFilled,
  type BrowserContext,
} from "./helpers";

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

/** 在 JD 页捕获岗位（active tab 必须是 JD 页） */
async function captureJob(jobPath: string): Promise<Page> {
  const jobPage = await context.newPage();
  await jobPage.goto(`${FIXTURE_BASE}/${jobPath}`);
  await jobPage.bringToFront();
  // Branch-L UI：无独立捕获按钮——「开始识别」内置 autoCaptureJob 完成捕获
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await sidePanel.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 20000 }); // jobbar 出现 = 捕获成功（各 fixture 公司名不同）
  return jobPage;
}

/** 打开申请表页并扫描 */
async function scanApplicationForm(): Promise<Page> {
  const appPage = await context.newPage();
  await appPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  return appPage;
}

async function confirmAllAndFill(): Promise<void> {
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);
}

// ---------- Scenario A：AI 产品岗位完整链路 ----------

test("Scenario A: AI 产品 JD → 捕获 → 路由 → 扫描 → 确认填写 → DOM 写入 variant", async () => {
  await captureJob("job-ai-product.html");

  // Storage：Active Job 存在且 primaryProfile = aiProduct
  const raw = (await readStorage(sidePanel, "afa.jobs.v1")) as Record<string, {
    jobs: { id: string; jobType: string }[];
    activeJobId: string | null;
  }>;
  const jobsStore = raw["afa.jobs.v1"];
  const activeJob = jobsStore.jobs.find((j) => j.id === jobsStore.activeJobId);
  expect(activeJob?.jobType).toBe("aiProduct");

  // 跨页面：打开申请表（不同 URL），Active Job 从 storage 恢复
  const appPage = await scanApplicationForm();
  await expect(sidePanel.getByText("星辰科技有限公司")).toBeVisible();

  // Preview：项目描述来源 = AI 产品版本
  await expect(sidePanel.locator(".source-badge", { hasText: "AI 产品版本" }).first()).toBeVisible();

  // 确认填写 → 真实 DOM 验证
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AIPRODUCT/);
  // 基础资料字段
  await expect(appPage.locator("#name")).toHaveValue("张三");
  await expect(appPage.locator("#school")).toHaveValue("示例科技大学");
  await expect(appPage.locator("#email")).toHaveValue("zhangsan@test.com");
});

// ---------- Scenario B：同一 Profile，不同 Job → 不同内容 ----------

test("Scenario B: Agent JD → 同一项目描述字段切换为 Agent Variant", async () => {
  await captureJob("job-agent.html");
  const appPage = await scanApplicationForm();

  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible();
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AGENT/);
  await expect(appPage.locator("#project-desc")).not.toHaveValue(/AIPRODUCT/);
});

// ---------- Scenario C：无 JD 手动选择方向 ----------

test("Scenario C: 无 JD → 指定方向 AIGC → 重扫 → AIGC Variant", async () => {
  const appPage = await scanApplicationForm();
  // 未关联岗位 = 次级状态（jobbar 空态，非警告）
  await expect(sidePanel.locator(".jobbar-empty")).toBeVisible();

  // 指定方向（无 AI / 无 Job 即可完成）：jobbar 空态「指定方向」→ AIGC chip
  await sidePanel.getByRole("button", { name: "指定方向" }).click();
  await sidePanel.locator(".chip-select", { hasText: "AIGC / 营销 / 创意" }).first().click();
  await expect(sidePanel.locator(".jobbar-title", { hasText: "手动选择" })).toBeVisible();

  // 重扫后内容来源随之切换
  await sidePanel.getByRole("button", { name: "重新识别" }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });
  await expect(sidePanel.locator(".source-badge", { hasText: "AIGC / 营销 / 创意版本" }).first()).toBeVisible({ timeout: 15000 });
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AIGC/);
});

// ---------- Scenario D：Profile Override 不重扫 DOM ----------

test("Scenario D: AI 产品岗位 → 手动指定 Agent 方向 → 内容切换（不重扫 DOM）", async () => {
  await captureJob("job-ai-product.html");
  await scanApplicationForm();
  const fieldCountBefore = await sidePanel.locator(".field-card").count();

  // 岗位条「调整」→ 方向 chip（override 在既有候选上原位重解析，不重扫）
  await sidePanel.getByRole("button", { name: "调整" }).click();
  await sidePanel.locator(".chip-select", { hasText: "Agent / AI 应用开发" }).first().click();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });

  const fieldCountAfter = await sidePanel.locator(".field-card").count();
  expect(fieldCountAfter).toBe(fieldCountBefore);

  await confirmAllAndFill();
  const appPage = context.pages().find((p) => p.url().includes("application-form"))!;
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AGENT/);
});

// ---------- Scenario E：资料库有的客观信息直接填写，资料库没有的保持空 ----------

test("Scenario E: 身份证号按资料库填写；资料库为空的期望薪资保持空", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await ensureFilled(sidePanel);

  // 身份证号：资料库里有（旧版存在 sensitive 块）→ 按用户要求直接填写
  await expect(appPage.locator("#idcard")).toHaveValue("110101199001011234");
  // 期望薪资：资料库里没有 → 绝不编一个值填进去
  await expect(appPage.locator("#salary")).toHaveValue("");
  const salaryCard = sidePanel.locator(".field-card", { hasText: "期望薪资" }).first();
  await expect(salaryCard.getByText("资料库里没有对应内容")).toBeVisible();
});

// ---------- Scenario F：maxlength 超限不静默截断、也不写超长值 ----------

test("Scenario F: maxlength=300 字段内容 365+ 字 → 判为需人工处理，不写入、不截断", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  const highlightsCard = sidePanel.locator(".field-card", { hasText: "项目亮点" });
  await expect(highlightsCard.getByText(/36[0-9] \/ 300/)).toBeVisible(); // currentLength > maxLength
  await expect(highlightsCard.getByText("请人工填写")).toBeVisible();

  await ensureFilled(sidePanel);

  // 超限字段：不自动截断，也不把超长值硬塞进控件 → 保持空，其余字段照常写入
  await expect(appPage.locator("#highlights")).toHaveValue("");
  await expect(appPage.locator("#name")).toHaveValue("张三");
});

// ---------- Scenario G：Manual Edit 只影响本次填写 ----------

test("Scenario G: Preview 手动修改 → DOM 为修改值 → Master Profile 不变", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  const projectCard = sidePanel.locator(".field-card", { hasText: "项目描述" }).first();
  const input = projectCard.locator("input.value-input");
  await input.fill("TEST MANUAL CONTENT");

  // 手动修改后来源 = 手动修改
  await expect(projectCard.locator(".source-badge", { hasText: "手动修改" })).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue("TEST MANUAL CONTENT");

  // Master Profile 原始 variant 未被回写
  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  const profileStore = profileRaw["afa.profile.v1"];
  expect(profileStore.projects[0].variants.aiProduct).toContain("E2E标记-AIPRODUCT");
});

// ---------- Scenario H：Fallback ----------

test("Scenario H: AI Product Variant 为空 → 默认版本 + fallback 提示 → DOM 用默认描述", async () => {
  // 覆盖 Profile：aiProduct variant 置空（v1+v2 双写——v2 已存在时只改 v1 会被忽略）
  const profileNoVariant = structuredClone(PROFILE_FIXTURE);
  profileNoVariant.projects[0].variants.aiProduct = "";
  await seedProfileDeep(sidePanel, profileNoVariant);

  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  const projectCard = sidePanel.locator(".field-card", { hasText: "项目描述" }).first();
  await expect(projectCard.locator(".source-badge", { hasText: "默认版本" })).toBeVisible();
  await expect(projectCard.getByText(/已使用默认表达/)).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/项目中描述（默认）/);
  await expect(appPage.locator("#project-desc")).not.toHaveValue(/E2E标记/);
});

// ---------- Scenario I：Router Low Confidence ----------

test("Scenario I: 模糊 JD → matcher low confidence → 方向不明确提示", async () => {
  await captureJob("job-ambiguous.html");
  await scanApplicationForm();
  // Pack Matcher 低置信：岗位条明示「方向不确定，建议手动指定」，不自动强切、不显示推荐 banner（不假装确定）
  await expect(sidePanel.getByText(/方向不确定，建议手动指定/)).toBeVisible();
  await expect(sidePanel.getByText("这个岗位更适合")).toHaveCount(0);
});

// ---------- Scenario J：Unknown Field 不编造不填写 ----------

test("Scenario J: 「请描述你对我们的理解」→ unknown → 不自动填写", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  const unknownCard = sidePanel.locator(".field-card", { hasText: "请描述你对我们的理解" });
  await expect(unknownCard).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#understanding")).toHaveValue("");
});

// ---------- 跨页面 Job Context ----------

test("跨页面: 捕获后关闭 JD 页 → 申请页扫描仍恢复 Active Job（storage 持久化）", async () => {
  const jobPage = await captureJob("job-ai-product.html");
  await jobPage.close(); // JD 页关闭

  const appPage = await context.newPage();
  await appPage.goto(`${FIXTURE_BASE}/application-form.html`);
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  // Active Job 仍在（来自 storage，不依赖页面内存）
  await expect(sidePanel.getByText("星辰科技有限公司")).toBeVisible();
  await expect(sidePanel.locator(".source-badge", { hasText: "AI 产品版本" }).first()).toBeVisible();
});

// ---------- 刷新恢复 ----------

test("刷新恢复: 表单页与 Side Panel 刷新后 Active Job / 方向指定恢复", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  // 手动指定 Agent 方向（override 持久化到岗位库）
  await sidePanel.getByRole("button", { name: "调整" }).click();
  await sidePanel.locator(".chip-select", { hasText: "Agent / AI 应用开发" }).first().click();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });

  // 刷新表单页 + Side Panel
  await appPage.reload();
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();

  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  // Active Job 恢复 + 手动方向指定恢复（仍是 Agent）
  await expect(sidePanel.getByText("星辰科技有限公司")).toBeVisible();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AGENT/);
});

// ---------- Dev Trace Viewer ----------

test("Dev Trace: 捕获 + 扫描 + 填写生成完整 trace 事件流", async () => {
  await sidePanel.getByRole("button", { name: "设置" }).click();
  await sidePanel.getByRole("checkbox", { name: /显示执行轨迹/ }).check();
  await sidePanel.getByRole("button", { name: "投递" }).click();
  await captureJob("job-ai-product.html");
  await scanApplicationForm();
  await confirmAllAndFill();

  // TraceViewer 在设置页（1.5s 轮询刷新）
  await sidePanel.getByRole("button", { name: "设置" }).click();
  await sidePanel.waitForTimeout(2000);
  const traceStorage = (await readStorage(sidePanel, "afa.trace.v1")) as Record<string, {
    events: { stage: string }[];
  }>;
  const storedStages = (traceStorage["afa.trace.v1"]?.events ?? []).map((e) => e.stage).join(",");

  await sidePanel.locator(".trace-viewer summary").click();
  const traceText = await sidePanel.locator(".trace-viewer").textContent();
  const combined = `${storedStages}|${traceText}`;
  // 当前 trace taxonomy 的主链路（capture → route → preview → plan → write）；
  // JOB_PARSE / FORM_SCAN / FILL_COMPLETE 在类型中保留但已无产出点（见 docs/SAFETY_FLOW_AUDIT.md）
  for (const stage of ["JOB_CAPTURE", "PROFILE_ROUTE", "PREVIEW_READY", "FILL_PLAN_CREATE", "FIELD_WRITE"]) {
    expect(combined).toContain(stage);
  }
  // 脱敏：trace 不含完整手机号/身份证
  expect(combined).not.toContain("13800001234");
  expect(combined).not.toContain("110101199001011234");
});

// ---------- Stage 3：Fact-grounded Variant Generator（Scenario K-O）----------

/** 打开 Profile 页并展开项目经历的变体块（fixture：internships 1 条 + projects 1 条） */
async function openProjectVariants(): Promise<void> {
  await sidePanel.locator(".tabbar-item", { hasText: "资料" }).click();
  // 展开外层「项目经历」details
  await sidePanel.getByText(/项目经历（\d+）/).click();
  // 展开项目条目内部的「岗位方向表达」details（DOM 序 nth(1)：nth(0)=实习、nth(1)=项目）
  const summaries = sidePanel.locator(".pe-variants summary");
  await summaries.first().waitFor({ state: "attached", timeout: 10000 });
  await summaries.nth(1).click();
  // 项目经历第一个变体的生成按钮（全局序 6：实习 6 个方向在前）
  await sidePanel.locator(".pe-generate-btn").nth(6).waitFor({ state: "visible", timeout: 8000 });
}

/** 清空项目 variants（K-O 从空开始，区分保存值与 fixture 初值） */
async function clearProjectVariants(): Promise<void> {
  await sidePanel.evaluate(() => {
    return chrome.storage.local.get('afa.profile.v1').then((res) => {
      const profile = res['afa.profile.v1'];
      const keys = ['agent', 'aiApplication', 'aiProduct', 'aiOperation', 'aiSolution', 'aigcMarketing'];
      for (const k of keys) profile.projects[0].variants[k] = '';
      return chrome.storage.local.set({ 'afa.profile.v1': profile });
    });
  });
}

/** 注入 Mock 脚本（一次性） */
async function setMockScript(script: { draft?: string; error?: string } | null): Promise<void> {
  await sidePanel.evaluate((s) => {
    return chrome.storage.local.get("afa.generation.settings.v1").then((res) => {
      const settings = (res["afa.generation.settings.v1"] as Record<string, unknown>) ?? {};
      settings.mockScript = s;
      return chrome.storage.local.set({ "afa.generation.settings.v1": settings });
    });
  }, script);
}

/**
 * 点击「AI 生成」按钮（全局序：实习 6 方向 0-5，项目 6 方向 6-11）
 * 0=实习Agent 6=项目Agent 8=项目AI产品
 */
async function clickGenerateRaw(globalIndex: number): Promise<void> {
  await sidePanel.locator(".pe-generate-btn").nth(globalIndex).click();
}

async function clickGenerate(globalIndex: number): Promise<void> {
  await clickGenerateRaw(globalIndex);
  await sidePanel.locator(".dialog-wide").waitFor({ timeout: 20000 });
}

test("Scenario K: AI 产品岗位 → 生成 → validation pass → 保存 → 刷新后持久化", async () => {
  await clearProjectVariants();
  await captureJob("job-ai-product.html");
  await openProjectVariants();
  await clickGenerate(8); // 项目 AI 产品方向

  // Review UI：验证状态 pass + 使用事实展示
  await expect(sidePanel.locator(".val-badge", { hasText: "所有表达均有事实支持" })).toBeVisible();
  await expect(sidePanel.locator(".review-list").first()).toContainText("✓");

  const saveBtn = sidePanel.locator(".dialog .primary", { hasText: "保存为 AI 产品 Variant" });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await sidePanel.locator(".dialog-wide").waitFor({ state: "detached", timeout: 10000 });

  // 刷新 Side Panel → variant 持久化
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  const savedVariant = profileRaw["afa.profile.v1"].projects[0].variants.aiProduct;
  expect(savedVariant.length).toBeGreaterThan(10);
  expect(savedVariant).toContain("。");
});

test("Scenario L: Mock 返回「带领 10 人团队」→ validation fail → 保存禁用", async () => {
  await clearProjectVariants();
  await setMockScript({ draft: "带领 10 人团队完成系统交付，降低成本 70%。" });
  await clearProjectVariants();
  await captureJob("job-ai-product.html");
  await openProjectVariants();
  await clickGenerate(8);

  // Validator fail：10 人 / 70% / 带领 均不在事实中
  await expect(sidePanel.locator(".val-badge", { hasText: "禁止保存" })).toBeVisible();
  await expect(sidePanel.locator(".dialog .primary", { hasText: "保存为" })).toBeDisabled();

  // 原 variant 未被写入
  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  expect(profileRaw["afa.profile.v1"].projects[0].variants.aiProduct).toBe("");
});

test("Scenario M: pass 后手动追加不存在数字 → 验证失效 → 重验 fail → 禁止保存", async () => {
  await clearProjectVariants();
  await captureJob("job-ai-product.html");
  await openProjectVariants();
  await clickGenerate(8);

  const saveBtn = sidePanel.locator(".dialog .primary", { hasText: "保存为" });
  await expect(saveBtn).toBeEnabled();

  // 手动编辑：追加不存在的事实 → 验证失效
  await sidePanel.locator(".diff-textarea").fill("已通过验证的内容。提升收入 200%。");
  await expect(sidePanel.getByText("内容已修改，验证已失效")).toBeVisible();
  await expect(saveBtn).toBeDisabled();

  // 重新验证 → unsupported → 仍禁止保存
  await sidePanel.getByRole("button", { name: "重新验证" }).click();
  await expect(sidePanel.locator(".val-badge", { hasText: "禁止保存" })).toBeVisible();
  await expect(saveBtn).toBeDisabled();
});

test("Scenario N: Provider 抛错 → UI 显示失败 → 原 Variant 不变", async () => {
  await clearProjectVariants();
  await setMockScript({ error: "PROVIDER_UNAVAILABLE" });
  await clearProjectVariants();
  await captureJob("job-ai-product.html");
  await openProjectVariants();

  await clickGenerateRaw(8);
  await expect(sidePanel.locator(".banner-error", { hasText: "PROVIDER_UNAVAILABLE" })).toBeVisible({ timeout: 20000 });
  await expect(sidePanel.locator(".dialog-wide")).toHaveCount(0); // 无 Review 弹窗

  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  expect(profileRaw["afa.profile.v1"].projects[0].variants.aiProduct).toBe("");
});

test("Scenario O: JD 要求 LangChain 但事实没有 → 生成结果不得写入 LangChain", async () => {
  await clearProjectVariants();
  await captureJob("job-agent.html"); // agent JD 含 LangChain
  await openProjectVariants();
  await clickGenerate(6); // 项目 Agent 方向

  await expect(sidePanel.locator(".val-badge", { hasText: "所有表达均有事实支持" })).toBeVisible();
  const draftText = await sidePanel.locator(".diff-textarea").inputValue();
  expect(draftText).not.toContain("LangChain");

  const saveBtn = sidePanel.locator(".dialog .primary", { hasText: "保存为" });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await sidePanel.locator(".dialog-wide").waitFor({ state: "detached", timeout: 10000 });

  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  expect(profileRaw["afa.profile.v1"].projects[0].variants.agent).not.toContain("LangChain");
});

// ---------- Stage 3.5：Provider Settings E2E（Scenario P-R，不调用真实付费 API）----------

import http from "node:http";

/** 本地 Provider Bridge stub：OpenAI 兼容格式，测试完自动关闭 */
async function startBridgeStub(responseContent: string): Promise<number> {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      model: "bridge-test-model",
      choices: [{ message: { content: responseContent } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  void 0;
  return port;
}

async function openProviderSettings(): Promise<void> {
  await sidePanel.getByRole("button", { name: "设置" }).click();
  // Provider 设置是可折叠 details：先展开 summary
  await sidePanel.locator(".provider-settings summary").click();
  await sidePanel.locator(".provider-settings select").waitFor({ timeout: 8000 });
  // 切换到 openai-compatible 展开 baseUrl/model/key 输入
  await sidePanel.locator(".provider-settings select").selectOption("openai-compatible");
  await sidePanel.locator(".provider-settings input[type=password]").waitFor({ timeout: 8000 });
}

test("Scenario P: 未配置完整 Provider → 生成被 Health Check 拦截（PROVIDER_UNAVAILABLE）", async () => {
  await captureJob("job-ai-product.html");
  // 切到 openai-compatible 但不填 Key → invalid_config
  await openProviderSettings();
  await sidePanel.getByRole("button", { name: "投递" }).click();
  await openProjectVariants();
  await clickGenerateRaw(8);
  await expect(sidePanel.locator(".banner-error", { hasText: "PROVIDER_UNAVAILABLE" })).toBeVisible({ timeout: 20000 });
  await expect(sidePanel.locator(".dialog-wide")).toHaveCount(0);
});

test("Scenario Q: 本地 Provider Bridge → Test Connection 成功（Provider available）", async () => {
  const port = await startBridgeStub("OK");
  await openProviderSettings();
  await sidePanel.locator(".provider-settings input").first().fill(`http://127.0.0.1:${port}`);
  await sidePanel.locator(".provider-settings input").nth(1).fill("bridge-test-model");
  await sidePanel.locator(".provider-settings input[type=password]").fill("test-key-not-real");
  await sidePanel.getByRole("button", { name: /测试连接/ }).click();
  await expect(sidePanel.locator(".ps-health.ok", { hasText: "连接正常" })).toBeVisible({ timeout: 20000 });
});

test("Scenario R: Provider 返回非法 JSON → INVALID_STRUCTURED_OUTPUT → 旧 Variant 不变", async () => {
  const port = await startBridgeStub("这不是 JSON 输出");
  // 配置 provider
  await sidePanel.getByRole("button", { name: "设置" }).click();
  await sidePanel.locator(".provider-settings summary").click();
  await sidePanel.locator(".provider-settings select").waitFor({ timeout: 8000 });
  await sidePanel.locator(".provider-settings select").selectOption("openai-compatible");
  await sidePanel.locator(".provider-settings input").first().fill(`http://127.0.0.1:${port}`);
  await sidePanel.locator(".provider-settings input").nth(1).fill("bridge-test-model");
  await sidePanel.locator(".provider-settings input[type=password]").fill("test-key-not-real");
  await sidePanel.getByRole("button", { name: "投递" }).click();

  await clearProjectVariants();
  await captureJob("job-ai-product.html");
  await openProjectVariants();
  await clickGenerateRaw(8);

  await expect(sidePanel.locator(".banner-error", { hasText: "INVALID_STRUCTURED_OUTPUT" })).toBeVisible({ timeout: 30000 });
  await expect(sidePanel.locator(".dialog-wide")).toHaveCount(0);
  const profileRaw = (await readStorage(sidePanel, "afa.profile.v1")) as Record<string, typeof PROFILE_FIXTURE>;
  expect(profileRaw["afa.profile.v1"].projects[0].variants.aiProduct).toBe("");
});

// ---------- Stage 4：Grounded Answer Engine（Scenario S-Y，Mock Provider）----------

/** 生成某开放题的回答：定位卡片 → 点「AI 生成回答」 */
async function generateOpenAnswer(questionText: string): Promise<void> {
  const card = sidePanel.locator(".field-card", { hasText: questionText });
  await card.locator(".open-answer-block button", { hasText: "AI 生成回答" }).click();
  await card.locator(".open-answer-block .val-badge, .open-answer-block .fallback-warning").first().waitFor({ timeout: 20000 });
}

test("Scenario S: 为什么申请这个岗位 → 生成 → pass → 确认填写 → DOM 写入", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("为什么申请这个岗位");
  const card = sidePanel.locator(".field-card", { hasText: "为什么申请这个岗位" });
  await expect(card.locator(`[data-val="pass"]`)).toBeVisible();
  await expect(card.getByText("申请动机")).toBeVisible();

  await confirmAllAndFill();
  const value = await appPage.locator("#why-role").inputValue();
  expect(value.length).toBeGreaterThan(10);
});

test("Scenario T: 为什么选择我们公司 + 编造公司评价 → Company Guard fail → 禁止填写", async () => {
  await setMockScript({ draft: "贵司是行业领先企业，企业文化优秀。我有相关项目经验。" });
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("为什么选择我们公司");
  const card = sidePanel.locator(".field-card", { hasText: "为什么选择我们公司" });
  await expect(card.locator(`[data-val="fail"]`)).toBeVisible();
  await expect(card.getByText(/缺少事实支持/)).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#why-company")).toHaveValue("");
});

test("Scenario U: 职业规划 + careerPreferences 为空 → INSUFFICIENT_CONTEXT", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("请描述你的职业规划");
  const card = sidePanel.locator(".field-card", { hasText: "请描述你的职业规划" });
  await expect(card.getByText(/信息不足/)).toBeVisible();
  await expect(card.getByText("career_goal")).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#career-plan")).toHaveValue("");
});

test("Scenario V: 代表项目 → 使用推荐第一名经历的事实 → DOM 写入", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("请介绍你最有代表性的项目");
  const card = sidePanel.locator(".field-card", { hasText: "请介绍你最有代表性的项目" });
  await expect(card.locator(`[data-val="pass"]`)).toBeVisible();
  const answer = await card.locator(".diff-textarea").inputValue();
  // Mock 拼接 selected facts——推荐第一名经历的事实必然出现（具体哪段经历由 routing 决定）
  expect(answer.length).toBeGreaterThan(10);

  await confirmAllAndFill();
  await expect(appPage.locator("#representative")).toHaveValue(/。/);
});

test("Scenario W: maxlength=200 + Mock 超长 → REVIEW → 未处理不写入且不截断", async () => {
  await setMockScript({ draft: "完成需求梳理与流程拆解，日处理量 5000-6000 条，准确率稳定 90% 以上。".repeat(6) });
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("其他补充说明");
  const card = sidePanel.locator(".field-card", { hasText: "其他补充说明" });
  await expect(card.getByText(/（超长，禁止截断）/)).toBeVisible();
  await expect(card.locator(`[data-val="review"]`).or(card.locator(`[data-val="fail"]`))).toBeVisible();

  // FAIL 状态无确认 checkbox（不进入确认流程），直接批量确认其余字段并填写
  await sidePanel.getByRole("button", { name: /全部确认/ }).click({ timeout: 3000 }).catch(() => {}); // 无待确认项时按钮不渲染（可选项）
  await ensureFilled(sidePanel);

  await expect(appPage.locator("#extra-info")).toHaveValue("");
  const display = await card.locator(".diff-textarea").inputValue();
  expect(display.length).toBeGreaterThan(200);
});

test("Scenario X: 编辑已验证 Answer → 失效 → 重新验证 → 通过后写入", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("为什么申请这个岗位");
  const card = sidePanel.locator(".field-card", { hasText: "为什么申请这个岗位" });
  await expect(card.locator(`[data-val="pass"]`)).toBeVisible();

  await card.locator(".diff-textarea").fill("基于示例流程自动化项目经验，希望申请该岗位。带领 5 人团队完成交付。");
  await expect(card.getByText("内容已修改，验证已失效")).toBeVisible();

  await card.getByRole("button", { name: "重新验证" }).click();
  await expect(card.locator(`[data-val="fail"]`)).toBeVisible();

  await card.locator(".diff-textarea").fill("负责测试业务流程自动化，希望申请该岗位。");
  await card.getByRole("button", { name: "重新验证" }).click();
  await expect(card.locator(`[data-val="pass"]`)).toBeVisible();

  await confirmAllAndFill();
  await expect(appPage.locator("#why-role")).toHaveValue(/负责测试业务流程自动化/);
});

test("Scenario Y: 同一 Job 刷新页面 → Session 恢复已生成 Answer", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  await generateOpenAnswer("为什么申请这个岗位");
  const before = await sidePanel.locator(".field-card", { hasText: "为什么申请这个岗位" }).locator(".diff-textarea").inputValue();
  expect(before.length).toBeGreaterThan(10);

  await appPage.reload();
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).click();
  await revealPreview(sidePanel);
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  const card = sidePanel.locator(".field-card", { hasText: "为什么申请这个岗位" });
  const restored = await card.locator(".diff-textarea").inputValue();
  expect(restored).toBe(before);
  await expect(card.locator(`[data-val="pass"]`)).toBeVisible();
});
