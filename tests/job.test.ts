import { describe, expect, it } from "vitest";
import { classifyJobType, RuleBasedJobParser, makeManualJobContext } from "../src/job/jobParser";
import { routeJob } from "../src/profile/profileRouter";
import { parseJobContext, makeJobId } from "../src/job/schema";
import { validateProfile } from "../src/profile/schema";
import { resolveValue } from "../src/profile/profileResolver";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { Profile } from "../src/types/profile";
import type { RawJobPage } from "../src/job/schema";

describe("classifyJobType（规则分类）", () => {
  it("Agent 岗位 JD → agent 得分最高", () => {
    const jd = "负责 Agent 工作流设计，基于 RAG 与 Tool Calling 构建多智能体系统，熟悉 Python 与 LangChain。";
    const { scores } = classifyJobType(jd);
    expect(scores.agent).toBeGreaterThan(scores.aiProduct);
    expect(scores.agent).toBeGreaterThan(0);
  });

  it("产品经理 JD → aiProduct 得分最高", () => {
    const jd = "岗位职责：负责 AI 产品的需求分析与 PRD 撰写，进行竞品分析和用户研究，推动产品迭代。";
    const { scores } = classifyJobType(jd);
    expect(scores.aiProduct).toBeGreaterThan(scores.agent);
  });

  it("营销 JD → aigcMarketing 得分最高", () => {
    const jd = "负责品牌营销创意策划，产出种草内容与短视频文案，管理新媒体账号。";
    const { scores } = classifyJobType(jd);
    expect(scores.aigcMarketing).toBeGreaterThan(scores.agent);
  });

  it("无关文本 → 全部 0 分", () => {
    const { scores } = classifyJobType("今天天气不错。");
    expect(Object.values(scores).every((v) => v === 0)).toBe(true);
  });
});

describe("RuleBasedJobParser", () => {
  const rawPage: RawJobPage = {
    url: "https://jobs.example.com/job/123",
    pageTitle: "AI产品运营（用户增长方向）-示例科技有限公司招聘",
    metaTitle: "AI产品运营（用户增长方向）-示例科技有限公司招聘",
    metaCompany: "",
    h1Texts: ["AI产品运营（用户增长方向）"],
    bodyText: [
      "示例科技有限公司 | 深圳",
      "岗位职责：",
      "1. 负责产品运营与用户增长，关注留存与转化数据；",
      "2. 分析用户需求，输出数据分析报告；",
      "任职要求：",
      "1. 本科学历，2 年以上运营经验；",
    ].join("\n"),
  };

  it("提取岗位/公司/城市/JD 正文并分类", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse(rawPage);
    expect(job.position).toContain("AI产品运营");
    expect(job.company).toBe("示例科技有限公司");
    expect(job.location).toBe("深圳");
    expect(job.jd).toContain("岗位职责");
    expect(job.jobType).toBe("aiOperation");
    expect(job.source).toBe("captured");
    expect(job.id).toMatch(/^job_/);
  });

  it("Agent JD → jobType=agent", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse({
      ...rawPage,
      pageTitle: "Agent 开发工程师-X智能科技招聘",
      h1Texts: ["Agent 开发工程师"],
      bodyText: "岗位职责：负责 Agent 工作流与 RAG 系统开发，熟悉 Python、LangChain 与 MCP 协议。\n任职要求：熟悉大模型应用落地。",
    });
    expect(job.jobType).toBe("agent");
  });

  it("无法识别任何信息 → jobType=general，字段留空不编造", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse({
      url: "https://example.com/x",
      pageTitle: "欢迎",
      metaTitle: "",
      metaCompany: "",
      h1Texts: [],
      bodyText: "欢迎光临",
    });
    expect(job.jobType).toBe("general");
    expect(job.company).toBe("");
    expect(job.position).toBe("未识别岗位");
  });

  it("Issue #001 Moka 回归：无 h1 + title=载具策划 - 3C（望月）- 2027校园招聘 → position 不丢", async () => {
    const parser = new RuleBasedJobParser();
    const job = await parser.parse({
      url: "https://app.mokahr.com/campus_apply/shiyue#/job/xxx",
      pageTitle: "载具策划 - 3C（望月）- 2027校园招聘",
      metaTitle: "",
      metaCompany: "",
      h1Texts: [],
      bodyText: "岗位职责：负责 3C 品类的载具策划与玩法设计。",
    });
    expect(job.position).toContain("载具策划");
    expect(job.position).not.toContain("校园招聘");
    expect(job.company).toBe(""); // ATS 宿主页：只信 structured data，此页无 → 空
  });
});

