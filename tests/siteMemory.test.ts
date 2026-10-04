import { describe, expect, it } from "vitest";
import { deriveStatus, runScanPipeline } from "../src/pipeline/scanPipeline";
import { buildFillPlan } from "../src/pipeline/fillPlan";
import { assessRisk } from "../src/rules/riskRules";
import { defaultProfile } from "../src/profile/defaultProfile";
import { explainCandidate } from "../src/core/explainMatch";
import { fieldFullLabel } from "../src/core/fieldLabels";
import { confidenceLevel } from "../src/matching/matcher";
import type { Profile } from "../src/types/profile";
import type { RawField, RawFieldContext, CandidateField } from "../src/types/field";
import {
  MAX_SITE_RULES,
  buildRule,
  describeRule,
  emptySiteMemory,
  fieldMatchCandidates,
  hostFromUrl,
  matchSiteRule,
  rulesForHost,
  sanitizeRule,
  upsertRule,
  type SiteFieldRule,
} from "../src/site/siteMemory";

/**
 * 本轮深化的三件事，一条测试一条：
 * ① 低置信不静默填写（要人点头）；
 * ② 人在某个招聘站上的判断能沉淀成站点记忆，下次直接生效；
 * ③ 这层记忆**只含站点自己写的文字**，不含用户资料值、不含凭据。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "",
    placeholder: "",
    ariaLabel: "",
    name: "",
    id: "",
    title: "",
    fieldsetLabel: "",
    sectionTitle: "",
    prevSiblingText: "",
    parentText: "",
    autocomplete: "",
    inputType: "text",
    maxLength: null,
    required: false,
    disabled: false,
    readOnly: false,
    currentValue: "",
    ...partial,
  };
}

function field(partial: { context?: Partial<RawFieldContext>; kind?: RawField["kind"] } = {}): RawField {
  return {
    reference: `probe:${partial.context?.labelText ?? partial.context?.id ?? ""}`,
    kind: partial.kind ?? "text",
    context: ctx(partial.context),
    options: [],
  };
}

function profileWith(): Profile {
  const p = structuredClone(defaultProfile);
  p.basic.name = "张明";
  p.basic.email = "zhang@example.com";
  p.basic.phone = "13800001122";
  p.education = [
    {
      ...structuredClone(defaultProfile.education[0]!),
      school: "示例大学",
      major: "计算机科学与技术",
      degree: "本科",
    },
  ];
  return p;
}

/* ===================================================================== *
 * ① 低置信必须人工确认，而不是静默填
 * ===================================================================== */

