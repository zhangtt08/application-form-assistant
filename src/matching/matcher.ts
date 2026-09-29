import type { MatchResult, RawField, MatchSource } from "../types/field";
import { FIELD_ALIASES } from "../rules/fieldAliases";
import { deCamelize, normalizeText } from "../utils/normalizeText";
import { getCanonicalFieldDef } from "../rules/canonicalFields";

/**
 * Field Matcher（Phase 5）+ Confidence Engine（Phase 6）。
 * 分层策略：
 *  Level 1 精确匹配 → Level 2 别名/包含 → Level 3 上下文（section 加成、type 提示、选项提示）。
 * 绝不因“最相似”强行选择：top1 与 top2 分差过小 → UNKNOWN。
 */

interface Signal {
  text: string;
  weight: number;
  source: string;
}

const SECTION_HINTS: Record<string, string[]> = {
  basic: ["基本", "个人信息", "个人资料", "联系", "basic", "personal", "contact"],
  education: ["教育", "学历", "学习", "学业", "education"],
  internship: ["实习", "工作经历", "工作经验", "工作经历", "实践", "经历", "实习经历", "internship", "experience", "employment"],
  campus: ["校园", "社团", "学生工作", "学生干部", "在校", "课外", "campus", "student"],
  project: ["项目", "project"],
  skills: ["技能", "证书", "特长", "荣誉", "skills"],
  job: ["求职", "意向", "偏好", "就业", "job", "preference", "expectation"],
  content: ["自我", "介绍", "评价", "优势", "开放", "about", "open question"],
};

/** 段落归属加成 */
function sectionBonus(sectionTitle: string, fieldId: string): number {
  const norm = normalizeText(sectionTitle);
  if (!norm) return 0;
  const def = getCanonicalFieldDef(fieldId);
  if (!def) return 0;
  const hints = SECTION_HINTS[def.group] ?? [];
  return hints.some((h) => norm.includes(normalizeText(h))) ? 0.08 : 0;
}

/**
 * 经历类语义槽位：internship/campus/project 三组词表高度同义（工作职责/工作内容/业绩/总结），
 * 仅靠 alias 无法区分归属，必须由 section 标题决定落到哪一组。
 */
const SEMANTIC_SLOTS: string[][] = [
  ["internship.description", "campus.description", "project.description"],
  ["internship.responsibilities", "campus.responsibilities", "project.responsibilities"],
  ["internship.workContent", "campus.workContent", "project.workContent"],
  ["internship.achievements", "campus.achievements", "project.achievements"],
  ["internship.summary", "campus.summary", "project.summary"],
];

/** 组判定顺序即优先级：校园/项目/教育标题更特异，先于 internship 的泛化词（经历/实践） */
const GROUP_CHECK_ORDER = [
  "campus", "project", "education", "internship", "basic", "skills", "job", "content",
] as const;

/** section 标题 → 组。组合标题（如「教育及实习经历」）按特异组优先，只返回一个。 */
function sectionGroupOf(sectionTitle: string): string | null {
  const norm = normalizeText(sectionTitle);
  if (!norm) return null;
  for (const group of GROUP_CHECK_ORDER) {
    const hints = SECTION_HINTS[group] ?? [];
    if (hints.some((h) => norm.includes(normalizeText(h)))) return group;
  }
  return null;
}

/**
 * 信号文本自带经历组前缀（实习/项目/校园）时，alias 已能精确归属，
 * 必须跳过 section 语义转移——否则混合标题（如「经历与作品」）会把
 * 「实习描述」这类明确信号错转给其他组。
 */
export function explicitExperienceGroupOf(signalText: string): string | null {
  const norm = normalizeText(signalText);
  if (!norm) return null;
  if (/实习|工作经历|工作经验|internship/.test(norm)) return "internship";
  if (/项目|project/.test(norm)) return "project";
  if (/校园|社团|学生会|学生工作|campus/.test(norm)) return "campus";
  return null;
}

/**
 * section 明确命中某个经历组时的语义槽位归属修正：
 * - 组内同槽位 id 获得转移分（同槽位最高分 × 0.97），保证「项目经历」下的「工作职责」落 project.responsibilities
 * - 非该组的经历类候选 × 0.5 惩罚，防止实习词表抢走项目/校园板块的字段
 * 仅在 section 单独命中 campus/project/internship 之一时启用；education 等组合标题不启用。
 */
