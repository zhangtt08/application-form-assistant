import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeAll, vi } from "vitest";
import { scanPage } from "../src/content/scanner";
import { runScanPipeline, deriveStatus } from "../src/pipeline/scanPipeline";
import { buildFillPlan } from "../src/pipeline/fillPlan";
import { classifyApplicationContext } from "../src/context/applicationContext";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { CandidateField, RawField, RawFieldContext } from "../src/types/field";
import type { Profile } from "../src/types/profile";

/**
 * Application Context Gate（issue-004）单测。
 *
 * 真机事实：Moka 未登录页上，登录手机号被判 basic.phone、导航职位搜索框被判 internship.position，
 * 两者 SAFE 且能进 ConfirmedFillPlan。本文件用一份复刻该结构的回归样本，验证：
 * 语境判定先于字段分类，非申请控件被排除为 excluded（不是 manual），
 * 而真申请区里的手机号 / 期望职位绝不受牵连（不能把手机号控件一刀切封死）。
 */

const FIXTURE = resolve(__dirname, "../fixtures/real-regressions/issue-004-moka-login-context.html");

beforeAll(() => {
  // jsdom 无布局引擎：getBoundingClientRect 恒为 0，真实浏览器有布局，此处补桩
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100, height: 24, top: 0, left: 0, bottom: 24, right: 100, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

function loadFixture(): RawField[] {
  const html = readFileSync(FIXTURE, "utf-8").replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  document.body.innerHTML = html;
  return scanPage();
}

function profileWithContent(): Profile {
  const p: Profile = structuredClone(defaultProfile);
  p.basic.name = "张小明";
  p.basic.phone = "15300001122";
  p.basic.email = "test.resume@example.com";
  p.basic.city = "测试市";
  p.education[0] = {
    school: "示例科技大学", college: "测试学院", major: "测试专业", degree: "本科",
    educationLevel: "本科", startDate: "2023.09", endDate: "2027.06", gpa: "", rank: "",
  };
  p.internships[0] = {
    company: "示例科技有限公司", department: "测试部门", position: "AI 应用实习生",
    startDate: "2026.06", endDate: "2026.09", descriptionShort: "", descriptionMedium: "",
    descriptionLong: "", responsibilities: "", workContent: "", achievements: "", summary: "",
    variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
  };
  p.jobPreferences.expectedPosition = ["AI 应用实习生"];
  return p;
}

function candidatesOf(): CandidateField[] {
  return runScanPipeline(loadFixture(), profileWithContent());
}

function byId(list: CandidateField[], id: string): CandidateField {
  const hit = list.find((c) => c.raw.context.id === id);
  if (!hit) throw new Error(`fixture 里找不到控件 #${id}（scanPage 未采集到？）`);
  return hit;
}

describe("issue-004 语境门禁：认证区", () => {
  it("登录手机号 → authentication / excluded，且不带任何内容", () => {
    const c = byId(candidatesOf(), "login-phone");
    expect(c.applicationContext?.zone).toBe("authentication");
    expect(c.applicationContext?.eligible).toBe(false);
    expect(c.status).toBe("excluded");
    expect(c.value).toBeUndefined();
  });

  it("验证码框与协议勾选：由既有的关键词忽略层先拦掉，根本不成为候选（分层防御，不重复计数）", () => {
    const ids = candidatesOf().map((c) => c.raw.context.id);
    expect(ids).not.toContain("login-sms"); // placeholder 含「验证码」→ IGNORE_KEYWORDS
    expect(ids).not.toContain("login-agree"); // 无名 checkbox 不成组 + label 含「同意」
  });

  it("「获取验证码」容器本身即认证语境：即使去掉 autocomplete 仍被排除", () => {
    const raw = classifyApplicationContext({
      labelText: "", placeholder: "请输入", ariaLabel: "", name: "code", id: "sms2", title: "",
      fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
      autocomplete: "", inputType: "text", maxLength: null, required: false, disabled: false,
      readOnly: false, currentValue: "",
      ancestorSignals: [
        { depth: 1, tag: "div", role: "", hints: [], hits: ["auth:获取验证码", "auth:验证码"] },
        { depth: 2, tag: "div", role: "dialog", hints: [], hits: ["auth:手机号登录"] },
      ],
      siblingLabels: ["请输入手机号", "获取验证码"],
    } as RawFieldContext);
    expect(raw.eligible).toBe(false);
    expect(raw.zone).toBe("authentication");
    // §四：结论必须可解释，不能只给一个 boolean
    expect(raw.reasons.join(" ")).toContain("认证");
  });
});

describe("issue-004 语境门禁：导航 / 搜索 / 全局区", () => {
  it("header 里的职位搜索框 → search 或 navigation，排除；但分类器仍认得它像 position", () => {
    const c = byId(candidatesOf(), "kw-7f8a");
    expect(["search", "navigation"]).toContain(c.applicationContext?.zone ?? "");
    expect(c.status).toBe("excluded");
    // 语义分类本身没错——错的是语境。这里证明 match 仍然算得出 position-like
    expect(["internship.position", "jobPreferences.expectedPosition", "unknown"]).toContain(c.match.fieldId);
  });

  it("footer 订阅框 → global / excluded", () => {
    const c = byId(candidatesOf(), "footer-subscribe");
    expect(c.applicationContext?.zone).toBe("global");
    expect(c.status).toBe("excluded");
  });
});

describe("issue-004 语境门禁：申请区反例（不能误伤）", () => {
  it("个人信息区里的手机号 → application / eligible，并正常拿到内容与 ready", () => {
    const c = byId(candidatesOf(), "app-phone");
    expect(c.applicationContext?.eligible).toBe(true);
    expect(c.applicationContext?.zone).toBe("application");
    expect(c.status).toBe("ready");
    expect(c.value?.value).toBe("15300001122");
  });

  it("「期望职位」不因含「职位」二字被当搜索框（§十五）", () => {
    const c = byId(candidatesOf(), "app-position");
    expect(c.applicationContext?.eligible).toBe(true);
    expect(c.status).not.toBe("excluded");
  });

  it("同页别处有「登录」二字，申请区字段不受影响（§十一：以近邻容器为准）", () => {
    const list = candidatesOf();
    for (const id of ["app-name", "app-email", "app-school"]) {
      expect(byId(list, id).applicationContext?.eligible, id).toBe(true);
    }
  });

  it("无 <form> 的申请区照样 eligible（§十六：姚记 form.length===0 仍是合法表单）", () => {
    expect(document.querySelectorAll("form").length).toBe(0);
    const list = candidatesOf();
    expect(list.filter((c) => c.raw.context.id.startsWith("app-")).every((c) => c.applicationContext?.eligible)).toBe(true);
  });
});

describe("issue-004 边界与防线", () => {
  it("零信号孤立控件 → unknown：仍可填，但拿不到 ready 默认勾选（§十 Unknown > Wrong）", () => {
    const bare: RawField = {
      reference: '{"tag":"input","idx":0}',
      kind: "text",
      options: [],
      context: {
        labelText: "X", placeholder: "", ariaLabel: "", name: "x", id: "x", title: "",
        fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
        autocomplete: "", inputType: "text", maxLength: null, required: false, disabled: false,
        readOnly: false, currentValue: "", ancestorSignals: [], siblingLabels: [],
      },
    };
    const ctx = classifyApplicationContext(bare.context);
    expect(ctx.zone).toBe("unknown");
    expect(ctx.eligible).toBe(true);
    const { status } = deriveStatus(
      bare,
      { fieldId: "basic.name", confidence: 0.95, matchedBy: "exact", evidence: [] },
      { risk: "SAFE", reason: "" } as never,
      true,
      { fieldId: "basic.name", value: "张小明", variant: "plain", editable: false, sourceType: "fact" },
    );
    expect(status).toBe("ready");
  });

  it("被排除的候选即使被强行 confirmed，也进不了 ConfirmedFillPlan（§二十一第二道防线）", () => {
    const excluded = byId(candidatesOf(), "login-phone");
    const forced: CandidateField = { ...excluded, confirmed: true, status: "need-confirm", value: { fieldId: "basic.phone", value: "15300001122", variant: "plain", editable: false, sourceType: "fact" } };
    const plan = buildFillPlan([forced], null, null);
    expect(plan.fields).toEqual([]);
  });

  it("语境排除项不得混进任何填写桶：整页只剩 5 个申请区候选", () => {
    const list = candidatesOf();
    const eligible = list.filter((c) => c.applicationContext?.eligible !== false);
    expect(eligible.map((c) => c.raw.context.id).sort()).toEqual(
      ["app-email", "app-name", "app-phone", "app-position", "app-school"],
    );
  });
});
