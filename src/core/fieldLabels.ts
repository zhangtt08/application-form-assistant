import { CANONICAL_FIELDS, getCanonicalFieldDef } from "../rules/canonicalFields";
import { FIELD_ALIASES } from "../rules/fieldAliases";

/**
 * Canonical Field 的用户可读名称。
 *
 * 单一事实源：标签直接取 `FIELD_ALIASES` 里**第一个中文别名**——那张词表本来就是
 * 「站点在这个字段上会写的中文」，再造一份 `FIELD_LABELS` 常量表就是第二份判断，
 * 早晚会和别名表漂移（同一个字段在清单里叫「姓名」、在回执里叫「名字」）。
 * 需要改某个字段的显示名时，改别名表里那一行的顺序，不要在这里加特例。
 */

const GROUP_LABELS: Record<string, string> = {
  basic: "基本信息",
  education: "教育经历",
  internship: "实习/工作经历",
  campus: "校园经历",
  project: "项目经验",
  skills: "技能与证书",
  job: "求职意向",
  content: "长文本内容",
};

/** 板块（canonical group）中文名；未知分组返回 undefined，由调用方决定怎么兜底 */
export function groupLabel(group: string): string | undefined {
  return GROUP_LABELS[group];
}

const labelCache = new Map<string, string>();

/**
 * 字段的中文名。
 * 别名表缺失（新增 canonical id 还没配别名）时退回 id 尾段，
 * 这样界面永远不会出现空白，也不会把 unknown 编成一个像样的名字。
 */
export function fieldLabel(fieldId: string): string {
  if (fieldId === "unknown") return "未匹配到资料";
  const cached = labelCache.get(fieldId);
  if (cached) return cached;
  const aliases = FIELD_ALIASES[fieldId] ?? [];
  const cjk = aliases.find((a) => /[^\x00-\x7F]/.test(a));
  const label = cjk ?? fieldId.split(".").pop() ?? fieldId;
  labelCache.set(fieldId, label);
  return label;
}

/** 字段属于哪个板块（unknown / 未登记 id 返回 undefined） */
export function fieldGroup(fieldId: string): string | undefined {
  return getCanonicalFieldDef(fieldId)?.group;
}

/** 「教育经历 · 毕业院校」这种带上下级的完整写法，用于回执与清单 */
export function fieldFullLabel(fieldId: string): string {
  const group = fieldGroup(fieldId);
  const g = group ? groupLabel(group) : undefined;
  return g ? `${g} · ${fieldLabel(fieldId)}` : fieldLabel(fieldId);
}

/** 全部 canonical 字段（顺序 = 定义顺序，即资料页的板块顺序） */
export function allCanonicalFields() {
  return CANONICAL_FIELDS;
}
