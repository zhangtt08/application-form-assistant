import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import { riskOfFieldId } from "../src/rules/riskRules";
import { resolveValue } from "../src/profile/profileResolver";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 「是否有实习经历 / 是否有项目经验」这类是非题：答案从资料库已有的条目**单向**推出。
 *
 * 关键约束：有条目才答「是」，条目为空时不答「否」——「没录进资料库」和「没有这段经历」
 * 是两回事，替用户答「否」就是在编造事实。
 * 另一条约束：别名只写完整问句。裸名词（「实习经历」）会命中
 * 「请描述你的实习经历」这种 textarea，把「是」塞进描述框就是错填。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "radio", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function radio(labelText: string, options: string[]): RawField {
  return { reference: '{"tag":"input"}', kind: "radio", context: ctx({ labelText }), options };
}

describe('「是否有 X 经历」是非题', () => {
  it("问句形态的标签落到 hasExperience 系 canonical", () => {
    const cases: [string, string][] = [
      ["是否有实习经历", "internship.hasExperience"],
      ["您是否有过实习经历", "internship.hasExperience"],
      ["是否有相关工作经验", "internship.hasExperience"],
      ["是否有项目经验", "project.hasExperience"],
      ["是否参与过项目", "project.hasExperience"],
    ];
    for (const [label, fieldId] of cases) {
      const m = matchField(radio(label, ["是", "否"]));
      expect(m.fieldId, label).toBe(fieldId);
      expect(riskOfFieldId(fieldId).risk, fieldId).toBe("SAFE");
    }
  });

  it("「请描述你的实习经历」这种描述框不会被当成是非题", () => {
    const m = matchField({
      reference: "{}",
      kind: "textarea",
      context: ctx({ labelText: "请描述你的实习经历", inputType: "textarea" }),
      options: [],
    });
    expect(m.fieldId).not.toBe("internship.hasExperience");
  });

  it("有条目 → 「是」；条目清空 → 不回答（绝不答「否」）", () => {
    const withEntries = structuredClone(defaultProfile);
    expect(withEntries.internships.length).toBeGreaterThan(0);
    expect(resolveValue("internship.hasExperience", withEntries)?.value).toBe("是");
    expect(resolveValue("project.hasExperience", withEntries)?.value).toBe("是");

    const emptied = structuredClone(defaultProfile);
    emptied.internships = [];
    emptied.projects = [];
    expect(resolveValue("internship.hasExperience", emptied)).toBeUndefined();
    expect(resolveValue("project.hasExperience", emptied)).toBeUndefined();
  });

  it("站点选项写成 Yes/No 也算覆盖（同极性写法表与偏好题共用）", () => {
    const m = matchField(radio("是否有实习经历", ["Yes", "No"]));
    expect(m.fieldId).toBe("internship.hasExperience");
  });
});
