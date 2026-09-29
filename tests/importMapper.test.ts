import { describe, expect, it } from "vitest";
import { mapResumeJsonToProfile } from "../src/profile/importMapper";
import { validateProfile } from "../src/profile/schema";

/**
 * 简历母版 JSON → Profile 映射回归。
 * 夹具结构对齐用户真实简历 JSON：basic_info / snake_case / education 单对象 /
 * 职责·业绩数组 / 三档求职意向优先级。
 */
const resumeJson = {
  basic_info: {
    name: "张三",
    gender: "男",
    age: 21,
    city: "重庆市",
    phone: "13800000000",
    email: "test@example.com",
    portfolio: "example.com",
    graduation_year: 2027,
    job_intention: ["AI应用", "AI运营", "业务自动化"],
  },
  education: {
    school: "示例科技大学",
    major: "测试专业",
    degree: "本科",
    start_date: "2023.09",
    end_date: "2027.06",
    courses: ["课程A", "课程B"],
    summary: "测试专业本科在读",
  },
  internships: [
    {
      company: "示例科技有限公司",
      department: "测试部门",
      position: "AI 应用实习",
      start_date: "2026.06",
      end_date: "2026.09",
      responsibilities: ["职责一", "职责二"],
      work_content: ["内容一"],
      achievements: ["业绩一"],
      summary: "推动人工流程自动化",
    },
  ],
  projects: [
    {
      name: "示例流程自动化系统",
      type: "示例业务项目｜AI应用开发",
      start_date: "2026.06",
      end_date: "2026.09",
      role: ["业务方案设计", "Agent工作流设计"],
      background: "项目背景描述",
      core_features: ["功能一", "功能二"],
      achievements: ["成果一"],
      summary: "项目概述",
    },
  ],
  skills: {
    ai_application: ["Claude Code", "Prompt设计"],
    automation: ["Python基础"],
    product_and_business: ["需求拆解"],
    content_and_design: ["Premiere Pro"],
    aigc: ["ChatGPT"],
  },
  certificates: ["大学英语六级（CET-6）"],
  personal_strengths: ["优势一", "优势二"],
  self_evaluation: {
    general: "综合评价",
    ai_application: "AI评价",
    ai_operations: "运营评价",
  },
  career_plan: {
    short_term: "进入AI应用岗位",
    long_term: "形成完整解决方案能力",
  },
  personal_summary: "2027届测试专业本科生",
  job_preferences: {
    priority_1: ["AI应用"],
    priority_2: ["业务自动化"],
    priority_3: ["内容运营"],
  },
};

