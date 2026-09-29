import { describe, expect, it } from "vitest";
import {
  extractPositionWithMetadata,
  isReasonablePositionTitle,
  GENERIC_JOB_PAGE_LABELS,
  POSITION_SOURCE_SCORES,
} from "../src/job/positionExtraction";
import { RuleBasedJobParser } from "../src/job/jobParser";
import type { RawJobPage } from "../src/job/schema";

/**
 * Issue #002 回归（Real Regression Batch #2）：
 * Moka 真机职位「载具策划 - 3C（望月）- 202X」曾被判「未识别岗位」。
 * - capture 只采 h1（已修，jobCapture.test.ts）
 * - parser 职位白名单缺「策划」+ fallback 过严（本文件）
 * 本文件锁定：来源优先级、通用栏目词黑名单、合理性判断、关键词不再是唯一门槛。
 */

function raw(overrides: Partial<RawJobPage>): RawJobPage {
  return {
    url: "https://app.mokahr.com/campus_apply/xxx/job/yyy",
    pageTitle: "",
    metaTitle: "",
    metaCompany: "",
    h1Texts: [],
    bodyText: "",
    ...overrides,
  };
}

describe("isReasonablePositionTitle — 接受清单（不得误杀）", () => {
  const accept = [
    "载具策划 - 3C（望月）- 202X",
    "AI Agent 应用开发工程师",
    "产品经理（AI方向）",
    "AIGC内容运营",
    "Prompt Engineer",
    "游戏测试工程师-27届秋招",
    "管培生",
    "项目专员",
    "增长运营",
    "创意策划",
    "交付顾问",
    "实施工程师",
    "战略分析",
    "业务拓展",
  ];
  for (const t of accept) {
    it(`接受：${t}`, () => {
      expect(isReasonablePositionTitle(t)).toBe(true);
    });
  }
});

describe("isReasonablePositionTitle — 拒绝清单（false-positive guard）", () => {
  it.each(GENERIC_JOB_PAGE_LABELS)("拒绝栏目词：%s", (label) => {
    expect(isReasonablePositionTitle(label)).toBe(false);
  });

  const reject: Array<[string, string]> = [
    ["广州", "纯城市"],
    ["上海", "纯城市"],
    ["招聘", "纯招聘词"],
    ["诚聘", "纯招聘词"],
    ["Moka招聘", "ATS 品牌"],
    ["greenhouse", "ATS 品牌"],
    ["广州诗悦网络科技有限公司", "公司名形态"],
    ["广州诗悦网络科技有限公司", "公司名形态（与 company 相同）"],
    ["岗位职责：负责载具策划与玩法设计", "JD 段落"],
    ["负责 3C 品类的载具策划，产出玩法设计方案", "JD 段落（句级标点）"],
    ["2027", "纯数字"],
    ["a", "过短"],
  ];
  for (const [t, why] of reject) {
    it(`拒绝：${t}（${why}）`, () => {
      expect(isReasonablePositionTitle(t)).toBe(false);
    });
  }

  it("拒绝与 opts.company 完全相同的候选", () => {
    expect(isReasonablePositionTitle("诗悦网络", { company: "诗悦网络" })).toBe(false);
  });
});

