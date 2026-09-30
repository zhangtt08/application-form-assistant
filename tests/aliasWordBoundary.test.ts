import { describe, expect, it, beforeAll, vi } from "vitest";
import { scanPage } from "../src/content/scanner";
import { matchField } from "../src/matching/matcher";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 别名匹配的「词边界」与「自证类问题」守卫（Greenhouse 真机回归）。
 *
 * 真机上实测到的错填（改造前）：
 *  - `city` 命中 `ethni|city|` → 「Are you Hispanic/Latino?」被认成「所在城市」并写入城市；
 *  - `tel` 命中 `|tel|l` → 「Tell us about your proudest accomplishment.」被认成手机号并写入号码；
 *  - `tel` 命中 `la|tel|ino` → 「Country」被父级文本带偏成手机号。
 * 结论：英文（纯 ASCII）别名必须整词命中；中文没有词边界，仍走包含式。
 * 另：人口统计 / 自证类问题（民族、种族、残障、兵役…）永远不自动写。
 */

beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 120, height: 26, top: 0, left: 0, bottom: 26, right: 120, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function field(labelText: string, extra: Partial<RawFieldContext> = {}, kind: RawField["kind"] = "text"): RawField {
  return { reference: "{}", kind, context: ctx({ labelText, ...extra }), options: [] };
}

describe("英文别名整词命中", () => {
  it("真机误匹配三例全部不再命中", () => {
    expect(matchField(field("Are you Hispanic/Latino?", { id: "hispanic_ethnicity" })).fieldId).toBe("unknown");
    expect(matchField(field("Tell us about your proudest accomplishment.", { id: "question_123" }, "textarea")).fieldId).toBe("unknown");
    expect(matchField(field("Country", { id: "country" })).fieldId).toBe("unknown");
  });

  it("正常英文标签照常命中（边界不能把覆盖打掉）", () => {
    expect(matchField(field("Location (City)", { id: "location_city" })).fieldId).toBe("basic.city");
    expect(matchField(field("Phone number", { inputType: "tel" })).fieldId).toBe("basic.phone");
    expect(matchField(field("Email address", { inputType: "email" })).fieldId).toBe("basic.email");
    expect(matchField(field("First name", { autocomplete: "given-name" })).fieldId).toBe("basic.givenName");
  });

  it("中文仍是包含式匹配（没有词边界可言）", () => {
    expect(matchField(field("手机号码", { inputType: "tel" })).fieldId).toBe("basic.phone");
    expect(matchField(field("请填写您的电子邮箱", { inputType: "email" })).fieldId).toBe("basic.email");
  });

  it("「电子邮箱地址」同时含「邮箱」与「地址」：控件 type 决断同分冲突，不再白丢一个字段", () => {
    const withType = matchField(field("电子邮箱地址", { inputType: "email" }));
    expect(withType.fieldId).toBe("basic.email");
    expect(withType.confidence).toBeGreaterThanOrEqual(0.9);
    expect(withType.evidence.join(" ")).toContain("决断同分冲突");
    // 没有 type 声明可依时仍然宁缺勿错
    expect(matchField(field("电子邮箱地址", { inputType: "text" })).fieldId).toBe("unknown");
  });
});

describe("自证 / 人口统计类问题永不代填", () => {
  it("民族、种族、残障、兵役类问题一律 unknown", () => {
    const cases: [string, Partial<RawFieldContext>][] = [
      ["What is your race?", { id: "race" }],
      ["Do you have a disability?", { id: "disability" }],
      ["Veteran Status", { id: "veteran_status" }],
      ["民族", { id: "nation" }],
      ["是否退伍军人", { name: "veteran" }],
    ];
    for (const [label, extra] of cases) {
      expect(matchField(field(label, extra)).fieldId, label).toBe("unknown");
    }
  });

  it("性别 / 出生日期是资料库里的正常字段，不受该守卫影响", () => {
    expect(matchField(field("Gender", { id: "gender" })).fieldId).toBe("basic.gender");
    expect(matchField(field("Date of birth", { id: "dob" })).fieldId).toBe("basic.birthDate");
  });
});

describe("真实 Greenhouse 表单片段（整页扫描）", () => {
  it("姓名/邮箱/电话/城市/LinkedIn 填得进，EEO 题不动", () => {

    document.body.innerHTML = `
      <form>
        <label id="first-label" for="first_name">First Name*</label>
        <input id="first_name" name="first_name" autocomplete="given-name">
        <label id="last-label" for="last_name">Last Name*</label>
        <input id="last_name" name="last_name" autocomplete="family-name">
        <label id="email-label" for="email">Email*</label>
        <input id="email" name="email" type="email" autocomplete="email">
        <label id="loc-label" for="location">Location (City)*</label>
        <input id="location" name="location">
        <div class="eeoc__question__wrapper">
          <label id="hispanic-label" for="hispanic_ethnicity" class="select__label">Are you Hispanic/Latino?</label>
          <div class="select-shell">
            <div class="select__placeholder">Select...</div>
            <input class="select__input" id="hispanic_ethnicity" type="text" role="combobox"
                   aria-haspopup="true" aria-labelledby="hispanic-label" autocomplete="off" value="">
          </div>
        </div>
      </form>`;
    const ids = new Map(scanPage().map((f) => [f.context.labelText.trim(), matchField(f).fieldId]));
    expect(ids.get("First Name*")).toBe("basic.givenName");
    expect(ids.get("Last Name*")).toBe("basic.surname");
    expect(ids.get("Email*")).toBe("basic.email");
    expect(ids.get("Location (City)*")).toBe("basic.city");
    expect(ids.get("Are you Hispanic/Latino?")).toBe("unknown");
  });
});

describe("组合控件的子控件不继承分组标题（Greenhouse 电话控件）", () => {
  it("fieldset 的 legend 是 Phone，但 Country 下拉不是手机号", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Phone</legend>
        <label id="country-label" for="country">Country</label>
        <input id="country" class="select__input" role="combobox" aria-labelledby="country-label" autocomplete="off">
        <label id="phone-label" for="phone">Phone*</label>
        <input id="phone" type="tel" autocomplete="tel">
      </fieldset>`;
    const ids = new Map(scanPage().map((f) => [f.context.labelText.trim(), matchField(f).fieldId]));
    expect(ids.get("Country")).toBe("unknown");
    expect(ids.get("Phone*")).toBe("basic.phone");
  });
});
