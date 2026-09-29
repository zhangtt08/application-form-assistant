import type { ApplicationContextResult, ApplicationZone, ContextAncestorSignal, RawFieldContext } from "../types/field";

/**
 * Application Context Gate —— issue-004 的修复层。
 *
 * 一句话：系统原来只回答「这个控件长得像哪个字段」，从不回答「这个控件是不是申请流程的一部分」。
 * 于是 Moka 登录面板里的手机号框被判成 basic.phone、导航栏的职位搜索框被判成 internship.position，
 * 两者都是 SAFE、都带得上内容、都能进 ConfirmedFillPlan —— 用户点一次「确认并填写」，
 * 就把自己的手机号推进了一个**登录表单**。
 *
 * 判定不靠 `<form>`：姚记真实申请表单 `form.length === 0`，用它当门禁会把整张表单全否掉。
 * 用的是**由近及远的结构信号 + 确定性正负评分**（§十：不要 if login => false else true）。
 * 纯函数：输入只有已采集的上下文数据，绝不碰 DOM。
 */

/** 认证语境词（§六） */
const AUTH_TERMS = [
  "验证码", "获取验证码", "短信验证码", "验证码登录", "手机号登录", "首次登录", "创建账号",
  "忘记密码", "扫码登录", "一键登录", "登录后申请", "注册", "密码", "登录",
  "verification code", "verify code", "sign in", "signin", "log in", "login", "register", "sign up", "password", "otp", "captcha",
];
/** 搜索语境（§七） */
const SEARCH_TERMS = ["搜索职位", "职位搜索", "搜索岗位", "岗位搜索", "搜索", "请输入职位关键词", "输入职位关键字", "search", "keyword"];
/** 导航 / 全局 chrome（§八） */
const NAV_TERMS = ["职位列表", "全部职位", "在招职位", "首页", "关于我们", "更多资讯", "导航", "menu", "navbar"];
const GLOBAL_TERMS = ["cookie", "隐私政策", "备案号", "icp", "关注我们", "公众号", "版权", "footer", "copyright"];
/** 申请语境正向词（§九） */
const APP_TERMS = [
  "投递简历", "申请职位", "立即申请", "申请信息", "个人信息", "基本信息", "联系方式", "求职信息",
  "教育经历", "教育背景", "工作经历", "实习经历", "项目经历", "校园经历", "简历信息", "上传简历",
  "毕业时间", "毕业年份", "毕业院校", "期望职位", "期望岗位", "工作内容", "岗位职责",
  "apply", "application", "resume", "candidate info", "personal info",
];
/** 「典型申请字段共现」用的字段名族（§九：这是非常强的正向信号） */
const APP_FIELD_FAMILIES: { id: string; terms: string[] }[] = [
  { id: "name", terms: ["姓名", "name"] },
  { id: "phone", terms: ["手机", "phone", "mobile", "tel"] },
  { id: "email", terms: ["邮箱", "email", "mail"] },
  { id: "school", terms: ["院校", "学校", "大学", "school", "university"] },
  { id: "major", terms: ["专业", "major"] },
  { id: "company", terms: ["公司", "企业", "company"] },
  { id: "date", terms: ["毕业", "入职", "离职", "年月", "date"] },
  { id: "position", terms: ["职位", "岗位", "position", "title"] },
];
/** 直接指向认证流程的 autocomplete（§六：autocomplete=tel 不能证明它是申请字段） */
const AUTH_AUTOCOMPLETE = ["one-time-code", "current-password", "new-password", "username", "auth-password", "otp"];
/** 通用语义 class/id 片段（§十二：generic patterns，不依赖具体站点 class） */
const HINT_AUTH = ["login", "signin", "signup", "register", "auth", "verif", "captcha", "password", "sms"];
const HINT_SEARCH = ["search", "filter", "keyword"];
const HINT_NAV = ["nav", "header", "menu", "toolbar"];
const HINT_GLOBAL = ["footer", "cookie", "banner", "sidebar"];
/** 通用语义 class/id 片段（§十二：generic patterns，不绑定任何具体站点）。
 *  刻意不含 dialog/modal/drawer/panel —— 弹层既可能是真表单也可能是登录框，见 §八。 */
const HINT_APP = ["form", "field", "apply", "resume", "profil", "applicant"];

