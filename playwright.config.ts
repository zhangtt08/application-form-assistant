import { defineConfig } from "@playwright/test";

/**
 * Browser E2E（spec Stage 2.5 第二十一/二十二章）：
 * - 真实 Chromium Persistent Context + dist/ 扩展（不 mock 核心运行环境）
 * - fixtures 由本地静态服务器提供（webServer）
 * - 失败保留 screenshot / trace / video（Failure Artifact）
 * - npm run test:e2e 运行；npm test 仍只跑 unit/integration
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  workers: 1, // 每个测试启动独立浏览器，串行避免资源竞争
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  webServer: {
    command: "npx http-server tests/e2e/fixtures -p 4198 -c-1 --silent",
    port: 4198,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
