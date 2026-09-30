import { describe, expect, it, beforeAll, vi } from "vitest";
import { setCustomSelectValue } from "../src/content/eventDispatcher";

/**
 * 同页并发弹层的串扰（HANDOVER §5.3）：
 * 上一个下拉还开着就点下一个时，选项是**全 document** 查的，
 * 两个弹层里同名选项（真机见过：城市与省份都有「杭州」）会被点错一个 —— 错填。
 * 现在按「点自己触发器之后才出现的优先 → 离触发器近的优先」排序后再匹配文本。
 */

beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 120, height: 26, top: 0, left: 0, bottom: 26, right: 120, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

function antSelect(id: string, label: string): string {
  return `
    <div class="form-row">
      <label>${label}</label>
      <div class="ant-select" id="${id}">
        <div class="ant-select-selector">
          <input readonly placeholder="请选择">
          <span class="ant-select-selection-item"></span>
        </div>
      </div>
    </div>`;
}

describe("并发弹层隔离", () => {
  it("别的下拉已经开着且含同名选项时，只点自己弹层里的那一项", async () => {
    document.body.innerHTML = `${antSelect("city", "城市")}${antSelect("province", "省份")}
      <div class="ant-select-dropdown" data-owner="province">
        <div class="ant-select-item ant-select-item-option">杭州</div>
        <div class="ant-select-item ant-select-item-option">广州</div>
      </div>`;

    // 省份的下拉在页面加载时就是打开状态（站点自己的状态），它的选项一直挂在 body 上
    const provincePopup = document.querySelector('[data-owner="province"]')!;
    provincePopup.querySelectorAll(".ant-select-item").forEach((opt) =>
      opt.addEventListener("click", () => {
        document.querySelector("#province .ant-select-selection-item")!.textContent = opt.textContent;
      }),
    );

    // 城市：点自己的触发器之后才挂出自己的弹层（里面同样有「杭州」）
    document.querySelector("#city .ant-select-selector")!.addEventListener("click", () => {
      if (document.querySelector('[data-owner="city"]')) return;
      const panel = document.createElement("div");
      panel.className = "ant-select-dropdown";
      panel.dataset.owner = "city";
      panel.innerHTML =
        '<div class="ant-select-item ant-select-item-option">杭州</div><div class="ant-select-item ant-select-item-option">上海</div>';
      panel.querySelectorAll(".ant-select-item").forEach((opt) =>
        opt.addEventListener("click", () => {
          document.querySelector("#city .ant-select-selection-item")!.textContent = opt.textContent;
        }),
      );
      document.body.appendChild(panel);
    });

    const cityInput = document.querySelector("#city input") as HTMLInputElement;
    const res = await setCustomSelectValue(cityInput, "杭州");
    expect(res.ok, res.detail ?? "").toBe(true);
    expect(document.querySelector("#city .ant-select-selection-item")!.textContent).toBe("杭州");
    // 关键：省份那个「杭州」没有被顺手点掉
    expect(document.querySelector("#province .ant-select-selection-item")!.textContent ?? "").toBe("");
  });
});
