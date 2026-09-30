import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import { assessRisk } from "../src/rules/riskRules";
import { resolveValue } from "../src/profile/profileResolver";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 英文 ATS（Greenhouse / Lever / Workable / Workday 形态）的标签覆盖。
 * 这些站的姓名一律拆成 First name + Last name，城市问「Where are you based?」，
 * 中文词表对不上就是整片「识别不到 / 少填」——这里钉住，顺带钉住「不许抢中文站的标签」。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function input(partial: Partial<RawFieldContext> = {}): RawField {
  return { reference: '{"tag":"input"}', kind: "text", context: ctx(partial), options: [] };
}

function matched(field: RawField): { fieldId: string; confidence: number } {
  const m = matchField(field);
  return { fieldId: m.fieldId, confidence: m.confidence };
}

describe("英文站标签", () => {
  it("First name / Last name 分别落到 名 / 姓", () => {
    expect(matched(input({ labelText: "First name", name: "first_name" })).fieldId).toBe("basic.givenName");
    expect(matched(input({ labelText: "Last name", name: "last_name" })).fieldId).toBe("basic.surname");
    expect(matched(input({ labelText: "Full name" })).fieldId).toBe("basic.name");
  });

  it("标准 autocomplete 信号优先于猜标签", () => {
    expect(matched(input({ labelText: "Your given name", autocomplete: "given-name" })).fieldId).toBe("basic.givenName");
    expect(matched(input({ labelText: "Family name on passport", autocomplete: "family-name" })).fieldId).toBe("basic.surname");
  });

  it("GitHub URL 认得到，且不会被 portfolio / linkedin 抢走", () => {
    expect(matched(input({ labelText: "GitHub URL" })).fieldId).toBe("basic.github");
    expect(matched(input({ labelText: "代码仓库" })).fieldId).toBe("basic.github");
  });

  it("LinkedIn profile 与 Portfolio / website 是两个不同来源", () => {
    expect(matched(input({ labelText: "LinkedIn profile" })).fieldId).toBe("basic.linkedin");
    expect(matched(input({ labelText: "Portfolio / website", autocomplete: "url" })).fieldId).toBe("basic.portfolio");
  });

  it("Where are you based? 是现居城市，不是期望工作地", () => {
    expect(matched(input({ labelText: "Where are you based?" })).fieldId).toBe("basic.city");
    // 中文站原有的映射不能被英文别名抢走
    expect(matched(input({ labelText: "期望城市" })).fieldId).toBe("job.expectedCity");
    expect(matched(input({ labelText: "所在城市" })).fieldId).toBe("basic.city");
  });

  it("授权 / 签证类问句：即使认得也判 MANUAL_ONLY，不代替用户声明", () => {
    const signals = {
      labelText: "Are you legally authorized to work in the United States?",
      ariaLabel: "", placeholder: "", title: "", fieldsetLabel: "", sectionTitle: "",
    };
    const r = assessRisk("unknown", signals);
    expect(r.risk).toBe("MANUAL_ONLY");
    const sponsorship = assessRisk("unknown", {
      ...signals,
      labelText: "Will you now or in the future require sponsorship for employment visa status?",
    });
    expect(sponsorship.risk).toBe("MANUAL_ONLY");
  });

  it("姓 / 名两段在资料库里就取值（没填则留空，绝不拆整名）", () => {
    const p = structuredClone(defaultProfile);
    p.basic.name = "赵合一";
    expect(resolveValue("basic.surname", p)).toBeUndefined();
    expect(resolveValue("basic.givenName", p)).toBeUndefined();
    p.basic.surname = "赵";
    p.basic.givenName = "合一";
    expect(resolveValue("basic.surname", p)?.value).toBe("赵");
    expect(resolveValue("basic.givenName", p)?.value).toBe("合一");
  });
});
