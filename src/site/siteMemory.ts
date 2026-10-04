import { normalizeText } from "../utils/normalizeText";
import { isCanonicalFieldId } from "../rules/canonicalFields";
import type { RawFieldContext } from "../types/field";

/**
 * 站点记忆（Site Memory）。
 *
 * 解决的问题：同一招聘站的字段命名是**它自己的**（「最高学历毕业院校」＝ education.school），
 * 用户每次投递都要把同一个纠正做一遍；改错一次就记住不了，软件就显得没长大。
 * 这一层把「人在这一站上做过的判断」沉淀下来，下次扫描直接生效。
 *
 * 三条刻意的设计（改动前先读这段）：
 * 1. **只记站点的文字，绝不记用户的资料值。** 一条规则 = 主机名 + 站点自己给的控件文本
 *    （label / name / placeholder）+ canonical 字段 id 或「别填」标记。
 *    `sanitizeRule()` 是白名单装配：不在名单里的键（value / editedValue / answer…）直接丢掉，
 *    所以调用方就算把整个 CandidateField 传进来也不会把手机号带进存储。
 *    也不记任何凭据：本项目不接触 Cookie / 密码 / 登录态（见 docs/SAFETY_FLOW_AUDIT.md）。
 * 2. **它只能改「这一栏算哪个字段」，改不动红线。** 映射在 matcher 之后、assessRisk 之前生效，
 *    所以把一个字段人工改挂到身份证号/薪资这类 MANUAL_ONLY 字段上，仍然会被风险层拦下。
 *    「这一站别填」只会让字段更保守，不会让它更激进。
 * 3. **认不出就不生效。** 匹配按站点文字逐字相等（同一 host + 同一板块），
 *    站点改版或 id 被打乱时规则自然落空，回到正常识别流程 ——
 *    宁可这次让用户重改一遍，也不能把上次的判断套到一个不是同一栏的控件上。
 *
 * 纯逻辑（本文件上半部）与扩展共用，`agent/tools.mjs` 通过 `src/core` 加载同一份；
 * chrome.storage 读写在下面单独成节，纯逻辑不碰它。
 */

export const SITE_MEMORY_KEY = "afa.sitememory.v1";

/** block = 这一站这一栏以后都别填；map = 这一站这一栏其实是另一个资料字段 */
export type SiteRuleKind = "block" | "map";

