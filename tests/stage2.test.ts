import { describe, expect, it } from "vitest";
import {
  routeJob, effectiveProfileType, calculateProfileCoverage, computeRoutingConfidence,
  type ProfileSelection,
} from "../src/profile/profileRouter";
import { makeManualJobContext } from "../src/job/jobParser";
import { PROFILE_TYPES, type ProfileType } from "../src/job/profileTypes";
import { resolveValue } from "../src/profile/profileResolver";
import { defaultProfile } from "../src/profile/defaultProfile";
import { validateProfile } from "../src/profile/schema";
import { deriveStatus, numberValueFitsStep } from "../src/pipeline/scanPipeline";
import { buildFillPlan, summarizeFillOutcome } from "../src/pipeline/fillPlan";
import type { CandidateField, MatchResult, ResolvedValue, RiskLevel } from "../src/types/field";
import type { RiskAssessment } from "../src/rules/riskRules";

// ---------- helpers ----------

function zeroScores(): Record<ProfileType, number> {
  return Object.fromEntries(PROFILE_TYPES.map((t) => [t, 0])) as Record<ProfileType, number>;
}

function kwMap(entries: Partial<Record<ProfileType, string[]>>): Record<ProfileType, string[]> {
  const out = {} as Record<ProfileType, string[]>;
  for (const t of PROFILE_TYPES) out[t] = entries[t] ?? [];
  return out;
}

function mockMatch(fieldId: string, confidence: number): MatchResult {
  return { fieldId, confidence, matchedBy: "exact", evidence: [] };
}

function mockRisk(risk: RiskLevel): RiskAssessment {
  return { risk, reason: "" };
}

function mockRaw(maxLength: number | null = null, kind: "text" | "number" = "text", step?: number | null) {
  return {
    reference: '{"tag":"input"}',
    kind,
    context: {
      labelText: "项目描述", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
      fieldsetLabel: "", sectionTitle: "项目经历", prevSiblingText: "", parentText: "",
      autocomplete: "", inputType: kind, maxLength, step, required: false, disabled: false,
      readOnly: false, currentValue: "",
    },
    options: [],
  };
}

function mockValue(value: string): ResolvedValue {
  return { fieldId: "project.description", value, variant: "medium", editable: true, sourceType: "default" };
}

// ---------- Router Confidence（spec 二十三.1）----------

describe("Router Confidence", () => {
  it("高置信：分差明显且命中词多 → high", () => {
    const scores = zeroScores();
    scores.aiProduct = 9;
    scores.agent = 2;
    const { confidence, reason } = computeRoutingConfidence(
      scores,
      kwMap({ aiProduct: ["产品经理", "需求分析", "PRD", "竞品"] }),
    );
    expect(confidence).toBe("high");
    expect(reason).toContain("4 个");
  });

  it("两个方向接近 → low 并提示确认", () => {
    const scores = zeroScores();
    scores.aiProduct = 8;
    scores.agent = 7.5;
    const { confidence, reason } = computeRoutingConfidence(scores, kwMap({ aiProduct: ["产品"], agent: ["Agent"] }));
    expect(confidence).toBe("low");
    expect(reason).toContain("接近");
  });

  it("分差中等 → medium", () => {
    const scores = zeroScores();
    scores.aiProduct = 10;
    scores.agent = 7.4;
    const { confidence } = computeRoutingConfidence(scores, kwMap({ aiProduct: ["产品", "PRD"] }));
    expect(confidence).toBe("medium");
  });

  it("无关键词 → low（general 兜底）", () => {
    const { confidence, reason } = computeRoutingConfidence(zeroScores(), kwMap({}));
    expect(confidence).toBe("low");
    expect(reason).toContain("没有命中");
  });

  it("routeJob 对模糊 JD 输出 low + 理由（Scenario D）", () => {
    const job = makeManualJobContext("general");
    job.source = "captured";
    // Agent×1 与 产品×2 原始分相同（3.0）→ gap=0 → low
    job.jd = "负责 Agent 相关工作，参与产品规划与产品落地。";
    const sel = routeJob(job, defaultProfile);
    expect(sel.routingConfidence).toBe("low");
    expect(sel.routingReason.length).toBeGreaterThan(0);
  });
});

