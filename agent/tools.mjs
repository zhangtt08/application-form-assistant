/**
 * afa —— ATS Application Assistant 的 Agent 工具层。
 *
 * 契约：personal-agent-hub/docs/AGENT_API_STANDARD.md
 * 端口：8797（见 agent/README.md 与 personal-agent-hub/config/catalog.json）
 *
 * ── 这一层的设计前提（决定了下面每个工具能说什么）────────────────────────
 * 本产品是 Edge MV3 浏览器扩展，**没有常驻后端**：真正的填写发生在用户浏览器的
 * content script 里，资料存在那台浏览器的 chrome.storage.local 里。
 * 因此本 Agent 进程：
 *   1. 不连浏览器、不读 chrome.storage、不注入任何页面 —— 做不到，也不该做；
 *   2. 只复用扩展的**纯逻辑源码**（`src/core` 门面 → matcher / riskRules /
 *      scanPipeline / fillPlan / Profile 校验 / JobParser），通过 agent/ts-loader.mjs
 *      用 Node 直接加载同一批 `.ts` 文件，**不在这里重写第二份判断**；
 *   3. 只读：八个工具全部 `risk:'read'`。**没有任何工具会写 DOM、点提交、
 *      或向第三方站点发出写入请求** —— 这与扩展的安全红线一致（不自动提交、
 *      风险字段只允许手动、扫描阶段不写 DOM），不是保守，是产品定义。
 *
 * 严禁假数据：每个工具要么返回真实解析结果，要么如实报错并说明缺什么。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { register } from "node:module";
import { AgentError } from "./server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/* Node 原生 ESM 不补扩展名，而 src/ 内部 import 是不带扩展名的；补全钩子见 ts-loader.mjs */
register(new URL("./ts-loader.mjs", import.meta.url));

/* 单一事实源：扩展跑的就是这一份 */
const core = await import(pathToFileURLString(path.join(ROOT, "src", "core", "index.ts")));
const { scanPage } = await import(pathToFileURLString(path.join(ROOT, "src", "content", "scanner.ts")));
const { JSDOM } = await import("jsdom");

function pathToFileURLString(p) {
  return `file:///${p.replace(/\\/g, "/")}`;
}

export const project = {
  name: "afa",
  version: "0.1.0",
  summary:
    "网申自动填写助手（Edge MV3 扩展）的本地只读 Agent：复用扩展自身的字段匹配、风险分级与填写计划逻辑，" +
    "对给定表单 DOM 做只读扫描并返回匹配建议。绝不写入页面、绝不代点提交。",
};

/* ===================================================================== *
 * 脱敏：Agent 的输出会进模型上下文与日志，所以默认不外发完整个人标识。
 * 判据与 docs/TEST_DATA_POLICY.md 的 Forbidden 表一致。
 * ===================================================================== */

/** 完整值一律不外泄的字段（身份证 / 联系方式 / 住址 / 出生日期 / 他人联系方式） */
const NEVER_PLAIN = new Set([
  "basic.idNumber",
  "basic.phone",
  "basic.email",
  "basic.wechat",
  "basic.qq",
  "basic.address",
  "basic.birthDate",
  "basic.emergencyContactName",
  "basic.emergencyContactPhone",
  "basic.hukou",
  "basic.nativePlace",
  "sensitive.idNumber",
  "sensitive.phone",
  "sensitive.email",
]);

/** 只露首字的身份类字段（姓名本身也是个人标识） */
const INITIAL_ONLY = new Set(["basic.name", "basic.englishName", "basic.surname", "basic.givenName"]);

const VALUE_CAP = 160;

/** 把值变成「能判断有没有、看不出是什么」的形态 */
function maskValue(fieldId, raw) {
  const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  if (!value.trim()) return { has_value: false, masked: "" };
  const length = value.trim().length;
  if (NEVER_PLAIN.has(fieldId)) {
    if (value.includes("@")) {
      const [local = "", domain = ""] = value.split("@");
      return { has_value: true, length, masked: `${local.slice(0, 1)}***@${domain}`, redacted: true };
    }
    return { has_value: true, length, masked: `${value.slice(0, 1)}${"*".repeat(Math.min(length - 1, 10))}`, redacted: true };
  }
  if (INITIAL_ONLY.has(fieldId)) {
    return { has_value: true, length, masked: `${value.trim().slice(0, 1)}**`, redacted: true };
  }
  const flat = value.replace(/\s+/g, " ").trim();
  const truncated = flat.length > VALUE_CAP;
  return { has_value: true, length, masked: truncated ? `${flat.slice(0, VALUE_CAP)}…` : flat, truncated };
}

