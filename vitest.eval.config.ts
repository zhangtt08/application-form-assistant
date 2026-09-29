import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** Eval Runner 配置：npm run eval:generation 专用（与 npm test 的 tests/** 完全隔离） */
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["evaluation/eval.run.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