describe("makeManualJobContext（无 JD 兜底）", () => {
  it("生成 manual 来源的 JobContext，不猜岗位", () => {
    const job = makeManualJobContext("aiProduct");
    expect(job.source).toBe("manual");
    expect(job.jobType).toBe("aiProduct");
    expect(job.jd).toBe("");
    expect(parseJobContext(job).ok).toBe(true);
  });
});

describe("parseJobContext / makeJobId", () => {
  it("拒绝非法结构", () => {
    expect(parseJobContext({}).ok).toBe(false);
    expect(parseJobContext(null).ok).toBe(false);
  });
  it("id 唯一性", () => {
    expect(makeJobId()).not.toBe(makeJobId());
  });
});

describe("Profile Router", () => {
  function profileWithVariants(variantText: string): Profile {
    const p = structuredClone(defaultProfile);
    p.projects[0]!.variants.aiProduct = variantText;
    return p;
  }

  const productJob = makeManualJobContext("aiProduct");

  it("manual job → primary = 手选方向", () => {
    const sel = routeJob(productJob, defaultProfile);
    expect(sel.primaryProfile).toBe("aiProduct");
    expect(sel.scores.aiProduct).toBeGreaterThan(0);
  });

  it("captured JD 关键词决定 primary", () => {
    const job = makeManualJobContext("general");
    job.source = "captured";
    job.jd = "负责 Agent 与 RAG 系统开发，熟悉 Python、LangChain。";
    const sel = routeJob(job, defaultProfile);
    expect(sel.primaryProfile).toBe("agent");
  });

  it("无关键词 → general（禁止猜岗位）", () => {
    const job = makeManualJobContext("general");
    const sel = routeJob(job, defaultProfile);
    expect(sel.primaryProfile).toBe("general");
  });

  it("recommendedExperienceIds：有当前方向变体的经历排前", () => {
    const p = profileWithVariants("面向产品岗的表达");
    // exp-0 = internships[0]（无变体），exp-1 = projects[0]（有 aiProduct 变体）→ exp-1 排前
    const sel = routeJob(productJob, p);
    expect(sel.recommendedExperienceIds[0]).toBe("exp-1");
    expect(sel.recommendedExperienceIds).toContain("exp-0");
  });
});

describe("variants schema 兼容", () => {
  it("旧版 Profile（无 variants）导入 → 补全空变体", () => {
    const legacy = structuredClone(defaultProfile) as unknown as Record<string, unknown>;
    const entry = (legacy.internships as Record<string, unknown>[])[0]!;
    delete entry.variants;
    const result = validateProfile(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.internships[0]!.variants.agent).toBe("");
    expect(result.profile.projects[0]!.variants.aiProduct).toBe("");
  });

  it("variants 类型错 → 拒绝", () => {
    const broken = structuredClone(defaultProfile) as unknown as Record<string, unknown>;
    ((broken.internships as Record<string, unknown>[])[0]! as Record<string, unknown>).variants = "bad";
    expect(validateProfile(broken).ok).toBe(false);
  });
});

describe("resolver 变体接线", () => {
  it("profileType 对应变体非空 → description 用变体文本", () => {
    const p = structuredClone(defaultProfile);
    p.projects[0]!.descriptionMedium = "默认表达";
    p.projects[0]!.variants.aiProduct = "产品岗表达";
    const v = resolveValue("project.description", p, { maxLength: 300, profileType: "aiProduct" });
    expect(v?.value).toBe("产品岗表达");
  });

  it("变体为空 → 回退默认表达", () => {
    const p = structuredClone(defaultProfile);
    p.projects[0]!.descriptionMedium = "默认表达";
    const v = resolveValue("project.description", p, { maxLength: 300, profileType: "aiProduct" });
    expect(v?.value).toBe("默认表达");
  });

  it("general / 未指定方向 → 默认表达", () => {
    const p = structuredClone(defaultProfile);
    p.projects[0]!.descriptionMedium = "默认表达";
    p.projects[0]!.variants.aiProduct = "产品岗表达";
    expect(resolveValue("project.description", p, { maxLength: 300, profileType: "general" })?.value).toBe("默认表达");
    expect(resolveValue("project.description", p, { maxLength: 300 })?.value).toBe("默认表达");
  });

  it("internship 同样生效", () => {
    const p = structuredClone(defaultProfile);
    p.internships[0]!.descriptionLong = "默认实习表达";
    p.internships[0]!.variants.agent = "Agent 岗表达";
    const v = resolveValue("internship.description", p, { maxLength: 1000, profileType: "agent" });
    expect(v?.value).toBe("Agent 岗表达");
  });
});