// ---------- Effective Profile（spec 二十三.2）----------

describe("Effective Profile", () => {
  const selection = { primaryProfile: "aiProduct" } as ProfileSelection;

  it("无 override：使用 primaryProfile", () => {
    expect(effectiveProfileType(selection, null)).toBe("aiProduct");
  });

  it("有 override：使用 override", () => {
    expect(effectiveProfileType(selection, "agent")).toBe("agent");
  });

  it("清除 override：恢复 primaryProfile", () => {
    expect(effectiveProfileType(selection, "agent")).toBe("agent");
    expect(effectiveProfileType(selection, null)).toBe("aiProduct");
  });
});

// ---------- Content Resolver sourceType（spec 二十三.3）----------

describe("Content Resolver sourceType", () => {
  const p = structuredClone(defaultProfile);
  p.projects[0]!.descriptionLong = "默认表达";
  p.projects[0]!.descriptionMedium = "默认表达";
  p.projects[0]!.descriptionShort = "默认表达";

  it("variant 存在 → sourceType=variant + sourcePath，无 fallback", () => {
    p.projects[0]!.variants.agent = "Agent 表达";
    const v = resolveValue("project.description", p, { maxLength: 500, profileType: "agent" });
    expect(v?.sourceType).toBe("variant");
    expect(v?.sourcePath).toContain("variants.agent");
    expect(v?.fallbackUsed).toBe(false);
    expect(v?.profileType).toBe("agent");
  });

  it("variant 缺失 → fallback default（方向非 general 时标记）", () => {
    const v = resolveValue("project.description", p, { maxLength: 500, profileType: "aiProduct" });
    expect(v?.sourceType).toBe("default");
    expect(v?.fallbackUsed).toBe(true);
    expect(v?.value).toBe("默认表达");
  });

  it("页面上限很大但 long 为空时，回退到已有 medium 内容", () => {
    const q = structuredClone(defaultProfile);
    q.projects[0]!.descriptionLong = "";
    q.projects[0]!.descriptionMedium = "项目中等长度描述";
    const v = resolveValue("project.description", q, { maxLength: 2000, profileType: "general" });
    expect(v?.value).toBe("项目中等长度描述");
    expect(v?.variant).toBe("medium");
  });

  it("general / 无方向 → default 且不算 fallback", () => {
    const v = resolveValue("project.description", p, { maxLength: 500 });
    expect(v?.sourceType).toBe("default");
    expect(v?.fallbackUsed).toBe(false);
  });

  it("default 也没有 → undefined（pipeline 标注 empty）", () => {
    const q = structuredClone(defaultProfile);
    q.projects[0]!.descriptionShort = "";
    q.projects[0]!.descriptionMedium = "";
    q.projects[0]!.descriptionLong = "";
    expect(resolveValue("project.description", q, { maxLength: 500, profileType: "general" })).toBeUndefined();
  });

  it("fact 字段 → sourceType=fact", () => {
    const q = structuredClone(defaultProfile);
    q.basic.phone = "13800001234";
    const v = resolveValue("basic.phone", q);
    expect(v?.sourceType).toBe("fact");
  });
});

// ---------- Profile Coverage（spec 二十三.4）----------

describe("calculateProfileCoverage", () => {
  function profileWithVariants(count: number): typeof defaultProfile {
    const p = structuredClone(defaultProfile);
    p.internships.push(structuredClone(p.internships[0]!));
    p.projects.push(structuredClone(p.projects[0]!));
    // total = 4 条经历（2 实习 + 2 项目）
    const all = [...p.internships, ...p.projects];
    all.slice(0, count).forEach((e) => {
      e.variants.aiProduct = "有内容";
    });
    return p;
  }

  it("全部有 → coverage 1", () => {
    const c = calculateProfileCoverage(profileWithVariants(4), "aiProduct");
    expect(c.totalExperiences).toBe(4);
    expect(c.completedVariants).toBe(4);
    expect(c.coverage).toBe(1);
    expect(c.missingVariants).toHaveLength(0);
  });

  it("部分有 → 列出缺失", () => {
    const c = calculateProfileCoverage(profileWithVariants(1), "aiProduct");
    expect(c.completedVariants).toBe(1);
    expect(c.missingVariants).toEqual(["exp-1", "exp-2", "exp-3"]);
    expect(c.coverage).toBe(0.25);
  });

  it("全部为空 / general → 0", () => {
    const c = calculateProfileCoverage(profileWithVariants(0), "aiProduct");
    expect(c.coverage).toBe(0);
    expect(calculateProfileCoverage(profileWithVariants(3), "general").coverage).toBe(0);
  });
});

