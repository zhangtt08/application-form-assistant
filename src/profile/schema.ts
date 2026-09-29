import type {
  CampusExperienceEntry,
  ContentProfile,
  EducationEntry,
  InternshipEntry,
  JobPreferences,
  Profile,
  ProjectEntry,
  SensitiveProfile,
  SkillsProfile,
} from "../types/profile";

/**
 * Profile 导入校验（fail-safe + 向后兼容归一化）：
 * 结构或类型不合法 → 整体拒绝，绝不部分覆盖现有 Profile。
 * 允许：多余的未知字段被忽略（向前兼容）；
 *       旧版 Profile 缺失「后来新增的字段」→ 补默认值通过（向后兼容，用户资料不因升级丢失）。
 * 要求：所有已知字段类型正确且存在（新增字段缺失除外）。
 */

export type ValidationResult = { ok: true; profile: Profile } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const BASIC_KEYS: (keyof BasicProfileShape)[] = [
  "name", "englishName", "gender", "birthDate", "age", "phone", "email", "wechat", "qq", "city", "portfolio",
  "address", "idNumber", "nativePlace", "hukou", "hukouType", "politicalStatus", "maritalStatus",
  "height", "weight", "workYears", "emergencyContactName", "emergencyContactPhone",
];
type BasicProfileShape = Record<string, string>;

/** v1.0 之后的增量字段：缺失时补默认值（旧 Profile 兼容），存在但类型错仍拒绝 */
const BASIC_KEYS_OPTIONAL = new Set([
  "age", "qq", "portfolio", "address", "idNumber", "nativePlace", "hukou", "hukouType",
  "politicalStatus", "maritalStatus", "height", "weight", "workYears",
  "emergencyContactName", "emergencyContactPhone",
]);

function checkBasic(v: unknown, errors: string[]): BasicProfileShape {
  const out: Record<string, string> = {};
  if (!isRecord(v)) {
    errors.push("basic 必须是对象");
    return out as unknown as BasicProfileShape;
  }
  for (const key of BASIC_KEYS) {
    const val = v[key];
    if (typeof val === "string") {
      out[key] = val;
    } else if (val === undefined && BASIC_KEYS_OPTIONAL.has(key)) {
      out[key] = ""; // 旧版 Profile 没有该字段 → 补默认
    } else {
      errors.push(`basic.${key} 必须是 string，实际为 ${val === undefined ? "缺失" : typeof val}`);
    }
  }
  return out as unknown as BasicProfileShape;
}

function checkLongTextBlock(
  v: unknown,
  name: string,
  errors: string[],
  optional = false,
): Record<string, string> {
  const out = { short: "", medium: "", long: "" };
  if (v === undefined && optional) return out; // 旧版缺失 → 默认空块
  if (!isRecord(v)) {
    errors.push(`${name} 必须是对象`);
    return out;
  }
  for (const key of ["short", "medium", "long"] as const) {
    const val = v[key];
    if (typeof val === "string") out[key] = val;
    else if (val === undefined && optional) out[key] = "";
    else errors.push(`${name}.${key} 必须是 string`);
  }
  return out;
}

function checkStringArray(
  v: unknown,
  name: string,
  errors: string[],
  optional = false,
): string[] {
  if (v === undefined && optional) return []; // 旧版缺失 → 默认空数组
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    errors.push(`${name} 必须是 string[]`);
    return [];
  }
  return v as string[];
}

function checkEducation(v: unknown, errors: string[]): EducationEntry[] {
  if (!Array.isArray(v)) {
    errors.push("education 必须是数组");
    return [];
  }
  return v.map((item, i) => {
    if (!isRecord(item)) {
      errors.push(`education[${i}] 必须是对象`);
      return null as unknown as EducationEntry;
    }
    const keys: (keyof EducationEntry)[] = [
      "school", "college", "major", "degree", "educationLevel", "startDate", "endDate", "gpa", "rank",
    ];
    for (const k of keys) {
      if (typeof item[k] !== "string") errors.push(`education[${i}].${k} 必须是 string`);
    }
    // 升级新增的字段：旧 Profile 里没有 → 补空串，存在但类型错 → 拒绝
    for (const k of ["degreeType", "direction"] as (keyof EducationEntry)[]) {
      if (item[k] === undefined) (item as Record<string, unknown>)[k] = "";
      else if (typeof item[k] !== "string") errors.push(`education[${i}].${k} 必须是 string`);
    }
    return item as unknown as EducationEntry;
  });
}