describe("mapResumeJsonToProfile", () => {
  it("完整简历 JSON → 合法 Profile，映射产物必须通过 validateProfile", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const re = validateProfile(mapped.profile);
    expect(re.ok).toBe(true);
  });

  it("basic：basic_info → basic，多余字段忽略", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.basic.name).toBe("张三");
    expect(mapped.profile.basic.gender).toBe("男");
    expect(mapped.profile.basic.city).toBe("重庆市");
    expect(mapped.profile.basic.phone).toBe("13800000000");
    expect(mapped.profile.basic.email).toBe("test@example.com");
    expect(mapped.profile.basic.wechat).toBe("");
  });

  it("education 单对象 → 数组包装", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.education).toHaveLength(1);
    const edu = mapped.profile.education[0]!;
    expect(edu.school).toBe("示例科技大学");
    expect(edu.major).toBe("测试专业");
    expect(edu.degree).toBe("本科");
    expect(edu.startDate).toBe("2023.09");
    expect(edu.endDate).toBe("2027.06");
  });

  it("internship：short=概述 / medium=职责列表 / long=分段全文", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    const job = mapped.profile.internships[0]!;
    expect(job.company).toBe("示例科技有限公司");
    expect(job.descriptionShort).toBe("推动人工流程自动化");
    expect(job.descriptionMedium).toBe("职责一\n职责二");
    expect(job.descriptionLong).toContain("【工作职责】");
    expect(job.descriptionLong).toContain("【工作内容】");
    expect(job.descriptionLong).toContain("【主要业绩】");
    expect(job.descriptionLong).toContain("【概述】");
  });

  it("语义槽位：职责/内容/业绩/总结/背景 各自独立落位，不再只拼进 description", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    const job = mapped.profile.internships[0]!;
    expect(job.responsibilities).toBe("职责一\n职责二");
    expect(job.workContent).toBe("内容一");
    expect(job.achievements).toBe("业绩一");
    expect(job.summary).toBe("推动人工流程自动化");

    const p = mapped.profile.projects[0]!;
    expect(p.background).toBe("项目背景描述");
    expect(p.responsibilities).toBe("");
    expect(p.workContent).toBe("功能一\n功能二");
    expect(p.achievements).toBe("成果一");
    expect(p.summary).toBe("项目概述");
  });

  it("project：role 数组拼接，keywords 收录 type + role", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    const p = mapped.profile.projects[0]!;
    expect(p.name).toBe("示例流程自动化系统");
    expect(p.role).toBe("业务方案设计、Agent工作流设计");
    expect(p.keywords).toContain("示例业务项目｜AI应用开发");
    expect(p.keywords).toContain("业务方案设计");
    expect(p.descriptionLong).toContain("【项目背景】");
    expect(p.descriptionLong).toContain("【核心功能】");
  });

  it("skills：简历分组归并入 technical/tools/certificates", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.skills.technical).toContain("Claude Code");
    expect(mapped.profile.skills.technical).toContain("需求拆解");
    expect(mapped.profile.skills.tools).toContain("ChatGPT");
    expect(mapped.profile.skills.tools).toContain("Premiere Pro");
    expect(mapped.profile.skills.certificates).toContain("大学英语六级（CET-6）");
  });

  it("jobPreferences：三档优先级 + job_intention 合并去重", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.jobPreferences.expectedPosition).toEqual([
      "AI应用",
      "业务自动化",
      "内容运营",
      "AI运营",
    ]);
    // 所在城市 ≠ 意向城市，不编造
    expect(mapped.profile.jobPreferences.expectedCity).toEqual([]);
  });

  it("content：selfEvaluation/careerPlan/personalAdvantages 分块落位", () => {
    const mapped = mapResumeJsonToProfile(resumeJson);
    if (!mapped.ok) throw new Error("should map");
    const c = mapped.profile.content;
    expect(c.selfIntroduction.long).toBe("2027届测试专业本科生");
    expect(c.selfEvaluation.long).toContain("综合评价");
    expect(c.selfEvaluation.long).toContain("AI评价");
    expect(c.careerPlan.long).toContain("短期：进入AI应用岗位");
    expect(c.careerPlan.long).toContain("长期：形成完整解决方案能力");
    expect(c.personalAdvantages.medium).toBe("优势一；优势二");
  });

  it("sensitive 恒为空，绝不从外部 JSON 映射", () => {
    const withSensitive = {
      ...resumeJson,
      sensitive: { idNumber: "500000000000000000" },
    };
    const mapped = mapResumeJsonToProfile(withSensitive);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.sensitive.idNumber).toBe("");
  });

  it("campus_experience → campus 板块（组织/部门/职务/描述）", () => {
    const withCampus = {
      ...resumeJson,
      campus_experience: [
        {
          organization: "青年志愿者协会",
          department: "宣传部",
          position: "干事",
          start_date: "2023.09",
          end_date: "2024.06",
          responsibilities: ["志愿活动摄影", "公众号内容制作"],
          summary: "积累校园宣传经验",
        },
      ],
    };
    const mapped = mapResumeJsonToProfile(withCampus);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.campus).toHaveLength(1);
    const cp = mapped.profile.campus[0]!;
    expect(cp.organization).toBe("青年志愿者协会");
    expect(cp.department).toBe("宣传部");
    expect(cp.position).toBe("干事");
    expect(cp.startDate).toBe("2023.09");
    expect(cp.descriptionShort).toBe("积累校园宣传经验");
    expect(cp.descriptionMedium).toBe("志愿活动摄影\n公众号内容制作");
    expect(cp.descriptionLong).toContain("【工作职责】");
    expect(cp.responsibilities).toBe("志愿活动摄影\n公众号内容制作");
    expect(cp.summary).toBe("积累校园宣传经验");
  });

  it("basic 增量字段：age/portfolio；skills.awards；content.hobbies；job.expectedIndustry", () => {
    const enriched = {
      ...resumeJson,
      basic_info: { ...resumeJson.basic_info, age: 21, portfolio: "example.com" },
      skills: { ...resumeJson.skills, awards: ["竞赛二等奖"] },
      hobbies: ["摄影", "短视频创作"],
      job_preferences: { ...resumeJson.job_preferences, expected_industry: "互联网" },
    };
    const mapped = mapResumeJsonToProfile(enriched);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.basic.age).toBe("21");
    expect(mapped.profile.basic.portfolio).toBe("example.com");
    expect(mapped.profile.skills.awards).toContain("竞赛二等奖");
    expect(mapped.profile.content.hobbies.short).toBe("摄影、短视频创作");
    expect(mapped.profile.content.hobbies.long).toContain("· 摄影");
    expect(mapped.profile.jobPreferences.expectedIndustry).toBe("互联网");
  });

  it("垃圾 JSON → 拒绝（防止清空现有 Profile）", () => {
    expect(mapResumeJsonToProfile({ foo: 1 }).ok).toBe(false);
    expect(mapResumeJsonToProfile("text").ok).toBe(false);
    expect(mapResumeJsonToProfile([]).ok).toBe(false);
  });

  it("原生 Profile 格式也能被兜底映射（camelCase 兼容）", () => {
    const nativeBroken = {
      basic: { name: "李四", gender: "" },
      education: [{ school: "某大学", startDate: "2023.09" }],
    };
    const mapped = mapResumeJsonToProfile(nativeBroken);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.profile.basic.name).toBe("李四");
    expect(mapped.profile.education[0]!.startDate).toBe("2023.09");
  });
});

