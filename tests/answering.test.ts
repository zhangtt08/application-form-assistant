import { describe, expect, it } from "vitest";
import { classifyQuestion, QUESTION_INTENT_CONFIG } from "../src/answering/questionClassifier";
import { selectAnswerFacts, careerFactsFrom, companyFactsFrom } from "../src/answering/answerStrategy";
import { buildAnswerPrompt, ANSWER_PROMPT_VERSION, lengthTarget } from "../src/answering/promptBuilder";
import { validateAnswer } from "../src/answering/answerValidator";
import { requiresInsufficientContext } from "../src/answering/answerGenerator";
import { answerCacheKey } from "../src/answering/answerStore";
import type { Fact, JobRequirementProfile } from "../src/generation/types";

// ---------- 夹具 ----------

const EMPTY_REQ: JobRequirementProfile = { hardSkills: [], responsibilities: [], softSignals: [], priorityKeywords: [] };

const PROJECT_FACTS: Fact[] = [
  { id: "fact_001", type: "metric", text: "日处理量 5000-6000 条，峰值超过 10000 条" },
  { id: "fact_002", type: "metric", text: "标注准确率稳定在 90% 以上" },
  { id: "fact_003", type: "responsibility", text: "完成需求梳理、流程拆解、开发、测试和迭代" },
  { id: "fact_004", type: "technology", text: "使用 Playwright 与 Python 搭建自动化流程" },
  { id: "fact_005", type: "result", text: "支撑 5 个测试业务项目的流程自动化交付" },
];

// ---------- 1. Question Classifier ----------

describe("Question Classifier", () => {
  const cases: [string, string][] = [
    ["为什么选择本公司？", "why_company"],
    ["你为什么申请这一岗位？", "why_role"],
    ["请介绍你最有代表性的项目", "representative_project"],
    ["请简述你的优势", "strengths"],
    ["请说明你与岗位要求匹配的地方", "role_fit"],
    ["请描述一次你遇到困难并解决的经历", "challenge"],
    ["你的未来三年职业规划是什么？", "career_plan"],
    ["请做一个简单的自我介绍", "self_introduction"],
  ];
  for (const [label, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(classifyQuestion({ labelText: label }).intent).toBe(expected);
    });
  }

  it("开放题但无具体 intent → other（不瞎映射）", () => {
    expect(classifyQuestion({ labelText: "请描述你对我们的理解" }).intent).toBe("other");
  });

  it("非开放题 → null（走原有确定性路径）", () => {
    expect(classifyQuestion({ labelText: "姓名" }).intent).toBeNull();
    expect(classifyQuestion({ labelText: "学校" }).intent).toBeNull();
    expect(classifyQuestion({ labelText: "项目描述" }).intent).toBeNull();
  });

  it("placeholder 与上下文文本参与分类", () => {
    expect(classifyQuestion({ labelText: "补充说明", placeholder: "为什么申请该岗位" }).intent).toBe("why_role");
    expect(classifyQuestion({ labelText: "", contextText: "请谈谈你的职业目标" }).intent).toBe("career_plan");
  });

  it("QUESTION_INTENT_CONFIG 覆盖 10 类 intent", () => {
    const intents = new Set(QUESTION_INTENT_CONFIG.map((e) => e.intent));
    expect(intents.size).toBeGreaterThanOrEqual(9); // other 由兜底产生
  });
});

// ---------- 2. Fact Selection ----------