/** v1.2 增量语义槽位：旧版条目缺失 → 补默认 ""；存在但类型错仍拒绝 */
const EXPERIENCE_KEYS_OPTIONAL = ["responsibilities", "workContent", "achievements", "summary", "background"];

/**
 * v2.0 岗位方向变体（表达层）：旧版条目整块缺失 → 补全空变体（向后兼容）；
 * 存在但结构错仍拒绝。
 */
function normalizeVariants(item: Record<string, unknown>, name: string, i: number, errors: string[]): void {
  const val = item.variants;
  if (val === undefined) {
    item.variants = { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" };
    return;
  }
  if (!isRecord(val)) {
    errors.push(`${name}[${i}].variants 必须是对象`);
    item.variants = { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" };
    return;
  }
  const out: Record<string, string> = {};
  for (const k of ["agent", "aiApplication", "aiProduct", "aiOperation", "aiSolution", "aigcMarketing"]) {
    const v = val[k];
    if (typeof v === "string") out[k] = v;
    else if (v === undefined) out[k] = "";
    else errors.push(`${name}[${i}].variants.${k} 必须是 string`);
  }
  item.variants = out;
}

function checkExperienceEntries(
  v: unknown,
  name: string,
  errors: string[],
  keys: string[],
): Record<string, string>[] {
  if (!Array.isArray(v)) {
    errors.push(`${name} 必须是数组`);
    return [];
  }
  return v.map((item, i) => {
    if (!isRecord(item)) {
      errors.push(`${name}[${i}] 必须是对象`);
      return null as unknown as Record<string, string>;
    }
    for (const k of keys) {
      if (typeof item[k] !== "string") errors.push(`${name}[${i}].${k} 必须是 string`);
    }
    for (const k of EXPERIENCE_KEYS_OPTIONAL) {
      const val = (item as Record<string, unknown>)[k];
      if (val === undefined) (item as Record<string, unknown>)[k] = ""; // 旧版条目补默认
      else if (typeof val !== "string") errors.push(`${name}[${i}].${k} 必须是 string`);
    }
    normalizeVariants(item as Record<string, unknown>, name, i, errors);
    return item as unknown as Record<string, string>;
  });
}

const EXPERIENCE_KEYS = [
  "descriptionShort", "descriptionMedium", "descriptionLong",
];

function checkProjects(v: unknown, errors: string[]): ProjectEntry[] {
  if (!Array.isArray(v)) {
    errors.push("projects 必须是数组");
    return [];
  }
  return v.map((item, i) => {
    if (!isRecord(item)) {
      errors.push(`projects[${i}] 必须是对象`);
      return null as unknown as ProjectEntry;
    }
    const keys: (keyof ProjectEntry)[] = [
      "name", "role", "startDate", "endDate", "descriptionShort", "descriptionMedium", "descriptionLong",
    ];
    for (const k of keys) {
      if (typeof item[k] !== "string") errors.push(`projects[${i}].${k} 必须是 string`);
    }
    for (const k of EXPERIENCE_KEYS_OPTIONAL) {
      const val = (item as Record<string, unknown>)[k];
      if (val === undefined) (item as Record<string, unknown>)[k] = ""; // 旧版条目补默认
      else if (typeof val !== "string") errors.push(`projects[${i}].${k} 必须是 string`);
    }
    normalizeVariants(item as Record<string, unknown>, "projects", i, errors);
    if (!Array.isArray(item.keywords)) errors.push(`projects[${i}].keywords 必须是数组`);
    return item as unknown as ProjectEntry;
  });
}

export function validateProfile(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["根节点必须是对象"] };

  const basic = checkBasic(input.basic, errors);

  const skills = input.skills;
  let skillsOut: SkillsProfile;
  if (!isRecord(skills)) {
    errors.push("skills 必须是对象");
    skillsOut = { technical: [], tools: [], languages: [], certificates: [], awards: [] };
  } else {
    skillsOut = {
      technical: checkStringArray(skills.technical, "skills.technical", errors),
      tools: checkStringArray(skills.tools, "skills.tools", errors),
      languages: checkStringArray(skills.languages, "skills.languages", errors),
      certificates: checkStringArray(skills.certificates, "skills.certificates", errors),
      awards: checkStringArray(skills.awards, "skills.awards", errors, true), // 增量字段，可缺省
    };
  }

  const job = input.jobPreferences;
  let jobOut: JobPreferences;
  if (!isRecord(job)) {
    errors.push("jobPreferences 必须是对象");
    jobOut = {
      expectedCity: [], expectedPosition: [], expectedSalary: "", availableDate: "",
      employmentType: "", expectedIndustry: "",
    };
  } else {
    jobOut = {
      expectedCity: checkStringArray(job.expectedCity, "jobPreferences.expectedCity", errors),
      expectedPosition: checkStringArray(job.expectedPosition, "jobPreferences.expectedPosition", errors),
      expectedSalary: typeof job.expectedSalary === "string" ? job.expectedSalary : (errors.push("jobPreferences.expectedSalary 必须是 string"), ""),
      availableDate: typeof job.availableDate === "string" ? job.availableDate : (errors.push("jobPreferences.availableDate 必须是 string"), ""),
      employmentType: typeof job.employmentType === "string" ? job.employmentType : (errors.push("jobPreferences.employmentType 必须是 string"), ""),
      expectedIndustry:
        job.expectedIndustry === undefined
          ? "" // 旧版缺失 → 默认
          : typeof job.expectedIndustry === "string"
            ? job.expectedIndustry
            : (errors.push("jobPreferences.expectedIndustry 必须是 string"), ""),
    };
  }

  const content = input.content;
  let contentOut: ContentProfile;
  if (!isRecord(content)) {
    errors.push("content 必须是对象");
    contentOut = {
      selfIntroduction: { short: "", medium: "", long: "" },
      selfEvaluation: { short: "", medium: "", long: "" },
      personalAdvantages: { short: "", medium: "", long: "" },
      careerPlan: { short: "", medium: "", long: "" },
      hobbies: { short: "", medium: "", long: "" },
    };
  } else {
    contentOut = {
      selfIntroduction: checkLongTextBlock(content.selfIntroduction, "content.selfIntroduction", errors) as unknown as ContentProfile["selfIntroduction"],
      selfEvaluation: checkLongTextBlock(content.selfEvaluation, "content.selfEvaluation", errors) as unknown as ContentProfile["selfEvaluation"],
      personalAdvantages: checkLongTextBlock(content.personalAdvantages, "content.personalAdvantages", errors) as unknown as ContentProfile["personalAdvantages"],
      careerPlan: checkLongTextBlock(content.careerPlan, "content.careerPlan", errors) as unknown as ContentProfile["careerPlan"],
      hobbies: checkLongTextBlock(content.hobbies, "content.hobbies", errors, true) as unknown as ContentProfile["hobbies"], // 增量字段
    };
  }

  const sensitive = input.sensitive;
  let sensitiveOut: SensitiveProfile;
  if (!isRecord(sensitive)) {
    errors.push("sensitive 必须是对象");
    sensitiveOut = { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" };
  } else {
    sensitiveOut = { ...sensitive } as unknown as SensitiveProfile;
    for (const k of ["politicalStatus", "maritalStatus", "idNumber", "emergencyContact"] as const) {
      if (typeof sensitive[k] !== "string") errors.push(`sensitive.${k} 必须是 string`);
    }
  }

  const education = checkEducation(input.education, errors);
  const internships = checkExperienceEntries(
    input.internships, "internships", errors,
    ["company", "department", "position", "startDate", "endDate", ...EXPERIENCE_KEYS],
  ) as unknown as InternshipEntry[];

  // campus 为 v1.1 增量板块：整体缺失（旧 Profile）→ 默认空数组；存在则完整校验
  const campus = input.campus === undefined
    ? []
    : checkExperienceEntries(
        input.campus, "campus", errors,
        ["organization", "department", "position", "startDate", "endDate", ...EXPERIENCE_KEYS],
      ) as unknown as CampusExperienceEntry[];

  const projects = checkProjects(input.projects, errors);

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) };

  const profile: Profile = {
    basic: basic as unknown as Profile["basic"],
    education,
    internships,
    campus,
    projects,
    skills: skillsOut,
    jobPreferences: jobOut,
    content: contentOut,
    sensitive: sensitiveOut,
  };
  // Stage 4：careerPreferences 可选（用户显式填写；缺失/畸形时补全为空结构，不报错）
  const careerRaw = (input as Record<string, unknown>).careerPreferences;
  if (careerRaw && typeof careerRaw === "object") {
    const c = careerRaw as Record<string, unknown>;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    profile.careerPreferences = {
      targetDirections: arr(c.targetDirections),
      preferredWorkTypes: arr(c.preferredWorkTypes),
      developmentGoals: arr(c.developmentGoals),
    };
  }
  return { ok: true, profile };
}