// ---------- Fill Candidate 状态（spec 二十三.5）----------

describe("deriveStatus（Fill Candidate 状态机）", () => {
  it("LOW 风险（SAFE）+ 高置信 + 有值 → ready", () => {
    const { status } = deriveStatus(mockRaw(), mockMatch("basic.name", 0.95), mockRisk("SAFE"), true, mockValue("张三"));
    expect(status).toBe("ready");
  });

  it("MEDIUM 风险（REVIEW）在自动填写模式下仍可直接写入", () => {
    const { status } = deriveStatus(mockRaw(), mockMatch("content.selfEvaluation", 0.95), mockRisk("REVIEW"), true, mockValue("内容"));
    expect(status).toBe("ready");
  });

  it("HIGH 风险（MANUAL_ONLY）→ blocked（manual）", () => {
    const { status } = deriveStatus(mockRaw(), mockMatch("basic.name", 0.95), mockRisk("MANUAL_ONLY"), true, undefined);
    expect(status).toBe("manual");
  });

  it("识别成功但无内容 → empty", () => {
    const { status } = deriveStatus(mockRaw(), mockMatch("basic.email", 0.95), mockRisk("SAFE"), true, undefined);
    expect(status).toBe("empty");
  });

  it("UNKNOWN → unknown", () => {
    const { status } = deriveStatus(mockRaw(), mockMatch("unknown", 0), { risk: "UNKNOWN", reason: "" } as unknown as RiskAssessment, false, undefined);
    expect(status).toBe("unknown");
  });

  it("maxlength 超限 → 不自动填写（既不截断也不硬塞超长值），交回人工缩减", () => {
    const long = mockValue("字".repeat(420));
    const { status, riskReason } = deriveStatus(mockRaw(300), mockMatch("project.description", 0.95), mockRisk("SAFE"), true, long);
    expect(status).toBe("manual");
    expect(riskReason).toContain("420");
    expect(riskReason).toContain("300");
    // 内容保持完整，绝不被 substring
    expect(long.value).toHaveLength(420);
  });

  it("未超限不受影响", () => {
    const { status } = deriveStatus(mockRaw(500), mockMatch("project.description", 0.95), mockRisk("SAFE"), true, mockValue("字".repeat(384)));
    expect(status).toBe("ready");
  });
});

// ---------- number 控件格式门禁（issue-003：姚记毕业年份 stepMismatch）----------

