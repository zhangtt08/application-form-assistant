import { describe, expect, it } from "vitest";
import { parseResumeText } from "../src/profile/resumeTextParser";

const SAMPLE = `张小明
手机：15300001122　邮箱：test.resume@example.com
所在城市：杭州
求职意向：AI产品经理、AI运营

教育背景
2021.09-2025.06  示例科技大学  测试学院  测试专业  本科
GPA：3.7/4.0
主修课程：数据结构、机器学习

实习经历
2024.06-2024.09  XX科技有限公司  产品部  产品实习生
· 负责AI产品的需求调研与竞品分析，输出调研报告8份
· 主导设计智能问答功能原型，上线后日均使用1200次

项目经历
2023.10-2024.01  智能问答助手
角色：项目负责人
项目背景：面向校园场景的知识问答
· 基于RAG搭建检索链路，回答准确率提升至85%

校园经历
2022.09-2023.06  学生会  组织部  干事
· 组织校园活动5场

技能与证书
技术技能：Python、SQL
工具：Figma、Axure
语言能力：英语CET-6
获奖情况：校一等奖学金

自我评价
做事细致，交付前会自己先跑一遍。
`;

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error("expected ok result");
  return r as Extract<T, { ok: true }>;
}

describe("parseResumeText", () => {
  it("解析标准分节简历：基本信息 / 教育 / 实习 / 项目 / 校园", () => {
    const { profile } = ok(parseResumeText(SAMPLE));

    expect(profile.basic.name).toBe("张小明");
    expect(profile.basic.phone).toBe("15300001122");
    expect(profile.basic.email).toBe("test.resume@example.com");
    expect(profile.basic.city).toBe("杭州");

    expect(profile.education).toHaveLength(1);
    const edu = profile.education[0]!;
    expect(edu.school).toBe("示例科技大学");
    expect(edu.college).toBe("测试学院");
    expect(edu.major).toBe("测试专业");
    expect(edu.degree).toBe("本科");
    expect(edu.startDate).toBe("2021.09");
    expect(edu.endDate).toBe("2025.06");
    expect(edu.gpa).toBe("3.7/4.0");

    expect(profile.internships).toHaveLength(1);
    const intern = profile.internships[0]!;
    expect(intern.company).toBe("XX科技有限公司");
    expect(intern.department).toBe("产品部");
    expect(intern.position).toBe("产品实习生");
    expect(intern.responsibilities.split("\n")).toHaveLength(2);
    expect(intern.descriptionShort.length).toBeGreaterThan(0);
    expect(intern.descriptionMedium).toContain("需求调研");

    expect(profile.projects).toHaveLength(1);
    const proj = profile.projects[0]!;
    expect(proj.name).toBe("智能问答助手");
    expect(proj.role).toBe("项目负责人");
    expect(proj.background).toContain("知识问答");

    expect(profile.campus).toHaveLength(1);
    const campus = profile.campus[0]!;
    expect(campus.organization).toBe("学生会");
    expect(campus.department).toBe("组织部");
    expect(campus.position).toBe("干事");
  });

  it("技能按语义分流到 技术 / 工具 / 语言 / 获奖", () => {
    const { profile } = ok(parseResumeText(SAMPLE));
    expect(profile.skills.technical).toContain("Python");
    expect(profile.skills.technical).toContain("SQL");
    expect(profile.skills.tools).toContain("Figma");
    expect(profile.skills.tools).toContain("Axure");
    expect(profile.skills.languages.join("")).toContain("CET-6");
    expect(profile.skills.awards.join("")).toContain("一等奖学金");
  });

  it("常用文本与求职意向", () => {
    const { profile } = ok(parseResumeText(SAMPLE));
    expect(profile.content.selfEvaluation.long).toContain("做事细致");
    // 三档都写同一份文本，页面上无论 maxlength 多少都能取到
    expect(profile.content.selfEvaluation.short).toBe(profile.content.selfEvaluation.long);
    expect(profile.jobPreferences.expectedPosition).toEqual(["AI产品经理", "AI运营"]);
  });

  it("变体是表达层：导入一律留空，绝不编造", () => {
    const { profile } = ok(parseResumeText(SAMPLE));
    for (const entry of [...profile.internships, ...profile.projects, ...profile.campus]) {
      expect(Object.values(entry.variants).every((v) => v === "")).toBe(true);
    }
  });

  it("敏感字段永远为空（不从简历正文提取）", () => {
    const { profile } = ok(parseResumeText(`${SAMPLE}\n身份证号：330106199001011234`));
    expect(profile.sensitive.idNumber).toBe("");
    expect(profile.sensitive.politicalStatus).toBe("");
    expect(profile.sensitive.maritalStatus).toBe("");
    expect(profile.sensitive.emergencyContact).toBe("");
  });

  it("Markdown 记号 + 全角空格 + 日期在行尾 也能解析", () => {
    const text = `# 李雷
**邮箱：lilei@example.com**

## 工作经历
XX集团 数据分析师 2022年3月-2024年6月
- 负责日活报表搭建，覆盖 20 个业务线

## 项目经验
用户增长看板
- 搭建看板，周活提升 15%
`;
    const { profile } = ok(parseResumeText(text));
    expect(profile.basic.name).toBe("李雷");
    expect(profile.basic.email).toBe("lilei@example.com");
    expect(profile.internships).toHaveLength(1);
    expect(profile.internships[0]!.company).toBe("XX集团");
    expect(profile.internships[0]!.position).toBe("数据分析师");
    expect(profile.internships[0]!.startDate).toBe("2022.03");
    expect(profile.internships[0]!.endDate).toBe("2024.06");
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]!.name).toBe("用户增长看板");
  });

  it("空行分隔的无日期条目按空行切分", () => {
    const text = `王五

校园经历

青年志愿者协会 外联部
· 组织志愿活动 8 场

摄影社团 社长
· 负责社团日常运营
`;
    const { profile } = ok(parseResumeText(text));
    expect(profile.campus).toHaveLength(2);
    expect(profile.campus[0]!.organization).toBe("青年志愿者协会");
    expect(profile.campus[1]!.organization).toBe("摄影社团");
  });

  it("识别不到经历条目时整体拒绝，不用垃圾内容覆盖资料", () => {
    const r = parseResumeText("随便写点什么，这不是简历。");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("")).toContain("没能识别出任何经历条目");
  });

  it("只有姓名没有经历 → 拒绝（姓名不足以判定为简历）", () => {
    const r = parseResumeText("张小明\n手机：15300001122");
    expect(r.ok).toBe(false);
  });

  it("空文本 → 拒绝", () => {
    expect(parseResumeText("").ok).toBe(false);
    expect(parseResumeText("   \n\n  ").ok).toBe(false);
  });

  it("分节标题不会被当成条目内容", () => {
    const { profile } = ok(parseResumeText(SAMPLE));
    expect(profile.internships[0]!.descriptionLong).not.toContain("实习经历");
    expect(profile.education[0]!.school).not.toContain("教育背景");
  });
});
