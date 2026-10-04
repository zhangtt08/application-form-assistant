import type { CandidateField, CandidateStatus, MatchResult, RawField, ResolvedValue } from "../types/field";
import type { Profile } from "../types/profile";
import { matchField, confidenceLevel } from "../matching/matcher";
import { assessRisk, type RiskAssessment } from "../rules/riskRules";
import { polarityMatches, polarityTerms } from "../rules/yesNoAnswers";
import { resolveValue } from "../profile/profileResolver";
import { isCanonicalFieldId, getCanonicalFieldDef } from "../rules/canonicalFields";
import { LogEvent, logger } from "../utils/logger";
import { classifyQuestion } from "../answering/questionClassifier";
import { classifyApplicationContext } from "../context/applicationContext";
import { fieldFullLabel } from "../core/fieldLabels";
import { matchSiteRule, type SiteFieldRule } from "../site/siteMemory";

export interface ScanPipelineOptions {
  /** Stage 6.5：Effective Profile Pack（variantType/experienceOrder/fieldContents 接线 resolver） */
  pack?: import("../profile/pack/types").ProfilePack;
  /** 多条目字段取第几条（默认 0；默认按 DOM 序轮转分配） */
  entryIndex?: number;
  /** 当前岗位方向（Active Job → Profile Router）：决定经历表达变体 */
  profileType?: import("../job/profileTypes").ProfileType;
  /**
   * 这一站（同一 host）的站点记忆规则，已由调用方按 host 过滤好。
   * 只读：影响「这一栏算哪个字段 / 要不要跳过」的判断，不产生任何 DOM 写入。
   * 空数组 = 没有记忆，行为与之前完全一致。
   */
  siteRules?: import("../site/siteMemory").SiteFieldRule[];
}

/**
 * number 控件能否接受这个字符串值（HTML 语义：以 0 为步长基准，`step` 属性缺省即 1）。
 * issue-003：把 `2027.06` 写进整数年份框（`input[type=number]`，默认 step=1）时，
 * 值精确、落点也正确，但页面自身的约束校验判它 `stepMismatch` —— 真实提交会被拦下。
 * `step === null` 是站点显式声明的 `step="any"`（不设限）；`undefined` 是没采到，按默认 1 从严处理。
 */
export function numberValueFitsStep(value: string, step: number | null | undefined): boolean {
  if (step === null) return true;
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) return false; // 「2026-06」「至今」根本进不了数字框
  const s = step ?? 1;
  if (!Number.isFinite(s) || s <= 0) return true;
  const q = n / s;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/** 数字控件的取值适配（年份框要 2026 而不是 2026.06）；适配后仍不合规就保持原值 */
function finalValueForControl(value: ResolvedValue | undefined, raw: RawField): ResolvedValue | undefined {
  if (!value || raw.kind !== "number") return value;
  const adapted = adaptValueToNumberControl(value.value, raw.context);
  if (!adapted || adapted === value.value) return value;
  if (!numberValueFitsStep(adapted, raw.context.step)) return value;
  return { ...value, value: adapted, sourcePath: `${value.sourcePath ?? value.fieldId}（按数字框格式取年/月）` };
}

/**
 * 数字控件的取值适配：「毕业年份」这类框要的是 `2026`，而资料库统一存 `2026.06`。
 * 只按字段语义取其中已经存在的数字，不编造任何内容；取不到就返回 undefined（保持原值，
 * 让「收不下」的判断照常生效）。
 */
export function adaptValueToNumberControl(value: string, ctx: RawField["context"]): string | undefined {
  const probe = `${ctx.labelText} ${ctx.placeholder} ${ctx.name} ${ctx.id} ${ctx.sectionTitle}`;
  const y = /(年份|year)/i.test(probe) ? /(19|20)\d{2}/.exec(value)?.[0] : undefined;
  if (y) return y;
  const m = /(月份|月份|month)/i.test(probe) ? /[-.](\d{1,2})$/.exec(value)?.[1] : undefined;
  if (m) return String(Number(m));
  // 纯数字框（年龄等）：`22岁` → `22`
  if (/^\d{1,4}$/.test(value.trim())) return undefined;
  const bare = /^(\d{1,4})\s*(岁|年|个月|km|cm|kg)$/i.exec(value.trim());
  return bare?.[1];
}