/**
 * 中文键名简历母版（用户实际使用的版本）：
 * 个人信息/教育背景/实习经历/校园经历/项目经历/技能与资质/求职期望 +
 * {短,中,长} 常用文本块 + {短描述,中描述,长描述} 描述块 + null 值字段。
 */
const cnResume = {
  "个人信息": {
    "姓名": "张小明",
    "英文名": null,
    "性别": "男",
    "年龄": 21,
    "手机号": "15300001122",
    "邮箱": "test.resume@example.com",
    "QQ号": null,
    "所在城市": "重庆市",
    "个人主页/作品集": "192.0.2.100",
  },
  "教育背景": {
    "学校": "示例科技大学",
    "学院": "测试学院",
    "专业": "测试专业",
    "学历": "本科",
    "GPA": null,
    "专业排名": null,
    "入学时间": "2023.09",
    "毕业时间": "2027.06",
  },
  "实习经历": [
    {
      "公司": "示例科技有限公司",
      "部门": "测试部门",
      "岗位": "AI 应用实习生",
      "开始时间": "2026.06",
      "结束时间": "2026.09",
      "工作职责": ["职责一", "职责二"],
      "工作内容": ["内容一"],
      "工作业绩": ["业绩一"],
      "总结/收获": "实习收获",
      "描述": { "短描述": "短", "中描述": "中", "长描述": "长" },
    },
  ],
  "校园经历": [
    {
      "组织": "青年志愿者协会",
      "部门": null,
      "职务": "成员",
      "开始时间": null,
      "结束时间": null,
      "工作职责": ["志愿摄影"],
      "工作内容": ["素材整理"],
      "工作业绩": ["多次宣传"],
      "总结/收获": "校园收获",
    },
  ],
  "项目经历": [
    {
      "项目名称": "示例流程自动化系统",
      "角色": "方案设计｜开发",
      "开始时间": "2026.06",
      "结束时间": "2026.09",
      "关键词": ["AI应用", "Agent"],
      "项目背景": "背景描述",
      "项目职责": ["项目职责一"],
      "项目内容": ["功能一"],
      "项目成果": ["成果一"],
      "项目概述/总结": "项目概述",
    },
  ],
  "技能与资质": {
    "技术技能": ["Python基础"],
    "工具": ["Claude Code"],
    "语言能力": ["中文：母语"],
    "证书": ["CET-6"],
    "获奖情况": [],
  },
  "求职期望": {
    "期望城市": ["非北方城市均可"],
    "期望岗位": ["AI应用", "AI运营"],
    "期望行业": ["AI应用与人工智能"],
    "期望薪资": null,
    "到岗时间": "2027年毕业后",
    "就业类型": "2027届校招全职",
  },
  "自我介绍": { "短": "介短", "中": "介中", "长": "介长" },
  "自我评价": { "短": "评短", "中": "评中", "长": "评长" },
  "个人优势": { "短": "优短", "中": "优中", "长": "优长" },
  "职业规划": { "短": "规短", "中": "规中", "长": "规长" },
  "兴趣爱好": { "短": "趣短", "中": "趣中", "长": "趣长" },
};

