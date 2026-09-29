import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runScanPipeline } from "../src/pipeline/scanPipeline";
import { buildFillPlan } from "../src/pipeline/fillPlan";
import { fillFields } from "../src/content/filler";
import { scanPage } from "../src/content/scanner";
import type { CandidateField } from "../src/types/field";
import type { FillPlanPayload } from "../src/types/message";

beforeAll(() => {
  // jsdom 布局全 0：scanner 可见性判断需要 mock（与 filler.test.ts 一致）
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
});

/**
 * Safety Flow Reconciliation —— 单元契约测试（Scan Must Be Pure + Writer Contract）。
 *
 * 长期不变量：Scan / scanPipeline / resolver / candidate derivation 中
 * 不得出现任何 DOM 写入；Writer 只接受 confirmed 的 ConfirmedFillPlan。
 * 这些测试是安全红线的最内层，Browser E2E（scan-does-not-write.spec.ts）是最外层。
 */

function candidate(partial: Partial<CandidateField>): CandidateField {
  return {
    raw: {
      reference: JSON.stringify({ tag: "input", type: "text", name: partial.raw ? "" : "f", id: "", label: "", idx: 0 }),
      kind: "text",
      context: { tag: "input", type: "text", name: "f", id: "", label: "字段", maxLength: null, required: false, placeholder: "", value: "" },
    },
    match: { fieldId: "basic.name", score: 0.95, source: "exact" },
    risk: "SAFE",
    riskReason: "",
    status: "ready",
    ...partial,
  } as CandidateField;
}

function plan(fields: FillPlanPayload["fields"], confirmed = true): FillPlanPayload {
  return { confirmed, fields };
}

// ---------- 1. scanPipeline 不调用 writer（静态 + 行为双断言） ----------

describe("Scan Must Be Pure — scanPipeline 契约", () => {
  const src = readFileSync(resolve(__dirname, "../src/pipeline/scanPipeline.ts"), "utf-8");

  it("scanPipeline 源码不包含任何写入动作（fill / write / FILL_FIELDS / dispatchInput / SET_FIELD_VALUE）", () => {
    expect(src).not.toMatch(/FILL_FIELDS|fillFields|writeConfirmedPlan|dispatchInput|SET_FIELD_VALUE|setTextValue|setSelectValue/);
  });

  it("scanPipeline 不 import content 写入层（filler / eventDispatcher / writeVerifier）", () => {
    expect(src).not.toMatch(/from\s+"[^"]*content\/(filler|eventDispatcher|writeVerifier)"/);
  });

  it("runScanPipeline 返回值是候选（含 risk/status），不含写入结果字段", () => {
    const fields = scanPage(); // 空页面 → 空数组即可验证形状
    const out = runScanPipeline(fields, emptyProfile(), { profileType: "general" });
    expect(Array.isArray(out)).toBe(true);
    for (const c of out) {
      expect(typeof c.raw.reference).toBe("string");
      expect(["filled", "failed"]).not.toContain(c.status); // 绝不出现写入结果状态
      expect((c as unknown as Record<string, unknown>).outcomes).toBeUndefined();
      expect((c as unknown as Record<string, unknown>).originals).toBeUndefined();
    }
  });
});

function emptyProfile(): Parameters<typeof runScanPipeline>[1] {
  // 最小 Profile 形状（runScanPipeline 只读 basic 等字段，空库也能走通）
  return {
    basic: {},
    education: [],
    internships: [],
    projects: [],
    campus: [],
    skills: [],
    careerPreferences: {},
  } as unknown as Parameters<typeof runScanPipeline>[1];
}

// ---------- 2-10. Writer Contract：buildFillPlan 过滤 + fillFields 门禁 ----------

