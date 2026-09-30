import { describe, expect, it } from "vitest";
import { computeTrustLevel, derivePlatformFamily, summarizeRealReport, pilotLogLine } from "../src/pilot/pilotRepository";
import { applySafeMode, buildDryRunReport, renderDryRun } from "../src/pilot/safeMode";
import { KNOWN_LIMITATIONS, type TrustLevel } from "../src/pilot/types";
import type { RealIssue, RealValidationSession } from "../src/pilot/types";
import type { CandidateField } from "../src/types/field";
import type { RawField } from "../src/types/field";

function makeSession(over: Partial<RealValidationSession> = {}): RealValidationSession {
  return {
    id: "rvs_1",
    hostname: "ats.example.com",
    urlPattern: "/apply",
    platformFamily: "example-ats",
    testedAt: "2026-09-24T00:00:00Z",
    environment: { spa: true, frameworkHints: ["react"], sameOriginIframeCount: 0, crossOriginIframeCount: 0, shadowRootCount: 0, customSelectCount: 2 },
    detectedFields: 12,
    actualFieldCount: 12,
    writableFields: 9,
    manualFields: 3,
    scanDurationMs: 120,
    writeDurationMs: null,
    semanticCorrectnessChecked: true,
    semanticFalseFills: 0,
    classificationCorrections: [],
    issues: [],
    ...over,
  };
}

function makeIssue(over: Partial<RealIssue> = {}): RealIssue {
  return {
    issueId: "ri_1",
    validationSessionId: "rvs_1",
    hostname: "ats.example.com",
    severity: "P2",
    stage: "write",
    errorCode: "WRITE_FAILED",
    fieldType: "text",
    fieldLabel: "",
    environment: "{}",
    expectedBehavior: "",
    actualBehavior: "",
    reproducible: true,
    screenshotAvailable: false,
    traceId: null,
    status: "new",
    createdAt: "2026-09-24T00:00:00Z",
    ...over,
  };
}

// ---------- Platform Fingerprint ----------

describe("Platform Fingerprint", () => {
  it("hostname 主域 + ATS 路径特征 → platformFamily", () => {
    expect(derivePlatformFamily("apply.company-a.com", "/ats/job/1")).toBe("company-a-ats");
    expect(derivePlatformFamily("www.company-b.cn", "/recruit/portal")).toBe("company-b-ats");
    expect(derivePlatformFamily("careers.company-c.com", "/position/9")).toBe("company-c-ats");
  });

  it("无 ATS 路径特征 → 主域兜底；www 前缀归一", () => {
    expect(derivePlatformFamily("www.plain.com", "/page")).toBe("plain");
    expect(derivePlatformFamily("PLAIN.com", "/page")).toBe("plain"); // 大小写归一
  });
});

// ---------- Trust Level ----------

describe("Compatibility Trust Level", () => {
  it("unverified：从未测试", () => {
    const rec = { family: "example-ats", hostnamePatterns: [], trustLevel: "unverified" as TrustLevel, pagesTested: 0, lastTestedAt: null, unresolvedP0P1: 0 };
    expect(computeTrustLevel(rec, [], [])).toBe("unverified");
  });

  it("experimental：测试过但有未解决 P1", () => {
    const rec = { family: "example-ats", hostnamePatterns: ["ats.example.com"], trustLevel: "experimental" as TrustLevel, pagesTested: 1, lastTestedAt: null, unresolvedP0P1: 1 };
    const sessions = [makeSession()];
    const issues = [makeIssue({ severity: "P1", status: "new" })];
    expect(computeTrustLevel(rec, sessions, issues)).toBe("experimental");
  });

  it("verified：≥2 页面通过 + False Fill 0 + 无未解决 P0/P1", () => {
    const rec = { family: "example-ats", hostnamePatterns: ["ats.example.com"], trustLevel: "unverified" as TrustLevel, pagesTested: 2, lastTestedAt: null, unresolvedP0P1: 0 };
    const sessions = [makeSession(), makeSession({ id: "rvs_2" })];
    expect(computeTrustLevel(rec, sessions, [])).toBe("verified");
  });

  it("P0 未解决 → 不能 verified", () => {
    const rec = { family: "example-ats", hostnamePatterns: ["ats.example.com"], trustLevel: "unverified" as TrustLevel, pagesTested: 2, lastTestedAt: null, unresolvedP0P1: 1 };
    const sessions = [makeSession(), makeSession({ id: "rvs_2" })];
    const issues = [makeIssue({ severity: "P0", status: "fixing" })];
    expect(computeTrustLevel(rec, sessions, issues)).toBe("experimental");
  });
});