/** 采集侧用同一份词表做命中压缩：只保留命中的词，不保留正文（避免把页面文本搬进上下文） */
export function collectZoneHits(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: string[] = [];
  const scan = (list: string[], tag: string) => {
    for (const term of list) {
      if (lower.includes(term.toLowerCase())) {
        hits.push(`${tag}:${term}`);
        if (hits.length >= 12) return;
      }
    }
  };
  scan(AUTH_TERMS, "auth");
  scan(SEARCH_TERMS, "search");
  scan(NAV_TERMS, "nav");
  scan(GLOBAL_TERMS, "global");
  scan(APP_TERMS, "app");
  return [...new Set(hits)];
}

function hitsOf(signals: ContextAncestorSignal[], prefix: string, within: (depth: number) => boolean): string[] {
  return signals.filter((s) => within(s.depth)).flatMap((s) => s.hits.filter((h) => h.startsWith(`${prefix}:`)));
}

function hintMatches(signals: ContextAncestorSignal[], vocab: string[]): boolean {
  return signals.some((s) => s.hints.some((h) => vocab.some((v) => h.includes(v))));
}

function tagLandmark(signals: ContextAncestorSignal[], tags: string[]): boolean {
  return signals.some((s) => tags.includes(s.tag) || (tags.includes("dialog") && s.role === "dialog"));
}

