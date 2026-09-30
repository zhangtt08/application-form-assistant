import type { CanonicalFieldDef } from "../types/profile";

/**
 * Canonical Field ID 总表。
 * 所有网页字段必须先映射到这里的 id，再从 Profile 取值。
 */
export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  { id: "basic.name", group: "basic", multiEntry: false },
  { id: "basic.englishName", group: "basic", multiEntry: false },
  { id: "basic.surname", group: "basic", multiEntry: false },
  { id: "basic.givenName", group: "basic", multiEntry: false },
  { id: "basic.linkedin", group: "basic", multiEntry: false },
  { id: "basic.github", group: "basic", multiEntry: false },
  { id: "basic.gender", group: "basic", multiEntry: false },
  { id: "basic.birthDate", group: "basic", multiEntry: false },
  { id: "basic.age", group: "basic", multiEntry: false },
  { id: "basic.phone", group: "basic", multiEntry: false },
  { id: "basic.email", group: "basic", multiEntry: false },
  { id: "basic.wechat", group: "basic", multiEntry: false },
  { id: "basic.qq", group: "basic", multiEntry: false },
  { id: "basic.city", group: "basic", multiEntry: false },
  { id: "basic.portfolio", group: "basic", multiEntry: false },
  { id: "basic.address", group: "basic", multiEntry: false },
  { id: "basic.idNumber", group: "basic", multiEntry: false },
  { id: "basic.nativePlace", group: "basic", multiEntry: false },
  { id: "basic.hukou", group: "basic", multiEntry: false },
  { id: "basic.hukouType", group: "basic", multiEntry: false },
  { id: "basic.politicalStatus", group: "basic", multiEntry: false },
  { id: "basic.maritalStatus", group: "basic", multiEntry: false },
  { id: "basic.height", group: "basic", multiEntry: false },
  { id: "basic.weight", group: "basic", multiEntry: false },
  { id: "basic.workYears", group: "basic", multiEntry: false },
  { id: "basic.emergencyContactName", group: "basic", multiEntry: false },
  { id: "basic.emergencyContactPhone", group: "basic", multiEntry: false },

  { id: "education.school", group: "education", multiEntry: true },
  { id: "education.college", group: "education", multiEntry: true },
  { id: "education.major", group: "education", multiEntry: true },
  { id: "education.degree", group: "education", multiEntry: true },
  { id: "education.degreeType", group: "education", multiEntry: true },
  { id: "education.educationLevel", group: "education", multiEntry: true },
  { id: "education.direction", group: "education", multiEntry: true },
  { id: "education.startDate", group: "education", multiEntry: true },
  { id: "education.endDate", group: "education", multiEntry: true },
  { id: "education.gpa", group: "education", multiEntry: true },
  { id: "education.rank", group: "education", multiEntry: true },

  { id: "internship.company", group: "internship", multiEntry: true },
  /**
   * 「是否有实习经历」是非题（无条目 = 不回答，绝不因为没录就答「否」）。
   * multiEntry=false：它不是某一条经历的属性，而是整段经历的存在性。
   */
  { id: "internship.hasExperience", group: "internship", multiEntry: false },
  { id: "internship.department", group: "internship", multiEntry: true },
  { id: "internship.position", group: "internship", multiEntry: true },
  { id: "internship.startDate", group: "internship", multiEntry: true },
  { id: "internship.endDate", group: "internship", multiEntry: true },
  {
    id: "internship.description",
    group: "internship",
    multiEntry: true,
    variants: ["short", "medium", "long"],
  },
  { id: "internship.responsibilities", group: "internship", multiEntry: true },
  { id: "internship.workContent", group: "internship", multiEntry: true },
  { id: "internship.achievements", group: "internship", multiEntry: true },
  { id: "internship.summary", group: "internship", multiEntry: true },

  { id: "campus.organization", group: "campus", multiEntry: true },
  { id: "campus.department", group: "campus", multiEntry: true },
  { id: "campus.position", group: "campus", multiEntry: true },
  { id: "campus.startDate", group: "campus", multiEntry: true },
  { id: "campus.endDate", group: "campus", multiEntry: true },
  {
    id: "campus.description",
    group: "campus",
    multiEntry: true,
    variants: ["short", "medium", "long"],
  },
  { id: "campus.responsibilities", group: "campus", multiEntry: true },
  { id: "campus.workContent", group: "campus", multiEntry: true },
  { id: "campus.achievements", group: "campus", multiEntry: true },
  { id: "campus.summary", group: "campus", multiEntry: true },

  { id: "project.name", group: "project", multiEntry: true },
  /** 「是否有项目经验」是非题（同 internship.hasExperience：只在有条目时答「是」） */
  { id: "project.hasExperience", group: "project", multiEntry: false },
  { id: "project.role", group: "project", multiEntry: true },
  { id: "project.startDate", group: "project", multiEntry: true },
  { id: "project.endDate", group: "project", multiEntry: true },
  {
    id: "project.description",
    group: "project",
    multiEntry: true,
    variants: ["short", "medium", "long"],
  },
  { id: "project.background", group: "project", multiEntry: true },
  { id: "project.responsibilities", group: "project", multiEntry: true },
  { id: "project.workContent", group: "project", multiEntry: true },
  { id: "project.achievements", group: "project", multiEntry: true },
  { id: "project.summary", group: "project", multiEntry: true },

  { id: "skills.technical", group: "skills", multiEntry: false },
  { id: "skills.tools", group: "skills", multiEntry: false },
  { id: "skills.languages", group: "skills", multiEntry: false },
  { id: "skills.certificates", group: "skills", multiEntry: false },
  { id: "skills.awards", group: "skills", multiEntry: false },

  { id: "job.expectedCity", group: "job", multiEntry: false },
  { id: "job.expectedPosition", group: "job", multiEntry: false },
  { id: "job.expectedSalary", group: "job", multiEntry: false },
  { id: "job.availableDate", group: "job", multiEntry: false },
  { id: "job.employmentType", group: "job", multiEntry: false },
  { id: "job.expectedIndustry", group: "job", multiEntry: false },
  /** 「是否…」偏好单选题：用户在资料库里答过一次，之后全网申自动选同一答案 */
  { id: "job.acceptOfflineInterview", group: "job", multiEntry: false },
  { id: "job.acceptOnlineInterview", group: "job", multiEntry: false },
  { id: "job.acceptBusinessTrip", group: "job", multiEntry: false },
  { id: "job.acceptRelocation", group: "job", multiEntry: false },
  { id: "job.acceptOvertime", group: "job", multiEntry: false },

  {
    id: "content.selfIntroduction",
    group: "content",
    multiEntry: false,
    variants: ["short", "medium", "long"],
  },
  {
    id: "content.selfEvaluation",
    group: "content",
    multiEntry: false,
    variants: ["short", "medium", "long"],
  },
  {
    id: "content.personalAdvantages",
    group: "content",
    multiEntry: false,
    variants: ["short", "medium", "long"],
  },
  {
    id: "content.careerPlan",
    group: "content",
    multiEntry: false,
    variants: ["short", "medium", "long"],
  },
  {
    id: "content.hobbies",
    group: "content",
    multiEntry: false,
    variants: ["short", "medium", "long"],
  },
];

const fieldIdSet = new Set(CANONICAL_FIELDS.map((f) => f.id));

export function isCanonicalFieldId(id: string): boolean {
  return fieldIdSet.has(id);
}

export function getCanonicalFieldDef(id: string): CanonicalFieldDef | undefined {
  return CANONICAL_FIELDS.find((f) => f.id === id);
}
