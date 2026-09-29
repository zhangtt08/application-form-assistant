import { describe, expect, it, beforeAll, vi } from "vitest";
import { fillFields, undoFill, locateField } from "../src/content/filler";
import { writeNativeValue, setSelectValue } from "../src/content/eventDispatcher";
import { scanPage } from "../src/content/scanner";
import { fingerprintOf } from "../src/content/domUtils";
import type { FillPlanPayload } from "../src/types/message";

/**
 * Filler 回归（验收 6/7/12 + Safety Flow Reconciliation）：
 *  - native setter + input/change 事件写入
 *  - 未确认字段保持原值（fillFields 只处理传入项）
 *  - Writer Contract：只接受 confirmed 的 ConfirmedFillPlan 载荷；未确认/空计划直接拒绝
 *  - 异步回显：下拉/日期面板在下一帧才出现选中值时也必须判定成功（真实站点的常见形态）
 */
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100,
    height: 24,
    top: 0,
    left: 0,
    bottom: 24,
    right: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  // jsdom 未实现 scrollIntoView（locateField 需要）
  Element.prototype.scrollIntoView = vi.fn();
});

/** 构造合法 ConfirmedFillPlan 载荷（模拟 writeConfirmedPlan 的产物） */
function plan(fields: FillPlanPayload["fields"], confirmed = true): FillPlanPayload {
  return { confirmed, fields };
}