/* ===================================================================== *
 * 资料档案读取（真实文件 + 真实校验器）
 * ===================================================================== */

const DEFAULT_PROFILE_FILE = path.join(ROOT, "tests", "fixtures", "cn-resume.json");

function resolveInputFile(file, fallback) {
  const target = file ? (path.isAbsolute(file) ? file : path.join(ROOT, file)) : fallback;
  if (!target) throw new AgentError("bad_input", "缺少 file 参数，且没有可用的默认档案文件");
  if (!existsSync(target)) {
    throw new AgentError("bad_input", `文件不存在：${path.relative(ROOT, target) || target}`);
  }
  const rel = path.relative(ROOT, target).replace(/\\/g, "/");
  if (rel.startsWith("..")) {
    throw new AgentError("bad_input", "只允许读取本项目目录内的文件（越界路径）");
  }
  return { abs: target, rel };
}

/**
 * 三种真实入口，全部走扩展自己的解析器，不做任何简化：
 *  - 扩展导出的 Profile 文件（kind: application-form-assistant/profile）
 *  - 简历站/解析服务导出的中文简历 JSON（mapResumeJsonToProfile）
 *  - 纯文本简历（parseResumeText，与「资料」页粘贴框同一条路）
 */
function loadProfileFrom(file) {
  const text = readFileSync(file.abs, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object" && parsed.kind === "application-form-assistant/profile") {
    const v = core.validateProfile(parsed.profile);
    return v.ok
      ? { source: file.rel, format: "exported-profile", profile: v.profile, validation: { ok: true, errors: [] } }
      : { source: file.rel, format: "exported-profile", profile: null, validation: { ok: false, errors: v.errors } };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const mapped = core.mapResumeJsonToProfile(parsed);
    if (mapped.ok) {
      return { source: file.rel, format: "resume-json", profile: mapped.profile, validation: { ok: true, errors: [] }, ignored_blocks: mapped.ignoredBlocks, unknown_top_keys: mapped.unknownTopKeys };
    }
    // JSON 但不是简历格式：再按「已经是 Profile 结构」试一次，两条路都是扩展的真实校验器
    const v = core.validateProfile(parsed);
    if (v.ok) return { source: file.rel, format: "profile-json", profile: v.profile, validation: { ok: true, errors: [] } };
    return { source: file.rel, format: "resume-json", profile: null, validation: { ok: false, errors: mapped.errors } };
  }

  const fromText = core.parseResumeText(text);
  return fromText.ok
    ? { source: file.rel, format: "resume-text", profile: fromText.profile, validation: { ok: true, errors: [] }, notes: fromText.notes }
    : { source: file.rel, format: "resume-text", profile: null, validation: { ok: false, errors: fromText.errors } };
}

/** canonical id → Profile 里的真实取值（与 profileResolver 同一套字段路径） */
function valueForCanonicalId(profile, fieldId, entryIndex = 0) {
  const [block, key] = fieldId.split(".");
  if (!profile || !key) return undefined;
  if (block === "basic") return profile.basic?.[key];
  if (block === "sensitive") return profile.sensitive?.[key];
  if (block === "skills") {
    const v = profile.skills?.[key];
    return Array.isArray(v) ? v.join("、") : v;
  }
  if (block === "job") return profile.jobPreferences?.[key];
  if (block === "content") {
    const c = profile.content?.[key];
    if (!c) return undefined;
    return c.medium || c.short || c.long;
  }
  const collection = { education: "education", internship: "internships", campus: "campus", project: "projects" }[block];
  if (!collection) return undefined;
  const list = profile[collection] ?? [];
  const entry = list[Math.min(entryIndex, Math.max(0, list.length - 1))];
  if (!entry) return undefined;
  const v = entry[key];
  if (v && typeof v === "object") {
    const variants = ["short", "medium", "long"].map((k) => v[k]).filter(Boolean);
    return variants.length ? variants[1] ?? variants[0] : undefined;
  }
  return v;
}