function fieldText(ctx: RawFieldContext): string {
  return [ctx.labelText, ctx.placeholder, ctx.ariaLabel, ctx.name, ctx.id, ctx.title, ctx.fieldsetLabel, ctx.sectionTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** 共现的典型申请字段族数（§九） */
function appFieldFamilyCount(ctx: RawFieldContext): number {
  const texts = [...(ctx.siblingLabels ?? []), ctx.labelText, ctx.placeholder, ctx.fieldsetLabel, ctx.sectionTitle].filter(Boolean);
  const joined = texts.join(" ").toLowerCase();
  let n = 0;
  for (const fam of APP_FIELD_FAMILIES) {
    if (fam.terms.some((t) => joined.includes(t.toLowerCase()))) n += 1;
  }
  return n;
}

/**
 * 语境判定。
 * 结论只有三种走向：
 *  - 正向足够强 → application（可进候选）
 *  - 负向占优 → authentication / search / navigation / global（排除，且**不是** manual）
 *  - 说不清 → unknown（保守保留为可填，但拿不到 ready 待遇；§十「Unknown > Wrong」）
 */
export function classifyApplicationContext(ctx: RawFieldContext): ApplicationContextResult {
  const signals = ctx.ancestorSignals ?? [];
  const reasons: string[] = [];
  let score = 0;
  const zoneScore: Record<ApplicationZone, number> = {
    application: 0, authentication: 0, navigation: 0, search: 0, global: 0, unknown: 0,
  };

  // ---- 负向：认证（按层衰减：容器越远，证据越弱）----
  const authNear = hitsOf(signals, "auth", (d) => d <= 2).length;
  const authMid = hitsOf(signals, "auth", (d) => d >= 3 && d <= 4).length;
  const authFar = hitsOf(signals, "auth", (d) => d >= 5).length;
  if (authNear) {
    score -= 6;
    zoneScore.authentication -= 6;
    reasons.push(`紧邻容器出现认证用语（${authNear} 处）`);
  }
  if (authMid) {
    score -= 4;
    zoneScore.authentication -= 4;
    reasons.push(`所在区块含认证用语（${authMid} 处，第 3–4 层）`);
  }
  if (authFar) {
    score -= 2;
    zoneScore.authentication -= 2;
    reasons.push(`更外层含认证用语（${authFar} 处，权重已衰减）`);
  }
  if (ctx.inputType === "password" || AUTH_AUTOCOMPLETE.includes((ctx.autocomplete || "").toLowerCase())) {
    score -= 6;
    zoneScore.authentication -= 6;
    reasons.push(`控件自身是认证输入（type=${ctx.inputType} autocomplete=${ctx.autocomplete || "-"})`);
  }
  if (hintMatches(signals, HINT_AUTH)) {
    score -= 4;
    zoneScore.authentication -= 4;
    reasons.push("祖先容器语义 class/id 含 login/auth 模式");
  }

  // ---- 负向：搜索 ----
  const text = fieldText(ctx);
  const selfSearch = ctx.inputType === "search" || signals.some((s) => s.role === "searchbox" && s.depth <= 2) ||
    SEARCH_TERMS.some((t) => (ctx.placeholder || ctx.labelText || ctx.ariaLabel).toLowerCase().includes(t.toLowerCase()));
  if (selfSearch) {
    score -= 5;
    zoneScore.search -= 5;
    reasons.push("控件自身是搜索框（type=search / role=searchbox / 占位文案含搜索）");
  }
  if (hitsOf(signals, "search", (d) => d <= 2).length || hintMatches(signals, HINT_SEARCH)) {
    score -= 3;
    zoneScore.search -= 3;
    reasons.push("近邻容器是搜索区");
  }

  // ---- 负向：导航 / 全局 ----
  if (tagLandmark(signals, ["nav", "header"]) || hintMatches(signals, HINT_NAV)) {
    score -= 4;
    zoneScore.navigation -= 4;
    reasons.push("控件位于 header / nav 导航区");
  }
  if (tagLandmark(signals, ["footer"]) || hintMatches(signals, HINT_GLOBAL)) {
    score -= 3;
    zoneScore.global -= 3;
    reasons.push("控件位于 footer / 全局区");
  }

  // ---- 正向：申请语境 ----
  const appNear = hitsOf(signals, "app", (d) => d <= 2).length;
  const appAny = hitsOf(signals, "app", () => true).length;
  if (appNear) {
    score += 3;
    zoneScore.application += 3;
    reasons.push(`紧邻容器出现申请用语（${appNear} 处）`);
  } else if (appAny) {
    score += 1;
    zoneScore.application += 1;
    reasons.push("外层容器含申请用语（权重低）");
  }
  const families = appFieldFamilyCount(ctx);
  if (families >= 3) {
    score += 4;
    zoneScore.application += 4;
    reasons.push(`同一容器内共现 ${families} 类典型申请字段（强正向信号）`);
  } else if (families === 2) {
    score += 2;
    zoneScore.application += 2;
    reasons.push("同一容器内共现 2 类典型申请字段");
  }
  if (ctx.fieldsetLabel || ctx.sectionTitle) {
    const titled = `${ctx.fieldsetLabel} ${ctx.sectionTitle}`;
    if (APP_TERMS.some((t) => titled.toLowerCase().includes(t.toLowerCase()))) {
      score += 2;
      zoneScore.application += 2;
      reasons.push("字段所属分组标题是申请语义（fieldset / 小节标题）");
    }
  }
  // §八：dialog / modal / drawer 本身**不是**正向信号——真表单和登录框都常装进弹层，
  // 只看容器里写的是「投递简历」还是「验证码」。把它们算成正向会把登录面板越帮越像申请表。
  if (tagLandmark(signals, ["form", "fieldset", "section", "article"]) || hintMatches(signals, HINT_APP)) {
    score += 1;
    zoneScore.application += 1;
    reasons.push("位于表单/分组等语义容器内");
  }
  // 「期望职位」「申请职位」这类真申请字段绝不因含「职位」二字被当搜索框（§十五）
  if (/期望职位|申请职位|岗位名称|应聘职位|expected position|desired position/i.test(text)) {
    score += 3;
    zoneScore.application += 3;
    reasons.push("字段名本身是申请语义（含「职位」不等于搜索）");
  }

  const zone: ApplicationZone =
    zoneScore.application >= 3 && zoneScore.application >= -zoneScore.authentication &&
    zoneScore.application >= -zoneScore.search && zoneScore.application >= -zoneScore.navigation
      ? "application"
      : zoneScore.authentication < 0 && zoneScore.authentication <= zoneScore.search && zoneScore.authentication <= zoneScore.navigation
        ? "authentication"
        : zoneScore.search < 0 && zoneScore.search <= zoneScore.navigation
          ? "search"
          : zoneScore.navigation < 0
            ? "navigation"
            : zoneScore.global < 0
              ? "global"
              : "unknown";

  const excludedZones: ApplicationZone[] = ["authentication", "navigation", "search", "global"];
  const eligible = !excludedZones.includes(zone);
  const magnitude = Math.abs(score);
  const confidence = magnitude >= 6 ? "high" : magnitude >= 3 ? "medium" : "low";
  return {
    eligible,
    zone,
    confidence,
    reasons: reasons.length ? reasons : ["无正反结构信号，按 unknown 保守保留"],
    score,
  };
}