/** 选项文本比对口径（与写入层一致：去空白/标点、小写） */
function normalizeChoice(s: string): string {
  return (s ?? "")
    .replace(/[\u200b\u200c\ufeff]/g, "")
    .replace(/\s+/g, "")
    .replace(/[：:；;。.、,，*＊（）()]/g, "")
    .toLowerCase()
    .trim();
}

/** 单选/多选组的答案是否落在站点给的选项里 */
export function optionSetCoversValue(options: string[], value: string): boolean {
  const terms = value.split(/[、,，;；/\n]+/).map(normalizeChoice).filter(Boolean);
  const texts = options.map(normalizeChoice);
  return terms.some((t) => {
    // 「是/否」这类答案：站点写的是「可以接受 / 不接受」，只认同极性精确写法
    if (polarityTerms(t)) return options.some((o) => polarityMatches(t, o));
    return texts.some((o) => o === t || (t.length >= 2 && (o.includes(t) || t.includes(o))));
  });
}

/**
 * 状态推导（纯函数；扫描与「切换填写版本重解析」共用，保证两条路径行为一致）：
 * - unsupported：radio/checkbox/contenteditable 无界
 * - manual：MANUAL_ONLY / 控件收不下该值（禁止自动改写）
 * - unknown：未识别
 * - empty：识别成功但无可用内容
 * - low-confidence：匹配把握不足 → **不静默填写**，等人工确认
 * - need-confirm：AI 生成的开放题回答（要人过一眼内容）
 * - ready：SAFE + 高/中置信 + 有值（中置信按用户既有偏好仍可直接填，界面上有重点核对提示）
 */
export function deriveStatus(
  raw: RawField,
  match: MatchResult,
  risk: RiskAssessment,
  idValid: boolean,
  value: ResolvedValue | undefined,
): { status: CandidateStatus; riskReason?: string } {
  // Application Context Gate（issue-004）：先问「这是不是申请流程里的控件」，再问「它像哪个字段」。
  // 排除必须是 excluded 而不是 manual —— 「请人工填写」会把登录框伪装成一个待填的申请字段。
  const applicationContext = classifyApplicationContext(raw.context);
  if (!applicationContext.eligible) {
    return {
      status: "excluded",
      riskReason: `这不是申请表控件（语境判定：${applicationContext.zone}）—— ${applicationContext.reasons.join("；")}`,
    };
  }
  if (raw.kind === "checkbox") {
    // 多选勾选组：只有匹配到资料字段且资料里有内容时才勾（写入层按选项文本精确命中，
    // 命不中整体判失败），匹配不到的一律留在 unknown/empty，绝不凭空勾。
  }
  if (risk.risk === "MANUAL_ONLY") {
    return { status: "manual" };
  }
  if (!idValid || match.fieldId === "unknown") {
    return { status: "unknown" };
  }
  if (!value) {
    return { status: "empty" }; // 识别成功但 Profile 无可用内容
  }
  /**
   * 低置信 = 「像这一栏，但我不敢说」。以前这种会跟着自动填，
   * 用户看到的只是事后一个 62% —— 填错了要自己发现，成本全在人这边。
   * 现在它不进自动填写：卡片上写清把握不足与命中的依据，
   * 由人核对后点「确认要填这一项」显式放行（确认之后走 need-confirm，与其余字段同一道门禁）。
   * 例外：站点记忆里有人已经判过一次（confidence 被抬到人工档）→ 不再重复追问。
   */
  if (confidenceLevel(match.confidence) === "LOW") {
    return {
      status: "low-confidence",
      riskReason: `只有 ${Math.round(match.confidence * 100)}% 的把握判断这一栏是「${fieldFullLabel(match.fieldId)}」，所以没有自动填写；核对无误后点卡片上的「确认要填这一项」`,
    };
  }
  // 字数超限：既不自动截断，也不自动写入超长值（站点会判非法），交回人工缩减。
  const maxLen = raw.context.maxLength;
  if (maxLen != null && value.value.length > maxLen) {
    return {
      status: "manual",
      riskReason: `内容 ${value.value.length} 字超过字段上限 ${maxLen} 字：不自动截断，请删短后再填（或点「忽略」跳过）`,
    };
  }
  // 单选/多选组：资料里的答案必须在站点给的选项里对得上。
  // 对不上就是匹配错了（真机见过「是否接受线下面试」被判成政治面貌，值「共青团员」
  // 根本没有对应选项）——与其去点一个猜出来的选项，不如留给人工。
  if ((raw.kind === "radio" || raw.kind === "checkbox") && raw.options.length > 0 && !optionSetCoversValue(raw.options, value.value)) {
    return {
      status: "manual",
      riskReason: `网页给的选项（${raw.options.slice(0, 4).join(" / ")}）里没有你资料里的这个答案，请人工选择`,
    };
  }
  // 控件根本收不下这个值（issue-003）：与超长同一哲学——绝不自动改写用户内容。
  // 这里必须是 manual：自动填写模式也不能把不符合控件格式的值强行改写进去。
  if (raw.kind === "number" && !numberValueFitsStep(value.value, raw.context.step)) {
    return {
      status: "manual",
      riskReason: `该字段是数字控件（步长 ${raw.context.step ?? 1}），现有内容不符合其格式要求，禁止自动改写，请人工填写`,
    };
  }
  if (risk.risk === "SAFE" && confidenceLevel(match.confidence) === "HIGH") {
    return { status: "ready" };
  }
  // 用户已明确选择：REVIEW 风险与中置信仍可直接填（界面上有「重点核对」提示），
  // 低置信在上面已经被拦下，走不到这里。
  return { status: "ready" };
}