describe("Answer Fact Selection", () => {
  it("不同 intent 使用不同事实偏好", () => {
    const req: JobRequirementProfile = { ...EMPTY_REQ, hardSkills: ["Playwright"] };
    const roleFit = selectAnswerFacts("role_fit", req, PROJECT_FACTS);
    const strengths = selectAnswerFacts("strengths", req, PROJECT_FACTS);
    expect(roleFit.length).toBeGreaterThan(0);
    expect(strengths.length).toBeGreaterThan(0);
    // role_fit 偏好 metric/result 权重高 → metric 类事实应入选
    expect(roleFit.some((f) => f.type === "metric")).toBe(true);
  });

  it(" representative_project 保留全部关键事实（top8 内）", () => {
    const selected = selectAnswerFacts("representative_project", EMPTY_REQ, PROJECT_FACTS);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(selected.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------- 3. Company Fact Separation ----------

describe("Company Fact Separation", () => {
  it("companyFactsFrom 只包含公司名/岗位名，不包含 JD 要求", () => {
    const facts = companyFactsFrom({ company: "星辰科技", position: "AI产品经理", jd: "要求熟悉 LangChain 与 Kubernetes" });
    expect(facts.some((f) => f.text.includes("星辰科技"))).toBe(true);
    expect(facts.some((f) => f.text.includes("LangChain"))).toBe(false);
    expect(facts.some((f) => f.text.includes("Kubernetes"))).toBe(false);
  });

  it("无公司名 → company facts 为空", () => {
    expect(companyFactsFrom({ jd: "要求 LangChain" })).toHaveLength(0);
  });
});

// ---------- 4/5. Why Company / Career Plan insufficient ----------

describe("Grounded Answer 约束", () => {
  it("Why Company：无公司 facts 时公司评价 guard fail", () => {
    const report = validateAnswer(
      "贵司是行业领先企业，公司文化优秀。我有相关项目经验。",
      PROJECT_FACTS,
      [], // 无公司 facts
      [],
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.overall).toBe("fail");
    expect(report.companyClaims.some((c) => c.status === "unsupported")).toBe(true);
  });

  it("Why Company：只答岗位与自身经历 → 不触发公司 guard", () => {
    const report = validateAnswer(
      "岗位方向与我的经历匹配：完成需求梳理与流程拆解，使用 Playwright 搭建自动化流程。希望参与相关工作。",
      PROJECT_FACTS,
      [{ id: "company_001", type: "context", text: "公司名称：星辰科技" }],
      [],
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.companyClaims).toHaveLength(0);
  });

  it("Career Plan：无 career facts → insufficient_context（本地判定，不调 LLM）", () => {
    const r = requiresInsufficientContext("career_plan", []);
    expect(r.insufficient).toBe(true);
    expect(r.missing).toContain("career_goal");
  });

  it("Career Plan：有 career facts → 可生成", () => {
    const career = careerFactsFrom({ targetDirections: ["AI 产品方向"], preferredWorkTypes: [], developmentGoals: ["三年内独立负责 AI 产品线"] });
    expect(career.length).toBeGreaterThan(0);
    expect(requiresInsufficientContext("career_plan", career).insufficient).toBe(false);
  });

  it("Career Guard：回答中出现未配置的职业目标 → unsupported", () => {
    const report = validateAnswer(
      "未来三年希望成长为独立负责 AI 产品的产品经理。",
      PROJECT_FACTS,
      [],
      [], // careerPreferences 为空
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.careerClaims.some((c) => c.status === "unsupported")).toBe(true);
    expect(report.overall).toBe("fail");
  });

  it("Career Guard：有 careerPreferences 支持时 → supported", () => {
    const career = careerFactsFrom({ targetDirections: [], preferredWorkTypes: [], developmentGoals: ["三年内成长为独立负责 AI 产品线的产品经理"] });
    const report = validateAnswer(
      "未来三年希望成长为独立负责 AI 产品线的产品经理。",
      PROJECT_FACTS,
      [],
      career,
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.careerClaims.every((c) => c.status === "supported")).toBe(true);
  });
});

// ---------- 6. Preference Guard ----------

describe("Preference Guard", () => {
  it("无偏好事实 →「我一直热爱」unsupported", () => {
    const report = validateAnswer(
      "我一直热爱广告创意行业。",
      PROJECT_FACTS,
      [],
      [],
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.preferenceClaims.some((c) => c.status === "unsupported")).toBe(true);
    expect(report.overall).toBe("fail");
  });

  it("有偏好事实 → supported", () => {
    const withPref: Fact[] = [{ id: "fact_009", type: "context", text: "我一直热爱广告创意行业" }];
    const report = validateAnswer("我一直热爱广告创意行业。", withPref, [], [], { maxLength: null, targetCharacters: 300 });
    expect(report.preferenceClaims.every((c) => c.status === "supported")).toBe(true);
  });
});

// ---------- 7. Length ----------

describe("Answer Length", () => {
  it("maxlength 优先", () => {
    expect(lengthTarget({ maxLength: 200, targetCharacters: 200 })).toBe(200);
  });
  it("无 maxlength → 档位目标", () => {
    expect(lengthTarget({ maxLength: null, preset: "short", targetCharacters: 150 })).toBe(150);
    expect(lengthTarget({ maxLength: null, preset: "detailed", targetCharacters: 500 })).toBe(500);
    expect(lengthTarget({ maxLength: null, targetCharacters: 300 })).toBe(300);
  });
  it("超长 → review + exceeded 标记，内容不被截断", () => {
    const base = "完成需求梳理与流程拆解，日处理量 5000-6000 条，准确率稳定 90% 以上。";
    const long = base.repeat(6); // 260+ 字真实文本
    const report = validateAnswer(long, PROJECT_FACTS, [], [], { maxLength: 200, targetCharacters: 200 });
    expect(report.length.exceeded).toBe(true);
    expect(report.overall).toBe("review");
    expect(report.length.current).toBeGreaterThan(200); // 未截断（完整内容保留）
  });
});

// ---------- 8. Validation（个人/公司/career） ----------

describe("Answer Validation 汇总", () => {
  it("个人事实支持 + 无违规 → pass", () => {
    const report = validateAnswer(
      "完成需求梳理与流程拆解，日处理量 5000-6000 条。",
      PROJECT_FACTS,
      [],
      [],
      { maxLength: null, targetCharacters: 300 },
    );
    expect(report.overall).toBe("pass");
  });

  it("编造数字 → base fail", () => {
    const report = validateAnswer("日处理量 9000 条。", PROJECT_FACTS, [], [], { maxLength: null, targetCharacters: 300 });
    expect(report.baseStatus).toBe("fail");
    expect(report.overall).toBe("fail");
  });
});

// ---------- 9/10. Manual Edit + Cache/Session 纯逻辑 ----------

describe("Manual Edit 语义与 Cache Key", () => {
  it("编辑后重新 validate：追加不存在内容 → fail", () => {
    const ok = validateAnswer("完成需求梳理。", PROJECT_FACTS, [], [], { maxLength: null, targetCharacters: 300 });
    expect(ok.overall).toBe("pass");
    const edited = "完成需求梳理。带领 5 人团队完成交付。";
    const revalidated = validateAnswer(edited, PROJECT_FACTS, [], [], { maxLength: null, targetCharacters: 300 });
    expect(revalidated.overall).toBe("fail");
  });

  it("Cache Key：facts/promptVersion/job 变化 → key 变化", () => {
    const k1 = answerCacheKey("job_1", "为什么申请？", ["fact_001", "fact_002"], "answer-engine-v1");
    const k2 = answerCacheKey("job_1", "为什么申请？", ["fact_001", "fact_002"], "answer-engine-v1");
    expect(k1).toBe(k2); // 同条件复用
    expect(answerCacheKey("job_2", "为什么申请？", ["fact_001"], "answer-engine-v1")).not.toBe(k1);
    expect(answerCacheKey("job_1", "为什么申请？", ["fact_001", "fact_003"], "answer-engine-v1")).not.toBe(k1);
    expect(answerCacheKey("job_1", "为什么申请？", ["fact_001", "fact_002"], "answer-engine-v2")).not.toBe(k1);
  });

  it("ANSWER_PROMPT_VERSION 存在", () => {
    expect(ANSWER_PROMPT_VERSION).toMatch(/^answer-engine-v\d+$/);
  });
});

// ---------- Prompt 结构 ----------

describe("Answer Prompt", () => {
  it("三块事实分离 + maximumCharacters + insufficient 机制", () => {
    const { systemPrompt, userPrompt } = buildAnswerPrompt({
      question: "为什么申请该岗位？",
      intent: "why_role",
      jobRequirements: EMPTY_REQ,
      personalFacts: PROJECT_FACTS,
      companyFacts: [{ id: "company_001", type: "context", text: "公司名称：星辰科技" }],
      length: { maxLength: 300, targetCharacters: 300 },
      language: "zh-CN",
      tone: "sincere",
    });
    expect(userPrompt).toContain("[INTENT] why_role");
    expect(userPrompt).toContain("[MAXIMUM_CHARACTERS] 300");
    expect(userPrompt).toContain("[PERSONAL_FACTS_BEGIN]");
    expect(userPrompt).toContain("[COMPANY_FACTS_BEGIN]");
    expect(userPrompt).toContain("fact_004 | technology");
    expect(userPrompt).toContain("company_001");
    expect(systemPrompt).toContain("个人事实只能来自 PERSONAL_FACTS");
    expect(systemPrompt).toContain("insufficient_context");
    expect(systemPrompt).toContain("禁止编造");
  });
});