describe("number 控件收不下该值 → manual", () => {
  const endDate = () => mockMatch("education.endDate", 0.95);

  it("整数年份框收到 2027.06 → manual，且给出可解释的原因", () => {
    const v = mockValue("2027.06");
    const { status, riskReason } = deriveStatus(mockRaw(null, "number"), endDate(), mockRisk("SAFE"), true, v);
    expect(status).toBe("manual");
    expect(riskReason).toContain("数字控件");
    // 绝不自动改写：内容原样保留，由人工决定填什么
    expect(v.value).toBe("2027.06");
  });

  it("同一个框收到 2027 → ready（门禁只拦格式，不拦字段）", () => {
    const { status } = deriveStatus(mockRaw(null, "number"), endDate(), mockRisk("SAFE"), true, mockValue("2027"));
    expect(status).toBe("ready");
  });

  it("「至今」这类非数字根本进不了 number 控件 → manual", () => {
    const { status } = deriveStatus(mockRaw(null, "number"), endDate(), mockRisk("SAFE"), true, mockValue("至今"));
    expect(status).toBe("manual");
  });

  it("step=0.01 的小数控件收到 3.5 → 不误伤（合法小数照常 ready）", () => {
    const { status } = deriveStatus(mockRaw(null, "number", 0.01), mockMatch("basic.gpa", 0.95), mockRisk("SAFE"), true, mockValue("3.5"));
    expect(status).toBe("ready");
  });

  it("step=any 的 number 控件收到 2027.06 → 不设限", () => {
    const { status } = deriveStatus(mockRaw(null, "number", null), endDate(), mockRisk("SAFE"), true, mockValue("2027.06"));
    expect(status).toBe("ready");
  });

  it("文本框收到 2027.06 不受影响（姚记入职/离职时间就是文本框）", () => {
    const { status } = deriveStatus(mockRaw(null, "text"), mockMatch("internship.startDate", 0.95), mockRisk("SAFE"), true, mockValue("2026.06"));
    expect(status).toBe("ready");
  });

  it("numberValueFitsStep 容忍浮点误差，不误判 0.3 / step 0.1", () => {
    expect(numberValueFitsStep("0.3", 0.1)).toBe(true); // 0.3/0.1 = 2.9999999999999996
    expect(numberValueFitsStep("2027.06", 1)).toBe(false);
    expect(numberValueFitsStep("2027", 1)).toBe(true);
    expect(numberValueFitsStep("", 1)).toBe(false);
    expect(numberValueFitsStep("2026-06", 1)).toBe(false);
  });
});

// ---------- Confirmed Fill Plan（spec 二十三.6 / Scenario G）----------

describe("buildFillPlan", () => {
  function candidate(partial: Partial<CandidateField>): CandidateField {
    return {
      raw: mockRaw(),
      match: mockMatch("project.description", 0.95),
      risk: "SAFE",
      riskReason: "",
      status: "ready",
      ...partial,
    };
  }

  it("只有 approved 的可填字段进入计划", () => {
    const plan = buildFillPlan(
      [
        candidate({ confirmed: true, value: mockValue("A") }),
        candidate({ confirmed: false, value: mockValue("B") }), // 未确认
      ],
      "job_1",
      "aiProduct",
    );
    expect(plan.fields).toHaveLength(1);
    expect(plan.fields[0]?.value).toBe("A");
    expect(plan.effectiveProfileType).toBe("aiProduct");
  });

  it("manual（高风险）/ empty / unknown 不进入", () => {
    const plan = buildFillPlan(
      [
        candidate({ confirmed: true, status: "manual", risk: "MANUAL_ONLY" }),
        candidate({ confirmed: true, status: "empty" }),
        candidate({ confirmed: true, status: "unknown" }),
      ],
      null,
      "general",
    );
    expect(plan.fields).toHaveLength(0);
  });

  it("手动编辑值优先于解析值（Scenario F：只影响本次填写）", () => {
    const plan = buildFillPlan(
      [candidate({ confirmed: true, value: mockValue("原始内容"), editedValue: "用户修改内容" })],
      null,
      null,
    );
    expect(plan.fields[0]?.value).toBe("用户修改内容");
  });

  it("summarizeFillOutcome 统计成功/失败/跳过/高风险", () => {
    const plan = buildFillPlan([candidate({ confirmed: true, value: mockValue("A") })], null, null);
    const outcomes = [
      { reference: '{"tag":"input"}', status: "filled" as const },
    ];
    const summary = summarizeFillOutcome(plan, outcomes, [
      candidate({ status: "manual", risk: "MANUAL_ONLY" }),
      candidate({ confirmed: true, status: "need-confirm", value: mockValue("x") }),
    ]);
    expect(summary.filled).toBe(1);
    expect(summary.manualBlocked).toBe(1);
  });
});

// ---------- schema 回归：variants 导入兼容 ----------

describe("Stage 2 schema 回归", () => {
  it("旧版 Profile（无 variants）经 validateProfile 补全", () => {
    const legacy = structuredClone(defaultProfile) as unknown as Record<string, unknown>;
    delete ((legacy.internships as Record<string, unknown>[])[0]! as Record<string, unknown>).variants;
    const result = validateProfile(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.internships[0]!.variants.aiProduct).toBe("");
    }
  });
});
