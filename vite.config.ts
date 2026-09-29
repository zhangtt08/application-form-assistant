import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * 三段构建（按 --mode 切换），产出统一的 dist/ 供浏览器 Load unpacked：
 *  - sidepanel:  React SPA (sidepanel.html + sidepanel.js + sidepanel.css)
 *  - content:    content script，IIFE 单文件 content.js（manifest 静态/动态注入）
 *  - background: MV3 service worker，IIFE 单文件 background.js
 * 不使用 CRXJS 插件，规避其版本兼容问题；IIFE 保证 content script 无 ESM 依赖。
 */
export default defineConfig(({ mode }) => {
  if (mode === "sidepanel") {
    return {
      plugins: [react()],
      build: {
        outDir: resolve(root, "dist"),
        emptyOutDir: true, // 三段中第一段清空 dist
        rollupOptions: {
          input: { sidepanel: resolve(root, "sidepanel.html") },
          output: {
            entryFileNames: "sidepanel.js",
            chunkFileNames: "chunks/[name].js",
            assetFileNames: "[name].[ext]",
          },
        },
      },
    };
  }

  if (mode === "content") {
    return {
      build: {
        outDir: resolve(root, "dist"),
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(root, "src/content/index.ts"),
          output: {
            format: "iife",
            entryFileNames: "content.js",
          },
        },
      },
    };
  }

  // mode === "background"
  return {
    build: {
      outDir: resolve(root, "dist"),
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(root, "src/background/index.ts"),
        output: {
          format: "iife",
          entryFileNames: "background.js",
        },
      },
    },
  };
});
