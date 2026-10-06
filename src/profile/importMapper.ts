import type {
  BasicProfile,
  CampusExperienceEntry,
  CareerPreferences,
  ContentProfile,
  EducationEntry,
  InternshipEntry,
  JobPreferences,
  Profile,
  ProjectEntry,
  SkillsProfile,
} from "../types/profile";
import { polarityOf } from "../rules/yesNoAnswers";

/**
 * 简历母版 JSON → Profile 自适应映射（导入兜底）。
 *
 * 支持两种键名风格：
 * - 英文 snake_case/camelCase（basic_info / internships / responsibilities ...）
 * - 中文键名（个人信息 / 实习经历 / 工作职责 ...，描述为单段文本，
 *   兼容旧版 {短描述,中描述,长描述} 与常用文本 {短,中,长} 块）
 *
 * 原则：只搬运简历里明确写了的信息，缺的留空，绝不编造（fail-safe）；
 * 敏感字段（sensitive.*）永远不从外部 JSON 映射，恒为空。
 */

type Rec = Record<string, unknown>;

/**
 * 各大块的接受别名。**必须包含资料编辑器界面上显示的那套中文标题**：
 * 用户（以及替他们整理简历的 AI）是照界面上看到的词写 JSON 的。
 * 曾经这里只认「个人信息 / 教育背景 / 实习经历 / 技能与资质 / 求职期望」，
 * 而界面写的是「基础信息 / 教育经历 / 工作·实习经历 / 技能 / 求职偏好」，
 * 结果一份结构完好的简历只有「项目经历」一块被吃进去，其余全部静默丢弃，
 * 而 UI 还报「导入成功」。
 */
const BLOCK_KEYS = {
  basic: ["基础信息", "个人信息", "基本信息", "basic_info", "basic"],
  education: ["教育经历", "教育背景", "学习经历", "education"],
  internships: ["工作/实习经历", "实习/工作经历", "工作实习经历", "实习经历", "工作经历", "internships", "workExperiences"],
  campus: ["校园经历", "campus_experience", "campus", "campusActivities", "student_experience"],
  projects: ["项目经历", "项目经验", "projects"],
  skills: ["技能", "技能与资质", "技能与证书", "skills"],
  jobPreferences: ["求职偏好", "求职期望", "job_preferences", "jobPreferences"],
  careerPreferences: ["职业方向", "career_preferences", "careerPreferences"],
} as const;

type BlockKey = keyof typeof BLOCK_KEYS;

/** 回话给用户时用的名字（界面上的叫法，不是内部键名） */
const BLOCK_LABELS: Record<BlockKey, string> = {
  basic: "基础信息",
  education: "教育经历",
  internships: "工作/实习经历",
  campus: "校园经历",
  projects: "项目经历",
  skills: "技能",
  jobPreferences: "求职偏好",
  careerPreferences: "职业方向",
};

/** 常用文本五块 + 信封/元信息：它们不通过 BLOCK_KEYS 消费，但同样算「已认识」 */
const KNOWN_EXTRA_TOP_KEYS = [
  "自我介绍", "自我评价", "个人优势", "职业规划", "兴趣爱好",
  "self_introduction", "self_evaluation", "personal_strengths", "career_plan", "hobbies",
  "证书", "获奖情况", "敏感信息", "资料库名称", "适用方向",
  "kind", "version", "profile",
];