describe("低置信字段不再静默填写", () => {
  const raw = field({ context: { labelText: "联系方式", name: "c1" } });
  const lowMatch = { fieldId: "basic.phone", confidence: 0.55, matchedBy: "alias" as const, evidence: ["label=联系方式"] };
  const value = {
    fieldId: "basic.phone",
    value: "13800001122",
    variant: "plain" as const,
    editable: false,
    sourceType: "fact" as const,
  };
  const phoneRisk = assessRisk("basic.phone", ctx());

  it("SAFE + 有内容 + 低置信 → low-confidence（不是 ready）", () => {
    const { status, riskReason } = deriveStatus(raw, lowMatch, phoneRisk, true, value);
    expect(status).toBe("low-confidence");
    // 原因要能说出「多少把握、像哪个字段、怎么才能填」，不是一句「失败」
    expect(riskReason).toContain("55%");
    expect(riskReason).toContain(fieldFullLabel("basic.phone"));
  });

  it("低置信不进填写计划：没有人工点头就一个字都不写", () => {
    const c: CandidateField = {
      raw,
      match: lowMatch,
      risk: "SAFE",
      riskReason: "",
      value,
      status: "low-confidence",
      confirmed: true, // 即使上游误带 confirmed，计划门禁也拦
    };
    expect(buildFillPlan([c], null, null).fields).toHaveLength(0);
  });

  it("人核对放行（need-confirm + confirmed）之后走同一道门禁进入计划", () => {
    const derived = deriveStatus(raw, lowMatch, phoneRisk, true, value);
    expect(derived.status).toBe("low-confidence");
    const confirmedOne: CandidateField = {
      raw,
      match: lowMatch,
      risk: "SAFE",
      riskReason: "",
      value,
      status: "need-confirm",
      confirmed: true,
    };
    const plan = buildFillPlan([confirmedOne], null, null);
    expect(plan.fields).toHaveLength(1);
    expect(plan.confirmed).toBe(true);
  });

  it("红线优先于置信度：MANUAL_ONLY 的低置信字段仍是 manual", () => {
    const { status } = deriveStatus(
      field({ context: { labelText: "身份证号", name: "idno" } }),
      { fieldId: "sensitive.idNumber", confidence: 0.4, matchedBy: "alias", evidence: ["label=身份证号"] },
      assessRisk("sensitive.idNumber", ctx({ labelText: "身份证号" })),
      true,
      {
        fieldId: "sensitive.idNumber",
        value: "110101199001011234",
        variant: "plain",
        editable: false,
        sourceType: "fact",
      },
    );
    expect(status).toBe("manual");
  });

  it("完全未识别仍按 unknown 处理，低置信只针对「认出来了但证据不够」", () => {
    const { status } = deriveStatus(
      field({ context: { labelText: "任意神秘栏目", name: "x9" } }),
      { fieldId: "unknown", confidence: 0, matchedBy: "none", evidence: [] },
      { risk: "UNKNOWN", reason: "" } as never,
      false,
      undefined,
    );
    expect(status).toBe("unknown");
  });

  it("资料库里没内容时仍是 empty（更可行动），不报成低置信", () => {
    const { status } = deriveStatus(raw, { ...lowMatch, confidence: 0.3 }, phoneRisk, true, undefined);
    expect(status).toBe("empty");
  });

  it("中置信仍按用户既有偏好可直接填（本轮只收紧低置信这一档）", () => {
    const { status } = deriveStatus(
      raw,
      { fieldId: "content.selfEvaluation", confidence: 0.8, matchedBy: "alias", evidence: [] },
      assessRisk("content.selfEvaluation", ctx()),
      true,
      {
        fieldId: "content.selfEvaluation",
        value: "做事扎实",
        variant: "plain",
        editable: true,
        sourceType: "default",
      },
    );
    expect(confidenceLevel(0.8)).toBe("MEDIUM");
    expect(status).toBe("ready");
  });

  it("低置信的解释文案说清了「没自动填」而不是「填了」", () => {
    const c: CandidateField = {
      raw,
      match: lowMatch,
      risk: "SAFE",
      riskReason: "只有 55% 的把握判断这一栏是「基本信息 · 手机号」，所以没有自动填写",
      value,
      status: "low-confidence",
    };
    const explain = explainCandidate(c);
    expect(explain.level).toBe("LOW");
    expect(explain.blockedReason).toContain("没有自动填写");
    expect(explain.headline).toContain("扩展没有自动填它");
  });
});

/* ===================================================================== *
 * ② 站点记忆：人工判断沉淀 + 逐字段出口
 * ===================================================================== */

