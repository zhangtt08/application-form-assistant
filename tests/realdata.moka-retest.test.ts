import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RuleBasedJobParser } from "../src/job/jobParser";
import type { RawJobPage } from "../src/job/schema";

/**
 * Issue #002 Moka 真机回放（Real-site Replay）：
 * 原料 JSON 由 scripts/issue002-retest.mjs 在真实 Moka 页面
 * （app.mokahr.com/campus_apply/shiyuehr/72055 → 载具策划 - 3C（望月）-2027届校招 详情）
 * 用与 src/content/jobCapture.ts 完全一致的选择器采集落盘。
 * 本测试把真机原料喂给正式 RuleBasedJobParser —— 数据是真实的，解析是发布的代码。
 * JSON 不存在（如 CI 无真机数据）→ 跳过，不伪造。
 */

const RAW_PATH = resolve(__dirname, "../real-validation-results/sessions/2026-09-24-moka-retest-raw.json");

describe.skipIf(!existsSync(RAW_PATH))("Issue #002 Moka 真机回放", () => {
  const payload = JSON.parse(readFileSync(RAW_PATH, "utf-8")) as { capturedAt: string; raw: RawJobPage };
  const rawJobPage = payload.raw;

  it("真机原料完整性：职位名信号已采集（detail node 首位）", () => {
    expect(rawJobPage.jobDetailTitles?.[0]).toContain("载具策划");
    expect(rawJobPage.h1Texts).toEqual([]); // 该租户页无 h1（选择器升级的动因）
  });

  it("解析：position = 完整职位标题，source = job_detail（非 title fallback）", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(rawJobPage);
    expect(job.position).toBe("载具策划 - 3C（望月）-2027届校招");
    expect(job.position).not.toBe("未识别岗位");
    expect(job.positionExtraction?.source).toBe("job_detail");
    expect(job.positionExtraction?.confidence).toBe("high");
  });

  it("解析：company 来自真机版权行，完整不截断，ATS 品牌不冒充", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(rawJobPage);
    expect(job.company).toBe("广州诗悦网络科技有限公司");
    expect(job.company.toLowerCase()).not.toContain("moka");
  });

  it("解析：Profile Pack 不误路由——载具策划岗不得因「策划」进 AI 产品/AIGC，Pack 层无推荐", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(rawJobPage);
    const { matchPacks } = await import("../src/profile/pack/matcher");
    const { buildDefaultPacks } = await import("../src/profile/pack/defaultPacks");
    const result = matchPacks(buildDefaultPacks("2026-09-24"), {
      position: job.position,
      jd: job.jd,
      keywords: job.keywords,
    });
    // 用户规格：载具策划不属于任何内置方向 → confidence=low / 无明确推荐；禁止因「策划」进 AI 产品 / AIGC
    expect(result.recommendedProfilePackId).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.matches.every((m) => m.score <= 0)).toBe(true);
  });

  it("解析：Router 不高置信误路由——若进 AI 产品/AIGC 必须是 low confidence（UI 保持用户手选 Pack）", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(rawJobPage);
    const { routeJob } = await import("../src/profile/profileRouter");
    const { defaultProfile } = await import("../src/profile/defaultProfile");
    const selection = routeJob(job, defaultProfile);
    // 真机 JD 含「转化/落地/迭代」等通用商务词 → 弱信号允许，但禁止高置信
    if (selection.primaryProfile === "aiProduct" || selection.primaryProfile === "aigcMarketing") {
      expect(selection.routingConfidence).toBe("low");
    } else {
      // aiOperation/general 等其他方向：真机 JD 有真实关键词命中（转化→1.5），允许 low/medium，但不得 high
      expect(selection.routingConfidence).not.toBe("high");
    }
  });
});
