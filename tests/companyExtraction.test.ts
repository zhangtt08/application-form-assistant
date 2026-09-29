import { beforeEach, describe, expect, it } from "vitest";
import {
  extractCompanyWithMetadata,
  isAtsDomain,
  normalizeCompanyName,
  KNOWN_ATS_DOMAINS,
} from "../src/job/companyExtraction";
import { RuleBasedJobParser } from "../src/job/jobParser";
import { findDuplicate } from "../src/workspace/jobRepository";
import type { RawJobPage } from "../src/job/schema";
import type { JobRecord } from "../src/workspace/types";

function raw(partial: Partial<RawJobPage> & { url: string }): RawJobPage {
  return {
    pageTitle: "",
    metaTitle: "",
    metaCompany: "",
    h1Texts: [],
    bodyText: "",
    ...partial,
  };
}

beforeEach(() => {
  // 确保 storage 后端为内存态（jobRepository 测试）
});

// ---------- Case A：title 无公司名，header 品牌命中（姚记真实场景） ----------

describe("Issue #001 Case A — header brand", () => {
  it("title=游戏测试工程师-27届秋招 + header 姚记科技 → company=姚记科技", () => {
    const r = extractCompanyWithMetadata(
      raw({
        url: "https://zhaopin.yaoji.cn/job/abc",
        pageTitle: "游戏测试工程师-27届秋招",
        metaTitle: "游戏测试工程师-27届秋招",
        brandTexts: ["header|姚记科技", "header|全部职位"],
        logoAlts: ["姚记科技招聘"],
      }),
    );
    expect(r.company).toBe("姚记科技");
    expect(r.confidence).toBe("high");
    expect(["logo_alt", "header"]).toContain(r.source);
  });
});

// ---------- Case B：logo alt 清洗 ----------

describe("Issue #001 Case B — logo alt", () => {
  it('alt="XX科技招聘" → company=XX科技', () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-co.com/job/1", logoAlts: ["XX科技招聘"], brandTexts: ["header|高级产品经理"] }),
    );
    expect(r.company).toBe("XX科技");
    expect(r.source).toBe("logo_alt");
  });
});

// ---------- Case C：招聘官网后缀 normalize ----------

describe("Issue #001 Case C — normalize 招聘官网", () => {
  it("XX科技招聘官网 → XX科技", () => {
    expect(normalizeCompanyName("XX科技招聘官网")).toBe("XX科技");
    expect(normalizeCompanyName("XX集团校园招聘")).toBe("XX集团");
    expect(normalizeCompanyName("姚记科技招聘官网")).toBe("姚记科技");
  });

  it("页面存在「XX科技招聘官网」文本 → company=XX科技", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://careers.xx-tech.cn/job/2", brandTexts: ["header|XX科技招聘官网"] }),
    );
    expect(r.company).toBe("XX科技");
  });
});

// ---------- Case D：domain fallback（低置信） ----------

describe("Issue #001 Case D — domain fallback", () => {
  it("无可信节点 + jobs.example-company.com → company=example-company（low confidence）", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-company.com/job/3", pageTitle: "高级产品经理" }),
    );
    expect(r.company).toBe("example-company");
    expect(r.source).toBe("domain");
    expect(r.confidence).toBe("low");
  });
});

// ---------- Case E：通用 ATS Domain 禁止 ----------

describe("Issue #001 Case E — Moka domain blocked", () => {
  it("xxx.mokahr.com → 不产出任何 company（更不能是 Moka/mokahr）", () => {
    const r = extractCompanyWithMetadata(raw({ url: "https://xxx.mokahr.com/campus_apply/xx/1" }));
    expect(r.company).toBe("");
    expect(r.source).toBeNull();
  });

  it("isAtsDomain 识别所有已知 ATS", () => {
    for (const ats of KNOWN_ATS_DOMAINS) {
      expect(isAtsDomain(`app.${ats}`)).toBe(ats);
      expect(isAtsDomain(ats)).toBe(ats);
    }
    expect(isAtsDomain("zhaopin.yaoji.cn")).toBeNull();
    expect(isAtsDomain("job-boards.greenhouse.io")).toBe("greenhouse.io");
  });
});

// ---------- Case F：Greenhouse slug 禁止 ----------

describe("Issue #001 Case F — Greenhouse domain blocked", () => {
  it("boards.greenhouse.io/company-slug → 不产出（无 slug→company 规则前禁止使用）", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://boards.greenhouse.io/company-slug/jobs/4963703004", pageTitle: "Staff Software Engineer" }),
    );
    expect(r.company).toBe("");
    expect(r.company.toLowerCase()).not.toContain("greenhouse");
  });
});

// ---------- Pipeline 优先级与保护 ----------

