import { describe, expect, it } from "vitest";
import { CANONICAL_FIELDS } from "../src/rules/canonicalFields";
import { FIELD_ALIASES } from "../src/rules/fieldAliases";

/**
 * 别名表与 canonical 总表的成对性检查。
 *
 * 「识别不了」最常见的成因不是算法，而是词表漏了一个 canonical：
 * 一个 id 没有任何别名，就永远不会被匹配上，资料库里明明有内容却始终留空。
 * 反过来，别名表里的野 id 会被 matcher 静默忽略，看起来「有词却认不到」。
 * 两个方向都在这里钉死。
 */
describe("canonical ↔ 别名 成对性", () => {
  it("每个 canonical id 都有可用别名（risk.manual 这类无来源字段除外）", () => {
    const missing = CANONICAL_FIELDS.map((f) => f.id).filter(
      (id) => id !== "risk.manual" && (FIELD_ALIASES[id] ?? []).length === 0,
    );
    expect(missing, `这些字段永远识别不到：${missing.join(", ")}`).toEqual([]);
  });

  it("别名表里的每个键都是真实 canonical id", () => {
    const known = new Set(CANONICAL_FIELDS.map((f) => f.id));
    const orphan = Object.keys(FIELD_ALIASES).filter((id) => !known.has(id));
    expect(orphan, `这些别名指向不存在的字段：${orphan.join(", ")}`).toEqual([]);
  });

  it("别名不与「必填/选填」这类装饰写在一起（normalize 后才比对，写法必须已归一）", () => {
    const bad: string[] = [];
    for (const [id, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const alias of aliases) {
        if (/（必填）|（选填）|\*|：|:$/.test(alias)) bad.push(`${id}: ${alias}`);
      }
    }
    expect(bad, `别名里混进了标签装饰：${bad.join(" | ")}`).toEqual([]);
  });

  it("单字别名只允许白名单里的（长度 <2 时 scoreAlias 只在标签完全相等时生效，写多了是假覆盖）", () => {
    const ALLOWED_ONE_CHAR = new Set(["系"]); // 「所在院系」类站点的极端简写标签，只走精确相等
    const offenders: string[] = [];
    for (const [id, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const alias of aliases) {
        if ([...alias.trim()].length < 2 && !ALLOWED_ONE_CHAR.has(alias.trim())) offenders.push(`${id}: ${alias}`);
      }
    }
    expect(offenders, `这些别名几乎不会生效，应改写成完整词组：${offenders.join(" | ")}`).toEqual([]);
  });
});
