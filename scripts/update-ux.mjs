// UX4/UX5 重写：storage 预置 Active Job（去除捕获时序依赖）
import fs from "node:fs";

let s = fs.readFileSync("e2e/compat/ux-profilepack.spec.ts", "utf8");

const presetJob = `  await sidePanel.evaluate(() =>
    chrome.storage.local.get("afa.jobs.v1").then((res) => {
      const jobs = (res["afa.jobs.v1"] ?? { jobs: [], activeJobId: null, profileOverride: null });
      const job = { id: "job-agent-test", company: "智元智能", position: "AI Agent 应用开发工程师", location: "", jd: "负责 Agent 与 RAG 系统开发，使用 Python 构建 Workflow 自动化。", sourceUrl: "https://x.com/1", pageTitle: "", createdAt: "2026-09-24T00:00:00Z", jobType: "agent", keywords: ["Agent", "RAG"], source: "captured" };
      jobs.jobs = [job];
      jobs.activeJobId = "job-agent-test";
      return chrome.storage.local.set({ "afa.jobs.v1": jobs });
    }),
  );
  await sidePanel.getByRole("button", { name: "资料库" }).click();
  await sidePanel.locator(".pack-card", { hasText: "AI 产品" }).first().getByRole("button", { name: "使用" }).click();
  await sidePanel.locator(".bottom-nav .bn-item", { hasText: "填写" }).click();
  const formPage = await context.newPage();
  await formPage.goto(\`\${FIXTURE_BASE}/application-form.html\`);
  await formPage.bringToFront();
  await sidePanel.getByRole("button", { name: "扫描当前页面" }).click();
  await sidePanel.locator(".field-card").first().waitFor({ timeout: 15000 });`;

const ux4Start = s.indexOf(`test("UX4:`);
const ux4End = s.indexOf(`test("UX5:`);
const ux4New = `test("UX4: Agent JD 推荐 Agent Pack → 用户保持当前（不强切）", async () => {
${presetJob}
  await expect(sidePanel.getByText(/这个岗位更适合「AI 应用 \\/ Agent」资料库/)).toBeVisible({ timeout: 10000 });
  await sidePanel.getByRole("button", { name: "保持当前" }).click();
  await expect(sidePanel.getByText(/这个岗位更适合/)).toHaveCount(0);
  await expect(sidePanel.locator(".home-card", { hasText: "当前资料" }).getByText("AI 产品")).toBeVisible();
});

`;
s = s.slice(0, ux4Start) + ux4New + s.slice(ux4End);

const ux5Start = s.indexOf(`test("UX5:`);
const ux5End = s.indexOf(`test("UX8:`);
const ux5New = `test("UX5: 同场景点击切换 → effective pack 变 Agent", async () => {
${presetJob}
  await sidePanel.getByRole("button", { name: "切换", exact: true }).click();
  await expect(sidePanel.locator(".source-badge", { hasText: "Agent / AI 应用开发版本" }).first()).toBeVisible({ timeout: 15000 });
});

`;
s = s.slice(0, ux5Start) + ux5New + s.slice(ux5End);

fs.writeFileSync("e2e/compat/ux-profilepack.spec.ts", s);
console.log("ux4/5 rewritten OK");