describe("eventDispatcher（验收 7）", () => {
  it("input/textarea 走原生 setter 并派发 input+change（bubbles）", async () => {
    document.body.innerHTML = `<div><label for="a">姓名</label><input id="a" name="a"></div>`;
    const el = document.getElementById("a") as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener("input", (e) => events.push(`input:${(e as Event).bubbles}`));
    el.addEventListener("change", (e) => events.push(`change:${(e as Event).bubbles}`));

    const result = writeNativeValue(el, "李四");
    expect(result.ok).toBe(true);
    expect(el.value).toBe("李四");
    expect(events).toEqual(["input:true", "change:true"]);
  });

  it("select 按 value 与 text 匹配 option 并派发 change", async () => {
    document.body.innerHTML = `
      <select id="s"><option value="">请选择</option><option value="1">本科</option><option value="2">硕士</option></select>
    `;
    const el = document.getElementById("s") as HTMLSelectElement;

    const byValue = await setSelectValue(el, "2");
    expect(byValue.ok).toBe(true);
    expect(el.value).toBe("2");

    el.value = "";
    const byText = await setSelectValue(el, "本科");
    expect(byText.ok).toBe(true);
    expect(el.value).toBe("1");

    const miss = await setSelectValue(el, "不存在的选项");
    expect(miss.ok).toBe(false);
  });

  it("北森式只读自定义下拉：点击选项后写入并校验真实值", async () => {
    document.body.innerHTML = `
      <div class="form-row">
        <div class="form-label">最高学历</div>
        <div class="form-control">
          <input id="edu" readonly placeholder="请选择">
          <div class="select-dropdown" style="display:block">
            <div role="option">本科</div><div role="option">硕士</div>
          </div>
        </div>
      </div>
    `;
    document.querySelectorAll('[role="option"]').forEach((option) =>
      option.addEventListener("click", () => {
        (document.getElementById("edu") as HTMLInputElement).value = option.textContent ?? "";
      }),
    );
    const field = scanPage().find((f) => f.context.labelText === "最高学历");
    expect(field?.kind).toBe("custom-select");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "custom-select", value: "本科" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect((document.getElementById("edu") as HTMLInputElement).value).toBe("本科");
  });

  it("Ant 风格下拉：选项在点击触发器之后才渲染进 body 的弹层，也必须填上", async () => {
    document.body.innerHTML = `
      <div class="ant-select">
        <div class="ant-select-selector"><input id="ant-city" readonly><span class="ant-select-selection-item"></span></div>
      </div>
    `;
    // 站点行为：点击 selector 之后下一帧才把 dropdown 挂到 body，并把选中值写进 selection-item
    document.querySelector(".ant-select-selector")!.addEventListener("click", () => {
      const panel = document.createElement("div");
      panel.className = "ant-select-dropdown";
      panel.innerHTML = `<div class="ant-select-item ant-select-item-option">杭州</div><div class="ant-select-item ant-select-item-option">上海</div>`;
      panel.querySelectorAll("div").forEach((opt) =>
        opt.addEventListener("click", () => {
          panel.remove();
          const item = document.querySelector(".ant-select-selection-item")!;
          item.textContent = opt.textContent ?? "";
          item.setAttribute("title", opt.textContent ?? "");
        }),
      );
      document.body.appendChild(panel);
    });

    const field = scanPage().find((f) => f.kind === "custom-select");
    expect(field).toBeDefined();
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "custom-select", value: "杭州" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect(document.querySelector(".ant-select-selection-item")!.textContent).toBe("杭州");
    // 只读 input 自己是空的：读回必须看回显文本，否则真机上一批下拉全被判失败
    expect((document.getElementById("ant-city") as HTMLInputElement).value).toBe("");
  });

  it("Element/北森下拉选项没有 role 时也能按选项文本选择", async () => {
    document.body.innerHTML = `
      <div class="form-row">
        <div class="form-label">学习形式</div>
        <div class="el-select"><input id="mode" readonly placeholder="请选择"></div>
        <div class="el-select-dropdown" style="display:block">
          <div class="el-select-dropdown__item">全日制</div>
          <div class="el-select-dropdown__item">非全日制</div>
        </div>
      </div>
    `;
    document.querySelectorAll(".el-select-dropdown__item").forEach((option) =>
      option.addEventListener("click", () => {
        (document.getElementById("mode") as HTMLInputElement).value = option.textContent ?? "";
      }),
    );
    const field = scanPage().find((f) => f.context.labelText === "学习形式");
    expect(field?.kind).toBe("custom-select");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "custom-select", value: "全日制" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect((document.getElementById("mode") as HTMLInputElement).value).toBe("全日制");
  });

  it("div[role=combobox] 自定义下拉也会被扫描并填写", async () => {
    document.body.innerHTML = `
      <div class="form-row">
        <div class="form-label">最高学历</div>
        <div id="degree" role="combobox" aria-haspopup="listbox" aria-label="最高学历">请选择</div>
        <div class="dropdown" style="display:block"><div role="option">本科</div></div>
      </div>
    `;
    const trigger = document.getElementById("degree")!;
    document.querySelector('[role="option"]')!.addEventListener("click", () => { trigger.textContent = "本科"; });
    const field = scanPage().find((f) => f.context.labelText === "最高学历");
    expect(field?.kind).toBe("custom-select");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "custom-select", value: "本科" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect(trigger.textContent).toBe("本科");
  });

  it("下拉里确实没有该选项时判失败，绝不退化成填第一个", async () => {
    document.body.innerHTML = `
      <div class="el-select"><input id="absent" readonly placeholder="请选择"></div>
      <div class="el-select-dropdown" style="display:block">
        <div class="el-select-dropdown__item">全日制</div>
      </div>
    `;
    const field = scanPage().find((f) => f.kind === "custom-select");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "custom-select", value: "非全日制专升本" }]));
    expect(outcomes[0]?.status).toBe("failed");
    expect((document.getElementById("absent") as HTMLInputElement).value).toBe("");
  });

  it("日期特征在父容器时仍识别为 date 控件", () => {
    document.body.innerHTML = `
      <div class="el-date-editor el-date-editor--month">
        <label for="grad">毕业时间</label>
        <input id="grad" readonly placeholder="请选择">
      </div>
    `;
    const field = scanPage().find((f) => f.context.labelText === "毕业时间");
    expect(field?.kind).toBe("date");
  });

  it("radio 组按资料值选择对应选项", async () => {
    document.body.innerHTML = `
      <fieldset><legend>性别</legend>
        <label><input type="radio" name="gender" value="male">男</label>
        <label><input type="radio" name="gender" value="female">女</label>
      </fieldset>
    `;
    const field = scanPage().find((f) => f.kind === "radio");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "radio", value: "男" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect((document.querySelector('input[value="male"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[value="female"]') as HTMLInputElement).checked).toBe(false);
  });

  it("checkbox 组按资料里的多个词条分别勾选，命不中的不动", async () => {
    document.body.innerHTML = `
      <fieldset><legend>外语能力</legend>
        <label><input type="checkbox" name="lang" value="cet4">英语CET-4</label>
        <label><input type="checkbox" name="lang" value="cet6">英语CET-6</label>
        <label><input type="checkbox" name="lang" value="toefl">托福</label>
      </fieldset>
    `;
    const field = scanPage().find((f) => f.kind === "checkbox");
    expect(field).toBeDefined();
    const { outcomes } = await fillFields(
      plan([{ reference: field!.reference, kind: "checkbox", value: "英语CET-4、英语CET-6" }]),
    );
    expect(outcomes[0]?.status).toBe("filled");
    expect((document.querySelector('input[value="cet4"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[value="cet6"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[value="toefl"]') as HTMLInputElement).checked).toBe(false);
  });

  it("只读日期选择器允许按资料值写入并派发事件", async () => {
    document.body.innerHTML = `
      <div class="date-picker-row"><label for="p-start">开始时间</label>
        <input id="p-start" class="date-picker-input" readonly placeholder="请选择">
      </div>
    `;
    const field = scanPage().find((f) => f.context.labelText === "开始时间");
    expect(field?.kind).toBe("date");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "date", value: "2024.06" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect((document.getElementById("p-start") as HTMLInputElement).value).toBe("2024.06");
  });

  it("日期面板提供目标项时优先点击，保留组件内部状态", async () => {
    document.body.innerHTML = `
      <div class="el-date-editor el-date-editor--month">
        <label for="p-month">毕业时间</label>
        <input id="p-month" readonly placeholder="请选择">
        <div class="el-picker-panel" style="display:block">
          <div role="gridcell" data-date="2027-06">2027年06月</div>
        </div>
      </div>
    `;
    const input = document.getElementById("p-month") as HTMLInputElement;
    document.querySelector('[data-date="2027-06"]')!.addEventListener("click", () => {
      input.value = "2027-06";
    });
    const field = scanPage().find((f) => f.context.labelText === "毕业时间");
    const { outcomes } = await fillFields(plan([{ reference: field!.reference, kind: "date", value: "2027.06" }]));
    expect(outcomes[0]?.status).toBe("filled");
    expect(input.value).toBe("2027-06");
  });

  it("readonly 文本框不写，disabled 不写", async () => {
    document.body.innerHTML = `<input id="ro" readonly><input id="dis" disabled>`;
    expect(writeNativeValue(document.getElementById("dis") as HTMLInputElement, "x").ok).toBe(false);
    // 只读文本框（不是日期/下拉触发器）由策略层拒绝
    const { outcomes } = await fillFields(
      plan([{ reference: fingerprintOf(document.getElementById("ro") as HTMLElement), kind: "text", value: "x" }]),
    );
    expect(outcomes[0]?.status).toBe("failed");
  });
});

