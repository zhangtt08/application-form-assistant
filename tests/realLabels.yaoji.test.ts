import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 真机标签回归：以下 12 个标签是从姚记招聘官网前端产物（`ApplicationFormField label:"…"`）
 * 里抠出来的**实际渲染文案**，不是编造的样本。
 * 目的：识别层对真实站点的覆盖情况必须能被离线复现，站点加字段时这里会先红。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function radio(labelText: string, name: string, options: string[]): RawField {
  return {
    reference: '{"tag":"input"}',
    kind: "radio",
    context: ctx({ labelText, name, inputType: "radio" }),
    options,
  };
}

function text(labelText: string, inputType = "text"): RawField {
  return { reference: '{"tag":"input"}', kind: "text", context: ctx({ labelText, inputType }), options: [] };
}

describe("姚记真机表单标签（真机产物文案）", () => {
  it("可自动填写的标签全部认得到", () => {
    const cases: [RawField, string][] = [
      [text("姓名"), "basic.name"],
      [text("年龄", "number"), "basic.age"],
      [radio("性别", "gender", ["男", "女"]), "basic.gender"],
      [text("手机号码", "tel"), "basic.phone"],
      [text("电子邮箱", "email"), "basic.email"],
      [text("当前所在城市"), "basic.city"],
      [radio("学历", "degree", ["本科", "硕士"]), "education.degree"],
      [text("毕业院校"), "education.school"],
      [text("毕业年份", "number"), "education.endDate"],
      [text("专业"), "education.major"],
      // 这题之前恒留人工：选项文案就是「是 / 否」，资料库答过一次即可自动勾选
      [radio("是否接受线下面试", "acceptOfflineInterview", ["是", "否"]), "job.acceptOfflineInterview"],
    ];
    for (const [field, fieldId] of cases) {
      const m = matchField(field);
      expect(m.fieldId, m.evidence.join(" / ")).toBe(fieldId);
    }
  });

  it("推荐人 / 内推码是「别人的信息」，绝不用应聘者自己的资料顶替", () => {
    // 「推荐人姓名」含「姓名」，包含式别名会把张三写进推荐人栏 —— 真机错填形态
    const referrer = matchField(text("推荐人姓名"));
    expect(referrer.fieldId).toBe("unknown");
    expect(referrer.evidence.join(" ")).toContain("不是你的信息");

    const referrerPhone = matchField(text("推荐人手机号码", "tel"));
    expect(referrerPhone.fieldId).toBe("unknown");

    // 内推码资料库里没有来源，也只能留空
    expect(matchField(text("内推码")).fieldId).toBe("unknown");
  });

  it("紧急联系人是「他人资料」，但有专属 canonical，正常成立", () => {
    expect(matchField(text("紧急联系人姓名")).fieldId).toBe("basic.emergencyContactName");
    expect(matchField(text("紧急联系人电话", "tel")).fieldId).toBe("basic.emergencyContactPhone");
  });
});
