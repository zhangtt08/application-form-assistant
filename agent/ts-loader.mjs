/**
 * Node ESM 解析钩子：让 `agent/` 能直接 import 扩展的 `.ts` 源文件。
 *
 * 为什么需要它：Vite/vitest 会做扩展名补全，Node 原生的 ESM 解析器不会。
 * `src/` 里的模块互相 import 时写的是 `"../rules/fieldAliases"`（无扩展名），
 * Node 24 的类型擦除能读 `.ts`，但读不到没有扩展名的说明符。
 *
 * 这个钩子只做一件事：把解析不了的相对说明符按 `.ts → .tsx → /index.ts` 补全。
 * **不做任何转译、不做任何逻辑替换** —— 加载进来的就是扩展跑的那同一份源码。
 * 这样 Agent 与扩展共用同一套判断，不会出现「两边各写一份 matcher，给出两个置信度」。
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CANDIDATE_SUFFIXES = [".ts", ".tsx", "", "/index.ts", "/index.tsx"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const base = path.resolve(parentDir, specifier);
    // 已经能直接解析（含显式 .ts）→ 交回默认逻辑，Node 自己会擦类型
    if (isFile(base)) return next(specifier, context);
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (existsSync(candidate) && isFile(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(specifier, context);
}