describe("extractPositionWithMetadata — 来源优先级", () => {
  it("h1(1.0) > job_detail(0.95)：两者同时存在取 h1", () => {
    const r = extractPositionWithMetadata(
      raw({ h1Texts: ["高级游戏策划"], jobDetailTitles: ["载具策划 - 3C（望月）- 202X"] }),
    );
    expect(r.position).toBe("高级游戏策划");
    expect(r.extraction?.source).toBe("h1");
    expect(r.extraction?.confidence).toBe("high");
  });

  it("job_detail(0.95) > structured(0.95) > meta/title：同分按固定次序", () => {
    const r = extractPositionWithMetadata(
      raw({
        jobDetailTitles: ["载具策划 - 3C（望月）- 202X"],
        structuredData: [
          JSON.stringify({ "@type": "JobPosting", title: "结构化岗位" }),
        ],
        pageTitle: "结构化岗位 - 诗悦招聘",
      }),
    );
    expect(r.position).toBe("载具策划 - 3C（望月）- 202X");
    expect(r.extraction?.source).toBe("job_detail");
  });

  it("无 h1/detail 时 JSON-LD JobPosting.title 生效", () => {
    const r = extractPositionWithMetadata(
      raw({ structuredData: [JSON.stringify({ "@type": "JobPosting", title: "AI Agent 应用开发工程师" })] }),
    );
    expect(r.position).toBe("AI Agent 应用开发工程师");
    expect(r.extraction?.source).toBe("structured");
  });

  it("title 渠道（白名单命中）→ source=title", () => {
    const r = extractPositionWithMetadata(
      raw({ pageTitle: "AI产品运营-字节跳动招聘" }),
    );
    expect(r.position).toBe("AI产品运营");
    expect(r.extraction?.source).toBe("title");
  });

  it("title 渠道（droppedSuffix 保住非白名单词）→ source=dropped_suffix", () => {
    // 「管培生」不在职位白名单里——靠剥后缀 fallback 保住（这正是 Issue #002 的核心场景之一）
    const r = extractPositionWithMetadata(
      raw({ pageTitle: "管培生-2027校园招聘" }),
    );
    expect(r.position).toBe("管培生");
    expect(r.extraction?.source).toBe("dropped_suffix");
  });

  it("正文「岗位名称：」模式 → source=body", () => {
    const r = extractPositionWithMetadata(
      raw({ bodyText: "岗位名称：游戏测试工程师\n岗位职责：负责测试。" }),
    );
    expect(r.position).toBe("游戏测试工程师");
    expect(r.extraction?.source).toBe("body");
  });

  it("不是第一个字符串直接返回：h1 是栏目词时降级取 job_detail", () => {
    const r = extractPositionWithMetadata(
      raw({ h1Texts: ["职位详情"], jobDetailTitles: ["载具策划 - 3C（望月）- 202X"] }),
    );
    expect(r.position).toBe("载具策划 - 3C（望月）- 202X");
    expect(r.extraction?.source).toBe("job_detail");
  });

  it("全部候选不可靠 → position 为空（Unknown > Wrong）", () => {
    const r = extractPositionWithMetadata(
      raw({ pageTitle: "诗悦招聘", h1Texts: ["校园招聘"] }),
    );
    expect(r.position).toBe("");
    expect(r.extraction).toBeUndefined();
  });
});

