import { describe, expect, it } from "vitest";
import { defaultProfile } from "../src/profile/defaultProfile";
import { validateProfile } from "../src/profile/schema";
import { chooseVariant, resolveValue } from "../src/profile/profileResolver";
import { maskValue } from "../src/utils/logger";
import type { Profile } from "../src/types/profile";

describe("profile schema 校验", () => {
  it("合法完整 Profile 通过", () => {
    const result = validateProfile(structuredClone(defaultProfile));
    expect(result.ok).toBe(true);
  });

  it("非对象根节点拒绝", () => {
    expect(validateProfile("not-json-object").ok).toBe(false);
    expect(validateProfile(null).ok).toBe(false);
    expect(validateProfile([1, 2]).ok).toBe(false);
  });

  it("basic 字段类型错误拒绝", () => {
    const bad = structuredClone(defaultProfile) as unknown as Record<string, unknown>;
    bad.basic = { ...(bad.basic as object), phone: 12345 };
    const result = validateProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("basic.phone");
  });

  it("education 缺字段拒绝", () => {
    const bad = structuredClone(defaultProfile);
    bad.education = [{ school: "x" } as unknown as Profile["education"][number]];
    const result = validateProfile(bad);
    expect(result.ok).toBe(false);
  });

  it("skills.technical 含非字符串拒绝", () => {
    const bad = structuredClone(defaultProfile) as unknown as Record<string, unknown>;
    bad.skills = { technical: ["ok", 42], tools: [], languages: [], certificates: [] };
    expect(validateProfile(bad).ok).toBe(false);
  });

  it("向后兼容：v1.0 旧 Profile（缺 age/qq/portfolio/awards/hobbies/campus/expectedIndustry）通过并补默认值", () => {
    const old = {
      basic: { name: "张三", englishName: "", gender: "", birthDate: "", phone: "", email: "", wechat: "", city: "" },
      education: [],
      internships: [],
      projects: [],
      skills: { technical: [], tools: [], languages: [], certificates: [] },
      jobPreferences: { expectedCity: [], expectedPosition: [], expectedSalary: "", availableDate: "", employmentType: "" },
      content: {
        selfIntroduction: { short: "", medium: "", long: "" },
        selfEvaluation: { short: "", medium: "", long: "" },
        personalAdvantages: { short: "", medium: "", long: "" },
        careerPlan: { short: "", medium: "", long: "" },
      },
      sensitive: { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" },
    };
    const result = validateProfile(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.basic.age).toBe("");
    expect(result.profile.basic.qq).toBe("");
    expect(result.profile.basic.portfolio).toBe("");
    expect(result.profile.skills.awards).toEqual([]);
    expect(result.profile.jobPreferences.expectedIndustry).toBe("");
    expect(result.profile.content.hobbies).toEqual({ short: "", medium: "", long: "" });
    expect(result.profile.campus).toEqual([]);
  });
});

describe("profileResolver", () => {
  const profile: Profile = structuredClone(defaultProfile);
  profile.basic.name = "张三";
  profile.basic.phone = "13800001234";
  profile.education = [
    { school: "A大", college: "CS", major: "软件", degree: "本科", educationLevel: "", startDate: "2019", endDate: "2023", gpa: "3.5", rank: "" },
    { school: "B大", college: "EE", major: "电子", degree: "硕士", educationLevel: "", startDate: "2023", endDate: "2026", gpa: "", rank: "" },
  ];
  profile.content.personalAdvantages = {
    short: "短优势",
    medium: "中优势".repeat(50),
    long: "长优势".repeat(200),
  };
  profile.skills.technical = ["Java", "Python"];
  profile.internships = [
    {
      company: "某科技",
      department: "测试部门",
      position: "AI 应用实习",
      startDate: "2026.06",
      endDate: "2026.09",
      descriptionShort: "短",
      descriptionMedium: "中",
      descriptionLong: "长",
      responsibilities: "职责",
      workContent: "内容",
      achievements: "业绩",
      summary: "总结",
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    },
  ];

  it("basic 直接解析", () => {
    const v = resolveValue("basic.name", profile);
    expect(v?.value).toBe("张三");
    expect(v?.variant).toBe("plain");
  });

  it("空值返回 undefined（绝不填空）", () => {
    expect(resolveValue("basic.email", profile)).toBeUndefined();
  });

  it("多条目默认取第一条，可指定 entryIndex", () => {
    expect(resolveValue("education.school", profile)?.value).toBe("A大");
    expect(resolveValue("education.school", profile, { entryIndex: 1 })?.value).toBe("B大");
    expect(resolveValue("education.school", profile, { entryIndex: 5 })).toBeUndefined(); // 越界不填，不把最后一条重复填进去
  });

  it("sensitive 永不解析", () => {
    const p = structuredClone(profile);
    p.sensitive.idNumber = "110101199001011234";
    expect(resolveValue("sensitive.idNumber", p)).toBeUndefined();
    expect(resolveValue("risk.manual", p)).toBeUndefined();
    expect(resolveValue("unknown", p)).toBeUndefined();
  });

  it("maxlength 决定开放文本变体", () => {
    expect(resolveValue("content.personalAdvantages", profile, { maxLength: 80 })?.variant).toBe("short");
    expect(resolveValue("content.personalAdvantages", profile, { maxLength: 300 })?.variant).toBe("medium");
    expect(resolveValue("content.personalAdvantages", profile, { maxLength: 1000 })?.variant).toBe("long");
    expect(resolveValue("content.personalAdvantages", profile)?.variant).toBe("medium");
  });

  it("chooseVariant 边界", () => {
    expect(chooseVariant(null)).toBe("medium");
    expect(chooseVariant(undefined)).toBe("medium");
    expect(chooseVariant(120)).toBe("short");
    expect(chooseVariant(121)).toBe("medium");
    expect(chooseVariant(350)).toBe("medium");
    expect(chooseVariant(351)).toBe("long");
  });

  it("数组字段 join 输出", () => {
    expect(resolveValue("skills.technical", profile)?.value).toBe("Java、Python");
  });

  it("internship.department 走通用取值路径", () => {
    expect(resolveValue("internship.department", profile)?.value).toBe("测试部门");
    expect(resolveValue("internship.department", profile)?.entryCount).toBe(1);
  });

  it("campus.description 按变体取值；campus 客观字段走通用路径", () => {
    profile.campus = [
      {
        organization: "青年志愿者协会",
        department: "宣传部",
        position: "干事",
        startDate: "2023.09",
        endDate: "2024.06",
        descriptionShort: "短描述",
        descriptionMedium: "中描述",
        descriptionLong: "长描述",
        responsibilities: "",
        workContent: "",
        achievements: "",
        summary: "",
        variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
      },
    ];
    expect(resolveValue("campus.organization", profile)?.value).toBe("青年志愿者协会");
    expect(resolveValue("campus.description", profile, { maxLength: 80 })?.value).toBe("短描述");
    expect(resolveValue("campus.description", profile, { maxLength: 1000 })?.value).toBe("长描述");
  });

  it("internship 语义槽位走通用取值路径", () => {
    expect(resolveValue("internship.responsibilities", profile)?.value).toBe("职责");
    expect(resolveValue("internship.workContent", profile)?.value).toBe("内容");
    expect(resolveValue("internship.achievements", profile)?.value).toBe("业绩");
    expect(resolveValue("internship.summary", profile)?.value).toBe("总结");
  });
});

describe("logger 脱敏", () => {
  it("手机号脱敏", () => {
    expect(maskValue("basic.phone", "13800001234")).toBe("138****1234");
  });
  it("邮箱脱敏", () => {
    expect(maskValue("basic.email", "zhangsan@example.com")).toBe("z***@example.com");
  });
  it("身份证类完全隐藏", () => {
    expect(maskValue("sensitive.idNumber", "110101199001011234")).toBe("***");
  });
});