function profileShapeSummary(profile) {
  if (!profile) return null;
  const filled = (obj) => Object.values(obj ?? {}).filter((v) => typeof v === "string" && v.trim()).length;
  return {
    basic_filled: filled(profile.basic),
    basic_total: Object.keys(profile.basic ?? {}).length,
    education_entries: profile.education.length,
    internship_entries: profile.internships.length,
    campus_entries: profile.campus.length,
    project_entries: profile.projects.length,
    skills_arrays: Object.fromEntries(Object.entries(profile.skills ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    job_preference_filled: filled(profile.jobPreferences),
    content_blocks: Object.fromEntries(Object.entries(profile.content ?? {}).map(([k, v]) => [k, v && typeof v === "object" ? ["short", "medium", "long"].filter((s) => v[s]?.trim()).length : 0])),
    has_any_content: core.profileHasContent(profile),
  };
}

/** 逐 canonical 字段的「有没有内容 / 脱敏预览」—— 真实取值，真实脱敏 */
function profileFieldRows(profile, { includeMasked = true, onlyFilled = false, limit = 200 } = {}) {
  const rows = [];
  for (const def of core.CANONICAL_FIELDS) {
    const raw = valueForCanonicalId(profile, def.id);
    const risk = core.riskOfFieldId(def.id);
    const masked = maskValue(def.id, Array.isArray(raw) ? raw.join("、") : raw);
    if (onlyFilled && !masked.has_value) continue;
    rows.push({
      field_id: def.id,
      label: core.fieldLabel(def.id),
      group: def.group,
      multi_entry: def.multiEntry,
      risk: risk.risk,
      risk_reason: risk.reason,
      has_value: masked.has_value,
      ...(includeMasked && masked.has_value ? { value: masked.masked, value_length: masked.length, redacted: !!masked.redacted } : {}),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/* ===================================================================== *
 * 只读 DOM 扫描：jsdom 提供 DOM 环境，判定全部由扩展自己的代码做
 * ===================================================================== */

const EMPTY_RECT = { width: 100, height: 24, top: 0, left: 0, bottom: 24, right: 100, x: 0, y: 0 };

/**
 * 在 jsdom 里跑扩展的真实 scanner。
 *
 * 唯一的环境补偿是给 `getBoundingClientRect` 打桩：jsdom 没有布局引擎，rect 恒为 0，
 * 而 scanner 的「零尺寸控件不算候选」这条过滤在真实浏览器里是有效的。
 * 这与 `tests/scanner.test.ts` 的 beforeAll 桩**完全同一口径**，不是新规则；
 * 除布局数字外没有任何判定逻辑被替换。
 */
async function scanHtml(html, { url = "https://example.invalid/scan" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>scan</title></head><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true,
  });
  const g = globalThis;
  // Node 24 的 globalThis.navigator 是只读访问器，不能覆盖；scanner 及其依赖不读 navigator，
  // 所以这里只挂 scanner 真正用到的那几个全局量。
  const saved = { window: g.window, document: g.document, Element: g.Element, HTMLElement: g.HTMLElement, Node: g.Node, getComputedStyle: g.getComputedStyle };
  g.window = dom.window;
  g.document = dom.window.document;
  g.Element = dom.window.Element;
  g.HTMLElement = dom.window.HTMLElement;
  g.Node = dom.window.Node;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { ...EMPTY_RECT, toJSON: () => ({}) };
  };
  try {
    return { rawFields: scanPage(), title: dom.window.document.title || "" };
  } finally {
    Object.assign(g, saved);
    dom.window.close();
  }
}

/** 拉取真实页面：优先本机已装的 Playwright 引擎（无头，只读，不注入扩展、不点击） */
async function fetchPageHtml(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new AgentError("bad_input", `url 不是合法地址：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AgentError("bad_input", "只支持 http/https 页面");
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

function buildRawFieldFromQuestion(input) {
  const options = Array.isArray(input.options) ? input.options.map(String) : [];
  const kind = input.kind || (options.length ? "select" : "text");
  const context = {
    labelText: input.question ?? "",
    placeholder: input.placeholder ?? "",
    ariaLabel: input.aria_label ?? "",
    name: input.name ?? "",
    id: input.id ?? "",
    title: input.title ?? "",
    fieldsetLabel: input.fieldset ?? "",
    sectionTitle: input.section ?? "",
    prevSiblingText: "",
    parentText: "",
    autocomplete: input.autocomplete ?? "",
    inputType: input.input_type ?? (kind === "tel" ? "tel" : kind === "email" ? "email" : "text"),
    maxLength: typeof input.max_length === "number" ? input.max_length : null,
    required: !!input.required,
    disabled: false,
    readOnly: false,
    currentValue: "",
  };
  return { reference: `agent:${kind}:${(input.question ?? "").slice(0, 24)}`, kind, context, options, frameId: 0 };
}

/** 扫描结果 → 对外结构（值一律脱敏；红线原因原样保留） */
function candidateRows(candidates, { limit = 200, includeValues = false } = {}) {
  return candidates.slice(0, limit).map((c) => {
    const explain = core.explainCandidate(c);
    const masked = maskValue(c.match.fieldId, c.editedValue ?? c.value?.value);
    const label = c.raw.context.labelText || c.raw.context.placeholder || c.raw.context.name || c.raw.context.id || "(未命名字段)";
    return {
      dom_label: label,
      kind: c.raw.kind,
      section: c.raw.context.sectionTitle || undefined,
      required: c.raw.context.required,
      max_length: c.raw.context.maxLength ?? null,
      options: c.raw.options.length ? c.raw.options.slice(0, 12) : undefined,
      field_id: c.match.fieldId,
      field_label: explain.fieldLabel,
      status: c.status,
      risk: c.risk,
      risk_reason: c.riskReason,
      confidence: c.match.confidence,
      confidence_level: explain.level,
      matched_by: c.match.matchedBy,
      why: explain.headline,
      signals: explain.signals.map((s) => `${s.sourceLabel}：${s.text}`),
      alternative: explain.alternative ? { field_id: c.match.runnerUpFieldId, label: explain.alternative.fieldLabel, confidence: explain.alternative.percent / 100 } : undefined,
      blocked_reason: explain.blockedReason,
      fillable: c.status === "ready" || c.status === "need-confirm",
      open_question: c.openAnswer ? { intent: c.openAnswer.intent, question: c.openAnswer.question } : undefined,
      value: includeValues ? masked.masked : undefined,
      value_length: masked.has_value ? masked.length : 0,
    };
  });
}

function redlineTally(candidates) {
  const by = (fn) => candidates.filter(fn).length;
  return {
    total: candidates.length,
    fillable: by((c) => c.status === "ready" || c.status === "need-confirm"),
    manual_only: by((c) => c.risk === "MANUAL_ONLY" || c.status === "manual"),
    context_excluded: by((c) => c.status === "excluded"),
    unmatched: by((c) => c.status === "unknown"),
    no_profile_value: by((c) => c.status === "empty"),
    unsupported_control: by((c) => c.status === "unsupported"),
    low_confidence: by((c) => core.confidenceLevel(c.match.confidence) === "LOW"),
  };
}

async function scanAndMatch(input) {
  let html = input.html;
  let source = "input.html";
  if (!html && input.file) {
    const f = resolveInputFile(input.file, null);
    html = readFileSync(f.abs, "utf8");
    source = f.rel;
  }
  if (!html && input.url) {
    html = await fetchPageHtml(input.url);
    source = input.url;
  }
  if (!html) {
    throw new AgentError("bad_input", "需要 html / file / url 三者之一（只读扫描，不会写入任何页面）");
  }

  const profileFile = resolveInputFile(input.profile_file, DEFAULT_PROFILE_FILE);
  const loaded = loadProfileFrom(profileFile);
  if (!loaded.profile) {
    throw new AgentError("bad_input", `资料档案无法解析：${profileFile.rel}`, );
  }

  const { rawFields } = await scanHtml(html, input.url ? { url: input.url } : {});
  const candidates = core.runScanPipeline(rawFields, loaded.profile, {
    profileType: input.profile_type || undefined,
  });
  return { source, rawFields, candidates, profileSource: profileFile.rel, profileFormat: loaded.format };
}

/* ===================================================================== *
 * 校验结果导出（读真实入库文件，不生成、不改写）
 * ===================================================================== */

const RESULTS_DIR = path.join(ROOT, "real-validation-results");

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(md|json)$/.test(f))
    .map((f) => {
      const abs = path.join(dir, f);
      return { file: path.relative(ROOT, abs).replace(/\\/g, "/"), bytes: statSync(abs).size, modified: statSync(abs).mtime.toISOString() };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function firstHeading(abs) {
  const text = readFileSync(abs, "utf8");
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const verdict = /(\*\*)?(P0|P1|P2)(\*\*)?\s*[：:|-]?\s*([^|\n]{0,80})/i.exec(text);
  return { title: h1, severity: verdict?.[2] ? `${verdict[2].toUpperCase()}` : undefined, first_paragraph: text.split(/\r?\n/).find((l) => l.trim() && !/^#/.test(l))?.trim().slice(0, 200) };
}

/* ===================================================================== *
 * 工具声明
 * ===================================================================== */

const RISK_ENUM = ["SAFE", "REVIEW", "MANUAL_ONLY"];

export const tools = [
  {
    name: "afa.list_fields",
    description:
      "列出扩展资料模型里全部可填字段（canonical field）：中文名、所属板块、是否多条目、风险等级与为什么是这个等级、别名数量。" +
      "用于回答「这个助手到底能填哪些栏」。数据来自 src/rules/canonicalFields.ts 与 riskRules.ts 的真实表。",
    input_schema: {
      type: "object",
      properties: {
        group: { type: "string", description: "只看某个板块：basic/education/internship/campus/project/skills/job/content" },
        risk: { type: "string", enum: RISK_ENUM, description: "只看某个风险等级" },
        query: { type: "string", description: "按中文名或别名关键词过滤" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "默认 200（全量 91 条）" },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const q = input.query ? core.normalizeText(input.query) : "";
      const rows = [];
      for (const def of core.CANONICAL_FIELDS) {
        if (input.group && def.group !== input.group) continue;
        const risk = core.riskOfFieldId(def.id);
        if (input.risk && risk.risk !== input.risk) continue;
        const aliases = core.FIELD_ALIASES[def.id] ?? [];
        const label = core.fieldLabel(def.id);
        if (q && !(core.normalizeText(label).includes(q) || aliases.some((a) => core.normalizeText(a).includes(q)))) continue;
        rows.push({
          field_id: def.id,
          label,
          group: def.group,
          group_label: core.groupLabel(def.group),
          multi_entry: def.multiEntry,
          variants: def.variants ?? null,
          risk: risk.risk,
          risk_reason: risk.reason,
          alias_count: aliases.length,
          sample_aliases: aliases.slice(0, 6),
        });
        if (rows.length >= (input.limit ?? 200)) break;
      }
      return { total_canonical_fields: core.CANONICAL_FIELDS.length, returned: rows.length, fields: rows };
    },
  },

  {
    name: "afa.read_profile",
    description:
      "读取一份资料档案并返回**脱敏摘要**：真实条数、逐字段有没有内容、风险等级。身份证/手机/邮箱/住址/姓名等只给长度与打码形态，绝不外发完整值。" +
      "支持三种真实格式：扩展导出的 profile JSON、中文简历解析 JSON、纯文本简历（与扩展「资料」页同一条解析路径）。",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "项目内的档案文件路径；默认 tests/fixtures/cn-resume.json" },
        only_filled: { type: "boolean", description: "只列有内容的字段" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const file = resolveInputFile(input.file, DEFAULT_PROFILE_FILE);
      const loaded = loadProfileFrom(file);
      const base = {
        source: loaded.source,
        format: loaded.format,
        validation: loaded.validation,
        shape: profileShapeSummary(loaded.profile),
      };
      if (!loaded.profile) {
        return { ...base, fields: [], note: "档案未通过扩展自身的校验器，已如实返回错误，不做部分接受。" };
      }
      return {
        ...base,
        ...(loaded.ignored_blocks ? { ignored_blocks: loaded.ignored_blocks } : {}),
        ...(loaded.notes ? { parse_notes: loaded.notes } : {}),
        redaction: "身份证/手机/邮箱/住址/出生日期/姓名只返回长度与打码值（判据同 docs/TEST_DATA_POLICY.md）",
        field_count_with_value: profileFieldRows(loaded.profile, { includeMasked: false, onlyFilled: true }).length,
        fields: profileFieldRows(loaded.profile, { onlyFilled: input.only_filled ?? false, limit: input.limit ?? 200 }),
      };
    },
  },

  {
    name: "afa.validate_profile",
    description:
      "用扩展自己的校验器（src/profile/schema.ts 的 fail-safe 规则 + 真实简历映射器）检查一份档案文件，返回逐条错误与归一化后的结构统计。" +
      "用于回答「这份简历能不能被扩展吃进去」。不写任何文件。",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "项目内的档案文件路径（必填）" },
      },
      required: ["file"],
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const file = resolveInputFile(input.file, null);
      const loaded = loadProfileFrom(file);
      return {
        source: loaded.source,
        format: loaded.format,
        ok: loaded.validation.ok,
        errors: loaded.validation.errors,
        shape: profileShapeSummary(loaded.profile),
        unknown_top_keys: loaded.unknown_top_keys ?? [],
        ignored_blocks: loaded.ignored_blocks ?? [],
        parse_notes: loaded.notes ?? [],
        policy: loaded.profile ? "结构校验通过：扩展会整体接受这份档案。" : "结构校验失败：扩展按 fail-safe 拒绝整份档案，绝不部分覆盖现有资料。",
      };
    },
  },

  {
    name: "afa.scan_form",
    description:
      "对给定表单 DOM（html / 项目内文件 / 可访问的 url）做**只读扫描**：跑扩展真实的 scanner + matcher + 风险分级 + 语境门禁，" +
      "返回字段清单与匹配建议（含「为什么匹配到这个字段」）。本工具不写 DOM、不点击、不提交。",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "表单 HTML 片段" },
        file: { type: "string", description: "项目内的 HTML 文件路径（如 tests/fixtures/basic-form.html）" },
        url: { type: "string", description: "http/https 页面地址；需要能联网，失败会如实报原因" },
        profile_file: { type: "string", description: "用于匹配的资料档案；默认 tests/fixtures/cn-resume.json" },
        profile_type: { type: "string", description: "岗位方向（决定经历表达变体），如 aiProduct / general" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const { source, candidates, rawFields, profileSource } = await scanAndMatch(input);
      const limit = input.limit ?? 200;
      return {
        source,
        profile_source: profileSource,
        controls_found: rawFields.length,
        candidates_scanned: candidates.length,
        redlines: redlineTally(candidates),
        safety: "只读扫描：未对任何页面产生写入，未点击、未提交（与扩展的 Scan 阶段零写入红线同一实现）。",
        fields: candidateRows(candidates, { limit }),
        truncated: candidates.length > limit,
      };
    },
  },

  {
    name: "afa.match_question",
    description:
      "把一条表单问题（标签文字 + 可选的板块/提示/选项）交给扩展的匹配引擎，返回匹配到的资料字段、置信度、逐条依据、次选候选与风险结论。" +
      "这是「为什么匹配到这个字段」的单条问答入口，纯计算、不读文件、不碰 DOM。",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "页面上这个控件的标签文字，如「期望入职时间」" },
        section: { type: "string", description: "所在板块标题" },
        placeholder: { type: "string" },
        aria_label: { type: "string" },
        name: { type: "string" },
        id: { type: "string" },
        fieldset: { type: "string" },
        autocomplete: { type: "string" },
        input_type: { type: "string" },
        kind: { type: "string", description: "text/textarea/select/radio/checkbox/number/date/email/tel/custom-select" },
        options: { type: "array", items: { type: "string" }, maxItems: 40 },
        max_length: { type: "integer" },
        required: { type: "boolean" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const raw = buildRawFieldFromQuestion(input);
      const ctx = raw.context;
      const signals = {
        labelText: ctx.labelText,
        ariaLabel: ctx.ariaLabel,
        placeholder: ctx.placeholder,
        title: ctx.title,
        fieldsetLabel: ctx.fieldsetLabel,
        sectionTitle: ctx.sectionTitle,
      };
      const gate = core.classifyApplicationContext(ctx);
      const match = core.matchField(raw);
      const risk = core.assessRisk(match.fieldId, signals);
      const explain = core.explainCandidate({ raw, match, risk: risk.risk, riskReason: risk.reason, status: gate.eligible ? "ready" : "excluded" });
      const cls = core.classifyQuestion({ labelText: ctx.labelText, placeholder: ctx.placeholder, contextText: [ctx.sectionTitle, ctx.fieldsetLabel].filter(Boolean).join(" ") });
      return {
        question: input.question,
        application_context: { eligible: gate.eligible, zone: gate.zone, confidence: gate.confidence, reasons: gate.reasons, score: gate.score },
        field_id: match.fieldId,
        field_label: explain.fieldLabel,
        confidence: match.confidence,
        confidence_level: explain.level,
        matched_by: match.matchedBy,
        why: explain.headline,
        signals: explain.signals.map((s) => `${s.sourceLabel}：${s.text}`),
        alternative: explain.alternative ? { field_id: match.runnerUpFieldId, label: explain.alternative.fieldLabel, confidence: match.runnerUpConfidence } : undefined,
        risk: risk.risk,
        risk_reason: risk.reason,
        open_question_intent: cls.intent ?? null,
        note: gate.eligible
          ? "结论来自扩展的 matcher + riskRules，与侧边栏看到的是同一份判断。"
          : "语境门禁判定这不是申请表控件（登录 / 搜索 / 导航等），扩展不会把它列进填写清单。",
      };
    },
  },

  {
    name: "afa.plan_fill",
    description:
      "对给定表单生成**填写计划 JSON**（不落 DOM、不写入、不提交）：哪些字段会写什么（默认脱敏）、哪些被红线拦下及原因。" +
      "与扩展点「确认并填写」时走的是同一个 buildFillPlan 门禁，所以计划里绝不含 MANUAL_ONLY、未识别、语境排除或无内容的字段。",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string" },
        file: { type: "string" },
        url: { type: "string" },
        profile_file: { type: "string" },
        profile_type: { type: "string" },
        include_values: { type: "boolean", description: "true 时返回脱敏后的值预览；默认只返回长度" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const { source, candidates, profileSource } = await scanAndMatch(input);
      // 与扩展同一入口：只有 confirmed + ready/need-confirm + 有值 + 非 MANUAL_ONLY + 语境合格才进计划。
      const asConfirmed = candidates.map((c) =>
        c.status === "ready" || c.status === "need-confirm" ? { ...c, confirmed: true } : c,
      );
      const plan = core.buildFillPlan(asConfirmed, null, input.profile_type ?? null);
      const plannedRefs = new Set(plan.fields.map((f) => f.reference));
      const blocked = candidates
        .filter((c) => !plannedRefs.has(c.raw.reference))
        .map((c) => {
          const explain = core.explainCandidate(c);
          return {
            dom_label: c.raw.context.labelText || c.raw.context.placeholder || c.raw.context.name || "(未命名字段)",
            field_id: c.match.fieldId,
            field_label: explain.fieldLabel,
            status: c.status,
            risk: c.risk,
            reason: explain.blockedReason ?? c.riskReason,
          };
        });
      const limit = input.limit ?? 300;
      return {
        source,
        profile_source: profileSource,
        confirmed: plan.confirmed,
        created_at: plan.createdAt,
        plan_fields: plan.fields.slice(0, limit).map((f) => {
          const c = candidates.find((x) => x.raw.reference === f.reference);
          const masked = maskValue(f.fieldId, f.value);
          return {
            reference: f.reference,
            field_id: f.fieldId,
            field_label: c ? core.fieldFullLabel(f.fieldId) : f.fieldId,
            dom_label: c?.raw.context.labelText || c?.raw.context.placeholder || f.reference,
            kind: f.kind,
            value_length: masked.length ?? 0,
            ...(input.include_values ? { value_preview: masked.masked, redacted: !!masked.redacted } : {}),
          };
        }),
        counts: {
          planned: plan.fields.length,
          blocked: blocked.length,
          total_candidates: candidates.length,
        },
        blocked,
        redlines: redlineTally(candidates),
        safety:
          "这是**计划预览**：本工具不执行它。扩展也永远不会点击提交——填写完成后需用户自己在网页上提交。",
      };
    },
  },

  {
    name: "afa.export_results",
    description:
      "导出真实验证与兼容性产物：real-validation-results 下的 session/issue 记录清单与结论摘要、兼容性矩阵（存在则给出，不存在就说明怎么生成）、" +
      "兼容性 fixture 清单、单元测试文件清单。全部读真实入库文件，不生成也不改写任何结论。",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["all", "sessions", "issues", "compatibility"], description: "默认 all" },
        include_headings: { type: "boolean", description: "是否带每个文件的标题与首段（默认 true）" },
        limit: { type: "integer", minimum: 1, maximum: 300 },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const kind = input.kind ?? "all";
      const wantHeadings = input.include_headings !== false;
      const limit = input.limit ?? 100;
      const out = { generated_at: new Date().toISOString(), private_dir_policy: "real-validation-results/private/ 含填写值截图，已 gitignore，本工具不读取也不列出" };

      if (kind === "all" || kind === "sessions") {
        const files = listMarkdown(path.join(RESULTS_DIR, "sessions")).slice(0, limit);
        out.sessions = files.map((f) => ({ ...f, ...(wantHeadings ? firstHeading(path.join(ROOT, f.file)) : {}) }));
      }
      if (kind === "all" || kind === "issues") {
        const files = listMarkdown(path.join(RESULTS_DIR, "issues")).slice(0, limit);
        out.issues = files.map((f) => ({ ...f, ...(wantHeadings ? firstHeading(path.join(ROOT, f.file)) : {}) }));
      }
      if (kind === "all" || kind === "compatibility") {
        const report = path.join(ROOT, "compatibility-results", "report.md");
        out.compatibility = existsSync(report)
          ? { report_file: "compatibility-results/report.md", content: readFileSync(report, "utf8"), regenerated_by: "npm run test:compat" }
          : {
              report_file: null,
              note: "compatibility-results/report.md 是可再生产物，未入库；跑 npm run test:compat 生成后再读。",
            };
        out.compatibility_fixtures = listMarkdown(path.join(ROOT, "tests", "e2e", "fixtures", "compatibility")).map((f) => f.file);
        out.compat_specs = listMarkdown(path.join(ROOT, "e2e", "compat")).map((f) => f.file);
      }
      if (kind === "all") {
        out.unit_tests = listMarkdown(path.join(ROOT, "tests")).filter((f) => f.file.endsWith(".test.ts")).map((f) => f.file);
      }
      return out;
    },
  },

  {
    name: "afa.storage_overview",
    description:
      "列出扩展在 chrome.storage.local 里用到的真实存储键（键名、写它的模块、存什么、是否含个人标识）——这是从源码常量读出的真实清单。" +
      "可选传 export_file：把从扩展「资料」页导出的 JSON 交给本工具，返回真实条数与脱敏摘要。" +
      "注意：Node 进程**读不到浏览器里的 storage**，本工具不假装能读，只报键登记表与用户主动导出的文件。",
    input_schema: {
      type: "object",
      properties: {
        export_file: { type: "string", description: "项目内的导出文件路径" },
      },
      additionalProperties: false,
    },
    risk: "read",
    handler: async (input) => {
      const keys = [
        { key: "afa.profiles.v2", module: "src/profile/libraryStore.ts", holds: "多份资料库（shared + 每库经历内容）+ activeLibraryId", pii: true },
        { key: "afa.profile.v1", module: "src/profile/libraryStore.ts", holds: "单库时代的当前资料库镜像（向后兼容）", pii: true },
        { key: "afa.profiles.v2.corrupt", module: "src/profile/libraryStore.ts", holds: "解析失败时保留的原始损坏内容", pii: true },
        { key: "afa.jobs.v1", module: "src/job/jobStore.ts", holds: "岗位上下文（activeJob / 历史 / profileOverride）", pii: false },
        { key: "afa.jobs.v2", module: "src/workspace/jobRepository.ts", holds: "岗位库 v2（启动时从 v1 迁移）", pii: false },
        { key: "afa.sessions.v1", module: "src/answering/answerStore.ts", holds: "开放题回答会话快照 + 回答缓存", pii: true },
        { key: "afa.sessions.v2", module: "src/workspace/workspaceRepository.ts", holds: "ApplicationSessionV2（一次申请的工作区状态）", pii: false },
        { key: "afa.events.v1", module: "src/workspace/workspaceRepository.ts", holds: "用户 Timeline 事件（最近 200 条）", pii: false },
        { key: "afa.profilepacks.v1", module: "src/profile/pack/packStore.ts", holds: "Effective Profile Pack（填写版本/变体策略）", pii: false },
        { key: "afa.generation.settings.v1", module: "src/generation/provider.ts", holds: "模型提供方设置：baseURL 与 Key 只存这台机器", pii: true, note: "含 API Key，永不导出、永不回显值" },
        { key: "afa.generation.snapshots.v1", module: "src/generation/generationStore.ts", holds: "生成快照（用于事实溯源）", pii: true },
        { key: "afa.answer.cache.v1", module: "src/answering/answerStore.ts", holds: "按问题+事实集+提示词版本缓存的回答", pii: true },
        { key: "afa.apply.prefs.v1", module: "src/sidepanel/prefs.ts", holds: "autoFill / autoCaptureJob / showDev 三个开关", pii: false },
        { key: "afa.trace.v1", module: "src/utils/trace.ts", holds: "开发者模式的执行轨迹", pii: false },
      ];
      const result = {
        backend: "chrome.storage.local（仅在用户自己的 Edge 浏览器里）",
        node_can_read_browser_storage: false,
        note: "本工具不连浏览器、不注入页面：要拿真实内容请用扩展「资料」页导出 JSON，再用 export_file 或 afa.read_profile 读它。",
        keys,
        pii_keys: keys.filter((k) => k.pii).map((k) => k.key),
      };
      if (input.export_file) {
        const file = resolveInputFile(input.export_file, null);
        const loaded = loadProfileFrom(file);
        result.export = {
          source: loaded.source,
          format: loaded.format,
          ok: loaded.validation.ok,
          errors: loaded.validation.errors,
          shape: profileShapeSummary(loaded.profile),
          field_count_with_value: loaded.profile ? profileFieldRows(loaded.profile, { includeMasked: false, onlyFilled: true }).length : 0,
        };
      }
      return result;
    },
  },
];