describe("站点记忆套用到扫描管线", () => {
  const prof = profileWith();
  /**
   * 站点改版后的典型形状：栏名不成句，只剩一个混淆 id 和一个不像任何别名的文字。
   * 自动识别给 unknown（宁可不填），人工改挂一次之后由站点记忆接管 ——
   * 这正是「下次不用重改」要解决的那一格。
   */
  const obscureLabel = "F#7a9b 学历所属机构";
  const obscureField = field({ context: { labelText: obscureLabel, id: "ctrl_91827", sectionTitle: "教育背景" } });

  function rule(partial: Partial<SiteFieldRule> = {}): SiteFieldRule {
    return {
      id: "sr_test1",
      host: "careers.example.com",
      kind: "map",
      matchKey: "f#7a9b学历所属机构",
      section: "教育背景",
      fieldId: "education.school",
      siteLabel: obscureLabel,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...partial,
    };
  }

  it("没有记忆时这一栏认不出来（unknown，扩展不猜）", () => {
    const out = runScanPipeline([obscureField], prof, {});
    expect(out[0]!.match.fieldId).toBe("unknown");
    expect(out[0]!.status).toBe("unknown");
    expect(out[0]!.siteRule).toBeUndefined();
  });

  it("人工改挂过的那栏：下次扫描直接归到指定字段，并说明依据来自站点设定", () => {
    const out = runScanPipeline([obscureField], prof, { siteRules: [rule()] });
    const c = out[0]!;
    expect(c.match.fieldId).toBe("education.school");
    expect(c.status).toBe("ready");
    expect(c.siteRule).toMatchObject({ ruleId: "sr_test1", kind: "map", host: "careers.example.com" });
    expect(c.value?.value).toBe("示例大学");
    const explain = explainCandidate(c);
    expect(explain.signals.some((s) => s.source === "siteMemory")).toBe(true);
    // 说得出「本来自动识别成了什么」
    expect(c.siteRule?.overriddenFieldId).toBe("unknown");
  });

  it("跨站不串台：规则属于别的 host 时一条都不会被取出来", () => {
    const memory = { schemaVersion: 1 as const, rules: [rule({ host: "jobs.other.com" })] };
    expect(rulesForHost(memory, "careers.example.com")).toHaveLength(0);
    const out = runScanPipeline([obscureField], prof, { siteRules: rulesForHost(memory, "careers.example.com") });
    expect(out[0]!.match.fieldId).toBe("unknown");
  });

  it("站点改版后栏名变了 → 规则落空，宁可让人重改一次也不硬套", () => {
    const renamed = field({ context: { labelText: "毕业学校名称（新）", sectionTitle: "教育背景" } });
    expect(matchSiteRule([rule()], renamed.context)).toBeUndefined();
  });

  it("板块不同不误伤：同栏名出现在别的板块时规则不生效", () => {
    const inOtherSection = field({ context: { labelText: obscureLabel, sectionTitle: "家庭情况" } });
    expect(matchSiteRule([rule()], inOtherSection.context)).toBeUndefined();
  });

  it("「这一站以后都别填」：状态是跳过而不是填上，也不影响别的栏", () => {
    const block = rule({ id: "sr_b1", kind: "block", fieldId: undefined });
    const out = runScanPipeline(
      [obscureField, field({ context: { labelText: "姓名", name: "fullname" } })],
      prof,
      { siteRules: [block] },
    );
    const blocked = out.find((c) => c.raw.context.labelText === obscureLabel)!;
    expect(blocked.status).toBe("ignored");
    expect(blocked.value).toBeUndefined();
    expect(blocked.siteRule).toMatchObject({ kind: "block", ruleId: "sr_b1" });
    expect(explainCandidate(blocked).blockedReason).toContain("跳过");
    expect(buildFillPlan([{ ...blocked, confirmed: true }], null, null).fields).toHaveLength(0);
    // 另一栏照常识别与填写
    expect(out.find((c) => c.raw.context.labelText === "姓名")?.status).toBe("ready");
  });

  it("语境门禁仍排在站点记忆之前：登录框即使被记过也还是 excluded", () => {
    const loginPhone = field({
      context: {
        labelText: "手机号",
        name: "login_phone",
        sectionTitle: "登录",
        ancestorSignals: [{ depth: 1, tag: "div", role: "", hints: ["login"], hits: ["login:登录"] }],
      },
    });
    const out = runScanPipeline([loginPhone], prof, {
      siteRules: [rule({ kind: "block", matchKey: "手机号", section: "登录", fieldId: undefined })],
    });
    expect(out[0]!.status).toBe("excluded");
  });

  it("记忆改不动红线：人工把某栏挂到身份证号，风险层照样拦下", () => {
    const out = runScanPipeline(
      [field({ context: { labelText: "您的编号", name: "n1", sectionTitle: "基本信息" } })],
      prof,
      { siteRules: [rule({ matchKey: "您的编号", section: "基本信息", fieldId: "sensitive.idNumber", siteLabel: "您的编号" })] },
    );
    expect(out[0]!.match.fieldId).toBe("sensitive.idNumber");
    expect(out[0]!.status).toBe("manual");
    expect(out[0]!.value).toBeUndefined();
    expect(
      buildFillPlan([{ ...out[0]!, confirmed: true, status: "need-confirm" }], null, null).fields,
    ).toHaveLength(0);
  });
});

/* ===================================================================== *
 * ③ 这层记忆不含凭据、不含资料值
 * ===================================================================== */

