import type {
  CampusExperienceEntry,
  ContentProfile,
  EducationEntry,
  ExperienceVariants,
  InternshipEntry,
  JobPreferences,
  LongTextBlock,
  Profile,
  ProjectEntry,
} from "../types/profile";

/**
 * 简历纯文本 → Profile 解析（离线 / 确定性 / fail-safe）。
 *
 * 定位：网申里最耗时的一步是把简历重新敲进各个系统的表单。
 * 本模块让用户「粘贴一份中文简历的纯文本」就能得到结构化资料，
 * 不依赖任何 LLM、不联网、不上传 —— 与项目「免费可自托管」的选型一致。
 *
 * 设计原则（与 importMapper 一致）：
 * 1. **只搬运文本里明确写了的内容**，缺的留空，绝不编造；
 * 2. 岗位方向变体（variants）是表达层，导入时一律留空；
 * 3. 解析不出有效板块时**整体拒绝**，避免用一份垃圾文本清空现有资料；
 * 4. 输出经过 profileStore 的 validateProfile 复检后才允许写盘。
 *
 * 支持的输入形态：标题分节（教育背景 / 实习经历 / 项目经历 / 校园经历 / 技能证书 /
 * 自我评价 / 求职意向）、Markdown 记号（#、**、- 列表）、全角空格、
 * 多种日期写法（2024.06-2024.09 / 2024年6月—9月 / 2023-2024 / 2024.06-至今）。
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

export type ResumeTextParseResult =
  | { ok: true; profile: Profile; notes: string[] }
  | { ok: false; errors: string[] };

interface Line {
  text: string;
  blankBefore: boolean;
}

type SectionKey =
  | "basic"
  | "education"
  | "internship"
  | "project"
  | "campus"
  | "skills"
  | "job"
  | "selfIntroduction"
  | "selfEvaluation"
  | "personalAdvantages"
  | "careerPlan"
  | "hobbies";

type ContentKey = "selfIntroduction" | "selfEvaluation" | "personalAdvantages" | "careerPlan" | "hobbies";

const CONTENT_KEYS: ContentKey[] = [
  "selfIntroduction",
  "selfEvaluation",
  "personalAdvantages",
  "careerPlan",
  "hobbies",
];

const EMPTY_VARIANTS: ExperienceVariants = {
  agent: "",
  aiApplication: "",
  aiProduct: "",
  aiOperation: "",
  aiSolution: "",
  aigcMarketing: "",
};

/* ------------------------------------------------------------------ *
 * 分节标题识别
 * ------------------------------------------------------------------ */

const SECTION_WORDS: { key: SectionKey; words: string[] }[] = [
  { key: "education", words: ["教育背景", "教育经历", "学历背景", "教育信息", "学习经历", "教育与培训", "教育", "education"] },
  {
    key: "internship",
    words: [
      "实习与工作经历",
      "工作与实习经历",
      "实习/工作经历",
      "实习及工作经历",
      "实习和工作经历",
      "实习经历",
      "实习经验",
      "工作经历",
      "工作经验",
      "职业经历",
      "实习",
      "internship",
      "experience",
    ],
  },
  {
    key: "project",
    words: ["项目经历", "项目经验", "项目实践", "科研经历", "科研项目", "项目", "project", "projects"],
  },
  {
    key: "campus",
    words: [
      "校园经历",
      "校园活动",
      "校园实践",
      "学生工作",
      "社团经历",
      "社团活动",
      "社会实践",
      "实践经历",
      "社会工作",
      "组织经历",
      "campus",
    ],
  },
  {
    key: "skills",
    words: [
      "技能与证书",
      "技能证书",
      "专业技能",
      "技能特长",
      "语言能力",
      "计算机能力",
      "获奖情况",
      "获奖经历",
      "荣誉奖项",
      "技能",
      "证书",
      "奖项",
      "荣誉",
      "skills",
    ],
  },
  { key: "selfIntroduction", words: ["自我介绍", "个人介绍", "self introduction"] },
  { key: "selfEvaluation", words: ["自我介绍与评价", "自我评价", "个人评价", "自我描述", "自我认知"] },
  { key: "personalAdvantages", words: ["个人优势", "个人总结", "个人特质", "个人亮点", "核心优势"] },
  { key: "careerPlan", words: ["职业规划", "职业目标", "发展规划"] },
  { key: "hobbies", words: ["兴趣爱好", "兴趣特长", "爱好", "hobbies"] },
  {
    key: "job",
    words: [
      "求职意向",
      "求职期望",
      "求职目标",
      "应聘意向",
      "意向岗位",
      "期望岗位",
      "期望职位",
      "期望城市",
      "就业意向",
    ],
  },
  { key: "basic", words: ["基本信息", "个人信息", "个人资料", "基本资料", "联系方式"] },
];

