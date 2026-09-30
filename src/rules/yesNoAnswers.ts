/**
 * 「是 / 否」答案在真实网申单选组里的各种写法。
 *
 * 资料库存的是「是」，站点选项却常写「可以接受」「Yes」——选项覆盖检查、radio/checkbox 勾哪一项、
 * 原生 select 选哪个 option、自定义下拉点哪个节点、写入后回读判定，这五处必须用同一份同义集合，
 * 否则会出现「判定可填 → 点了反义词 → 回读说没填上」的错填链（少填/填错位置的经典成因）。
 *
 * 只在**同一极性内**扩展，绝不做包含式匹配（「不接受」含「接受」）。
 * 本模块不 import domUtils：写入层要反过来用它，避免循环依赖。
 */
function norm(s: string): string {
  return (s ?? "")
    .replace(/[\u200b\u200c\ufeff]/g, "")
    .replace(/[（(]\s*(必填|选填)\s*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[：:；;。.、,，*＊]/g, "")
    .toLowerCase()
    .trim();
}

const YES_TERMS = [
  "是", "是的", "对", "对的", "有", "可以", "可以的", "可", "能", "能够", "能接受",
  "接受", "可以接受", "同意", "愿意", "没问题", "方便", "支持",
  "yes", "y", "true", "ok", "available", "willing", "i am willing", "acceptable",
];

const NO_TERMS = [
  "否", "不是", "不对", "没有", "无", "不可以", "不可以的", "不能", "不能接受",
  "不接受", "不同意", "不愿意", "不方便", "不支持", "暂不",
  "no", "n", "false", "none", "do not accept", "not accept", "not acceptable", "unwilling", "no thanks",
];

const YES_SET = new Set(YES_TERMS.map(norm));
const NO_SET = new Set(NO_TERMS.map(norm));

/**
 * 值是「是/否」一类答案时，返回该极性的全部可接受写法（已 normalize）；
 * 不是这类答案返回 null（普通值走原有的精确/包含判定）。
 */
export function polarityTerms(value: string): Set<string> | null {
  const term = norm(value);
  if (!term) return null;
  if (YES_SET.has(term)) return YES_SET;
  if (NO_SET.has(term)) return NO_SET;
  return null;
}

/** 单个选项文本是否与该值同极性（精确，不做包含） */
export function polarityMatches(value: string, optionText: string): boolean {
  const set = polarityTerms(value);
  if (!set) return false;
  return set.has(norm(optionText));
}

/** 这段文本是「是」类还是「否」类答案（导入资料时归一化用） */
export function polarityOf(value: string): "yes" | "no" | null {
  const term = norm(value);
  if (YES_SET.has(term)) return "yes";
  if (NO_SET.has(term)) return "no";
  return null;
}
