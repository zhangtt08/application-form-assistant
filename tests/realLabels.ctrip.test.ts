import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 真机标签回归：以下文案是从携程招聘官网（careers.ctrip.com）页面内联的前端产物里
 * grep 出来的**实际字符串**（2026-09-30，curl + grep 引号串），不是编造的样本。
 * 携程的「候选人X（请勿填写你的个人信息）」是**内推人替被推荐人填**的表 ——
 * 那是别人的信息，扩展永不代填（红线：别人的信息不用应聘者自己的资料顶）。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function text(labelText: string, inputType = "text", extra: Partial<RawFieldContext> = {}): RawField {
  return { reference: '{"tag":"input"}', kind: "text", context: ctx({ labelText, inputType, ...extra }), options: [] };
}

describe("携程招聘官网真机标签（官网 bundle 实际文案）", () => {
  it("「候选人…（请勿填写你的个人信息）」绝不落到应聘者自己的资料", () => {
    for (const [label, type] of [
      ["候选人姓名（请勿填写你的个人信息）", "text"],
      ["候选人手机号（请勿填写你的个人信息）", "tel"],
      ["候选人邮箱（请勿填写你的个人信息）", "email"],
    ] as [string, string][]) {
      const m = matchField(text(label, type));
      expect(m.fieldId, label).toBe("unknown");
    }
  });

  it("裸「候选人信息」不是一刀切信号：应聘者本人的栏目照常识别（北森/大易把本人资料区就叫这个名字）", () => {
    expect(matchField(text("姓名", "text", { sectionTitle: "候选人信息" })).fieldId).toBe("basic.name");
    expect(matchField(text("手机号码", "tel", { sectionTitle: "候选人信息" })).fieldId).toBe("basic.phone");
  });

  it("内推码与推荐人保持人工（站点自己的文案：分享职位/我的内推码）", () => {
    expect(matchField(text("我的内推码")).fieldId).toBe("unknown");
    expect(matchField(text("推荐人姓名")).fieldId).toBe("unknown");
  });
});
