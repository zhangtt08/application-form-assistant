import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RuleBasedJobParser } from "../src/job/jobParser";
import type { RawJobPage } from "../src/job/schema";

/**
 * 国内主流招聘官网真机回放（2026-09-30，coverage 任务）：
 * 原料由 scripts/jd-raw-dump.mjs 在真实页面用与 src/content/jobCapture.ts 一致的选择器采集落盘，
 * 本测试把真机原料喂给正式 RuleBasedJobParser —— 数据是真实的，解析是发布的代码。
 * JSON 不存在（如 CI 无真机数据）→ 跳过，不伪造。
 */

const dir = resolve(__dirname, "../real-validation-results/sessions");
const loadRaw = (file: string): RawJobPage | null => {
  const p = resolve(dir, file);
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf-8")) as { raw: RawJobPage }).raw;
};

const bytedance = loadRaw("2026-09-30-bytedance-raw.json");
const xiaohongshu = loadRaw("2026-09-30-xiaohongshu-list-raw.json");
const ctrip = loadRaw("2026-09-30-ctrip-home-raw.json");

describe.skipIf(!bytedance)("字节跳动校招真机回放", () => {
  it("公司名取 title 末段「字节跳动」，不是团队段「移动OS」", async () => {
    const job = await new RuleBasedJobParser().parse(bytedance as RawJobPage);
    expect(job.company).toBe("字节跳动");
    expect(job.position).toBe("Android开发工程师 - 移动OS");
    expect(job.location).toBe("北京");
  });

  it("公司名不得是岗位/团队字符串的片段（Unknown > Wrong）", async () => {
    const job = await new RuleBasedJobParser().parse(bytedance as RawJobPage);
    if (job.company) expect(job.position.includes(job.company)).toBe(false);
  });
});

describe.skipIf(!xiaohongshu)("小红书校招真机回放", () => {
  it("[class*=company] 筛选条（全部/算法/北京市）绝不能当公司名", async () => {
    const job = await new RuleBasedJobParser().parse(xiaohongshu as RawJobPage);
    expect(["全部", "算法", "研发", "非技术", "北京市", "上海市", "武汉市"]).not.toContain(job.company);
    expect(job.company).toBe("小红书");
  });
});

describe.skipIf(!ctrip)("携程招聘官网真机回放", () => {
  it("「携程集团招聘官网」→ 携程集团，且无岗位信号时不编造岗位", async () => {
    const job = await new RuleBasedJobParser().parse(ctrip as RawJobPage);
    expect(job.company).toBe("携程集团");
    expect(job.position).toBe("未识别岗位");
  });
});
