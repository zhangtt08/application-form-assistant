// Stage 6.5 E2E 修补 pass 2
import fs from "node:fs";

let s = fs.readFileSync("e2e/scenarios.spec.ts", "utf8");

// R（内联 provider 配置）：资料 → 设置；← 返回扫描 → 填写
s = s.split(`await sidePanel.getByRole("button", { name: "资料" }).click();`).join(`await sidePanel.getByRole("button", { name: "设置" }).click();`);
s = s.split(`await sidePanel.getByText("← 返回扫描").click();`).join(`await sidePanel.getByRole("button", { name: "填写" }).click();`);
s = s.split(`await sidePanel.getByText('← 返回扫描').click();`).join(`await sidePanel.getByRole("button", { name: "填写" }).click();`);

// 刷新恢复测试重写（pack 语义：切换 pack → 刷新 → pack 恢复）
const rfOld = s.indexOf(`test("刷新恢复:`);
const rfEnd = s.indexOf(`// ---------- Dev Trace Viewer`);
const rfNew = `test("刷新恢复: 表单页与 Side Panel 刷新后 Active Job / 资料库恢复", async () => {
  await captureJob("job-ai-product.html");
  const appPage = await scanApplicationForm();

  // 切换资料库到 Agent（手动选择持久化）
  await sidePanel.getByRole("button", { name: "切换", exact: true }).click();
  await sidePanel.locator(".pack-card", { hasText: "AI 应用 / Agent" }).getByRole("button", { name: "使用" }).click();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });

  // 刷新表单页 + Side Panel
  await appPage.reload();
  await sidePanel.reload();
  await sidePanel.waitForSelector("text=扫描当前页面");

  await appPage.bringToFront();
  await sidePanel.getByRole("button", { name: "扫描当前页面" }).click();
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });

  // Active Job 恢复 + active pack 恢复（仍是 Agent）
  await expect(sidePanel.getByText("星辰科技有限公司")).toBeVisible();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });
  await confirmAllAndFill();
  await expect(appPage.locator("#project-desc")).toHaveValue(/E2E标记-AGENT/);
});

`;
if (rfOld > 0 && rfEnd > rfOld) s = s.slice(0, rfOld) + rfNew + s.slice(rfEnd);

fs.writeFileSync("e2e/scenarios.spec.ts", s);

// 首页岗位行：activeJob 时显示 查看+更新（Z2/Z11 二次捕获需要）
let a = fs.readFileSync("src/sidepanel/App.tsx", "utf8");
a = a.replace(
  `          {activeJob ? (
            <button className="btn-sm" onClick={() => setTab("jobs")}>查看</button>
          ) : (
            <button className="btn-sm" onClick={handleCaptureJob} disabled={capturing}>
              {capturing ? "捕获中…" : "捕获当前岗位"}
            </button>
          )}`,
  `          {activeJob ? (
            <>
              <button className="btn-sm" onClick={() => setTab("jobs")}>查看</button>
              <button className="btn-sm" onClick={handleCaptureJob} disabled={capturing}>
                {capturing ? "捕获中…" : "更新"}
              </button>
            </>
          ) : (
            <button className="btn-sm" onClick={handleCaptureJob} disabled={capturing}>
              {capturing ? "捕获中…" : "捕获当前岗位"}
            </button>
          )}`,
);
fs.writeFileSync("src/sidepanel/App.tsx", a);

// Z3：等「当前岗位」而不是「捕获当前岗位」
let z = fs.readFileSync("e2e/stage5-z1-z6.spec.ts", "utf8");
z = z.replace(`  await sidePanel.getByText("捕获当前岗位").waitFor({ timeout: 8000 });
  await sidePanel.getByText("当前岗位", { exact: true }).waitFor({ timeout: 8000 });`, `  await sidePanel.getByText("当前岗位", { exact: true }).waitFor({ timeout: 8000 });`);
z = z.replace(`  await sidePanel.getByText("捕获当前岗位").waitFor({ timeout: 8000 });`, `  await sidePanel.getByText("当前岗位", { exact: true }).waitFor({ timeout: 8000 });`);
fs.writeFileSync("e2e/stage5-z1-z6.spec.ts", z);

console.log("pass2 done");
