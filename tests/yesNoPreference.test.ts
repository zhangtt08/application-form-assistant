import { describe, expect, it, beforeAll, vi } from "vitest";
import { polarityMatches, polarityOf, polarityTerms } from "../src/rules/yesNoAnswers";
import { matchField } from "../src/matching/matcher";
import { riskOfFieldId } from "../src/rules/riskRules";
import { optionSetCoversValue } from "../src/pipeline/scanPipeline";
import { resolveValue } from "../src/profile/profileResolver";
import { defaultProfile } from "../src/profile/defaultProfile";
import { setCustomSelectValue, setRadioValue, setSelectValue } from "../src/content/eventDispatcher";
import { valueMatchesRequested } from "../src/content/domUtils";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 「是否…」单选题：资料库答一次 → 全网申自动勾选。
 * 三段链路必须用同一份同义表（选项覆盖判定 / 点哪个选项 / 写入回读），
 * 任何一段口径不一致都会表现成「说能填，却点了反义词」或「填对了却报失败」。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "radio", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function radioField(labelText: string, options: string[]): RawField {
  return { reference: '{"tag":"input"}', kind: "radio", context: ctx({ labelText, inputType: "radio" }), options };
}

describe("是/否 同义表", () => {
  it("同极性写法互相认得，反义写法绝不认", () => {
    expect(polarityMatches("是", "可以接受")).toBe(true);
    expect(polarityMatches("是", "接受")).toBe(true);
    expect(polarityMatches("是", "Yes")).toBe(true);
    expect(polarityMatches("是", "不接受")).toBe(false);
    expect(polarityMatches("否", "不接受")).toBe(true);
    expect(polarityMatches("否", "接受")).toBe(false);
  });

  it("非「是/否」类答案不参与极性扩展（杭州不是「是」）", () => {
    expect(polarityTerms("杭州")).toBeNull();
    expect(polarityMatches("本科", "是")).toBe(false);
  });

  it("归一化导入答案：可以/同意/不接受 → 是 / 否 / 空", () => {
    expect(polarityOf("可以")).toBe("yes");
    expect(polarityOf("同意")).toBe("yes");
    expect(polarityOf("不方便")).toBe("no");
    expect(polarityOf("")).toBeNull();
    expect(polarityOf("视情况而定")).toBeNull();
  });
});

describe("是/否 偏好识别与取值", () => {
  it("常见「是否…」题各有 canonical id", () => {
    const cases: [string, string][] = [
      ["是否接受线下面试", "job.acceptOfflineInterview"],
      ["能否接受线上面试", "job.acceptOnlineInterview"],
      ["是否接受出差", "job.acceptBusinessTrip"],
      ["是否接受异地工作", "job.acceptRelocation"],
      ["是否接受加班", "job.acceptOvertime"],
    ];
    for (const [label, fieldId] of cases) {
      const m = matchField(radioField(label, ["是", "否"]));
      expect(m.fieldId, label).toBe(fieldId);
      expect(riskOfFieldId(fieldId).risk, fieldId).toBe("SAFE");
    }
  });

  it("问句形态的标签才匹配：「对加班的看法」这种文本框不能被当成单选题", () => {
    const m = matchField({
      reference: "{}",
      kind: "text",
      context: ctx({ labelText: "对加班的看法", inputType: "text" }),
      options: [],
    });
    expect(m.fieldId).not.toBe("job.acceptOvertime");
  });

  it("资料库里记着答案 → 取到「是」；没记 → undefined（留空，不猜）", () => {
    const p = structuredClone(defaultProfile);
    expect(resolveValue("job.acceptOfflineInterview", p)).toBeUndefined();
    p.jobPreferences.acceptOfflineInterview = "是";
    expect(resolveValue("job.acceptOfflineInterview", p)?.value).toBe("是");
  });

  it("站点选项写法不同也算「覆盖」，不会退回需人工", () => {
    expect(optionSetCoversValue(["可以接受", "不接受"], "是")).toBe(true);
    expect(optionSetCoversValue(["Accept", "Do not accept"], "否")).toBe(true);
    expect(optionSetCoversValue(["接受", "不接受"], "否")).toBe(true);
    expect(optionSetCoversValue(["每周一次", "两周一次"], "是")).toBe(false);
  });
});