describe("中文键名简历母版", () => {
  it("映射为合法 Profile 且通过 validateProfile 复检", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(validateProfile(mapped.profile).ok).toBe(true);
  });

  it("basic/education 中文键落位，null 值留空", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.basic.name).toBe("张小明");
    expect(mapped.profile.basic.qq).toBe("");
    expect(mapped.profile.basic.portfolio).toBe("192.0.2.100");
    const edu = mapped.profile.education[0]!;
    expect(edu.school).toBe("示例科技大学");
    expect(edu.college).toBe("测试学院");
    expect(edu.degree).toBe("本科");
    expect(edu.gpa).toBe("");
    expect(edu.startDate).toBe("2023.09");
    expect(edu.endDate).toBe("2027.06");
  });

  it("实习：语义槽位独立落位 + 描述三变体直取", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    const job = mapped.profile.internships[0]!;
    expect(job.company).toBe("示例科技有限公司");
    expect(job.position).toBe("AI 应用实习生");
    expect(job.responsibilities).toBe("职责一\n职责二");
    expect(job.workContent).toBe("内容一");
    expect(job.achievements).toBe("业绩一");
    expect(job.summary).toBe("实习收获");
    expect(job.descriptionShort).toBe("短");
    expect(job.descriptionMedium).toBe("中");
    expect(job.descriptionLong).toBe("长");
  });

  it("校园：组织/职务/语义槽位", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    const cp = mapped.profile.campus[0]!;
    expect(cp.organization).toBe("青年志愿者协会");
    expect(cp.department).toBe("");
    expect(cp.position).toBe("成员");
    expect(cp.responsibilities).toBe("志愿摄影");
    expect(cp.workContent).toBe("素材整理");
    expect(cp.achievements).toBe("多次宣传");
    expect(cp.summary).toBe("校园收获");
  });

  it("项目：背景/职责/内容/成果/概述 + 关键词", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    const p = mapped.profile.projects[0]!;
    expect(p.name).toBe("示例流程自动化系统");
    expect(p.role).toBe("方案设计｜开发");
    expect(p.background).toBe("背景描述");
    expect(p.responsibilities).toBe("项目职责一");
    expect(p.workContent).toBe("功能一");
    expect(p.achievements).toBe("成果一");
    expect(p.summary).toBe("项目概述");
    expect(p.keywords).toContain("AI应用");
  });

  it("技能/求职期望 中文键落位", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.skills.technical).toContain("Python基础");
    expect(mapped.profile.skills.tools).toContain("Claude Code");
    expect(mapped.profile.skills.certificates).toContain("CET-6");
    expect(mapped.profile.jobPreferences.expectedPosition).toEqual(["AI应用", "AI运营"]);
    expect(mapped.profile.jobPreferences.expectedCity).toEqual(["非北方城市均可"]);
    expect(mapped.profile.jobPreferences.expectedIndustry).toBe("AI应用与人工智能");
    expect(mapped.profile.jobPreferences.expectedSalary).toBe("");
    expect(mapped.profile.jobPreferences.employmentType).toBe("2027届校招全职");
  });

  it("常用文本 {短,中,长} 直取", () => {
    const mapped = mapResumeJsonToProfile(cnResume);
    if (!mapped.ok) throw new Error("should map");
    const c = mapped.profile.content;
    expect(c.selfIntroduction.short).toBe("介短");
    expect(c.selfEvaluation.medium).toBe("评中");
    expect(c.personalAdvantages.long).toBe("优长");
    expect(c.careerPlan.short).toBe("规短");
    expect(c.hobbies.long).toBe("趣长");
  });
});

/**
 * 界面标签风格（issue：导入器只认「个人信息/教育背景/实习经历/技能与资质/求职期望」，
 * 而资料编辑器界面上写的是「基础信息/教育经历/工作·实习经历/技能/求职偏好」——
 * 用户照界面的词写 JSON，结果六块里只有「项目经历」被吃进去，UI 却报「导入成功」。）
 */