/**
 * 站点记忆里的「人工改挂」套用到匹配结果上。
 *
 * 为什么敢把置信度抬到人工档：这一栏的字段归属不是软件猜的，是人在这条 host 上
 * 亲手指过的（同一 host、同一控件文字、同一板块才命中）。但仍然只改「算哪个字段」，
 * 不改风险判定 —— assessRisk 之后照跑，所以人工把某栏改挂到身份证号/薪资这类字段上
 * 仍会被 MANUAL_ONLY 拦下（红线在站点记忆之上）。
 */
export function applySiteMapping(
  match: MatchResult,
  rule: SiteFieldRule,
): MatchResult {
  if (!rule.fieldId || rule.kind !== "map") return match;
  const from = match.fieldId;
  return {
    ...match,
    fieldId: rule.fieldId,
    confidence: Math.max(match.confidence, 0.95),
    evidence: [`siteMemory=${rule.siteLabel || rule.matchKey}`, ...match.evidence].slice(0, 3),
    // 记下来原识别结果，界面才能说清「本来识别成了什么」
    runnerUpFieldId: from !== rule.fieldId ? from : match.runnerUpFieldId,
    runnerUpConfidence: from !== rule.fieldId ? match.confidence : match.runnerUpConfidence,
  };
}

/**
 * 扫描管线编排（Side Panel 侧执行，纯逻辑）：
 * RawField → Matcher → Risk → Profile Resolver → CandidateField。
 * 只读：不产生任何 DOM 写操作。
 */