export interface SiteFieldRule {
  id: string;
  /** 主机名（不含协议与路径），如 careers.example.com */
  host: string;
  kind: SiteRuleKind;
  /** 站点自己给的控件文本，规范化后作为匹配键 */
  matchKey: string;
  /** 板块标题（可选）：同名控件靠它区分，如两段经历里各有一个「开始时间」 */
  section: string;
  /** kind=map 时改挂到的 canonical 字段 id */
  fieldId?: string;
  /** 站点原文（展示用，与 matchKey 同源，不是用户资料） */
  siteLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteMemory {
  schemaVersion: 1;
  rules: SiteFieldRule[];
}

/** 总量上限：站点记忆是便利设施，不该变成无限增长的历史堆积。 */
export const MAX_SITE_RULES = 300;
/** 站点文字入库长度上限（真表单的 label 很少超过这个数）。 */
const TEXT_CAP = 60;

/* ------------------------------------------------------------------ *
 * 纯逻辑
 * ------------------------------------------------------------------ */

export function emptySiteMemory(): SiteMemory {
  return { schemaVersion: 1, rules: [] };
}

/** URL → host；解析不了就返回 null（没有 host 就不许记站点规则） */
export function hostFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    return host && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

function clip(s: string): string {
  const t = (s ?? "").trim();
  return t.length > TEXT_CAP ? t.slice(0, TEXT_CAP) : t;
}

/**
 * 这个控件在站点上的「可写下来的名字」候选，按可靠性排序。
 * 不用 id 以外的随机量：`input_12345` 这类混淆 id 每次会话都可能变，
 * 记下来下次对不上就是白记 —— 所以 label 永远优先，name 次之，
 * 只有 label/name/placeholder 全空的控件才退到 id 或 aria-label。
 */
export function fieldMatchCandidates(ctx: RawFieldContext): string[] {
  const out: string[] = [];
  for (const raw of [ctx.labelText, ctx.groupLabel, ctx.name, ctx.placeholder, ctx.ariaLabel, ctx.id]) {
    const key = normalizeText(raw ?? "").replace(/\s+/g, "");
    if (key && key.length <= TEXT_CAP && !out.includes(key)) out.push(key);
  }
  return out;
}

/** 规则的板块归属：section 参与判定，空串 = 不限板块 */
function ruleSection(ctx: RawFieldContext): string {
  return clip(normalizeText(ctx.sectionTitle || ctx.fieldsetLabel || ""));
}

export function makeRuleId(): string {
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 白名单装配：只有这些键能进存储。其余（含任何资料值）一律丢弃。 */
export function sanitizeRule(input: unknown): SiteFieldRule | null {
  if (typeof input !== "object" || input === null) return null;
  const src = input as Record<string, unknown>;
  const host = typeof src.host === "string" ? hostFromUrl(`https://${src.host}`) : null;
  const matchKey = typeof src.matchKey === "string" ? normalizeText(src.matchKey).replace(/\s+/g, "") : "";
  const kind = src.kind === "block" || src.kind === "map" ? src.kind : null;
  if (!host || !matchKey || matchKey.length > TEXT_CAP || !kind) return null;
  if (kind === "map") {
    if (typeof src.fieldId !== "string" || !isCanonicalFieldId(src.fieldId)) return null;
  }
  const now = new Date().toISOString();
  const rule: SiteFieldRule = {
    id: typeof src.id === "string" && src.id ? src.id : makeRuleId(),
    host,
    kind,
    matchKey,
    section: typeof src.section === "string" ? clip(normalizeText(src.section)) : "",
    siteLabel: typeof src.siteLabel === "string" ? clip(src.siteLabel) : src.matchKey ? String(src.matchKey) : "",
    createdAt: typeof src.createdAt === "string" ? src.createdAt : now,
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : now,
  };
  if (kind === "map") rule.fieldId = String(src.fieldId);
  return rule;
}

/** 新建一条规则（从字段卡片而来：host + 控件语境 + 可选目标字段） */
export function buildRule(input: {
  host: string;
  ctx: RawFieldContext;
  kind: SiteRuleKind;
  fieldId?: string;
}): SiteFieldRule | null {
  const host = hostFromUrl(`https://${input.host}`);
  if (!host) return null;
  const candidates = fieldMatchCandidates(input.ctx);
  if (candidates.length === 0) return null;
  return sanitizeRule({
    host,
    kind: input.kind,
    matchKey: candidates[0],
    section: ruleSection(input.ctx),
    fieldId: input.fieldId,
    siteLabel: (input.ctx.labelText || input.ctx.groupLabel || input.ctx.name || input.ctx.placeholder || input.ctx.id || "").trim(),
  });
}

/** 同一 host 上同一控件同一板块 = 同一条规则（重复点按一次，不叠加） */
function sameRule(a: SiteFieldRule, b: SiteFieldRule): boolean {
  return a.host === b.host && a.kind === b.kind && a.matchKey === b.matchKey && a.section === b.section;
}

export function upsertRule(
  memory: SiteMemory,
  rule: SiteFieldRule,
): { memory: SiteMemory; created: boolean } {
  const index = memory.rules.findIndex((r) => sameRule(r, rule));
  if (index >= 0) {
    const rules = memory.rules.slice();
    rules[index] = { ...rule, id: rules[index]!.id, createdAt: rules[index]!.createdAt, updatedAt: new Date().toISOString() };
    return { memory: { ...memory, rules }, created: false };
  }
  const rules = [rule, ...memory.rules];
  if (rules.length > MAX_SITE_RULES) rules.length = MAX_SITE_RULES;
  return { memory: { ...memory, rules }, created: true };
}

export function removeRule(memory: SiteMemory, id: string): SiteMemory {
  return { ...memory, rules: memory.rules.filter((r) => r.id !== id) };
}

export function rulesForHost(memory: SiteMemory, host: string | null | undefined): SiteFieldRule[] {
  if (!host) return [];
  return memory.rules.filter((r) => r.host === host);
}

/**
 * 这一栏命中了哪条规则（同 host 由调用方先过滤好）。
 * 逐字相等才算命中：宁可漏掉（这次让用户重改一遍）也不误伤（把上次的判断套到别的栏上）。
 */
export function matchSiteRule(
  rules: SiteFieldRule[],
  ctx: RawFieldContext,
): SiteFieldRule | undefined {
  if (rules.length === 0) return undefined;
  const candidates = fieldMatchCandidates(ctx);
  if (candidates.length === 0) return undefined;
  const section = ruleSection(ctx);
  return rules.find((r) => {
    if (!candidates.includes(normalizeText(r.matchKey).replace(/\s+/g, ""))) return false;
    if (r.section && r.section !== section) return false;
    return true;
  });
}

/** 规则的中文说法（界面与回执共用一句口径） */
export function describeRule(rule: SiteFieldRule, fieldLabelOf: (id: string) => string): string {
  const what = rule.kind === "block" ? "这一栏不要自动填" : `这一栏按「${fieldLabelOf(rule.fieldId ?? "")}」填`;
  return `${rule.host} · ${rule.siteLabel || rule.matchKey} → ${what}`;
}

/* ------------------------------------------------------------------ *
 * 读盘 / 落盘（只有扩展侧用到；agent 走纯逻辑那半）
 * ------------------------------------------------------------------ */

function storageAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

function coerceMemory(raw: unknown): SiteMemory {
  if (typeof raw !== "object" || raw === null) return emptySiteMemory();
  const src = raw as Record<string, unknown>;
  const list = Array.isArray(src.rules) ? src.rules : [];
  const rules: SiteFieldRule[] = [];
  for (const item of list) {
    const r = sanitizeRule(item);
    if (r && !rules.some((x) => sameRule(x, r))) rules.push(r);
  }
  if (rules.length > MAX_SITE_RULES) rules.length = MAX_SITE_RULES;
  return { schemaVersion: 1, rules };
}

export async function loadSiteMemory(): Promise<SiteMemory> {
  if (!storageAvailable()) return emptySiteMemory();
  try {
    const result = await chrome.storage.local.get(SITE_MEMORY_KEY);
    return coerceMemory(result[SITE_MEMORY_KEY]);
  } catch {
    // 读不出来就当没有：站点记忆是便利设施，不能因为它坏了阻塞识别
    return emptySiteMemory();
  }
}

export async function saveSiteMemory(memory: SiteMemory): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SITE_MEMORY_KEY]: coerceMemory(memory) });
}

export async function addSiteRule(input: {
  host: string;
  ctx: RawFieldContext;
  kind: SiteRuleKind;
  fieldId?: string;
}): Promise<{ memory: SiteMemory; rule: SiteFieldRule | null; created: boolean }> {
  const memory = await loadSiteMemory();
  const rule = buildRule(input);
  if (!rule) return { memory, rule: null, created: false };
  const next = upsertRule(memory, rule);
  await saveSiteMemory(next.memory);
  return { memory: next.memory, rule, created: next.created };
}

export async function removeSiteRule(id: string): Promise<SiteMemory> {
  const memory = await loadSiteMemory();
  const next = removeRule(memory, id);
  await saveSiteMemory(next);
  return next;
}

/** 监听变化（多个 Side Panel 实例 / 设置页删除后投递页要跟着失效） */
export function subscribeSiteMemoryChanges(cb: (memory: SiteMemory) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !(SITE_MEMORY_KEY in changes)) return;
    cb(coerceMemory(changes[SITE_MEMORY_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