/** 按词长倒序展开成扁平表：长词优先命中（「技能与证书」不会被「技能」抢走） */
const SECTION_LOOKUP: { key: SectionKey; word: string }[] = SECTION_WORDS.flatMap((g) =>
  g.words.map((word) => ({ key: g.key, word })),
).sort((a, b) => b.word.length - a.word.length);

/** 去掉 Markdown / 装饰符，用于标题判定（不改变正文内容） */
function stripDecor(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^[\s#>*\-–—·•●○◦▪▫◆◇■□★☆♦➤▶►‣∙⋅【\[（(]+/, "")
    .replace(/[\s】\]）)】]+$/, "")
    .replace(/[:：]+$/, "")
    .trim();
}

/**
 * 会被误当成「板块后缀」的字段标签词。
 * 「项目背景：面向校园场景的问答」是条目里的一行，不是「项目」板块的开头——
 * 没有这道拦截，整段项目背景会被吃掉变成一个空板块。
 */
const SECTION_SUFFIX_BLOCK = /背景|职责|内容|成果|简介|介绍|概述|角色|目标|要求|描述|业绩|收获|总结|详情|详情|时间|地点/;

/**
 * 判定一行是否为分节标题。
 * 收紧条件避免误判：长度 ≤20、不含年份、不含句读、不以动词开头、后缀不是字段标签。
 */
