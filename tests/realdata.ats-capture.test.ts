import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RuleBasedJobParser } from "../src/job/jobParser";
import type { RawJobPage } from "../src/job/schema";

/**
 * Issue #009 真机回放（英文 ATS）：
 * 原料由 scripts/jd-raw-dump.mjs 在真实职位页采集落盘（与 src/content/jobCapture.ts 同一套选择器）。
 * 这一组用例钉住的是「岗位识别」第一步的两个真机缺陷：
 *  1. og:title 被当成公司名 → 公司栏印着职位名，而职位又因「公司名不能当职位」的互斥规则被自己挤掉；
 *  2. 英文职位名里的半角逗号被当句子标点 → 整个职位被判「未识别岗位」。
 * JSON 不存在则跳过，不伪造。
 */

const dir = resolve(__dirname, "../real-validation-results/sessions");
const load = (file: string): RawJobPage | null => {
  const p = resolve(dir, file);
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf-8")) as { raw: RawJobPage }).raw;
};

const lever = load("2026-09-30-lever-raw.json");
const greenhouse = load("2026-09-30-greenhouse-raw.json");

describe.skipIf(!lever)("Lever（jobs.lever.co）真机回放", () => {
  it("公司=Spotify（JSON-LD hiringOrganization），职位=Android Engineer - Experience", async () => {
    const job = await new RuleBasedJobParser().parse(lever as RawJobPage);
    expect(job.company).toBe("Spotify");
    expect(job.position).toBe("Android Engineer - Experience");
    expect(job.position).not.toBe("未识别岗位");
  });
});

describe.skipIf(!greenhouse)("Greenhouse（job-boards）真机回放", () => {
  it("带半角逗号的 h1 职位名成立，公司取招聘方自己写的 logo alt", async () => {
    const job = await new RuleBasedJobParser().parse(greenhouse as RawJobPage);
    expect(job.position).toBe("Software Engineer, Data Platform");
    expect(job.company).toBe("General Matter");
  });

  it("公司名与职位名不得互相顶替（og:title 当公司名的原始症状）", async () => {
    const job = await new RuleBasedJobParser().parse(greenhouse as RawJobPage);
    expect(job.company).not.toBe(job.position);
    expect(job.company).not.toMatch(/Engineer|Manager|Scientist/);
  });
});