describe("是/否 写入与回读", () => {
  beforeAll(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 100, height: 24, top: 0, left: 0, bottom: 24, right: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  it("资料里是「是」，站点选项是「可以接受」→ 勾中可以接受，不是不接受", async () => {
    document.body.innerHTML = `
      <div>
        <span id="q">是否接受线下面试</span>
        <label for="y"><input type="radio" name="offline" id="y">可以接受</label>
        <label for="n"><input type="radio" name="offline" id="n">不接受</label>
      </div>`;
    const yes = document.getElementById("y") as HTMLInputElement;
    const no = document.getElementById("n") as HTMLInputElement;
    const res = await setRadioValue(yes, "是");
    expect(res.ok, res.detail ?? "").toBe(true);
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    expect(valueMatchesRequested(yes, "是")).toBe(true);
  });

  it("资料里是「否」→ 勾中不接受", async () => {
    document.body.innerHTML = `
      <div>
        <label for="y2"><input type="radio" name="trip" id="y2">接受</label>
        <label for="n2"><input type="radio" name="trip" id="n2">不接受</label>
      </div>`;
    const accept = document.getElementById("y2") as HTMLInputElement;
    const reject = document.getElementById("n2") as HTMLInputElement;
    const res = await setRadioValue(accept, "否");
    expect(res.ok, res.detail ?? "").toBe(true);
    expect(reject.checked).toBe(true);
    expect(accept.checked).toBe(false);
  });

  it("回读的同极性判定只对选择类控件开放：文本框里躺着「可以」不算填了「是」", () => {
    document.body.innerHTML = `<input id="t" value="可以">`;
    const el = document.getElementById("t") as HTMLInputElement;
    expect(valueMatchesRequested(el, "是")).toBe(false);
  });

  it("原生 select 的选项写成「可以接受 / 不接受」→ selected 是「可以接受」", async () => {
    document.body.innerHTML = `
      <select id="s">
        <option value="">请选择</option>
        <option value="ok">可以接受</option>
        <option value="no">不接受</option>
      </select>`;
    const el = document.getElementById("s") as HTMLSelectElement;
    const res = await setSelectValue(el, "是");
    expect(res.ok, res.detail ?? "").toBe(true);
    expect(el.selectedOptions[0]?.textContent?.trim()).toBe("可以接受");
  });

  it("自研下拉（选项静态写在 DOM 里）也能按同极性命中，且不会点反义词", async () => {
    document.body.innerHTML = `
      <div class="form-row">
        <div class="form-label">是否接受线下面试</div>
        <div class="el-select"><input id="offline" readonly placeholder="请选择"></div>
        <div class="el-select-dropdown" style="display:block">
          <div class="el-select-dropdown__item">可以接受</div>
          <div class="el-select-dropdown__item">不接受</div>
        </div>
      </div>`;
    const clicked: string[] = [];
    document.querySelectorAll(".el-select-dropdown__item").forEach((option) =>
      option.addEventListener("click", () => {
        clicked.push(option.textContent ?? "");
        (document.getElementById("offline") as HTMLInputElement).value = option.textContent ?? "";
      }),
    );
    const offline = document.getElementById("offline") as HTMLInputElement;
    // Scanner 交给写入层的就是这个只读 input（`.el-select` div 不是控件，扫不到）
    const res = await setCustomSelectValue(offline, "是");
    expect(res.ok, res.detail ?? "").toBe(true);
    expect(clicked).toEqual(["可以接受"]);
    expect(offline.value).toBe("可以接受");
  });
});