function blockHasContent(root: Rec, keys: readonly string[]): boolean {
  return keys.some((k) => {
    const v = root[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (isRec(v)) return Object.values(v).some((x) => (typeof x === "string" ? x.trim() !== "" : x != null));
    return true;
  });
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** 数组取字符串列表；单个字符串也接受为单元素列表 */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

/**
 * 「列表语义」字段的解析：数组照收，逗号/顿号/分号分隔的字符串拆开。
 * 简历 JSON 里技能、期望城市、目标方向这类字段常写成 "A,B,C"，
 * 不拆就会变成一个巨型条目塞进编辑器，填表时也会整串写进去。
 * 刻意不用于工作职责/项目内容等正文字段——中文正文里满是「，、」，拆了会碎。
 */
function asTermList(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => asTermList(x));
  const s = str(v);
  if (!s) return [];
  return s.split(/[、，,；;|]+/).map((x) => x.trim()).filter(Boolean);
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

/** 按序取对象中第一个非空字符串值（中文/英文键名别名依序兜底） */
function s(e: Rec, keys: string[]): string {
  for (const k of keys) {
    const v = str(e[k]);
    if (v) return v;
  }
  return "";
}

/** 取根节点中第一个非空板块值（板块级中文/英文别名） */
function firstVal(root: Rec, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = root[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** 取根节点中第一个对象板块 */
function firstRec(root: Rec, keys: readonly string[]): Rec {
  const v = firstVal(root, keys);
  return isRec(v) ? v : {};
}

/**
 * 描述：单段文本（中文「描述」/英文 description，含旧键 descriptionShort/Medium/Long）。
 * 旧版 {短描述,中描述,长描述} / {short,medium,long} 块 → 取内容最全的一段迁移。
 */
function pickDesc(e: Rec): string {
  const direct = e["描述"] ?? e.description;
  if (typeof direct === "string") return str(direct);
  if (typeof e.descriptionShort === "string" || typeof e.descriptionMedium === "string" || typeof e.descriptionLong === "string") {
    return str(e.descriptionLong) || str(e.descriptionMedium) || str(e.descriptionShort);
  }
  const d = isRec(direct) ? direct : {};
  return str(d["长描述"] ?? d.long) || str(d["中描述"] ?? d.medium) || str(d["短描述"] ?? d.short);
}

const SECTION_LABELS: Record<string, string> = {
  summary: "概述",
  responsibilities: "工作职责",
  work_content: "工作内容",
  achievements: "主要业绩",
  background: "项目背景",
  core_features: "核心功能",
  architecture_logic: "架构逻辑",
  design_principle: "设计原则",
  current_limitations: "当前局限",
  content_methodology: "内容方法",
  tools: "工具",
  development_tools: "开发工具",
  courses: "主修课程",
};

/**
 * 把条目里除身份字段外的所有内容组装成长文本（【标签】+ 内容/条目列表）。
 * 按 JSON 原有键序输出，保证与简历原文阅读顺序一致。
 */
function composeSections(entry: Rec, skip: Set<string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (skip.has(key)) continue;
    const label = SECTION_LABELS[key] ?? key;
    const text = str(value);
    if (text) {
      parts.push(`【${label}】${text}`);
      continue;
    }
    const items = asList(value);
    if (items.length > 0) {
      parts.push(`【${label}】\n${items.map((l) => `· ${l}`).join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

const INTERNSHIP_SKIP = new Set([
  "company", "department", "position",
  "start_date", "startDate", "end_date", "endDate",
  "描述", "description", "descriptionShort", "descriptionMedium", "descriptionLong",
]);

const CAMPUS_SKIP = new Set([
  "organization", "department", "position",
  "start_date", "startDate", "end_date", "endDate",
  "描述", "description", "descriptionShort", "descriptionMedium", "descriptionLong",
]);

function mapCampus(v: unknown): CampusExperienceEntry[] {
  const list = Array.isArray(v) ? v.filter(isRec) : [];
  return list.map((e) => {
    const resp = asList(e["工作职责"] ?? e.responsibilities);
    const workContent = asList(e["工作内容"] ?? e.work_content ?? e.workContent);
    const achievements = asList(e["工作业绩"] ?? e.achievements);
    const summary = str(e["总结/收获"] ?? e.summary);
    const desc = pickDesc(e);
    return {
      organization: s(e, ["组织", "organization", "org", "club", "society", "student_organization"]),
      department: s(e, ["部门", "department"]),
      position: s(e, ["职务", "position", "role"]),
      startDate: s(e, ["开始时间", "开始", "start_date", "startDate"]),
      endDate: s(e, ["结束时间", "结束", "end_date", "endDate"]),
      descriptionShort: str(e.descriptionShort) || desc.short || summary || resp[0] || achievements[0] || "",
      descriptionMedium: str(e.descriptionMedium) || desc.medium || (resp.length > 0 ? resp.join("\n") : summary),
      descriptionLong: str(e.descriptionLong) || desc.long || composeSections(e, CAMPUS_SKIP),
      // 语义槽位：表单问什么填什么（工作职责/工作内容/业绩/总结各自独立）
      responsibilities: resp.join("\n"),
      workContent: workContent.join("\n"),
      achievements: achievements.join("\n"),
      summary,
      // 变体是表达层，导入时不编造，全部留空
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    };
  });
}

function mapInternships(v: unknown): InternshipEntry[] {
  const list = Array.isArray(v) ? v.filter(isRec) : [];
  return list.map((e) => {
    const resp = asList(e["工作职责"] ?? e.responsibilities);
    const workContent = asList(e["工作内容"] ?? e.work_content ?? e.workContent);
    const achievements = asList(e["工作业绩"] ?? e.achievements);
    const summary = str(e["总结/收获"] ?? e.summary);
    const desc = pickDesc(e);
    return {
      company: s(e, ["公司", "company"]),
      department: s(e, ["部门", "department"]),
      position: s(e, ["职务", "岗位", "position", "role"]),
      startDate: s(e, ["开始时间", "开始", "start_date", "startDate"]),
      endDate: s(e, ["结束时间", "结束", "end_date", "endDate"]),
      descriptionShort: str(e.descriptionShort) || desc.short || summary || resp[0] || achievements[0] || "",
      descriptionMedium: str(e.descriptionMedium) || desc.medium || (resp.length > 0 ? resp.join("\n") : summary),
      descriptionLong: str(e.descriptionLong) || desc.long || composeSections(e, INTERNSHIP_SKIP),
      // 语义槽位：表单问什么填什么（工作职责/工作内容/业绩/总结各自独立）
      responsibilities: resp.join("\n"),
      workContent: workContent.join("\n"),
      achievements: achievements.join("\n"),
      summary,
      // 变体是表达层，导入时不编造，全部留空
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    };
  });
}

const PROJECT_SKIP = new Set([
  "name", "type", "role",
  "start_date", "startDate", "end_date", "endDate",
  "descriptionShort", "descriptionMedium", "descriptionLong",
]);

function mapProjects(v: unknown): ProjectEntry[] {
  const list = Array.isArray(v) ? v.filter(isRec) : [];
  return list.map((e) => {
    const roleArr = asList(e["角色"] ?? e.role);
    const features = asList(e["项目内容"] ?? e.core_features);
    const resp = asList(e["项目职责"] ?? e.responsibilities);
    const achievements = asList(e["项目成果"] ?? e.achievements);
    const background = s(e, ["项目背景", "background", "background_intro"]);
    const summary = str(e["项目概述/总结"] ?? e.summary);
    const desc = pickDesc(e);
    const prevShort = str(e.descriptionShort);
    const prevMedium = str(e.descriptionMedium);
    const prevLong = str(e.descriptionLong);
    return {
      name: s(e, ["项目名称", "name"]),
      role: roleArr.join("、"),
      startDate: s(e, ["开始时间", "开始", "start_date", "startDate"]),
      endDate: s(e, ["结束时间", "结束", "end_date", "endDate"]),
      descriptionShort: prevShort || desc.short || summary || features[0] || resp[0] || "",
      descriptionMedium: prevMedium || desc.medium || (features.length > 0 ? features.join("\n") : summary || resp.join("\n")),
      descriptionLong: prevLong || desc.long || composeSections(e, PROJECT_SKIP),
      keywords: dedupe([...asList(e["关键词"]), str(e.type), ...roleArr]),
      // 语义槽位：项目背景/职责/内容/成果/总结各自独立
      background,
      responsibilities: resp.join("\n"),
      workContent: features.join("\n"),
      achievements: achievements.join("\n"),
      summary,
      // 变体是表达层，导入时不编造，全部留空
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    };
  });
}

function mapEducation(v: unknown): EducationEntry[] {
  const list = Array.isArray(v) ? v.filter(isRec) : isRec(v) ? [v] : [];
  return list.map((e) => ({
    school: s(e, ["学校", "school"]),
    college: s(e, ["学院", "college", "department"]),
    major: s(e, ["专业", "major"]),
    degree: s(e, ["学历", "degree"]),
    degreeType: s(e, ["学位", "degree_type", "degreeType"]),
    educationLevel: s(e, ["education_level", "educationLevel", "学习形式", "全日制"]),
    direction: s(e, ["研究方向", "专业方向", "direction", "research_direction"]),
    startDate: s(e, ["入学时间", "start_date", "startDate"]),
    endDate: s(e, ["毕业时间", "end_date", "endDate"]),
    gpa: s(e, ["GPA", "gpa"]),
    rank: s(e, ["专业排名", "rank"]),
  }));
}

function mapBasic(root: Rec): BasicProfile {
  const bi = firstRec(root, BLOCK_KEYS.basic);
  return {
    name: s(bi, ["姓名", "name"]),
    englishName: s(bi, ["英文名", "english_name", "englishName"]),
    surname: s(bi, ["姓氏", "姓", "surname", "last_name", "lastName", "family_name"]),
    givenName: s(bi, ["名字", "名", "given_name", "givenName", "first_name", "firstName"]),
    linkedin: s(bi, ["领英", "领英主页", "linkedin", "linkedin_profile", "linkedinProfile"]),
    github: s(bi, ["github", "GitHub", "代码仓库", "开源主页", "github_profile", "githubProfile"]),
    gender: s(bi, ["性别", "gender"]),
    birthDate: s(bi, ["出生日期", "birth_date", "birthDate", "birthday"]),
    age: s(bi, ["年龄", "age"]),
    phone: s(bi, ["手机号", "phone", "mobile"]),
    email: s(bi, ["邮箱", "email"]),
    wechat: s(bi, ["微信", "wechat", "weixin"]),
    qq: s(bi, ["QQ号", "qq", "qq_number", "qqnum"]),
    city: s(bi, ["所在城市", "city", "current_city"]),
    address: s(bi, ["通讯地址", "联系地址", "住址", "address", "home_address"]),
    idNumber: s(bi, ["身份证号", "身份证号码", "证件号码", "id_number", "idNumber"]),
    nativePlace: s(bi, ["籍贯", "原籍", "native_place", "nativePlace"]),
    hukou: s(bi, ["户口所在地", "户籍所在地", "户口", "hukou"]),
    hukouType: s(bi, ["户口性质", "户籍性质", "hukou_type", "hukouType"]),
    politicalStatus: s(bi, ["政治面貌", "political_status", "politicalStatus"]),
    maritalStatus: s(bi, ["婚姻状况", "marital_status", "maritalStatus"]),
    height: s(bi, ["身高", "height"]),
    weight: s(bi, ["体重", "weight"]),
    workYears: s(bi, ["工作年限", "从业年限", "work_years", "workYears"]),
    emergencyContactName: s(bi, ["紧急联系人", "emergency_contact", "emergencyContactName"]),
    emergencyContactPhone: s(bi, ["紧急联系电话", "紧急联系人电话", "emergency_contact_phone", "emergencyContactPhone"]),
    portfolio: s(bi, [
      "主页/作品集", "个人主页/作品集", "portfolio", "website", "homepage", "personal_website", "blog", "github",
    ]),
  };
}

function mapSkills(root: Rec): SkillsProfile {
  const sk = firstRec(root, BLOCK_KEYS.skills);
  return {
    technical: dedupe([
      ...asTermList(sk["技术技能"]),
      ...asTermList(sk.ai_application),
      ...asTermList(sk.automation),
      ...asTermList(sk.product_and_business),
      ...asTermList(sk.technical),
    ]),
    tools: dedupe([
      ...asTermList(sk["工具"]),
      ...asTermList(sk.aigc),
      ...asTermList(sk.content_and_design),
      ...asTermList(sk.tools),
    ]),
    languages: dedupe([...asTermList(sk["语言能力"]), ...asTermList(sk.languages)]),
    certificates: dedupe([
      ...asTermList(sk["证书"]),
      ...asTermList(sk.certificates),
      ...asTermList(firstVal(root, ["证书", "certificates"])),
    ]),
    awards: dedupe([
      ...asTermList(sk["获奖情况"]),
      ...asTermList(sk.awards),
      ...asTermList(firstVal(root, ["获奖情况", "awards", "honors"])),
    ]),
  };
}

function mapJobPreferences(root: Rec, bi: Rec): JobPreferences {
  const jp = firstRec(root, BLOCK_KEYS.jobPreferences);
  /** 「是/否」偏好：中文母版可能写「是/否/可以/不接受」，统一收成「是」「否」或留空 */
  const yesNo = (keys: string[]): string => {
    const polarity = polarityOf(s(jp, keys));
    return polarity === "yes" ? "是" : polarity === "no" ? "否" : "";
  };
  return {
    // 意向岗位：中文「期望岗位」直取优先，其次三档优先级 + 求职意向，全部保留顺序去重
    expectedPosition: dedupe([
      ...asTermList(jp["期望岗位"]),
      ...asTermList(jp.priority_1),
      ...asTermList(jp.priority_2),
      ...asTermList(jp.priority_3),
      ...asTermList(jp.expected_position ?? jp.expectedPosition),
      ...asTermList(bi.job_intention),
    ]),
    // 期望城市：简历通常只写「所在城市」，不等于意向城市 —— 宁可不填
    expectedCity: dedupe(asTermList(jp["期望城市"] ?? jp.expected_city ?? jp.expectedCity)),
    expectedSalary: s(jp, ["期望薪资", "expected_salary", "expectedSalary"]),
    availableDate: s(jp, ["到岗时间", "available_date", "availableDate", "available_time"]),
    employmentType: s(jp, ["就业类型", "employment_type", "employmentType"]),
    expectedIndustry: asTermList(
      jp["期望行业"] ?? jp.expected_industry ?? jp.expectedIndustry ?? jp.industry,
    ).join("、"),
    acceptOfflineInterview: yesNo(["是否接受线下面试", "线下面试", "acceptOfflineInterview", "accept_offline_interview"]),
    acceptOnlineInterview: yesNo(["是否接受线上面试", "线上面试", "acceptOnlineInterview", "accept_online_interview"]),
    acceptBusinessTrip: yesNo(["是否接受出差", "出差", "acceptBusinessTrip", "accept_business_trip"]),
    acceptRelocation: yesNo(["是否接受异地", "异地", "外派", "acceptRelocation", "accept_relocation"]),
    acceptOvertime: yesNo(["是否接受加班", "加班", "acceptOvertime", "accept_overtime"]),
  };
}

/**
 * 中文母版常用文本块 {短,中,长} 直接映射；
 * 返回 null 表示不是该结构（英文版各槽位走各自的旧派生逻辑）。
 */
function directBlock(v: unknown): LongTextBlock | null {
  if (!isRec(v)) return null;
  const short = str(v["短"] ?? v.short);
  const medium = str(v["中"] ?? v.medium);
  const long = str(v["长"] ?? v.long);
  if (!short && !medium && !long) return null;
  return { short, medium, long };
}

function mapContent(root: Rec): ContentProfile {
  // 自我介绍：中文 {短,中,长}；英文 personal_summary 字符串三档同文
  const introBlock = directBlock(firstVal(root, ["自我介绍", "self_introduction"]));
  const personalSummary = str(root.personal_summary);
  const selfIntroduction: LongTextBlock = introBlock ?? {
    short: personalSummary,
    medium: personalSummary,
    long: personalSummary,
  };

  // 自我评价：中文 {短,中,长}；英文 self_evaluation {general, ai_application, ai_operations}
  const evalRaw = firstVal(root, ["自我评价", "self_evaluation"]);
  const evalBlock = directBlock(evalRaw);
  let selfEvaluation: LongTextBlock;
  if (evalBlock) {
    selfEvaluation = evalBlock;
  } else {
    const seRec = isRec(evalRaw) ? evalRaw : {};
    const seGeneral = typeof evalRaw === "string" ? evalRaw.trim() : str(seRec.general);
    const seAi = str(seRec.ai_application);
    const seOps = str(seRec.ai_operations);
    selfEvaluation = {
      short: seGeneral,
      medium: seGeneral,
      long: [seGeneral, seAi, seOps].filter(Boolean).join("\n\n"),
    };
  }

  // 个人优势：中文 {短,中,长}；英文 personal_strengths 数组
  const advRaw = firstVal(root, ["个人优势", "personal_strengths"]);
  const strengths = asList(advRaw);
  const personalAdvantages: LongTextBlock = directBlock(advRaw) ?? {
    short: strengths[0] ?? "",
    medium: strengths.join("；"),
    long: strengths.map((st) => `· ${st}`).join("\n"),
  };

  // 职业规划：中文 {短,中,长}；英文 career_plan {short_term, long_term}
  const planRaw = firstVal(root, ["职业规划", "career_plan"]);
  const planBlock = directBlock(planRaw);
  let careerPlan: LongTextBlock;
  if (planBlock) {
    careerPlan = planBlock;
  } else {
    const cp = isRec(planRaw) ? planRaw : {};
    const shortTerm = str(cp.short_term);
    const longTerm = str(cp.long_term);
    careerPlan = {
      short: shortTerm,
      medium: shortTerm,
      long: [
        shortTerm ? `短期：${shortTerm}` : "",
        longTerm ? `长期：${longTerm}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  // 兴趣爱好：中文 {短,中,长}；英文 hobbies 数组
  const hobRaw = firstVal(root, ["兴趣爱好", "hobbies"]);
  const hobbies = asList(hobRaw);
  const hobbyBlock: LongTextBlock = directBlock(hobRaw) ?? {
    short: hobbies.join("、"),
    medium: hobbies.join("、"),
    long: hobbies.map((h) => `· ${h}`).join("\n"),
  };

  return { selfIntroduction, selfEvaluation, personalAdvantages, careerPlan, hobbies: hobbyBlock };
}

export type MapResult = {
  ok: true;
  profile: Profile;
  /** 输入里明确有内容、但映射结果为空的块（界面上的叫法）——用于告诉用户「我看到了但没用上」 */
  ignoredBlocks: string[];
  /** 顶层出现过的、我们不认识的键名 */
  unknownTopKeys: string[];
} | { ok: false; errors: string[] };

function mapCareerPreferences(root: Rec): CareerPreferences {
  const cp = firstRec(root, BLOCK_KEYS.careerPreferences);
  return {
    targetDirections: asTermList(cp["目标方向"] ?? cp.targetDirections),
    preferredWorkTypes: asTermList(cp["偏好工作类型"] ?? cp.preferredWorkTypes),
    developmentGoals: asTermList(cp["发展目标"] ?? cp.developmentGoals),
  };
}

/** 报告「输入里有、但没映射出内容」的块，以及不认识的顶层键（issue：静默部分导入被当成成功） */
function surveyRoot(
  root: Rec,
  mapped: Record<BlockKey, boolean>,
): { ignoredBlocks: string[]; unknownTopKeys: string[] } {
  const ignoredBlocks = (Object.keys(BLOCK_KEYS) as BlockKey[])
    .filter((k) => blockHasContent(root, BLOCK_KEYS[k]) && !mapped[k])
    .map((k) => BLOCK_LABELS[k]);
  const consumed = new Set<string>([...Object.values(BLOCK_KEYS).flat(), ...KNOWN_EXTRA_TOP_KEYS]);
  const unknownTopKeys = Object.keys(root).filter((k) => !consumed.has(k));
  return { ignoredBlocks, unknownTopKeys };
}

/**
 * 把简历母版 JSON 映射为 Profile。
 * 识别门槛：至少有姓名 / 教育 / 实习 / 项目之一，否则拒绝（防止垃圾 JSON 清空 Profile）。
 * 允许**部分导入**（用户选择），但必须把没吃进去的块如实报出来，见 `ignoredBlocks`。
 */
export function mapResumeJsonToProfile(parsed: unknown): MapResult {
  if (!isRec(parsed)) {
    return { ok: false, errors: ["简历格式解析失败：根节点必须是对象"] };
  }
  const root = parsed;
  const bi = firstRec(root, BLOCK_KEYS.basic);

  const basic = mapBasic(root);
  const education = mapEducation(firstVal(root, BLOCK_KEYS.education));
  const internships = mapInternships(firstVal(root, BLOCK_KEYS.internships));
  const campus = mapCampus(
    firstVal(root, BLOCK_KEYS.campus),
  );
  const projects = mapProjects(firstVal(root, BLOCK_KEYS.projects));
  const skills = mapSkills(root);
  const jobPreferences = mapJobPreferences(root, bi);
  const careerPreferences = mapCareerPreferences(root);
  const content = mapContent(root);
  const sensitive = { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" };

  const recognizable = Boolean(
    basic.name || education.length > 0 || internships.length > 0 || campus.length > 0 || projects.length > 0,
  );
  if (!recognizable) {
    return {
      ok: false,
      errors: ["无法识别为简历格式：缺少姓名、教育、实习或项目信息"],
    };
  }

  const { ignoredBlocks, unknownTopKeys } = surveyRoot(root, {
    basic: Boolean(basic.name || basic.phone || basic.email),
    education: education.length > 0,
    internships: internships.length > 0,
    campus: campus.length > 0,
    projects: projects.length > 0,
    skills:
      skills.technical.length + skills.tools.length + skills.languages.length +
      skills.certificates.length + skills.awards.length > 0,
    jobPreferences:
      jobPreferences.expectedCity.length + jobPreferences.expectedPosition.length > 0 ||
      Boolean(jobPreferences.expectedSalary || jobPreferences.availableDate),
    careerPreferences:
      careerPreferences.targetDirections.length + careerPreferences.preferredWorkTypes.length +
      careerPreferences.developmentGoals.length > 0,
  });

  return {
    ok: true,
    ignoredBlocks,
    unknownTopKeys,
    profile: {
      basic, education, internships, campus, projects, skills, jobPreferences, careerPreferences, content, sensitive,
    },
  };
}