function applySectionSlotTransfer(
  sectionTitle: string,
  candidates: Map<string, Candidate>,
  addCandidate: (fieldId: string, score: number, evidence: string[], matchedBy: MatchSource) => void,
): void {
  const group = sectionGroupOf(sectionTitle);
  if (group !== "campus" && group !== "project" && group !== "internship") return;

  for (const slot of SEMANTIC_SLOTS) {
    let bestScore = 0;
    let bestId = "";
    for (const id of slot) {
      const c = candidates.get(id);
      if (c && c.score > bestScore) {
        bestScore = c.score;
        bestId = id;
      }
    }
    if (bestScore <= 0) continue;

    for (const id of slot) {
      const def = getCanonicalFieldDef(id);
      const c = candidates.get(id);
      if (def?.group === group) {
        const transfer = bestScore * 0.97;
        if (!c || transfer > c.score) {
          addCandidate(id, transfer, [`slot-transfer from ${bestId}`], "context");
        }
      } else if (c) {
        c.score *= 0.5;
        c.evidence.push(`section-penalty(${group})`);
      }
    }
  }
}

/**
 * HTML 标准 autocomplete 是站点自己声明的字段语义，比任何文本猜测都可信，
 * 权重给到与 label 同级。大量规范化的官网表单（尤其英文 ATS）只靠它就能认出。
 */
const AUTOCOMPLETE_MAP: Record<string, string> = {
  name: "basic.name",
  "organization-name": "internship.company",
  "organization-title": "internship.position",
  email: "basic.email",
  "email-address": "basic.email",
  tel: "basic.phone",
  "mobile-phone": "basic.phone",
  "tel-national": "basic.phone",
  impp: "basic.wechat",
  bday: "basic.birthDate",
  "street-address": "basic.address",
  "address-line1": "basic.address",
  "address-level2": "basic.city",
  url: "basic.portfolio",
  homepage: "basic.portfolio",
};

function autocompleteHint(autocomplete: string): { fieldId: string; score: number } | null {
  const token = normalizeText(autocomplete).split(/\s+/).filter(Boolean).pop() ?? "";
  if (!token) return null;
  const fieldId = AUTOCOMPLETE_MAP[token];
  return fieldId ? { fieldId, score: 0.94 } : null;
}

function buildSignals(ctx: RawField["context"], kind?: string): Signal[] {
  const signals: Signal[] = [];
  const push = (text: string, weight: number, source: string) => {
    const norm = normalizeText(text);
    if (norm) signals.push({ text: norm, weight, source });
  };

  push(ctx.labelText, 1.0, "label");
  push(ctx.ariaLabel, 0.95, "aria");
  push(ctx.placeholder, 0.88, "placeholder");
  // name/id 驼峰展开："phoneNumber" -> "phone number"
  push(deCamelize(ctx.name), 0.82, "name");
  push(deCamelize(ctx.id), 0.8, "id");
  push(ctx.title, 0.75, "title");
  push(ctx.prevSiblingText, 0.7, "prevSibling");
  push(ctx.fieldsetLabel, 0.65, "fieldset");
  // 单选/多选组不吃容器全文：组所在的容器往往同时装着隔壁字段的标签
  // （姚记真机：是/否 组因为容器里出现「政治面貌」被认成政治面貌）
  if (kind !== "radio" && kind !== "checkbox") push(ctx.parentText, 0.5, "parent");
  return signals;
}

function scoreAlias(signalText: string, aliasNorm: string): number {
  if (!aliasNorm) return 0;
  if (signalText === aliasNorm) return 1.0;
  if (aliasNorm.length >= 2 && signalText.includes(aliasNorm)) return 0.85;
  if (signalText.length >= 2 && aliasNorm.includes(signalText)) return 0.8;
  return 0;
}

/** type=email/tel 的弱提示（文本无结果时的兜底候选，置信度中等） */
function typeHint(ctx: RawField["context"]): { fieldId: string; score: number } | null {
  if (ctx.inputType === "email") return { fieldId: "basic.email", score: 0.78 };
  if (ctx.inputType === "tel") return { fieldId: "basic.phone", score: 0.8 };
  return null;
}

