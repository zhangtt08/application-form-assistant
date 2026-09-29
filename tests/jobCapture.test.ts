import { afterEach, describe, expect, it } from "vitest";
import { extractRawJobPage } from "../src/content/jobCapture";

/**
 * Issue #001/#002 capture 端回归：
 * - Moka 等 SPA 面板的职位名不在 <h1> 里（.job-name 类节点）
 * - Issue #002：真实 h1 与职位详情节点分开采集（h1Texts / jobDetailTitles），
 *   供 parser 做来源打分（real h1 1.0 > detail node 0.95）。
 * - 长度过滤（2..60）：职位列表大容器被自然排除。
 */

function setDom(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("jobCapture — 详情标题节点采集（Issue #002 Case A-D）", () => {
  it("Case A：只有 .job-name（无 h1）→ 采集进 jobDetailTitles", () => {
    setDom(`
      <div class="job-detail-panel">
        <div class="job-name">载具策划 - 3C（望月）- 202X</div>
        <div class="job-desc">岗位职责：负责载具策划。</div>
      </div>
    `);
    const raw = extractRawJobPage();
    expect(raw.h1Texts).toEqual([]);
    expect(raw.jobDetailTitles?.[0]).toBe("载具策划 - 3C（望月）- 202X");
  });

  it("Case B：h1 + .job-name 同时存在 → h1 进 h1Texts，详情节点进 jobDetailTitles（互不混入）", () => {
    setDom(`
      <h1>高级游戏策划</h1>
      <div class="job-name">错误候选</div>
    `);
    const raw = extractRawJobPage();
    expect(raw.h1Texts).toEqual(["高级游戏策划"]);
    expect(raw.jobDetailTitles).toEqual(["错误候选"]);
  });

  it("Case C：.job-name 文本过长（职位列表大容器，含大量策划岗位）→ 长度过滤拒绝", () => {
    const roles = ["游戏策划", "运营策划", "系统策划", "战斗策划", "数值策划", "关卡策划", "文案策划", "主策划"];
    const longList = roles.map((r) => `<div class="job-item">${r}-某项目组-2027校园招聘-广州站</div>`).join("");
    setDom(`<div class="job-name">${longList}</div>`);
    const raw = extractRawJobPage();
    expect(raw.h1Texts).toEqual([]);
    expect(raw.jobDetailTitles).toBeUndefined();
  });

  it("Case D：多个 .job-name（短详情标题 + 长列表容器）→ 只采短的可信标题", () => {
    const longList = Array.from(
      { length: 12 },
      (_, i) => `<div class="job-item">职位${i}策划-部门${i}-2027校园招聘-工作地点广州-岗位职责描述文本</div>`,
    ).join("");
    setDom(`
      <div class="job-name">载具策划 - 3C（望月）- 202X</div>
      <div class="job-name job-list">${longList}</div>
    `);
    const raw = extractRawJobPage();
    expect(raw.jobDetailTitles).toEqual(["载具策划 - 3C（望月）- 202X"]);
  });

  it("camelCase 类名 jobName / jobTitle 同样命中 jobDetailTitles", () => {
    setDom(`<div class="jobTitle">资深策划师</div>`);
    const raw = extractRawJobPage();
    expect(raw.jobDetailTitles?.[0]).toBe("资深策划师");
  });

  it("h1.job-name 组合节点（Issue #001 fixture 结构）→ 属于真实 h1，进 h1Texts", () => {
    setDom(`<aside class="job-detail-panel"><h1 class="job-name">机器人产品助理实习生</h1></aside>`);
    const raw = extractRawJobPage();
    expect(raw.h1Texts).toEqual(["机器人产品助理实习生"]);
    expect(raw.jobDetailTitles).toBeUndefined();
  });

  it("真实 h1 优先：详情节点不会挤掉 h1（Issue #002 来源优先级的前置）", () => {
    setDom(`
      <h1>游戏测试工程师-27届秋招</h1>
      <div class="job-name">别的候选</div>
    `);
    const raw = extractRawJobPage();
    expect(raw.h1Texts[0]).toContain("游戏测试工程师");
    expect(raw.jobDetailTitles?.[0]).toBe("别的候选");
  });

  it("Moka 设计系统标题节点（sd-foundation-heading，2026-09 真机结构）→ jobDetailTitles", () => {
    setDom(`
      <div class="left-panel-abc">
        <div class="title-ROUQFdjmhP sd-foundation-heading-40-axnSz">载具策划 - 3C（望月）-2027届校招</div>
        <div class="sd-Spacing-x sd-foundation-heading-24-yyy">职位描述</div>
      </div>
    `);
    const raw = extractRawJobPage();
    expect(raw.jobDetailTitles?.[0]).toBe("载具策划 - 3C（望月）-2027届校招");
    expect(raw.jobDetailTitles?.[1]).toBe("职位描述");
  });

  it("company_element：class 含 company-name 的节点进 brandTexts", () => {
    setDom(`<div class="company-name">广州诗悦网络科技有限公司</div>`);
    const raw = extractRawJobPage();
    expect(
      raw.brandTexts?.some((b) => b.startsWith("company_element|") && b.includes("诗悦")),
    ).toBe(true);
  });
});