describe("RuleBasedJobParser — Issue #002 Moka 回归", () => {
  it("Moka 自定义域名部署：.job-name 完整职位 + company_element 公司 → position/company 双正确", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(
      raw({
        url: "https://careers.shiyue.com/campus_apply/vehcile-planner-3c",
        pageTitle: "诗悦招聘",
        metaCompany: "Moka招聘",
        jobDetailTitles: ["载具策划 - 3C（望月）- 202X"],
        brandTexts: ["company_element|广州诗悦网络科技有限公司"],
        bodyText: "岗位职责：负责 3C 品类的载具策划与玩法设计。\n任职要求：熟悉游戏开发流程。",
      }),
    );
    expect(job.position).toBe("载具策划 - 3C（望月）- 202X");
    expect(job.company).toBe("广州诗悦网络科技有限公司");
    expect(job.positionExtraction?.source).toBe("job_detail");
    expect(job.positionExtraction?.confidence).toBe("high");
    // Moka招聘 不得冒充公司
    expect(job.company).not.toContain("Moka");
  });

  it("Moka ATS 宿主域名（app.mokahr.com）：company 只信 JSON-LD，position 仍可来自 job-name 节点", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(
      raw({
        url: "https://app.mokahr.com/campus_apply/shiyue/job/vehcile-planner-3c",
        pageTitle: "诗悦招聘",
        metaCompany: "Moka招聘",
        jobDetailTitles: ["载具策划 - 3C（望月）- 202X"],
        structuredData: [
          JSON.stringify({
            "@type": "JobPosting",
            title: "载具策划 - 3C（望月）- 202X",
            hiringOrganization: { name: "广州诗悦网络科技有限公司" },
          }),
        ],
        bodyText: "岗位职责：负责 3C 品类的载具策划与玩法设计。",
      }),
    );
    expect(job.position).toBe("载具策划 - 3C（望月）- 202X");
    expect(job.company).toBe("广州诗悦网络科技有限公司");
  });

  it.each([
    ["职位详情"],
    ["校园招聘"],
    ["加入我们"],
    ["岗位列表"],
    ["招聘职位"],
    ["职位列表"],
  ])("h1 为栏目词「%s」→ 不成为 position", async (label) => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(raw({ h1Texts: [label], pageTitle: "某公司招聘" }));
    expect(job.position).toBe("未识别岗位");
  });

  it("title 只有公司样后缀（如 腾讯招聘）→ 不产出职位（不编造）", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(raw({ pageTitle: "腾讯招聘" }));
    expect(job.position).toBe("未识别岗位");
  });

  it("Moka 2026-09 真机形状（sd-foundation-heading 详情 + 无 h1/.job-name/JSON-LD）→ position/company 双正确", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(
      raw({
        url: "https://app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4",
        pageTitle: "广州诗悦网络科技有限公司 - 校园招聘",
        metaCompany: "", // 真机：无 og:site_name / og:title
        h1Texts: [], // 真机：详情页无 h1
        // 真机 DOM 顺序：职位标题（sd-foundation-heading-40）→ 段落标题噪音
        jobDetailTitles: [
          "载具策划 - 3C（望月）-2027届校招",
          "职位描述",
          "职位信息",
          "官方公众号",
        ],
        brandTexts: [], // 真机：无 company-name 类节点
        bodyText:
          "首页/职位列表/职位详情\n载具策划 - 3C（望月）-2027届校招\n分享\n本科|全职\n申请职位\n职位描述\n岗位职责：参与《望月》载具操控设计。\n© 2026-2027 广州诗悦网络科技有限公司\n京公网安备 11010802024479号京ICP备15060035号-3",
      }),
    );
    // position：完整标题（不只「包含载具策划」），来源为详情节点而非 title fallback
    expect(job.position).toBe("载具策划 - 3C（望月）-2027届校招");
    expect(job.positionExtraction?.source).toBe("job_detail");
    expect(job.positionExtraction?.confidence).toBe("high");
    // company：版权行年份区间「© 2026-2027」+ 公司名含「网」不被截断
    expect(job.company).toBe("广州诗悦网络科技有限公司");
  });

  it("title 通道不会把公司名当职位（真机 pageTitle 只有公司名+栏目）", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(
      raw({ pageTitle: "广州诗悦网络科技有限公司 - 校园招聘" }),
    );
    expect(job.position).toBe("未识别岗位");
  });

  it("来源分数表：h1 > job_detail = structured > body = meta > title > dropped_suffix", () => {
    expect(POSITION_SOURCE_SCORES.h1).toBeGreaterThan(POSITION_SOURCE_SCORES.job_detail);
    expect(POSITION_SOURCE_SCORES.job_detail).toBe(POSITION_SOURCE_SCORES.structured);
    expect(POSITION_SOURCE_SCORES.structured).toBeGreaterThan(POSITION_SOURCE_SCORES.body);
    expect(POSITION_SOURCE_SCORES.body).toBe(POSITION_SOURCE_SCORES.meta);
    expect(POSITION_SOURCE_SCORES.meta).toBeGreaterThan(POSITION_SOURCE_SCORES.title);
    expect(POSITION_SOURCE_SCORES.title).toBeGreaterThan(POSITION_SOURCE_SCORES.dropped_suffix);
  });
});
