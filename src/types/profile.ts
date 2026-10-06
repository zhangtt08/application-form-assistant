export interface BasicProfile {
  name: string;
  englishName: string;
  /**
   * 英文 ATS（Greenhouse / Lever / Workday）几乎都把姓名拆成 First name + Last name，
   * 中文站用整名「姓名」。只填 name 的话，那些拆分字段就永远识别不到值（少填）。
   * 因此库里单独存姓 / 名两段，由用户自己填 —— 扩展绝不把「赵合一」自作主张拆成「赵 / 合一」
   * （复姓、少数民族姓名、中英混排都会拆错）。
   */
  surname?: string;
  givenName?: string;
  /** 领英主页：英文站高频字段，与「个人主页 / portfolio」是两个来源 */
  linkedin?: string;
  /** GitHub 主页：技术岗网申的标配字段，同样与 portfolio 分开存 */
  github?: string;
  gender: string;
  birthDate: string;
  age: string;
  phone: string;
  email: string;
  wechat: string;
  qq: string;
  city: string;
  portfolio: string;
  /**
   * 国内校招网申的高频字段（可选：旧 Profile / 旧 fixture 里没有这些键）。
   * 此前不在资料库里，识别到了也只能留空（用户看到的「少填」）。
   * 一律用户自己填，扩展绝不猜值。
   */
  address?: string;
  idNumber?: string;
  nativePlace?: string;
  hukou?: string;
  hukouType?: string;
  politicalStatus?: string;
  maritalStatus?: string;
  height?: string;
  weight?: string;
  workYears?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface EducationEntry {
  school: string;
  college: string;
  major: string;
  degree: string;
  /** 学位（学士/硕士/博士），与「学历（本科/研究生）」是两个不同字段 */
  degreeType?: string;
  educationLevel: string;
  /** 研究方向 / 专业方向 */
  direction?: string;
  startDate: string;
  endDate: string;
  gpa: string;
  rank: string;
}

/**
 * 经历的岗位方向变体（spec 第四章：facts 事实层 + variants 表达层）。
 * facts = 描述/职责/内容/业绩等事实性字段，不随岗位改变；
 * variants = 面向不同岗位方向的「这条经历怎么讲」表达版本。
 * 任何变体都不允许制造不存在的经历、数字、技能或结果。
 */
export interface ExperienceVariants {
  agent: string;
  aiApplication: string;
  aiProduct: string;
  aiOperation: string;
  aiSolution: string;
  aigcMarketing: string;
}

const EMPTY_VARIANTS: ExperienceVariants = {
  agent: "",
  aiApplication: "",
  aiProduct: "",
  aiOperation: "",
  aiSolution: "",
  aigcMarketing: "",
};

export function emptyVariants(): ExperienceVariants {
  return { ...EMPTY_VARIANTS };
}

/** ExperienceVariants 的全部键（schema 归一化用） */
export const EXPERIENCE_VARIANT_KEYS = Object.keys(EMPTY_VARIANTS) as (keyof ExperienceVariants)[];

export interface InternshipEntry {
  company: string;
  department: string;
  position: string;
  startDate: string;
  endDate: string;
  /** 经历描述（表单「实习描述/工作描述」栏的默认来源；按岗位方向的版本见 variants） */
  description: string;
  /** 语义槽位：工作职责（对应表单「工作职责/岗位职责」栏） */
  responsibilities: string;
  /** 语义槽位：工作内容（对应「工作内容/主要工作」栏） */
  workContent: string;
  /** 语义槽位：工作业绩（对应「工作业绩/成果/亮点」栏） */
  achievements: string;
  /** 语义槽位：总结/收获（对应「实习总结/收获体会」栏） */
  summary: string;
  /** 岗位方向变体（表达层，见 ExperienceVariants 注释） */
  variants: ExperienceVariants;
}

/** 校园经历（学生会/社团/学生工作等），结构与实习条目一致 */
export interface CampusExperienceEntry {
  organization: string;
  department: string;
  position: string;
  startDate: string;
  endDate: string;
  description: string;
  responsibilities: string;
  workContent: string;
  achievements: string;
  summary: string;
  variants: ExperienceVariants;
}

export interface ProjectEntry {
  name: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
  keywords: string[];
  /** 语义槽位：项目背景 */
  background: string;
  /** 语义槽位：项目职责/项目分工 */
  responsibilities: string;
  /** 语义槽位：项目内容/核心功能 */
  workContent: string;
  /** 语义槽位：项目成果/业绩 */
  achievements: string;
  /** 语义槽位：项目概述 */
  summary: string;
  variants: ExperienceVariants;
}

export interface SkillsProfile {
  technical: string[];
  tools: string[];
  languages: string[];
  certificates: string[];
  awards: string[];
}

export interface JobPreferences {
  expectedCity: string[];
  expectedPosition: string[];
  expectedSalary: string;
  availableDate: string;
  employmentType: string;
  expectedIndustry: string;
  /**
   * 网申里高频的「是否…」单选题（是否接受线下面试 / 出差 / 异地…）。
   * 这些是**可记录的偏好**，不是承诺或授权：用户在资料库答一次，之后所有表单复用。
   * 值为 "是" / "否" / ""（空 = 还没记录过，识别到也不会瞎猜）。
   */
  acceptOfflineInterview?: string;
  acceptOnlineInterview?: string;
  acceptBusinessTrip?: string;
  acceptRelocation?: string;
  acceptOvertime?: string;
}

/** 「是否…」偏好键（schema 补全、资料页表单、默认值共用同一份来源） */
export const YES_NO_PREFERENCE_KEYS = [
  "acceptOfflineInterview",
  "acceptOnlineInterview",
  "acceptBusinessTrip",
  "acceptRelocation",
  "acceptOvertime",
] as const;

export type YesNoPreferenceKey = (typeof YES_NO_PREFERENCE_KEYS)[number];

export interface ContentProfile {
  selfIntroduction: string;
  selfEvaluation: string;
  personalAdvantages: string;
  careerPlan: string;
  hobbies: string;
}

/** 敏感字段：Risk Engine 恒为 MANUAL_ONLY，扩展绝不写入 */
export interface SensitiveProfile {
  politicalStatus: string;
  maritalStatus: string;
  idNumber: string;
  emergencyContact: string;
}

export interface CareerPreferences {
  targetDirections: string[];
  preferredWorkTypes: string[];
  developmentGoals: string[];
}

export interface Profile {
  basic: BasicProfile;
  education: EducationEntry[];
  internships: InternshipEntry[];
  campus: CampusExperienceEntry[];
  projects: ProjectEntry[];
  skills: SkillsProfile;
  jobPreferences: JobPreferences;
  /** Stage 4：职业方向配置（用户显式填写；开放题 career_plan 的事实来源） */
  careerPreferences?: CareerPreferences;
  content: ContentProfile;
  sensitive: SensitiveProfile;
}

export interface ProfileExportFile {
  kind: "application-form-assistant/profile";
  version: 1;
  profile: Profile;
}

/** Canonical Field ID → Profile 取值器所需的最小信息 */
export interface CanonicalFieldDef {
  id: string;
  /** 用于给用户看的分组 */
  group: "basic" | "education" | "internship" | "campus" | "project" | "skills" | "job" | "content";
  /** 是否多条目（education/internship/campus/project） */
  multiEntry: boolean;
}