describe("fillFields（验收 6/12 + Writer Contract）", () => {
  it("只写入传入项；不在清单里的字段保持原值", async () => {
    document.body.innerHTML = `
      <div><label for="nm">姓名</label><input id="nm" name="nm" value="原值"></div>
      <div><label for="se">自我评价</label><textarea id="se"></textarea></div>
    `;
    const fields = scanPage();
    const nameRef = fields.find((f) => f.context.name === "nm")!.reference;

    const { outcomes, originals } = await fillFields(
      plan([{ reference: nameRef, kind: "text", value: "新值" }]),
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("filled");
    expect((document.getElementById("nm") as HTMLInputElement).value).toBe("新值");
    // originals 带 undoTag：撤销靠它找回元素（站点写完值后会重排 DOM，指纹不再可靠）
    expect(originals).toHaveLength(1);
    expect(originals[0]).toMatchObject({ reference: nameRef, kind: "text", previousValue: "原值" });
    expect(typeof originals[0]!.undoTag).toBe("string");
    expect((document.getElementById("se") as HTMLTextAreaElement).value).toBe("");

    const radio = await fillFields(plan([{ reference: "fake-radio-ref", kind: "radio", checked: true }]));
    expect(radio.outcomes[0]!.status).toBe("failed");
  });

  it("Writer Contract：plan.confirmed !== true → 拒绝执行，DOM 一个字节都不动", async () => {
    document.body.innerHTML = `<div><label for="g1">姓名</label><input id="g1" name="g1" value="原值"></div>`;
    const ref = scanPage().find((f) => f.context.name === "g1")!.reference;
    await expect(fillFields(plan([{ reference: ref, kind: "text", value: "新值" }], false))).rejects.toThrow(
      /未经用户确认/,
    );
    expect((document.getElementById("g1") as HTMLInputElement).value).toBe("原值");
  });

  it("Writer Contract：plan.confirmed 缺失 → 拒绝执行", async () => {
    document.body.innerHTML = `<input id="g2" name="g2" value="原值">`;
    const ref = scanPage().find((f) => f.context.name === "g2")!.reference;
    await expect(
      fillFields({ fields: [{ reference: ref, kind: "text", value: "x" }] } as unknown as FillPlanPayload),
    ).rejects.toThrow();
    expect((document.getElementById("g2") as HTMLInputElement).value).toBe("原值");
  });

  it("Writer Contract：空计划（fields.length === 0）→ 拒绝执行", async () => {
    document.body.innerHTML = `<input id="g3" name="g3" value="原值">`;
    await expect(fillFields(plan([]))).rejects.toThrow(/填写计划为空/);
    expect((document.getElementById("g3") as HTMLInputElement).value).toBe("原值");
  });

  it("指纹失效（页面变化）→ failed 而非崩溃", async () => {
    document.body.innerHTML = `<div>空页面</div>`;
    const { outcomes } = await fillFields(
      plan([{ reference: '{"tag":"input","type":"text","name":"gone","id":"","label":"","idx":0}', kind: "text", value: "x" }]),
    );
    expect(outcomes[0]!.status).toBe("failed");
  });

  it("Undo 恢复原值（验收 11 辅助）", async () => {
    document.body.innerHTML = `<div><label for="u">姓名</label><input id="u" name="u" value="old"></div>`;
    const { originals } = await fillFields(
      plan([{ reference: scanPage().find((f) => f.context.name === "u")!.reference, kind: "text", value: "new" }]),
    );
    expect((document.getElementById("u") as HTMLInputElement).value).toBe("new");
    const { restored, failed } = await undoFill(originals);
    expect(restored).toBe(1);
    expect(failed).toBe(0);
    expect((document.getElementById("u") as HTMLInputElement).value).toBe("old");
  });
});

describe("指纹定位回归（姚记 ATS 类无 name/id/label 表单）", () => {
  it("仅靠 placeholder 区分的字段：各指纹必须命中各自元素，不能都落到第一个", async () => {
    document.body.innerHTML = `
      <div><div>姓名</div><input type="text" placeholder="请输入姓名"></div>
      <div><div>手机号码</div><input type="text" placeholder="请输入手机号码"></div>
    `;
    const fields = scanPage();
    const nameField = fields.find((f) => f.context.placeholder === "请输入姓名");
    const phoneField = fields.find((f) => f.context.placeholder === "请输入手机号码");
    expect(nameField).toBeDefined();
    expect(phoneField).toBeDefined();

    const { outcomes } = await fillFields(
      plan([
        { reference: nameField!.reference, kind: "text", value: "张三" },
        { reference: phoneField!.reference, kind: "text", value: "13800000000" },
      ]),
    );
    expect(outcomes.map((o) => o.status)).toEqual(["filled", "filled"]);

    const inputs = document.querySelectorAll("input");
    expect(inputs[0]!.value).toBe("张三");
    expect(inputs[1]!.value).toBe("13800000000");
  });

  it("属性完全雷同的孪生输入框：靠结构路径 + 同类序号消歧", async () => {
    document.body.innerHTML = `
      <input type="text" placeholder="请输入内容"><input type="text" placeholder="请输入内容">
    `;
    const inputs = document.querySelectorAll("input");
    const ref0 = fingerprintOf(inputs[0]!);
    const ref1 = fingerprintOf(inputs[1]!);
    expect(ref0).not.toBe(ref1);

    await fillFields(plan([{ reference: ref1, kind: "text", value: "第二个" }]));
    expect(inputs[0]!.value).toBe("");
    expect(inputs[1]!.value).toBe("第二个");
  });

  it("同名同 label 的重复表单块：结构路径让每个块各填各的", async () => {
    document.body.innerHTML = `
      <div class="block"><div>公司名称</div><input type="text"></div>
      <div class="block"><div>公司名称</div><input type="text"></div>
    `;
    const inputs = document.querySelectorAll("input");
    const refs = [fingerprintOf(inputs[0] as HTMLElement), fingerprintOf(inputs[1] as HTMLElement)];
    expect(refs[0]).not.toBe(refs[1]);
    await fillFields(plan([
      { reference: refs[0]!, kind: "text", value: "甲公司" },
      { reference: refs[1]!, kind: "text", value: "乙公司" },
    ]));
    expect((inputs[0] as HTMLInputElement).value).toBe("甲公司");
    expect((inputs[1] as HTMLInputElement).value).toBe("乙公司");
  });

  it("页面在字段前面异步插入一个控件后，指纹仍能找回原来那个", async () => {
    document.body.innerHTML = `
      <div id="wrap">
        <div>姓名</div><input type="text" id="target" name="realname" placeholder="姓名">
      </div>
    `;
    const ref = fingerprintOf(document.getElementById("target") as HTMLElement);
    // 站点插了一个前置控件：同类序号变了，结构路径也变了，但 name/label 身份仍在
    const extra = document.createElement("input");
    extra.type = "text";
    extra.name = "other";
    const wrap = document.getElementById("wrap")!;
    wrap.insertBefore(extra, wrap.firstChild);
    const res = await fillFields(plan([{ reference: ref, kind: "text", value: "张三" }]));
    expect(res.outcomes[0]!.status).toBe("filled");
    expect((document.getElementById("target") as HTMLInputElement).value).toBe("张三");
    expect((extra as HTMLInputElement).value).toBe("");
  });

  it("locateField 高亮的是指纹对应的元素本身", () => {
    document.body.innerHTML = `
      <input type="text" placeholder="A"><input type="text" placeholder="B">
    `;
    const inputs = document.querySelectorAll("input");
    expect(locateField(fingerprintOf(inputs[1]!))).toBe(true);
    expect(inputs[0]!.style.outline).toBe("");
    expect(inputs[1]!.style.outline).toContain("2563eb");
  });
});
