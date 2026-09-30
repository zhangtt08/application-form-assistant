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
/**
 * 时间栏（真机字节跳动：教育经历板块下的「开始时间 / 结束时间」会被实习线抢走，
 * 把实习的起止月份填进求学的起止月份 —— 那是另一段经历的内容）。
 * 单列出来是因为教育板块**只**转移时间栏：描述/职责那几组没有教育线槽位，
 * 整体套用会把教育板块的字段全打成 unknown。
 */
const DATE_SLOTS: string[][] = [
  ["education.startDate", "internship.startDate", "campus.startDate", "project.startDate"],
  ["education.endDate", "internship.endDate", "campus.endDate", "project.endDate"],
];

const SEMANTIC_SLOTS: string[][] = [
  ["internship.description", "campus.description", "project.description"],
  ["internship.responsibilities", "campus.responsibilities", "project.responsibilities"],
  ["internship.workContent", "campus.workContent", "project.workContent"],
  ["internship.achievements", "campus.achievements", "project.achievements"],
  ["internship.summary", "campus.summary", "project.summary"],
  /**
   * 「职务 / 职位」这一类：站点板块写着「校园经历 / 学生会」时，「担任职务」要落在
   * campus.position（技术部部长），不能被实习线的 internship.position（AI 实习生）顶掉 ——
   * 那是把另一段经历的内容填进这一栏。
   */
  ["internship.position", "campus.position", "project.role"],
  ...DATE_SLOTS,
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
 * campus/project/internship 全套槽位启用；纯教育标题（「教育经历」）只启用时间栏，
 * 混合标题（「教育及实习经历」）不启用 —— 那本来就是两段经历共用一个板块。
 */
function applySectionSlotTransfer(
  sectionTitle: string,
  candidates: Map<string, Candidate>,
  addCandidate: (fieldId: string, score: number, evidence: string[], matchedBy: MatchSource) => void,
): void {
  const group = sectionGroupOf(sectionTitle);
  const pureEducation =
    group === "education" && !/实习|工作|项目|校园|社团|internship|project|campus/i.test(normalizeText(sectionTitle));
  if (group !== "campus" && group !== "project" && group !== "internship" && !pureEducation) return;

  const slots = pureEducation ? DATE_SLOTS : SEMANTIC_SLOTS;
  for (const slot of slots) {
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
 * 受保护类别 / 人口统计自证题（EEO、民族、残障、兵役等）。
 * 这些是「对一类人的声明」，不是资料库里的个人信息；即使某个别名碰巧命中也不许自动写。
 */
const PROTECTED_CLASS_MARKERS = [
  "hispanic", "latino", "latinx", "african american", "native american", "pacific islander",
  "two or more races", "ethnicity", "sexual orientation", "gender identity",
  "veteran", "disabled veteran", "disability", "race",
  "民族", "种族", "残障", "残疾", "退伍军人", "兵役",
];

function protectedClassHit(text: string): string | null {
  const norm = normalizeText(text);
  for (const mark of PROTECTED_CLASS_MARKERS) {
    if (/[^\x00-\x7F]/.test(mark) ? norm.includes(mark) : aliasIn(norm, mark)) return mark;
  }
  return null;
}

/**
 * 「这是别人的信息」标记（normalize 后比对）。
 * 站点标签里出现这些词，说明要填的是推荐人 / 家长 / 紧急联系人等**他人**资料，
 * 不能用应聘者自己的姓名、手机号去顶替（姚记真机：「推荐人姓名」含「姓名」，包含式别名会错填）。
 */
const OTHER_PERSON_MARKERS = [
  "推荐人", "内推人", "介绍人", "证明人", "家长", "监护人", "配偶", "亲属", "紧急联系人",
  "referee", "referencer",
  /**
   * 站点在标签里明写「这是别人的信息」的形态（真机携程招聘官网 bundle：
   * `候选人姓名` / `候选人手机号（请勿填写你的个人信息）` / `候选人邮箱（请勿填写你的个人信息）`，
   * 那是内推人替被推荐人填的表）。
   * 不能把裸词「候选人」列进来：国内 ATS 也用「候选人信息」指应聘者本人的资料区
   * （北森/大易的应聘者中心就叫这个），一刀切会把本人字段整体打成需人工。
   */
  "请勿填写你的个人信息", "请勿填写您的个人信息",
];

/** 专为「他人」设立的 canonical id：只有它们可以在含他人标记的标签上成立 */
const OTHER_PERSON_FIELD_IDS = new Set(["basic.emergencyContactName", "basic.emergencyContactPhone"]);

/**
 * 带限定词的字段名后缀（真机字节跳动官网文案：「学历类型」「紧急联系人与自己的关系」）。
 * 这类标签问的是「XX 的类型/关系」，不是 XX 本身；资料库没有对应槽位时留人工。
 */
const QUALIFIED_SUFFIX_PATTERN = /(类型|类别|种类|关系)$/;


/**
 * HTML 标准 autocomplete 是站点自己声明的字段语义，比任何文本猜测都可信，
 * 权重给到与 label 同级。大量规范化的官网表单（尤其英文 ATS）只靠它就能认出。
 */
const AUTOCOMPLETE_MAP: Record<string, string> = {
  name: "basic.name",
  "given-name": "basic.givenName",
  "family-name": "basic.surname",
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

/**
 * 英文（纯 ASCII）别名必须**整词**命中。
 *
 * 真机教训（Greenhouse）：裸包含式让 `city` 命中 `ethni|city|`（"Are you Hispanic/Latino?" 的
 * id=hispanic_ethnicity → 被认成「所在城市」并写入）、`tel` 命中 `|tel|l`（"Tell us about your
 * proudest accomplishment" → 被认成手机号写入）、以及 `la|tel|ino`。
 * 中文没有词边界，仍走包含式。
 */
const WORD_ALIAS_RE = new Map<string, RegExp>();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasIn(hay: string, needle: string): boolean {
  if (!needle) return false;
  if (/[^\x00-\x7F]/.test(needle)) return hay.includes(needle);
  let re = WORD_ALIAS_RE.get(needle);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, "i");
    WORD_ALIAS_RE.set(needle, re);
  }
  return re.test(hay);
}

function scoreAlias(signalText: string, aliasNorm: string): number {
  if (!aliasNorm) return 0;
  if (signalText === aliasNorm) return 1.0;
  // 别名出现在标签里：英文别名要求整词（否则 city ⊂ ethnicity、tel ⊂ tell/latino 会错填）
  if (aliasNorm.length >= 2 && aliasIn(signalText, aliasNorm)) return 0.85;
  // 标签是别名的一部分（控件 name="lang" 对上 "language skills"）：这里不能加词边界，
  // 否则短 name 的站点会整体认不出来（少填）。
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

  /**
   * 「这是别人的信息」守卫（姚记真机站点暴露的错填形态）：
   * 标签「推荐人姓名」里含「姓名」，包含式别名会把**应聘者自己**的名字填进推荐人栏。
   * 命中他人标记时，只有专为「他人」设立的 canonical 才允许成立，其余一律 UNKNOWN（宁缺勿错）。
   */
  const whoText = normalizeText(
    [ctx.labelText, ctx.ariaLabel, ctx.placeholder, ctx.name, ctx.id, ctx.fieldsetLabel, ctx.prevSiblingText].join(" "),
  );
  const otherPerson = OTHER_PERSON_MARKERS.find((mark) => whoText.includes(normalizeText(mark)));
  if (otherPerson && !OTHER_PERSON_FIELD_IDS.has(top.fieldId)) {
    return {
      fieldId: "unknown",
      confidence: 0,
      matchedBy: "none",
      evidence: [`标签里的「${otherPerson}」不是你的信息，不能拿你的资料代填`],
    };
  }

  // 人口统计 / 受保护类别自证题：不是资料，任何情况下都不自动写
  const protectedMark = protectedClassHit(
    [ctx.labelText, ctx.ariaLabel, ctx.placeholder, ctx.name, ctx.id, ctx.fieldsetLabel, ctx.sectionTitle].join(" "),
  );
  if (protectedMark) {
    return {
      fieldId: "unknown",
      confidence: 0,
      matchedBy: "none",
      evidence: [`人口统计 / 自证类问题（${protectedMark}）：不属于资料，需本人作答`],
    };
  }

  /**
   * 组合控件的子控件不继承分组标题（Greenhouse 真机）：
   * 电话控件是 `<fieldset><legend>Phone</legend> [Country 下拉] [号码输入框] </fieldset>`，
   * 那个 Country 下拉只因为 fieldset=Phone 就被认成手机号并写入号码 —— 那是错填。
   * 控件自己有标签、而标签完全没匹配上、候选只来自「分组级信号」（fieldset/section/parent）时，
   * 说明这个控件是分组里的一个**不同**字段，宁缺勿错。
   */
  const onlyGroupSignal = top.evidence.length > 0 && top.evidence.every((e) => /^(fieldset|section|parent)=/.test(e));
  if (onlyGroupSignal && normalizeText(ctx.labelText)) {
    return {
      fieldId: "unknown",
      confidence: 0,
      matchedBy: "none",
      evidence: [`控件自己的标签「${ctx.labelText.trim().slice(0, 24)}」与所在分组的标题不是一回事，不替它猜`],
    };
  }

  /**
   * 「字段名 + 限定词」问的不是那个字段本身（字节跳动官网真机文案：「学历类型」不是「学历」、
   * 「紧急联系人与自己的关系」不是「紧急联系人姓名」，资料库都没有对应槽位）。
   * 只在胜出靠**包含式**匹配（标签比别名长）时拦下：别名里有完整写法的（「学位类型」→
   * education.degreeType）走 exact 分支，照常通过。
   */
  const qualifiedLabel = normalizeText(ctx.labelText || ctx.ariaLabel || ctx.placeholder);
  if (top.matchedBy !== "exact" && QUALIFIED_SUFFIX_PATTERN.test(qualifiedLabel)) {
    return {
      fieldId: "unknown",
      confidence: 0,
      matchedBy: "none",
      evidence: [`标签「${qualifiedLabel.slice(0, 24)}」问的是带限定词的字段，资料库没有这一栏，不拿「${top.fieldId}」顶`],
    };
  }

  // 多候选接近 → UNKNOWN（宁可漏配，不可错配）
  if (runnerUp && top.score - runnerUp.score < 0.06 && top.score < 0.92) {
    /**
     * 但控件自己的声明优先于「放弃」：`<input type=email>` 配「电子邮箱地址」这种
     * 同时含「邮箱」和「地址」的标签，站点已经说明它是邮箱；直接判 unknown
     * 就是真机上「明明识别到了却少填」。
     */
    const hints = [ah, th].filter((h): h is { fieldId: string; score: number } => !!h);
    const decider = hints.find((h) => h.fieldId === top.fieldId || h.fieldId === runnerUp.fieldId);
    if (decider) {
      const winner = Array.from(candidates.values()).find((c) => c.fieldId === decider.fieldId) ?? top;
      const loser = winner.fieldId === top.fieldId ? runnerUp : top;
      return {
        fieldId: winner.fieldId,
        confidence: Number(Math.max(winner.score, 0.9).toFixed(2)),
        matchedBy: winner.matchedBy,
        evidence: [
          ...winner.evidence.slice(0, 2),
          `控件声明（${decider === ah ? `autocomplete=${decider.fieldId}` : `type=${decider.fieldId}`}）决断同分冲突`,
        ],
        runnerUpFieldId: loser.fieldId,
        runnerUpConfidence: loser.score,
      };
    }
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