// ---------- Real Report ----------

describe("Real Compatibility Report", () => {
  it("汇总真实指标（detection recall / write success / false fill）", () => {
    const report = summarizeRealReport({
      sessions: [
        makeSession({ detectedFields: 10, actualFieldCount: 12, writableFields: 8, manualFields: 2, semanticFalseFills: 0 }),
        makeSession({ id: "rvs_2", detectedFields: 10, actualFieldCount: 10, writableFields: 7, manualFields: 3, semanticFalseFills: 1 }),
      ],
      issues: [makeIssue({ severity: "P0" }), makeIssue({ severity: "P2", issueId: "ri_2" })],
      platformFamilies: [],
    });
    expect(report.testedPages).toBe(2);
    expect(report.platformFamilies).toBe(1);
    expect(report.fieldCount).toBe(20);
    expect(report.detectionRecall).toBe(Number((20 / 22).toFixed(3)));
    expect(report.writeSuccessRate).toBe(0.75);
    expect(report.falseFillCount).toBe(1);
    expect(report.issuesBySeverity.P0).toBe(1);
  });

  it("空数据如实为 0/null（不伪造）", () => {
    const report = summarizeRealReport({ sessions: [], issues: [], platformFamilies: [] });
    expect(report.testedPages).toBe(0);
    expect(report.detectionRecall).toBeNull();
    expect(report.falseFillCount).toBe(0);
  });

  it("pilot-log 行格式", () => {
    expect(pilotLogLine(makeSession())).toContain("| example-ats |");
  });
});

// ---------- Safe Mode & Dry Run ----------

function makeCandidate(over: Partial<CandidateField> = {}): CandidateField {
  const raw: RawField = {
    reference: '{"tag":"input","type":"text","name":"name","id":"n","label":"姓名","placeholder":"","idx":0}',
    kind: "text",
    context: {
      labelText: "姓名", placeholder: "", ariaLabel: "", name: "name", id: "n", title: "",
      fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "", autocomplete: "",
      inputType: "text", maxLength: null, required: false, disabled: false, readOnly: false, currentValue: "",
    },
    options: [],
  };
  return {
    raw,
    match: { fieldId: "basic.name", confidence: 0.95, matchedBy: "alias" },
    risk: "SAFE",
    riskReason: "",
    value: { fieldId: "basic.name", value: "张三", variant: "plain", editable: true, sourceType: "fact" },
    status: "need-confirm",
    entryIndex: undefined,
    ...over,
  } as CandidateField;
}

describe("Safe Validation Mode", () => {
  it("MANUAL_ONLY 字段强制转为 manual 且清空写入值", () => {
    const candidates = [
      makeCandidate(),
      makeCandidate({ risk: "MANUAL_ONLY", riskReason: "身份证号" }),
      makeCandidate({ status: "unknown" }),
    ];
    const safe = applySafeMode(candidates);
    expect(safe[0]!.value).toBeTruthy();
    expect(safe[1]!.status).toBe("manual");
    expect(safe[1]!.value).toBeUndefined();
    expect(safe[2]!.status).toBe("unknown");
  });
});