function detectSection(raw: string): { key: SectionKey; inline: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 30) return null;

  const withColon = /^([^:：]{1,20})[:：]\s*(.*)$/.exec(trimmed);
  const head = stripDecor(withColon?.[1] ?? trimmed);
  const inline = (withColon?.[2] ?? "").trim();

  if (!head || head.length > 20) return null;
  if (/\d{4}/.test(head)) return null; // 含年份 → 内容行
  if (/[，。；、]/.test(head)) return null; // 含句读 → 内容行
  if (/^(?:我|本|该|负责|参与|协助|主要|独立|全程)/.test(head)) return null;

  for (const { key, word } of SECTION_LOOKUP) {
    if (head === word) return { key, inline };
    // 「教育背景（本科）」这类极短后缀仍算标题；「项目背景：…」不算
    if (head.startsWith(word)) {
      const suffix = head.slice(word.length);
      if (suffix.length <= 6 && !/[，。；]/.test(suffix) && !SECTION_SUFFIX_BLOCK.test(suffix)) {
        return { key, inline: `${suffix} ${inline}`.trim() };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 日期
 * ------------------------------------------------------------------ */

const DATE_TOKEN = "(?:\\d{4}\\s*[年.\\-/]\\s*\\d{1,2}\\s*月?|\\d{4}\\s*年?\\s*\\d{1,2}\\s*月|\\d{4}\\s*年)";
const DATE_RANGE_SRC = `(${DATE_TOKEN})\\s*(?:[-–—~～〜至到]|--)\\s*(${DATE_TOKEN}|至今|现在|现今|今|present|now)`;
const DATE_SINGLE_SRC = DATE_TOKEN;

function normalizeDate(s: string): string {
  const t = s.replace(/\s/g, "");
  const m = /^(\d{4})[年.\-/]?(\d{1,2})?月?$/.exec(t);
  if (!m) return t; // 「至今」等原样保留
  const year = m[1]!;
  const month = m[2];
  return month ? `${year}.${month.padStart(2, "0")}` : year;
}

function extractDateRange(line: string): { start: string; end: string } | null {
  const range = new RegExp(DATE_RANGE_SRC, "i").exec(line);
  if (range?.[1] && range[2]) return { start: normalizeDate(range[1]), end: normalizeDate(range[2]) };
  const single = new RegExp(DATE_SINGLE_SRC).exec(line);
  if (single?.[0]) return { start: normalizeDate(single[0]), end: "" };
  return null;
}

/** 去掉行内日期片段，剩下的就是标题实体 */
function removeDates(line: string): string {
  return line
    .replace(new RegExp(DATE_RANGE_SRC, "gi"), " ")
    .replace(new RegExp(DATE_SINGLE_SRC, "g"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ *
 * 行处理工具
 * ------------------------------------------------------------------ */

const BULLET_RE = /^\s*(?:[·•●○◦▪▫◆◇■□★☆♦➤▶►‣∙⋅\-–—*＊]|\d{1,2}\s*[.、)）]|[（(]\s*\d{1,2}\s*[)）])/;

function isBullet(line: string): boolean {
  return BULLET_RE.test(line);
}

function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[·•●○◦▪▫◆◇■□★☆♦➤▶►‣∙⋅\-–—*＊]\s*)+/, "")
    .replace(/^\s*\d{1,2}\s*[.、)）]\s*/, "")
    .replace(/^\s*[（(]\s*\d{1,2}\s*[)）]\s*/, "")
    .trim();
}

/** 一行是否像「条目标题行」：带日期区间、非要点、长度可控 */
function looksLikeEntryHead(line: string): boolean {
  if (isBullet(line)) return false;
  const r = new RegExp(DATE_RANGE_SRC, "i").exec(line);
  if (!r) return false;
  if (line.length > 90) return false;
  const atStart = r.index <= 6;
  const atEnd = r.index + r[0].length >= line.length - 2;
  return atStart || atEnd;
}

/** 是否是条目内的标签行（GPA：/ 工作职责：/ 角色：…）——标签行永远不开新条目 */
function isLabelLine(line: string): boolean {
  return SLOT_LABELS.some(({ re }) => re.test(line));
}

function looksLikeTitle(line: string): boolean {
  if (isBullet(line)) return false;
  if (isLabelLine(line)) return false;
  return line.length <= 60;
}

function normalizeLines(text: string): Line[] {
  const raw = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/[\u200b\ufeff]/g, "")
    .split("\n");

  const out: Line[] = [];
  let pendingBlank = false;
  for (const item of raw) {
    const cleaned = item.replace(/\*\*/g, "").replace(/__/g, "").trim();
    if (!cleaned) {
      pendingBlank = true;
      continue;
    }
    out.push({ text: cleaned, blankBefore: pendingBlank });
    pendingBlank = false;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 分节
 * ------------------------------------------------------------------ */

interface Sectioned {
  basic: Line[];
  education: Line[];
  internship: Line[];
  project: Line[];
  campus: Line[];
  skills: Line[];
  job: Line[];
  content: Record<ContentKey, Line[]>;
}

function emptySections(): Sectioned {
  return {
    basic: [],
    education: [],
    internship: [],
    project: [],
    campus: [],
    skills: [],
    job: [],
    content: { selfIntroduction: [], selfEvaluation: [], personalAdvantages: [], careerPlan: [], hobbies: [] },
  };
}

/** SectionKey → 对应的缓冲数组（返回引用，直接 push 即写入 out） */
function sectionBucket(out: Sectioned, key: SectionKey): Line[] {
  switch (key) {
    case "basic":
      return out.basic;
    case "education":
      return out.education;
    case "internship":
      return out.internship;
    case "project":
      return out.project;
    case "campus":
      return out.campus;
    case "skills":
      return out.skills;
    case "job":
      return out.job;
    default:
      return out.content[key];
  }
}

function splitSections(lines: Line[]): Sectioned {
  const out = emptySections();
  let current: SectionKey = "basic";

  for (const line of lines) {
    const hit = detectSection(line.text);
    if (hit) {
      current = hit.key;
      if (hit.inline) sectionBucket(out, current).push({ text: hit.inline, blankBefore: false });
      continue;
    }
    sectionBucket(out, current).push(line);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 基础信息
 * ------------------------------------------------------------------ */

const PHONE_RE = /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const NAME_BLACKLIST = /简历|求职|应聘|信息|联系|电话|邮箱|证书|专业|大学|学院|姓名|个人|自荐|resume|curriculum/i;

function pickLabeled(lines: string[], re: RegExp): string {
  for (const line of lines) {
    const m = re.exec(line);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function detectName(headerLines: string[]): string {
  const explicit = pickLabeled(headerLines, /^(?:姓名|名字)\s*[:：]\s*(.+)$/);
  if (explicit) return explicit.replace(/[，,。;；].*$/, "").trim();
  for (const line of headerLines.slice(0, 6)) {
    // 先剥掉 Markdown 记号：`# 李雷` / `**李雷**` 都要能认出来
    const core = stripDecor(line);
    if (!core || NAME_BLACKLIST.test(core)) continue;
    if (detectSection(core)) continue; // 分节标题不是姓名
    if (/^[\u4e00-\u9fa5·]{2,4}$/.test(core)) return core;
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * 条目切分
 * ------------------------------------------------------------------ */

function groupEntries(items: Line[]): Line[][] {
  const groups: Line[][] = [];
  let current: Line[] = [];
  for (const item of items) {
    // 断点：① 新条目以带日期的标题行开头；② 空行分隔且该行像标题（非要点、非「GPA：」这类标签行）
    const startsNew =
      current.length > 0 &&
      (looksLikeEntryHead(item.text) || (item.blankBefore && looksLikeTitle(item.text)));
    if (startsNew) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** 条目标题行：优先第一行；若第一行只有日期则用第二行，日期行丢弃 */
function resolveTitleRow(group: Line[]): { title: string; rest: Line[] } {
  const first = group[0]!;
  if (!removeDates(first.text) && group.length > 1) {
    return { title: group[1]!.text, rest: group.slice(2) };
  }
  return { title: first.text, rest: group.slice(1) };
}

function dateOf(group: Line[]): { start: string; end: string } {
  for (const line of group.slice(0, 3)) {
    const d = extractDateRange(line.text);
    if (d) return d;
  }
  return { start: "", end: "" };
}

function splitTokens(text: string): string[] {
  return text
    .split(/[\s|｜/／、]+|·{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 要点归类
 * ------------------------------------------------------------------ */

type Slot =
  | "role"
  | "background"
  | "responsibilities"
  | "workContent"
  | "achievements"
  | "summary"
  | "gpa"
  | "rank"
  | "courses";

const SLOT_LABELS: { slot: Slot; re: RegExp }[] = [
  { slot: "role", re: /^(?:角色|担任|职务角色|我的角色|个人角色|承担角色)\s*[:：]\s*(.+)$/ },
  { slot: "background", re: /^(?:项目背景|选题背景|背景介绍|项目简介|项目介绍|背景)\s*[:：]\s*(.+)$/ },
  { slot: "responsibilities", re: /^(?:工作职责|岗位职责|主要职责|职责描述|职责|承担工作)\s*[:：]\s*(.+)$/ },
  { slot: "workContent", re: /^(?:工作内容|主要工作内容|主要工作|工作描述|工作概述|项目内容|核心工作)\s*[:：]\s*(.+)$/ },
  { slot: "achievements", re: /^(?:工作业绩|主要业绩|业绩|项目成果|主要成果|成果|产出|取得成果)\s*[:：]\s*(.+)$/ },
  { slot: "summary", re: /^(?:总结与收获|工作总结|个人收获|总结|收获|反思|心得体会)\s*[:：]\s*(.+)$/ },
  { slot: "gpa", re: /^(?:GPA|绩点|平均绩点)\s*[:：]\s*(.+)$/i },
  { slot: "rank", re: /^(?:专业排名|年级排名|排名)\s*[:：]\s*(.+)$/ },
  { slot: "courses", re: /^(?:主修课程|核心课程|相关课程|课程)\s*[:：]\s*(.+)$/ },
];

const DUTY_HINT =
  /负责|参与|协助|主导|推进|维护|支持|承担|组织|策划|调研|分析|编写|撰写|设计|执行|跟进|对接|搭建|开发|测试|运营|管理|协调|统筹|监控|优化|整理|统计|接待|讲解|培训/;
const RESULT_HINT =
  /\d+(?:\.\d+)?\s*(?:%|％|倍|万|千|个|人次|人|次|篇|份|条|台|套|小时|天|周|个月|月|年)|提升|增长|提高|降低|减少|节省|超过|达成|获奖|荣获|上线|发布|落地|转化率|覆盖率|Top\s*\d/i;

interface EntryDraft {
  title: string;
  start: string;
  end: string;
  points: string[];
  responsibilities: string[];
  workContent: string[];
  achievements: string[];
  summary: string;
  background: string;
  role: string;
  gpa: string;
  rank: string;
  courses: string;
}

/** 标签后的内容可能是「A；B」多条，拆开 */
function splitListItems(value: string): string[] {
  const parts = value
    .split(/[；;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [value];
}

function classifyGroup(group: Line[]): EntryDraft {
  const { title, rest } = resolveTitleRow(group);
  const draft: EntryDraft = {
    title: removeDates(title) || title,
    start: "",
    end: "",
    points: [],
    responsibilities: [],
    workContent: [],
    achievements: [],
    summary: "",
    background: "",
    role: "",
    gpa: "",
    rank: "",
    courses: "",
  };

  const d = dateOf(group);
  draft.start = d.start;
  draft.end = d.end;

  for (const item of rest) {
    const text = item.text;
    if (!removeDates(text).trim()) continue; // 纯日期行（标题行已在 resolveTitleRow 处理）

    let matched = false;
    for (const { slot, re } of SLOT_LABELS) {
      const value = re.exec(text)?.[1]?.trim();
      if (!value) continue;
      matched = true;
      if (slot === "role") draft.role = draft.role ? `${draft.role}、${value}` : value;
      else if (slot === "background") draft.background = draft.background ? `${draft.background}\n${value}` : value;
      else if (slot === "responsibilities") draft.responsibilities.push(...splitListItems(value));
      else if (slot === "workContent") draft.workContent.push(...splitListItems(value));
      else if (slot === "achievements") draft.achievements.push(...splitListItems(value));
      else if (slot === "summary") draft.summary = draft.summary ? `${draft.summary}\n${value}` : value;
      else if (slot === "gpa") draft.gpa = value;
      else if (slot === "rank") draft.rank = value;
      else if (slot === "courses") draft.courses = value;
      break;
    }
    if (matched) continue;

    const point = stripBullet(text);
    if (!point) continue;
    draft.points.push(point);
    if (DUTY_HINT.test(point)) draft.responsibilities.push(point);
    else if (RESULT_HINT.test(point)) draft.achievements.push(point);
    else draft.workContent.push(point);
  }

  return draft;
}

/* ------------------------------------------------------------------ *
 * 组装三种长度的描述
 * ------------------------------------------------------------------ */

function firstSentence(points: string[], limit: number): string {
  const joined = points.join("；");
  if (joined.length <= limit) return joined;
  const cut = joined.slice(0, limit);
  const at = Math.max(cut.lastIndexOf("；"), cut.lastIndexOf("。"), cut.lastIndexOf("，"));
  return at > limit * 0.5 ? cut.slice(0, at) : cut;
}

interface ExperienceTail {
  descriptionShort: string;
  descriptionMedium: string;
  descriptionLong: string;
  responsibilities: string;
  workContent: string;
  achievements: string;
  summary: string;
  variants: ExperienceVariants;
}

function buildTail(draft: EntryDraft): ExperienceTail {
  const longParts = [...draft.points];
  if (draft.background) longParts.push(`【背景】${draft.background}`);
  if (draft.courses) longParts.push(`【主修课程】${draft.courses}`);

  const medium = draft.points.length > 0 ? draft.points.join("\n") : draft.summary;
  const long = longParts.length > 0 ? longParts.join("\n") : medium;
  const short =
    draft.points.length === 0 && draft.summary ? draft.summary.slice(0, 120) : firstSentence(draft.points, 118);

  return {
    descriptionShort: short,
    descriptionMedium: medium,
    descriptionLong: long || medium,
    responsibilities: draft.responsibilities.join("\n"),
    workContent: draft.workContent.join("\n"),
    achievements: draft.achievements.join("\n"),
    summary: draft.summary,
    variants: { ...EMPTY_VARIANTS },
  };
}

/* ------------------------------------------------------------------ *
 * 各板块解析
 * ------------------------------------------------------------------ */

const DEGREE_RE = /(本科|硕士|研究生|博士|大专|专科|学士|中专|高中|MBA|EMBA|Bachelor|Master|PhD)/i;
const COMPANY_RE = /(公司|集团|科技|有限|股份|银行|证券|保险|事务所|工作室|研究院|研究所|医院|学校|大学|政府|委员会|基金会|传媒|文化|教育|中心)/;
const DEPARTMENT_RE = /(部|部门|事业部|中心|科|处|室|组|团队|研究院)$/;
const ORG_RE = /(学生会|研究生会|社团|协会|联合会|委员会|团委|团总支|志愿者|俱乐部|班委)/;

function parseEducation(groups: Line[][]): EducationEntry[] {
  return groups.map((group) => {
    const draft = classifyGroup(group);
    const tokens = splitTokens(draft.title);
    const school = tokens[0] ?? draft.title;
    let college = "";
    let major = "";
    let degree = "";
    for (const token of tokens) {
      if (!degree && DEGREE_RE.test(token)) degree = token;
    }
    const middle = tokens.slice(1).filter((t) => t !== degree);
    const first = middle[0];
    if (first && /(学院|学部)$/.test(first)) {
      college = first;
      major = middle[1] ?? "";
    } else {
      major = first ?? "";
    }
    return {
      school,
      college,
      major,
      degree,
      degreeType: tokens.find((t) => /(学士|硕士|博士)/.test(t)) ?? "",
      educationLevel: degree,
      startDate: draft.start,
      endDate: draft.end,
      gpa: draft.gpa,
      rank: draft.rank,
    };
  });
}

function parseInternships(groups: Line[][]): InternshipEntry[] {
  return groups.map((group) => {
    const draft = classifyGroup(group);
    const tokens = splitTokens(draft.title);
    let company = "";
    let department = "";
    const positionParts: string[] = [];
    for (const token of tokens) {
      // 公司名不能同时长得像部门（「产品中心」不是公司）
      if (!company && COMPANY_RE.test(token) && !DEPARTMENT_RE.test(token)) {
        company = token;
        continue;
      }
      if (!department && token !== company && DEPARTMENT_RE.test(token)) {
        department = token;
        continue;
      }
      positionParts.push(token);
    }
    if (!company) {
      company = tokens[0] ?? draft.title;
      const idx = positionParts.indexOf(company);
      if (idx >= 0) positionParts.splice(idx, 1);
    }
    return {
      company,
      department,
      position: positionParts.join(" "),
      startDate: draft.start,
      endDate: draft.end,
      ...buildTail(draft),
    };
  });
}

function parseCampus(groups: Line[][]): CampusExperienceEntry[] {
  return groups.map((group) => {
    const draft = classifyGroup(group);
    const tokens = splitTokens(draft.title);
    let organization = "";
    let department = "";
    const positionParts: string[] = [];
    for (const token of tokens) {
      if (!organization && ORG_RE.test(token)) {
        organization = token;
        continue;
      }
      if (!department && token !== organization && DEPARTMENT_RE.test(token)) {
        department = token;
        continue;
      }
      positionParts.push(token);
    }
    if (!organization) {
      organization = tokens[0] ?? draft.title;
      const idx = positionParts.indexOf(organization);
      if (idx >= 0) positionParts.splice(idx, 1);
    }
    return {
      organization,
      department,
      position: positionParts.join(" "),
      startDate: draft.start,
      endDate: draft.end,
      ...buildTail(draft),
    };
  });
}

function parseProjects(groups: Line[][]): ProjectEntry[] {
  return groups.map((group) => {
    const draft = classifyGroup(group);
    const tokens = splitTokens(draft.title);
    const name = tokens[0] ?? draft.title;
    const roleFromTitle = tokens.slice(1).find((t) => /负责人|组长|队长|主导|主要开发/.test(t)) ?? "";
    const tail = buildTail(draft);
    return {
      name,
      role: draft.role || roleFromTitle,
      startDate: draft.start,
      endDate: draft.end,
      keywords: [],
      background: draft.background,
      ...tail,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 技能 / 求职意向 / 常用文本
 * ------------------------------------------------------------------ */

const LANG_RE = /英语|英文|日语|韩语|法语|德语|西班牙语|CET|雅思|托福|IELTS|TOEFL|四六级|六级|四级/i;
const CERT_RE = /证书|资格证|认证|执照|CET|雅思|托福|驾照/;

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

function parseSkills(lines: Line[]): Profile["skills"] {
  const technical: string[] = [];
  const tools: string[] = [];
  const languages: string[] = [];
  const certificates: string[] = [];
  const awards: string[] = [];

  const route = (item: string, bucket: "technical" | "tools") => {
    const text = item.trim();
    if (!text) return;
    if (LANG_RE.test(text)) languages.push(text);
    else if (/奖|荣誉|优秀|标兵|模范/.test(text)) awards.push(text);
    else if (CERT_RE.test(text)) certificates.push(text);
    else if (bucket === "tools") tools.push(text);
    else technical.push(text);
  };

  for (const line of lines) {
    const text = line.text;

    const tech = /^(?:技术技能|专业技能|技术能力|编程能力|技术)\s*[:：]\s*(.+)$/.exec(text);
    const tool = /^(?:工具|软件|软件工具|开发工具|常用工具|工具软件)\s*[:：]\s*(.+)$/.exec(text);
    const lang = /^(?:语言能力|语言|外语水平)\s*[:：]\s*(.+)$/.exec(text);
    const cert = /^(?:证书|资格证书|资质证书)\s*[:：]\s*(.+)$/.exec(text);
    const award = /^(?:获奖情况|获奖经历|荣誉奖项|荣誉|奖项)\s*[:：]\s*(.+)$/.exec(text);

    const bucket: "technical" | "tools" | "languages" | "certificates" | "awards" | null = tech
      ? "technical"
      : tool
        ? "tools"
        : lang
          ? "languages"
          : cert
            ? "certificates"
            : award
              ? "awards"
              : null;

    if (bucket) {
      const value = (tech ?? tool ?? lang ?? cert ?? award)![1]!.trim();
      for (const raw of value.split(/[、，,；;]/)) {
        const item = raw.trim();
        if (!item) continue;
        if (bucket === "languages") languages.push(item);
        else if (bucket === "certificates") certificates.push(item);
        else if (bucket === "awards") awards.push(item);
        else if (bucket === "tools") tools.push(item);
        else route(item, "technical");
      }
      continue;
    }

    for (const item of splitBareSkillLine(text)) route(item, "technical");
  }

  return {
    technical: uniq(technical),
    tools: uniq(tools),
    languages: uniq(languages),
    certificates: uniq(certificates),
    awards: uniq(awards),
  };
}

/** 技能板块没有标签的裸行：可能是「Python、SQL、Figma」一长串 */
function splitBareSkillLine(line: string): string[] {
  const text = stripBullet(line);
  if (!text) return [];
  const parts = text
    .split(/[、，,；;|｜/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2 && text.length <= 200) return parts;
  return [text];
}

function parseJobPreferences(lines: Line[]): JobPreferences {
  const all = lines.map((l) => l.text).join("\n");
  const pick = (re: RegExp): string => re.exec(all)?.[1]?.trim() ?? "";

  const positionRaw = pick(/^(?:求职意向|应聘意向|求职目标|意向岗位|期望岗位|期望职位|就业意向)\s*[:：]?\s*(.+)$/m);
  const city = pick(/^(?:期望城市|意向城市|期望地点|工作地点)\s*[:：]\s*(.+)$/m);
  const salary = pick(/^(?:期望薪资|期望薪酬|薪资要求)\s*[:：]\s*(.+)$/m);
  const available = pick(/^(?:到岗时间|可到岗时间|入职时间)\s*[:：]\s*(.+)$/m);
  const type = pick(/^(?:就业类型|工作性质|求职类型)\s*[:：]\s*(.+)$/m);
  const industry = pick(/^(?:期望行业|意向行业)\s*[:：]\s*(.+)$/m);

  const splitValues = (v: string): string[] =>
    v
      .split(/[、，,；;|｜/]/)
      .map((s) => s.replace(/[。.]$/, "").trim())
      .filter(Boolean);

  // 兜底：只写了「求职意向」标题、岗位名单独成行的写法
  const loosePositions = positionRaw
    ? []
    : lines
        .flatMap((l) => splitValues(stripBullet(l.text)))
        .filter((t) => t.length <= 24 && !/^(?:期望|意向|到岗|薪资|城市)/.test(t));

  return {
    expectedPosition: uniq(splitValues(positionRaw).concat(loosePositions)),
    expectedCity: uniq(splitValues(city)),
    expectedSalary: salary,
    availableDate: available,
    employmentType: type,
    expectedIndustry: industry,
  };
}

function parseContent(sections: Record<ContentKey, Line[]>): ContentProfile {
  const build = (lines: Line[], sep: string): LongTextBlock => {
    const items = lines.map((l) => stripBullet(l.text)).filter(Boolean);
    if (items.length === 0) return { short: "", medium: "", long: "" };
    const text = items.join(sep);
    return { short: text, medium: text, long: items.join("\n") };
  };
  return {
    selfIntroduction: build(sections.selfIntroduction, " "),
    selfEvaluation: build(sections.selfEvaluation, " "),
    personalAdvantages: build(sections.personalAdvantages, "；"),
    careerPlan: build(sections.careerPlan, " "),
    hobbies: build(sections.hobbies, "、"),
  };
}

/* ------------------------------------------------------------------ *
 * 基础信息组装
 * ------------------------------------------------------------------ */

function parseBasic(sections: Sectioned, allText: string): Profile["basic"] {
  const sectionLines = sections.basic.map((l) => l.text);
  const fallback = allText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const scope = sectionLines.length > 0 ? sectionLines : fallback;
  const flat = scope.join(" ");

  const pick = (re: RegExp): string => {
    for (const line of scope.slice(0, 30)) {
      const m = re.exec(line);
      if (m?.[1]?.trim()) return m[1].trim().replace(/[，,。;；]$/, "");
    }
    return "";
  };

  const genderRaw = pick(/^(?:性别)\s*[:：]\s*(.+)$/);
  const gender = /^男/.test(genderRaw) ? "男" : /^女/.test(genderRaw) ? "女" : genderRaw;
  const ageRaw = pick(/^(?:年龄)\s*[:：]\s*(.+)$/) || (/(\d{1,2})\s*岁/.exec(flat)?.[1] ?? "");

  return {
    name: detectName(scope),
    englishName: pick(/^(?:英文名|英文姓名|English\s*Name)\s*[:：]\s*(.+)$/i),
    gender,
    birthDate: pick(/^(?:出生日期|出生年月|生日)\s*[:：]\s*(.+)$/),
    age: ageRaw.replace(/[^\d]/g, ""),
    phone: (PHONE_RE.exec(flat)?.[0] ?? "").replace(/[^\d]/g, ""),
    email: EMAIL_RE.exec(flat)?.[0] ?? "",
    wechat: pick(/^(?:微信|微信号|WeChat)\s*[:：]\s*(.+)$/i),
    qq: pick(/^(?:QQ号|QQ)\s*[:：]?\s*(.+)$/i).replace(/[^\d]/g, ""),
    city: pick(/^(?:所在城市|现居城市|现居地|居住地|城市|所在地)\s*[:：]\s*(.+)$/),
    address: pick(/^(?:通讯地址|联系地址|住址|家庭地址|地址)\s*[:：]\s*(.+)$/),
    idNumber: pick(/^(?:身份证号?|证件号码)\s*[:：]\s*([0-9Xx\s-]+)$/),
    nativePlace: pick(/^(?:籍贯|原籍)\s*[:：]\s*(.+)$/),
    hukou: pick(/^(?:户口所在地|户籍所在地|户口|户籍|生源地)\s*[:：]\s*(.+)$/),
    hukouType: pick(/^(?:户口性质|户籍性质|户口类型)\s*[:：]\s*(.+)$/),
    politicalStatus: pick(/^(?:政治面貌|党派)\s*[:：]\s*(.+)$/),
    maritalStatus: pick(/^(?:婚姻状况|婚姻|婚否)\s*[:：]\s*(.+)$/),
    height: pick(/^(?:身高)\s*[:：]\s*(.+)$/),
    weight: pick(/^(?:体重)\s*[:：]\s*(.+)$/),
    workYears: pick(/^(?:工作年限|从业年限)\s*[:：]\s*(.+)$/),
    emergencyContactName: pick(/^(?:紧急联系人)\s*[:：]\s*(.+)$/),
    emergencyContactPhone: pick(/^(?:紧急联系电话|紧急联系人电话)\s*[:：]\s*(.+)$/),
    portfolio:
      pick(/^(?:个人主页|作品集|个人网站|博客|GitHub|主页|链接)\s*[:：]\s*(.+)$/i) ||
      (/(https?:\/\/[^\s）)]+)/.exec(flat)?.[1] ?? ""),
  };
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 解析简历纯文本。
 * @param text 用户粘贴的原始文本（可含 Markdown、全角空格、多余空行）
 */
export function parseResumeText(text: string): ResumeTextParseResult {
  if (!text || !text.trim()) return { ok: false, errors: ["粘贴内容为空"] };

  const lines = normalizeLines(text);
  if (lines.length === 0) return { ok: false, errors: ["粘贴内容为空"] };

  const sections = splitSections(lines);

  const education = parseEducation(groupEntries(sections.education));
  const internships = parseInternships(groupEntries(sections.internship));
  const projects = parseProjects(groupEntries(sections.project));
  const campus = parseCampus(groupEntries(sections.campus));
  const skills = parseSkills(sections.skills);
  const jobPreferences = parseJobPreferences(sections.job);
  const content = parseContent(sections.content);
  const basic = parseBasic(sections, text);

  const notes: string[] = [];
  if (education.length > 0) notes.push(`教育经历 ${education.length} 条`);
  if (internships.length > 0) notes.push(`实习/工作经历 ${internships.length} 条`);
  if (projects.length > 0) notes.push(`项目经历 ${projects.length} 条`);
  if (campus.length > 0) notes.push(`校园经历 ${campus.length} 条`);
  const skillCount =
    skills.technical.length +
    skills.tools.length +
    skills.languages.length +
    skills.certificates.length +
    skills.awards.length;
  if (skillCount > 0) notes.push(`技能/证书 ${skillCount} 项`);
  const contentFilled = CONTENT_KEYS.filter((k) => content[k].long).length;
  if (contentFilled > 0) notes.push(`常用文本 ${contentFilled} 段`);
  if (jobPreferences.expectedPosition.length > 0) notes.push(`求职意向 ${jobPreferences.expectedPosition.length} 项`);
  if (basic.name) notes.push(`姓名「${basic.name}」`);
  if (basic.phone) notes.push("手机号");
  if (basic.email) notes.push("邮箱");

  const hasExperienceBlock = education.length > 0 || internships.length > 0 || projects.length > 0 || campus.length > 0;
  if (!hasExperienceBlock) {
    return {
      ok: false,
      errors: [
        "没能识别出任何经历条目 —— 请确认粘贴的是简历正文，并保留「教育背景 / 实习经历 / 项目经历」这类小标题。",
        ...(notes.length > 0 ? [`（只识别到：${notes.join("、")}）`] : []),
      ],
    };
  }

  const profile: Profile = {
    basic,
    education,
    internships,
    campus,
    projects,
    skills,
    jobPreferences,
    content,
    careerPreferences: { targetDirections: [], preferredWorkTypes: [], developmentGoals: [] },
    // 纯文本解析永远不碰敏感字段（政治面貌 / 婚姻 / 身份证 / 紧急联系人）
    sensitive: { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" },
  };

  return { ok: true, profile, notes };
}