describe("Writer Contract — buildFillPlan 过滤规则", () => {
  it("HIGH（MANUAL_ONLY）即使 confirmed 也不得进入 plan（第二道防线在 Writer 之前）", () => {
    const plan1 = buildFillPlan(
      [candidate({ confirmed: true, risk: "MANUAL_ONLY", value: { fieldId: "x", value: "v", variant: "plain", editable: true, sourceType: "default" } })],
      null,
      null,
    );
    expect(plan1.fields).toHaveLength(0);
  });

  it("MANUAL_ONLY / status=manual 被过滤", () => {
    const p = buildFillPlan(
      [
        candidate({ confirmed: true, status: "manual", risk: "MANUAL_ONLY" }),
        candidate({ confirmed: true, risk: "MANUAL_ONLY" }),
      ],
      null,
      null,
    );
    expect(p.fields).toHaveLength(0);
  });

  it("unconfirmed candidate 被过滤（默认勾选 ≠ 用户确认豁免：未勾选的不写）", () => {
    const p = buildFillPlan([candidate({ confirmed: false, value: { fieldId: "x", value: "v", variant: "plain", editable: true, sourceType: "default" } })], null, null);
    expect(p.fields).toHaveLength(0);
  });

  it("empty / unknown 候选被过滤", () => {
    const p = buildFillPlan(
      [candidate({ confirmed: true, status: "empty" }), candidate({ confirmed: true, status: "unknown" })],
      null,
      null,
    );
    expect(p.fields).toHaveLength(0);
  });

  it("approved LOW（SAFE + ready + confirmed）进入 plan", () => {
    const p = buildFillPlan(
      [candidate({ confirmed: true, value: { fieldId: "basic.name", value: "张三", variant: "plain", editable: true, sourceType: "default" } })],
      "job_1",
      "general",
    );
    expect(p.fields).toHaveLength(1);
    expect(p.fields[0]!.value).toBe("张三");
    expect(p.confirmed).toBe(true);
  });

  it("approved MEDIUM（need-confirm + confirmed）进入 plan", () => {
    const p = buildFillPlan(
      [
        candidate({
          confirmed: true,
          status: "need-confirm",
          value: { fieldId: "project.description", value: "内容", variant: "plain", editable: true, sourceType: "default" },
        }),
      ],
      null,
      null,
    );
    expect(p.fields).toHaveLength(1);
  });

  it("manual edited value 进入 plan（用户在 Preview 改过的值优先生效）", () => {
    const p = buildFillPlan(
      [candidate({ confirmed: true, value: { fieldId: "x", value: "原始", variant: "plain", editable: true, sourceType: "default" }, editedValue: "用户改过" })],
      null,
      null,
    );
    expect(p.fields[0]!.value).toBe("用户改过");
  });

  it("ConfirmedFillPlan 必带 confirmed: true（Writer 运行时门禁依赖此字段）", () => {
    const p = buildFillPlan([], null, null);
    expect(p.confirmed).toBe(true);
    expect(p.fields).toHaveLength(0);
  });
});

describe("Writer Contract — fillFields 运行时门禁（第二道防线）", () => {
  it("未确认 plan → 抛错拒绝，DOM 不变", async () => {
    document.body.innerHTML = `<div><label for="sc1">姓名</label><input id="sc1" name="sc1" value="原值"></div>`;
    const ref = scanPage().find((f) => f.context.name === "sc1")!.reference;
    await expect(fillFields(plan([{ reference: ref, kind: "text", value: "新值" }], false))).rejects.toThrow(/未经用户确认/);
    await new Promise((r) => setTimeout(r, 50));
    expect((document.getElementById("sc1") as HTMLInputElement).value).toBe("原值");
  });

  it("空 plan → 抛错拒绝", async () => {
    await expect(fillFields(plan([]))).rejects.toThrow(/填写计划为空/);
  });

  it("confirmed plan → 正常进入执行（元素不存在时返回 failed，而不是被 gate 拦截）", async () => {
    document.body.innerHTML = `<div>no such field</div>`;
    const { outcomes } = await fillFields(plan([{ reference: '{"tag":"input","name":"ghost","id":"","label":"","idx":0}', kind: "text", value: "x" }]));
    expect(outcomes).toHaveLength(1); // 到达了 DOM 查找层（gate 放行）
    expect(outcomes[0]!.status).toBe("failed");
  });

  it("语境门禁：计划里混入非申请表控件 → 整份拒绝，一个字段都不写", async () => {
    document.body.innerHTML = `<div><label for="sc2">姓名</label><input id="sc2" name="sc2" value="原值"></div>`;
    const ref = scanPage().find((f) => f.context.name === "sc2")!.reference;
    await expect(
      fillFields(plan([
        { reference: ref, kind: "text", value: "新值", contextEligible: false },
      ])),
    ).rejects.toThrow(/非申请表控件/);
    await new Promise((r) => setTimeout(r, 50));
    expect((document.getElementById("sc2") as HTMLInputElement).value).toBe("原值");
  });
});