const uiLabelJson = {
  资料库名称: "AI应用 / Agent",
  基础信息: { 姓名: "张三", 性别: "男", 年龄: 21, 手机号: "13800000000", 邮箱: "test@example.com", 所在城市: "重庆市", "主页/作品集": "example.com" },
  教育经历: [{ 学校: "示例科技大学", 学院: "测试学院", 专业: "测试专业", 学历: "本科", 入学时间: "2023.09", 毕业时间: "2027.07" }],
  "工作/实习经历": [{ 公司: "示例科技有限公司", 部门: "测试部门", 职务: "AI 应用实习生", 开始: "2026.06", 结束: "至今", "描述-短": "占位短描述" }],
  项目经历: [{ 项目名称: "占位项目", 角色: "独立开发", 开始: "2026.01", 结束: "至今" }],
  技能: { 技术技能: "Python,Playwright", 工具: "飞书多维表格", 语言能力: "CET-6", 证书: "大学英语六级" },
  求职偏好: { 期望城市: "重庆,成都", 期望岗位: "AI应用开发", 就业类型: "全职" },
  职业方向: { 目标方向: "AI应用开发,Agent/Workflow", 偏好工作类型: "真实业务驱动", 发展目标: "复合型AI应用人才" },
  自我介绍: { 短: "占位简介" },
};

describe("界面标签风格（issue：照界面的词写 JSON 必须能导入）", () => {
  it("六块全部落地，不再只剩项目经历", () => {
    const r = mapResumeJsonToProfile(uiLabelJson);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.profile;
    expect(p.basic.name).toBe("张三");
    expect(p.basic.phone).toBe("13800000000");
    expect(p.education[0]?.school).toBe("示例科技大学");
    expect(p.internships[0]?.company).toBe("示例科技有限公司");
    expect(p.projects[0]?.name).toBe("占位项目");
    expect(p.skills.technical).toContain("Python");
    expect(p.skills.certificates.join("")).toContain("大学英语六级");
    expect(p.jobPreferences.expectedCity.join(",")).toContain("重庆");
    expect(p.careerPreferences?.targetDirections.join(",")).toContain("Agent");
    expect(p.careerPreferences?.developmentGoals.length).toBeGreaterThan(0);
  });

  it("全部块都吃进去时不报缺失", () => {
    const r = mapResumeJsonToProfile(uiLabelJson);
    if (!r.ok) throw new Error("should be ok");
    expect(r.ignoredBlocks).toEqual([]);
    expect(r.unknownTopKeys).toEqual([]);
  });

  it("部分导入必须如实报告：有内容却没映射上的块列出来，而不是谎报成功", () => {
    const r = mapResumeJsonToProfile({
      基础信息: { 名称: "张三", 联系电话: "13800000000" }, // 块在、字段名全错 → 映射不出内容
      技能: { 我会什么: "Python" },
      项目经历: [{ 项目名称: "占位项目" }],
      神秘字段: { x: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignoredBlocks).toContain("基础信息");
    expect(r.ignoredBlocks).toContain("技能");
    expect(r.ignoredBlocks).not.toContain("项目经历"); // 这块真吃进去了
    expect(r.unknownTopKeys).toEqual(["神秘字段"]);
  });

  it("敏感字段恒为空：外部 JSON 不得注入身份证号", () => {
    const r = mapResumeJsonToProfile({
      基础信息: { 姓名: "张三", 身份证号: "110101199001011234", 政治面貌: "群众" },
    });
    if (!r.ok) throw new Error("should be ok");
    expect(r.profile.sensitive.idNumber).toBe("");
    expect(r.profile.sensitive.politicalStatus).toBe("");
  });

  it("导出信封格式原样回灌可通过校验（导出↔导入 round-trip）", async () => {
    const { buildExportFile } = await import("../src/profile/profileStore");
    const mapped = mapResumeJsonToProfile(uiLabelJson);
    if (!mapped.ok) throw new Error("should be ok");
    const envelope = buildExportFile(mapped.profile);
    const v = validateProfile(envelope.profile);
    expect(v.ok).toBe(true);
    // 信封里的 profile 再走一次映射，内容不丢
    const again = mapResumeJsonToProfile(envelope.profile);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.profile.basic.name).toBe("张三");
  });
});