/** 选项提示：select/radio 的选项文本（如 男/女 → gender） */
function optionsHint(options: string[]): { fieldId: string; score: number } | null {
  if (!options.length) return null;
  const joined = normalizeText(options.join("|"));
  if (joined.includes("男") && joined.includes("女")) {
    return { fieldId: "basic.gender", score: 0.72 };
  }
  return null;
}

interface Candidate {
  fieldId: string;
  score: number;
  evidence: string[];
  matchedBy: MatchSource;
}

export function matchField(raw: RawField): MatchResult {
  const { context: ctx } = raw;
  const signals = buildSignals(ctx, raw.kind);
  const candidates = new Map<string, Candidate>();

  const addCandidate = (
    fieldId: string,
    score: number,
    evidence: string[],
    matchedBy: MatchSource,
  ) => {
    const existing = candidates.get(fieldId);
    if (!existing || score > existing.score) {
      candidates.set(fieldId, { fieldId, score, evidence, matchedBy });
    }
  };

  // Level 1 + 2：别名 × 信号源
  for (const [fieldId, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const signal of signals) {
      for (const alias of aliases) {
        const aliasNorm = normalizeText(alias);
        const s = scoreAlias(signal.text, aliasNorm);
        if (s > 0) {
          const matchedBy: MatchSource = s === 1.0 ? "exact" : "alias";
          addCandidate(
            fieldId,
            s * signal.weight,
            [`${signal.source}=${signal.text.slice(0, 24)}`],
            matchedBy,
          );
        }
      }
    }
    // section 上下文加成（Level 3）
    const best = candidates.get(fieldId);
    if (best && ctx.sectionTitle) {
      const bonus = sectionBonus(ctx.sectionTitle, fieldId);
      if (bonus > 0) {
        best.score = Math.min(best.score + bonus, 0.98);
        best.evidence.push(`section=${normalizeText(ctx.sectionTitle).slice(0, 16)}`);
        if (best.matchedBy === "alias") best.matchedBy = "context";
      }
    }
  }

  // section 明确命中经历组时：语义槽位转移 + 跨组惩罚（在冲突检测前修正候选分）。
  // 信号文本自带组前缀（实习/项目/校园）时跳过——alias 已能精确归属，
  // 否则混合标题（如「经历与作品」）会把「实习描述」这类明确信号错转给其他组。
  if (ctx.sectionTitle) {
    const signalText = `${ctx.labelText} ${ctx.ariaLabel} ${ctx.placeholder}`;
    if (!explicitExperienceGroupOf(signalText)) {
      applySectionSlotTransfer(ctx.sectionTitle, candidates, addCandidate);
    }
  }

  // Level 3：type / options 提示
  const ah = autocompleteHint(ctx.autocomplete);
  if (ah) addCandidate(ah.fieldId, ah.score, [`autocomplete=${ctx.autocomplete}`], "type-hint");
  const th = typeHint(ctx);
  if (th) addCandidate(th.fieldId, th.score, [`type=${ctx.inputType}`], "type-hint");
  const oh = optionsHint(raw.options);
  if (oh) addCandidate(oh.fieldId, oh.score, [`options=[${raw.options.join("/")}]`], "context");

  // 排序 + 冲突检测
  const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const runnerUp = sorted[1];

  if (!top) {
    return { fieldId: "unknown", confidence: 0, matchedBy: "none", evidence: [] };
  }

  // 多候选接近 → UNKNOWN（宁可漏配，不可错配）
  if (runnerUp && top.score - runnerUp.score < 0.06 && top.score < 0.92) {
    return {
      fieldId: "unknown",
      confidence: Math.max(0, top.score - 0.3),
      matchedBy: "none",
      evidence: [
        `冲突: ${top.fieldId}(${top.score.toFixed(2)}) vs ${runnerUp.fieldId}(${runnerUp.score.toFixed(2)})`,
      ],
      runnerUpFieldId: runnerUp.fieldId,
      runnerUpConfidence: runnerUp.score,
    };
  }

  const confidence = Math.min(top.score, 0.99);
  return {
    fieldId: top.fieldId,
    confidence: Number(confidence.toFixed(2)),
    matchedBy: top.matchedBy,
    evidence: top.evidence.slice(0, 3),
    runnerUpFieldId: runnerUp?.fieldId,
    runnerUpConfidence: runnerUp?.score,
  };
}

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.9) return "HIGH";
  if (c >= 0.7) return "MEDIUM";
  return "LOW";
}