describe("Dry Run", () => {
  it("值正文零展示：只有来源标签 + 长度（隐私收紧）", () => {
    const report = buildDryRunReport([makeCandidate()], { platformFamily: "example-ats", hostname: "ats.example.com" });
    expect(report.wouldWriteCount).toBe(1);
    const entry = report.entries[0]!;
    // 不含任何正文字符——只有「N chars」
    expect(entry.valuePreview).toMatch(/^\d+ chars$/);
    expect(entry.valuePreview).not.toContain("张");
    const text = renderDryRun(report);
    expect(text).toContain("[Dry Run]");
    expect(text).toContain("将写入 1 个字段");
    expect(text).toContain("基础资料");
    // 完整值与截断摘要都不出现
    expect(text.includes("张三")).toBe(false);
  });

  it("来源标签映射：fact=基础资料 / variant=岗位方向版本 / ai_grounded=AI Grounded Answer", () => {
    const report = buildDryRunReport(
      [
        makeCandidate(),
        makeCandidate({
          match: { fieldId: "project.description", confidence: 0.9, matchedBy: "alias", evidence: ["label"] },
          value: { fieldId: "project.description", value: "项目描述内容", variant: "medium", editable: true, sourceType: "variant" },
        }),
        makeCandidate({
          match: { fieldId: "open.question", confidence: 1, matchedBy: "exact", evidence: ["label"] },
          value: { fieldId: "open.question", value: "生成的回答内容", variant: "plain", editable: true, sourceType: "ai_grounded" },
        }),
      ],
      { platformFamily: "x", hostname: "y" },
    );
    expect(report.entries[0]!.sourceType).toBe("基础资料");
    expect(report.entries[1]!.sourceType).toBe("岗位方向版本（中）");
    expect(report.entries[2]!.sourceType).toBe("AI Grounded Answer");
  });

  it("高风险字段：MANUAL_ONLY → 值显示「隐藏内容」", () => {
    const report = buildDryRunReport(
      [makeCandidate({ risk: "MANUAL_ONLY", value: { fieldId: "basic.idcard", value: "110101199001011234", variant: "plain", editable: false, sourceType: "fact" }, status: "manual" })],
      { platformFamily: "x", hostname: "y" },
    );
    expect(report.entries[0]!.valuePreview).toBe("隐藏内容");
    expect(renderDryRun(report)).toContain("MANUAL ONLY");
    // 值绝不出现
    expect(renderDryRun(report)).not.toContain("110101");
  });

  it("unknown/empty 字段标记 manualReason", () => {
    const report = buildDryRunReport(
      [makeCandidate({ status: "unknown" }), makeCandidate({ status: "empty", value: undefined })],
      { platformFamily: "x", hostname: "y" },
    );
    expect(report.entries[0]!.manualReason).toContain("未识别");
    expect(report.entries[1]!.wouldWrite).toBe(false);
    expect(report.entries[1]!.valuePreview).toBe("(空)");
  });
});

// ---------- Known Limitations ----------

describe("Known Limitation Registry", () => {
  it("只有认不出结构的自定义下拉仍按环境提示；iframe 与日期已不再是「不支持」", () => {
    const hits = KNOWN_LIMITATIONS.filter((k) =>
      k.matches({ sameOriginIframeCount: 1, crossOriginIframeCount: 1, shadowRootCount: 0, customSelectCount: 3 }),
    );
    // iframe 按 frame 路由填写（同源 + 跨域都由 all_frames 注入）、日期走站点日历格子点击，
    // 这两类已经不是能力缺口 —— 再把它们报成「需人工」就是给交付文档撒谎。
    expect(hits.map((h) => h.code)).toEqual(["UNKNOWN_CUSTOM_SELECT"]);
  });

  it("无特殊环境 → 无限制提示", () => {
    const hits = KNOWN_LIMITATIONS.filter((k) =>
      k.matches({ sameOriginIframeCount: 0, crossOriginIframeCount: 0, shadowRootCount: 0, customSelectCount: 0 }),
    );
    expect(hits).toHaveLength(0);
  });
});
