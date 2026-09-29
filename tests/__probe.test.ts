import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, it, vi } from "vitest";

/**
 * 临时探针：compatibility/custom-select.html 在扫描管线下的字段分级（供 Safety E2E 用）。
 */
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100, height: 24, top: 0, left: 0, bottom: 24, right: 100, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

describe("probe", () => {
  it("dump", async () => {
    const html = readFileSync(resolve(__dirname, "../tests/e2e/fixtures/compatibility/custom-select.html"), "utf-8");
    document.documentElement.innerHTML = html;
    const { scanPage } = await import("../src/content/scanner");
    const { runScanPipeline } = await import("../src/pipeline/scanPipeline");
    const { defaultProfile } = await import("../src/profile/defaultProfile");
    const fields = scanPage();
    console.log("detected:", fields.length);
    const out = runScanPipeline(fields, defaultProfile as never, { profileType: "general" });
    for (const c of out) {
      const label = c.raw.context.labelText || c.raw.context.name || c.raw.context.id;
      console.log(
        JSON.stringify({
          label,
          id: c.raw.context.id,
          fieldId: c.match.fieldId,
          risk: c.risk,
          status: c.status,
          confirmed: c.confirmed ?? false,
          hasValue: !!c.value,
          editable: c.value?.editable,
        }),
      );
    }
  });
});
