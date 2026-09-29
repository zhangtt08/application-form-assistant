// Stage 6.5 E2E 更新脚本：旧 locator → 新 UI（一次性运行）
import fs from "node:fs";

let s = fs.readFileSync("e2e/scenarios.spec.ts", "utf8");

// 1) openProviderSettings：资料 tab → 底部导航「设置」
s = s.replace(
  `  await sidePanel.getByRole("button", { name: "资料" }).click();
  await sidePanel.getByText("AI Provider 设置（真实模型）").click();`,
  `  await sidePanel.getByRole("button", { name: "设置" }).click();
  await sidePanel.getByText("AI Provider 设置（真实模型）").click();`,
);

// 2) openProjectVariants：资料库 → 管理基础资料
s = s.replace(
  `  await sidePanel.getByRole("button", { name: "资料" }).click();
  // 展开外层「项目经历」details`,
  `  await sidePanel.getByRole("button", { name: "资料库" }).click();
  await sidePanel.getByRole("button", { name: "管理基础资料" }).click();
  // 展开外层「项目经历」details`,
);

// 3) Dev Trace：dev toggle 移到设置页
s = s.replace(
  `  await sidePanel.locator(".dev-toggle input").check();`,
  `  await sidePanel.getByRole("button", { name: "设置" }).click();
  await sidePanel.locator(".dev-toggle input").check();
  await sidePanel.getByRole("button", { name: "填写" }).click();`,
);

// 4) Scenario C 重写（资料库语义，spec 场景 A）
const cOld = s.indexOf(`test("Scenario C:`);
const cEnd = s.indexOf(`// ---------- Scenario D`);
const cNew = `test("Scenario C: 无 JD → 资料库选择 AIGC/营销 → 扫描 → AIGC Variant", async () => {
  const appPage = await scanApplicationForm();
  // 未关联岗位 = 次级状态（非警告）
  await expect(sidePanel.getByText("未关联")).toBeVisible();

  // 资料库切换（无 AI / 无 Job 即可完成）
  await sidePanel.getByRole("button", { name: "切换", exact: true }).click();
  await sidePanel.locator(".pack-card", { hasText: "AIGC / AI 营销" }).getByRole("button", { name: "使用" }).click();
  await expect(sidePanel.locator(".source-badge", { hasText: "AIGC / 营销 / 创意版本" }).first()).toBeVisible({ timeout: 15000 });
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AIGC/});
});

`;
s = s.slice(0, cOld) + cNew.replace("})", "});") + s.slice(cEnd);

// 5) Scenario D 重写（pack 切换）
const dOld = s.indexOf(`test("Scenario D:`);
const dEnd = s.indexOf(`// ---------- Scenario E`);
const dNew = `test("Scenario D: AI 产品岗位 → 切换 Agent 资料库 → 内容切换", async () => {
  await captureJob("job-ai-product.html");
  await scanApplicationForm();
  const fieldCountBefore = await sidePanel.locator(".field-card").count();

  await sidePanel.getByRole("button", { name: "切换", exact: true }).click();
  await sidePanel.locator(".pack-card", { hasText: "AI 应用 / Agent" }).getByRole("button", { name: "使用" }).click();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });

  const fieldCountAfter = await sidePanel.locator(".field-card").count();
  expect(fieldCountAfter).toBe(fieldCountBefore);

  await confirmAllAndFill();
  const appPage = context.pages().find((p) => p.url().includes("application-form"))!;
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AGENT/});
});

`;
s = s.slice(0, dOld) + dNew.replace("})", "});") + s.slice(dEnd);

// 6) Scenario I 重写（matcher low confidence）
const iOld = s.indexOf(`test("Scenario I:`);
const iEnd = s.indexOf(`// ---------- Scenario J`);
const iNew = `test("Scenario I: 模糊 JD → matcher low confidence → 方向不明确提示", async () => {
  await captureJob("job-ambiguous.html");
  await scanApplicationForm();
  // Pack Matcher 低置信：不自动强切、不显示推荐 banner（不假装确定）
  await expect(sidePanel.locator(".home-card", { hasText: "当前资料" })).toBeVisible();
  await expect(sidePanel.getByText("这个岗位更适合")).toHaveCount(0);
});

`;
s = s.slice(0, iOld) + iNew + s.slice(iEnd);

fs.writeFileSync("e2e/scenarios.spec.ts", s);
console.log("scenarios updated OK");