export function runScanPipeline(
  rawFields: RawField[],
  profile: Profile,
  options: ScanPipelineOptions = {},
): CandidateField[] {
  const candidates: CandidateField[] = [];
  // 多条目分配：同一 canonical id 在页面上第 k 次出现（DOM 序）→ 取 Profile 第 k 条。
  // 网申表单的「实习经历1/2/3」「项目1/2」是重复块，字段顺序与经历顺序一致；
  // 不做分配会让所有重复块都填第一条数据（错位）。每 id 独立计数，字段集合不齐时依然对齐。
  const entryCounters = new Map<string, number>();
  const siteRules = options.siteRules ?? [];
  for (const raw of rawFields) {
    // Application Context Gate 前置短路（issue-004）：非申请控件必须在多条目轮转计数之前剔除，
    // 否则登录面板里的「手机号」会挤掉 internship/basic 的真实序号，导致整张表单错位。
    const applicationContext = classifyApplicationContext(raw.context);
    if (!applicationContext.eligible) {
      const excludedMatch = matchField(raw);
      candidates.push({
        raw,
        match: excludedMatch,
        risk: "UNKNOWN",
        riskReason: `已排除（语境：${applicationContext.zone}）—— ${applicationContext.reasons.join("；")}`,
        value: undefined,
        status: "excluded",
        applicationContext,
      });
      logger.event(
        LogEvent.FIELD_SKIPPED,
        `${raw.context.labelText || raw.context.name || raw.context.placeholder} → 非申请表控件 (${applicationContext.zone})`,
        { zone: applicationContext.zone, score: applicationContext.score },
      );
      continue;
    }

    // 站点记忆（人工在这一站判过一次）——同样必须在轮转计数之前短路：
    // 「这一站别填」的一栏不该把 internship.2 的序号顶成 internship.3。
    const siteRule = matchSiteRule(siteRules, raw.context);
    if (siteRule && siteRule.kind === "block") {
      candidates.push({
        raw,
        match: matchField(raw),
        risk: "SAFE",
        riskReason: `按你在 ${siteRule.host} 的设定，这一栏以后都不自动填`,
        value: undefined,
        status: "ignored",
        applicationContext,
        siteRule: { ruleId: siteRule.id, host: siteRule.host, kind: "block" },
      });
      logger.event(LogEvent.FIELD_SKIPPED, `${raw.context.labelText || raw.context.name} → 站点设定：这一站不填`);
      continue;
    }

    // Stage 4：开放问题识别（必须在 matcher 轮转计数之前——
    // 开放问题常被 alias 误配到 multiEntry 字段（如「为什么申请岗位」→ internship.position），
    // 若不提前短路会挤占轮转序号，导致真实经历字段错位）
    const earlyCls = classifyQuestion({
      labelText: raw.context.labelText,
      placeholder: raw.context.placeholder,
      contextText: [raw.context.sectionTitle, raw.context.fieldsetLabel].filter(Boolean).join(" "),
    });
    if (earlyCls.intent && earlyCls.matchedBy !== "open-marker") {
      // 强开放题（关键词命中）：直接走 Answer Engine 路径，不进入 matcher 分配
      const match = matchField(raw);
      const risk = assessRisk(match.fieldId, {
        labelText: raw.context.labelText,
        ariaLabel: raw.context.ariaLabel,
        placeholder: raw.context.placeholder,
        title: raw.context.title,
        fieldsetLabel: raw.context.fieldsetLabel,
        sectionTitle: raw.context.sectionTitle,
      });
      candidates.push({
        raw,
        match,
        risk: risk.risk,
        riskReason: risk.reason,
        value: undefined,
        status: "unknown",
        openAnswer: {
          intent: earlyCls.intent,
          question: raw.context.labelText || raw.context.placeholder || "开放问题",
          status: "not_generated",
          lengthConstraint: { maxLength: raw.context.maxLength, targetCharacters: raw.context.maxLength ?? 300 },
        },
      });
      logger.event(LogEvent.QUESTION_CLASSIFY, `${earlyCls.intent} ← ${raw.context.labelText.slice(0, 20)}`, {
        intent: earlyCls.intent,
      });
      continue;
    }

    let match = matchField(raw);
    // 站点记忆改挂前的自动识别结果，界面用它说明「本来识别成了什么」
    const siteOverrodeFrom =
      siteRule && siteRule.kind === "map" && siteRule.fieldId && siteRule.fieldId !== match.fieldId
        ? match.fieldId
        : undefined;
    if (siteRule && siteRule.kind === "map") {
      match = applySiteMapping(match, siteRule);
    }

    // 风险评估：文本关键词优先，其次 canonical id（即使 unknown 也可能命中敏感词）
    const risk = assessRisk(match.fieldId, {
      labelText: raw.context.labelText,
      ariaLabel: raw.context.ariaLabel,
      placeholder: raw.context.placeholder,
      title: raw.context.title,
      fieldsetLabel: raw.context.fieldsetLabel,
      sectionTitle: raw.context.sectionTitle,
    });

    const idValid = isCanonicalFieldId(match.fieldId);

    // 取值：MANUAL_ONLY 永不取值；unknown 不取值
    let entryIndex = options.entryIndex;
    if (options.entryIndex === undefined && idValid) {
      const def = getCanonicalFieldDef(match.fieldId);
      if (def?.multiEntry) {
        const n = entryCounters.get(match.fieldId) ?? 0;
        entryCounters.set(match.fieldId, n + 1);
        entryIndex = n;
      }
    }
    const value =
      idValid && risk.risk !== "MANUAL_ONLY"
        ? resolveValue(match.fieldId, profile, {
            entryIndex,
            maxLength: raw.context.maxLength,
            profileType: options.profileType,
            pack: options.pack,
          })
        : undefined;

    const derived = deriveStatus(raw, match, risk, idValid, finalValueForControl(value, raw));
    let status = derived.status;
    let riskReason = derived.riskReason ?? risk.reason;
    let finalValue = finalValueForControl(value, raw);

    // Stage 4：开放问题识别。
    // classifyQuestion 命中（keyword/strong/open-marker）时强制覆盖 matcher 的误配——
    // 开放问题常被 alias 部分匹配到 direct/experience 字段（如「为什么申请岗位」→ internship.position），
    // 此时 matcher 结果必须废弃，改走 Answer Engine 路径。
    let openAnswer: import("../answering/types").OpenAnswerMeta | undefined;
    const cls = classifyQuestion({
      labelText: raw.context.labelText,
      placeholder: raw.context.placeholder,
      contextText: [raw.context.sectionTitle, raw.context.fieldsetLabel].filter(Boolean).join(" "),
    });
    if (cls.intent) {
      openAnswer = {
        intent: cls.intent,
        question: raw.context.labelText || raw.context.placeholder || "开放问题",
        status: "not_generated",
        lengthConstraint: { maxLength: raw.context.maxLength, targetCharacters: raw.context.maxLength ?? 300 },
      };
      // 已有解析内容（value 存在）说明 matcher 命中了真实资料字段 → 保留原路径；
      // 无内容（empty/unknown/low-confidence）→ 废弃误配，标记为开放题待生成
      if (!value) {
        finalValue = undefined;
        status = "unknown";
      }
    }

    candidates.push({
      raw,
      match,
      risk: risk.risk,
      riskReason,
      value: finalValue,
      status,
      entryIndex,
      openAnswer,
      applicationContext,
      siteRule:
        siteRule && siteRule.kind === "map"
          ? { ruleId: siteRule.id, host: siteRule.host, kind: "map", overriddenFieldId: siteOverrodeFrom }
          : undefined,
    });

    // ContentResolver 日志（spec Stage 2 第二十二章）：内容来源可追溯
    if (value) {
      const source = value.sourceType ?? "fact";
      logger.event(
        LogEvent.CONTENT_RESOLVER,
        `${match.fieldId} source=${source}${value.fallbackUsed ? " fallback=true" : ""}${value.profileType ? ` profile=${value.profileType}` : ""}`,
      );
    }

    if (idValid && status !== "unknown" && status !== "empty" && status !== "low-confidence") {
      logger.event(
        LogEvent.FIELD_MATCHED,
        `${raw.context.labelText || raw.context.name} → ${match.fieldId} (${match.confidence}) [${risk.risk}]${siteRule ? " 站点设定" : ""}`,
        { evidence: match.evidence },
      );
    } else {
      logger.event(LogEvent.FIELD_SKIPPED, `${raw.context.labelText || raw.context.name} → 不填写 (${status})`);
    }
  }

  return candidates;
}