describe("站点记忆的数据边界", () => {
  it("sanitizeRule 白名单装配：混进来的资料值键被整体丢弃", () => {
    const dirty = {
      host: "careers.example.com",
      kind: "map",
      matchKey: "最高学历毕业院校",
      fieldId: "education.school",
      // 有人（或某个未来的调用方）把整个候选传进来：这些键绝不能落盘
      value: "示例大学",
      editedValue: "张三的真实学校",
      phone: "13800001122",
      idNumber: "110101199001011234",
      cookie: "session=abc",
      storageState: { cookies: [] },
      answer: "我为什么适合这个岗位",
    };
    const clean = sanitizeRule(dirty)!;
    expect(Object.keys(clean).sort()).toEqual(
      ["createdAt", "fieldId", "host", "id", "kind", "matchKey", "section", "siteLabel", "updatedAt"].sort(),
    );
    const json = JSON.stringify(clean);
    for (const secret of ["示例大学", "张三的真实学校", "13800001122", "110101199001011234", "session=abc", "我为什么适合"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("非 canonical 字段 / 缺 host / 缺栏名 / 未知 kind → 整条规则被拒", () => {
    expect(sanitizeRule({ host: "a.com", kind: "map", matchKey: "学校", fieldId: "随便编的" })).toBeNull();
    expect(sanitizeRule({ host: "", kind: "map", matchKey: "学校", fieldId: "education.school" })).toBeNull();
    expect(sanitizeRule({ host: "a.com", kind: "map", matchKey: "  " })).toBeNull();
    expect(sanitizeRule({ host: "a.com", kind: "别的", matchKey: "学校" })).toBeNull();
    expect(sanitizeRule(null)).toBeNull();
  });

  it("hostFromUrl 只认真实 http(s) 主机名", () => {
    expect(hostFromUrl("https://Careers.Example.COM/apply?x=1")).toBe("careers.example.com");
    expect(hostFromUrl("file:///C:/x/form.html")).toBeNull();
    expect(hostFromUrl("chrome://extensions/")).toBeNull();
    expect(hostFromUrl(undefined)).toBeNull();
  });

  it("超长匹配键拒绝保存，展示标签截断，不存页面长正文", () => {
    const long = "学".repeat(200);
    expect(sanitizeRule({ host: "a.com", kind: "block", matchKey: long, siteLabel: long })).toBeNull();
    const r = sanitizeRule({ host: "a.com", kind: "block", matchKey: "学历", siteLabel: long })!;
    expect(r.matchKey.length).toBeLessThanOrEqual(60);
    expect(r.siteLabel.length).toBeLessThanOrEqual(60);
  });

  it("重复点同一条设定不会叠加成两条（幂等 upsert）", () => {
    const base = emptySiteMemory();
    const r = buildRule({
      host: "careers.example.com",
      ctx: ctx({ labelText: "最高学历毕业院校", sectionTitle: "教育背景" }),
      kind: "map",
      fieldId: "education.school",
    })!;
    expect(r).not.toBeNull();
    const first = upsertRule(base, r);
    const second = upsertRule(first.memory, r);
    const third = upsertRule(second.memory, { ...r, fieldId: "education.major" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(third.memory.rules).toHaveLength(1);
    // 覆盖而不是新增：改挂目标变了要用新的那条，且 id 保持稳定（界面上的撤销靠它）
    expect(third.memory.rules[0]!.fieldId).toBe("education.major");
    expect(third.memory.rules[0]!.id).toBe(first.memory.rules[0]!.id);
  });

  it("总量有上限，规则不会无限堆积", () => {
    let memory = emptySiteMemory();
    for (let i = 0; i < MAX_SITE_RULES + 40; i += 1) {
      memory = upsertRule(memory, sanitizeRule({ host: "a.com", kind: "block", matchKey: `栏位${i}` })!).memory;
    }
    expect(memory.rules).toHaveLength(MAX_SITE_RULES);
  });

  it("超长标签不截断为另一个栏位，改用完整短键或拒绝记忆", () => {
    const prefix = "同".repeat(60);
    expect(sanitizeRule({ host: "a.com", kind: "block", matchKey: prefix + "甲" })).toBeNull();
    expect(buildRule({ host: "a.com", kind: "block", ctx: ctx({ labelText: prefix + "甲" }) })).toBeNull();
    const rule = buildRule({ host: "a.com", kind: "block", ctx: ctx({ labelText: prefix + "甲", name: "qualification" }) })!;
    expect(rule.matchKey).toBe("qualification");
    expect(matchSiteRule([rule], ctx({ labelText: prefix + "甲", name: "qualification" }))).toBe(rule);
    expect(matchSiteRule([rule], ctx({ labelText: prefix + "乙", name: "other" }))).toBeUndefined();
  });

  it("匹配键取站点文字的可靠顺序：label 优先，混淆 id 只兜底", () => {
    const keys = fieldMatchCandidates(ctx({ labelText: "姓名", name: "input_12345", id: "f_77" }));
    expect(keys[0]).toBe("姓名");
    expect(keys).toContain("input_12345");
  });

  it("describeRule 说的是站点栏名 + 资料字段中文名，不出现资料值", () => {
    const text = describeRule(
      {
        id: "x",
        host: "careers.example.com",
        kind: "map",
        matchKey: "最高学历毕业院校",
        section: "教育背景",
        fieldId: "education.school",
        siteLabel: "最高学历毕业院校",
        createdAt: "",
        updatedAt: "",
      },
      fieldFullLabel,
    );
    expect(text).toContain("careers.example.com");
    expect(text).toContain("最高学历毕业院校");
    expect(text).toContain(fieldFullLabel("education.school"));
  });
});