describe("Company Extraction Pipeline", () => {
  it("JSON-LD hiringOrganization 最高优先", () => {
    const r = extractCompanyWithMetadata(
      raw({
        url: "https://zhaopin.yaoji.cn/job/1",
        structuredData: [JSON.stringify({ "@type": "JobPosting", hiringOrganization: { name: "姚记科技" } })],
        brandTexts: ["header|某其他公司"],
        pageTitle: "游戏测试工程师",
      }),
    );
    expect(r.company).toBe("姚记科技");
    expect(r.source).toBe("structured_data");
    expect(r.confidence).toBe("high");
  });

  it("og:site_name → meta 来源 medium-high", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-co.com/job/5", metaSiteName: "示例科技" }),
    );
    expect(r.company).toBe("示例科技");
    expect(r.source).toBe("meta");
  });

  it("title fallback（旧逻辑兼容）：AI产品运营-字节跳动招聘 → 字节跳动", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://www.example.com/job/6", metaTitle: "AI产品运营-字节跳动招聘" }),
    );
    expect(r.company).toBe("字节跳动");
  });

  it("所有候选不可靠 → company 空（Unknown > Wrong）", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://10.0.0.1/job/7", pageTitle: "招聘" }),
    );
    expect(r.company).toBe("");
  });

  it("导航文本被拒绝：首页/全部职位/登录 不能当公司", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-co.com/job/8", brandTexts: ["header|首页", "header|全部职位", "header|登录"] }),
    );
    expect(r.company).toBe("");
  });

  it("岗位名候选被降权：structured 数据缺失时职位词候选不可胜出", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-co.com/job/9", brandTexts: ["header|产品经理招聘"] }),
    );
    // 「产品经理招聘」含职位词 → 降权后若无更高分候选则拒绝
    expect(r.company === "" || !/产品经理/.test(r.company)).toBe(true);
  });

  it("ATS 品牌名出现在候选值中被拦截", () => {
    const r = extractCompanyWithMetadata(
      raw({ url: "https://jobs.example-co.com/job/10", brandTexts: ["header|Moka招聘平台"], logoAlts: ["moka"] }),
    );
    expect(r.company).not.toBe("Moka");
    expect(r.company.toLowerCase()).not.toContain("moka");
  });
});

// ---------- Parser 集成 + companyExtraction metadata ----------

describe("RuleBasedJobParser companyExtraction", () => {
  it("parse 输出 companyExtraction source/confidence", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(
      raw({
        url: "https://zhaopin.yaoji.cn/job/abc",
        pageTitle: "游戏测试工程师-27届秋招",
        brandTexts: ["header|姚记科技"],
        bodyText: "岗位职责：编写测试用例。任职要求：计算机相关专业。",
      }),
    );
    expect(job.position).toBe("游戏测试工程师-27届秋招");
    expect(job.company).toBe("姚记科技");
    expect(job.companyExtraction?.source).toBeTruthy();
    expect(job.companyExtraction?.confidence).toBe("high");
  });

  it("company 无法识别时 parse 仍成功（company 空，不崩溃）", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(raw({ url: "https://xxx.mokahr.com/campus_apply/x/1", pageTitle: "高级产品经理" }));
    expect(job.company).toBe("");
    expect(job.position).toBeTruthy();
  });
});

// ---------- Duplicate Detection（spec 十三） ----------

describe("Duplicate Detection with company update", () => {
  const jobRecord = (over: Partial<JobRecord>): JobRecord =>
    ({
      id: "job-1",
      company: "",
      position: "游戏测试工程师-27届秋招",
      location: "",
      jd: "",
      sourceUrl: "https://zhaopin.yaoji.cn/job/abc",
      pageTitle: "",
      createdAt: "2026-09-24T00:00:00Z",
      jobType: "general",
      keywords: [],
      source: "captured",
      status: "captured",
      ...over,
    }) as JobRecord;

  it("URL 命中优先：company 从空变为姚记科技不产生重复", () => {
    const existing = [jobRecord({ id: "job-1", company: "" })];
    const dup = findDuplicate(existing, {
      sourceUrl: "https://zhaopin.yaoji.cn/job/abc",
      position: "游戏测试工程师-27届秋招",
      company: "姚记科技",
    });
    expect(dup?.id).toBe("job-1");
  });

  it("URL 命中后 upsert 更新 company（不新建）", () => {
    // upsertJobFromContext 由 repository 测试覆盖；这里验证 findDuplicate 的 URL 优先语义
    const existing = [
      jobRecord({ id: "job-1", company: "旧值" }),
      jobRecord({ id: "job-2", company: "姚记科技", sourceUrl: "https://other.example.com/job/x" }),
    ];
    const dup = findDuplicate(existing, {
      sourceUrl: "https://zhaopin.yaoji.cn/job/abc",
      position: "不同岗位名",
      company: "姚记科技",
    });
    expect(dup?.id).toBe("job-1"); // URL 优先于 company+position
  });
});
