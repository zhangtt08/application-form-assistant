// UX9 重写（显式等待版）
import fs from "node:fs";

let s = fs.readFileSync("e2e/compat/ux-profilepack.spec.ts", "utf8");
const start = s.indexOf(`test("UX9:`);
const next = `test("UX9: 删除 active Pack → fallback 通用", async () => {
  await sidePanel.locator(".bottom-nav .bn-item", { hasText: "资料库" }).click();
  await sidePanel.getByRole("button", { name: "＋ 新建资料库" }).click();
  await sidePanel.locator(".pack-editor input").first().fill("待删除库");
  await sidePanel.getByRole("button", { name: "保存资料库" }).click();
  await expect(sidePanel.getByText("已保存")).toBeVisible();
  await sidePanel.getByRole("button", { name: "← 返回资料库" }).click();
  // 使用待删除库
  await sidePanel.locator(".pack-card", { hasText: "待删除库" }).getByRole("button", { name: "使用" }).click();
  // onUsePack 回填写页 → 重新进资料库
  await sidePanel.locator(".bottom-nav .bn-item", { hasText: "资料库" }).click();
  await expect(sidePanel.locator(".pack-card", { hasText: "待删除库" }).locator(".pack-in-use")).toBeVisible({ timeout: 15000 });
  // 二次确认删除
  await sidePanel.locator(".pack-card", { hasText: "待删除库" }).getByRole("button", { name: "删除" }).click();
  await sidePanel.locator(".pack-card", { hasText: "待删除库" }).getByRole("button", { name: "确认删除" }).click();
  // fallback：active 回到 通用
  await sidePanel.locator(".bottom-nav .bn-item", { hasText: "资料库" }).click();
  await expect(sidePanel.locator(".pack-card.pack-active", { hasText: "通用" })).toBeVisible({ timeout: 15000 });
  await expect(sidePanel.locator(".pack-card", { hasText: "待删除库" })).toHaveCount(0);
});
`;
s = s.slice(0, start) + next;
fs.writeFileSync("e2e/compat/ux-profilepack.spec.ts", s);
console.log("ux9 rewritten");
