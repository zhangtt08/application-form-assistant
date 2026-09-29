import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import { runScanPipeline } from "../src/pipeline/scanPipeline";
import { defaultProfile } from "../src/profile/defaultProfile";
import type { Profile, InternshipEntry } from "../src/types/profile";
import type { RawField, RawFieldContext } from "../src/types/field";
import cnResume from "./fixtures/cn-resume.json";
import { mapResumeJsonToProfile } from "../src/profile/importMapper";
import { validateProfile } from "../src/profile/schema";

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "",
    placeholder: "",
    ariaLabel: "",
    name: "",
    id: "",
    title: "",
    fieldsetLabel: "",
    sectionTitle: "",
    prevSiblingText: "",
    parentText: "",
    autocomplete: "",
    inputType: "text",
    maxLength: null,
    required: false,
    disabled: false,
    readOnly: false,
    currentValue: "",
    ...partial,
  };
}

function field(partial: { context?: Partial<RawFieldContext> }): RawField {
  return {
    reference: '{"tag":"input"}',
    kind: "text",
    context: ctx(partial.context),
    options: [],
  };
}

describe("语义槽位 section 归属（修复跨板块错配）", () => {
  it("section=项目经历 + 工作职责 → project.responsibilities（不再落实习）", () => {
    const m = matchField(field({ context: { labelText: "工作职责", sectionTitle: "项目经历" } }));
    expect(m.fieldId).toBe("project.responsibilities");
  });

  it("section=项目经历 + 工作内容/工作业绩/总结 → project 对应槽位", () => {
    expect(matchField(field({ context: { labelText: "工作内容", sectionTitle: "项目经历" } })).fieldId).toBe("project.workContent");
    expect(matchField(field({ context: { labelText: "工作业绩", sectionTitle: "项目经历" } })).fieldId).toBe("project.achievements");
    // 「收获与体会」无组前缀 → 由 section 决定归属；「实习收获」这类带前缀信号则信 label
    expect(matchField(field({ context: { labelText: "收获与体会", sectionTitle: "项目经历" } })).fieldId).toBe("project.summary");
  });

  it("section=校园经历 + 工作职责/工作内容 → campus 对应槽位", () => {
    expect(matchField(field({ context: { labelText: "工作职责", sectionTitle: "校园经历" } })).fieldId).toBe("campus.responsibilities");
    expect(matchField(field({ context: { labelText: "工作内容", sectionTitle: "校园经历" } })).fieldId).toBe("campus.workContent");
    expect(matchField(field({ context: { labelText: "工作业绩", sectionTitle: "校园经历" } })).fieldId).toBe("campus.achievements");
  });

  it("section=实习经历 + 工作职责 → internship.responsibilities（本组不受惩罚）", () => {
    const m = matchField(field({ context: { labelText: "工作职责", sectionTitle: "实习经历" } }));
    expect(m.fieldId).toBe("internship.responsibilities");
  });

  it("组合标题（教育及实习经历）不启用转移，实习字段不受惩罚", () => {
    const m = matchField(field({ context: { labelText: "工作职责", sectionTitle: "教育及实习经历" } }));
    expect(m.fieldId).toBe("internship.responsibilities");
  });

  it("section=项目经历 + 项目背景 → project.background", () => {
    expect(matchField(field({ context: { labelText: "项目背景", sectionTitle: "项目经历" } })).fieldId).toBe("project.background");
  });
});

describe("多条目 entryIndex 轮转分配（修复重复块错位）", () => {
  function internProfile(): Profile {
    const p = structuredClone(defaultProfile);
    const mk = (company: string, position: string): InternshipEntry => ({
      company, department: "", position, startDate: "", endDate: "",
      descriptionShort: "", descriptionMedium: "", descriptionLong: "",
      responsibilities: "", workContent: "", achievements: "", summary: "",
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    });
    p.internships = [mk("公司一", "岗位一"), mk("公司二", "岗位二"), mk("公司三", "岗位三")];
    return p;
  }

  it("同 id 重复字段按 DOM 序取第 1/2/3 条经历", () => {
    const raws = [
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "岗位" } }),
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "岗位" } }),
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "岗位" } }),
    ];
    const cands = runScanPipeline(raws, internProfile());
    expect(cands[0]?.value?.value).toBe("公司一");
    expect(cands[1]?.value?.value).toBe("岗位一");
    expect(cands[2]?.value?.value).toBe("公司二");
    expect(cands[3]?.value?.value).toBe("岗位二");
    expect(cands[4]?.value?.value).toBe("公司三");
    expect(cands[5]?.value?.value).toBe("岗位三");
  });

  it("字段集合不齐时每 id 独立计数仍对齐", () => {
    // 第二条经历没有「岗位」字段：公司仍按序 0/1
    const raws = [
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "岗位" } }),
      field({ context: { labelText: "公司" } }),
    ];
    const cands = runScanPipeline(raws, internProfile());
    expect(cands[0]?.value?.value).toBe("公司一");
    expect(cands[1]?.value?.value).toBe("岗位一");
    expect(cands[2]?.value?.value).toBe("公司二");
  });

  it("单条目字段（basic.*）不受轮转影响", () => {
    const p = internProfile();
    p.basic.name = "张三";
    const raws = [
      field({ context: { labelText: "姓名" } }),
      field({ context: { labelText: "姓名" } }),
    ];
    const cands = runScanPipeline(raws, p);
    expect(cands[0]?.value?.value).toBe("张三");
    expect(cands[1]?.value?.value).toBe("张三");
  });

  it("经历条数不足时多余表单块留空（绝不把最后一条重复填进每一块）", () => {
    const p = internProfile();
    p.internships = p.internships.slice(0, 2); // 只有 2 条
    const raws = [
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "公司" } }),
      field({ context: { labelText: "公司" } }),
    ];
    const cands = runScanPipeline(raws, p);
    expect(cands[0]?.value?.value).toBe("公司一");
    expect(cands[1]?.value?.value).toBe("公司二");
    expect(cands[2]?.value).toBeUndefined(); // 第 3 块没有对应资料 → 不填
    expect(cands[2]?.status).toBe("empty");
  });
});

describe("完整中文简历 fixture 导入（逐条逐槽位回归）", () => {
  const mapped = mapResumeJsonToProfile(cnResume);

  it("映射成功且通过 validateProfile 复检", () => {
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(validateProfile(mapped.profile).ok).toBe(true);
  });

  it("三条实习逐条落位（错位回归）", () => {
    if (!mapped.ok) throw new Error("should map");
    const list = mapped.profile.internships;
    expect(list).toHaveLength(3);
    expect(list[0]?.company).toBe("示例科技有限公司");
    expect(list[0]?.position).toBe("AI 应用实习生");
    expect(list[0]?.responsibilities).toContain("职责A1");
    expect(list[0]?.workContent).toContain("内容A1");
    expect(list[0]?.achievements).toContain("业绩A1");
    expect(list[0]?.summary).toBe("实习A收获");
    expect(list[0]?.descriptionShort).toBe("A短描述");
    expect(list[1]?.company).toBe("示例互动有限公司");
    expect(list[1]?.position).toBe("短视频剪辑与运营");
    expect(list[1]?.responsibilities).toContain("职责B1");
    expect(list[1]?.summary).toBe("实习B收获");
    expect(list[2]?.company).toBe("示例水务有限公司");
    expect(list[2]?.position).toBe("品牌专员");
    expect(list[2]?.workContent).toContain("内容C1");
  });

  it("两条校园逐条落位", () => {
    if (!mapped.ok) throw new Error("should map");
    const list = mapped.profile.campus;
    expect(list).toHaveLength(2);
    expect(list[0]?.organization).toBe("班级");
    expect(list[0]?.position).toBe("学习委员");
    expect(list[0]?.responsibilities).toContain("班级职责");
    expect(list[0]?.summary).toBe("班级收获");
    expect(list[1]?.organization).toBe("青年志愿者协会");
    expect(list[1]?.department).toBe("宣传部");
    expect(list[1]?.responsibilities).toContain("志愿职责");
  });

  it("两条项目逐条落位（背景/职责/内容/成果/概述）", () => {
    if (!mapped.ok) throw new Error("should map");
    const list = mapped.profile.projects;
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe("示例流程自动化系统");
    expect(list[0]?.background).toBe("项目A背景");
    expect(list[0]?.responsibilities).toContain("项目A职责1");
    expect(list[0]?.workContent).toContain("项目A内容1");
    expect(list[0]?.achievements).toContain("项目A成果1");
    expect(list[0]?.summary).toBe("项目A概述");
    expect(list[0]?.descriptionLong).toBe("PA长");
    expect(list[1]?.name).toBe("示例 AI 作品集网站");
    expect(list[1]?.background).toBe("项目B背景");
    expect(list[1]?.summary).toBe("项目B概述");
  });

  it("常用文本五块全部落位", () => {
    if (!mapped.ok) throw new Error("should map");
    const c = mapped.profile.content;
    expect(c.selfIntroduction.long).toBe("介长");
    expect(c.selfEvaluation.medium).toBe("评中");
    expect(c.personalAdvantages.short).toBe("优短");
    expect(c.careerPlan.long).toBe("规长");
    expect(c.hobbies.short).toBe("趣短");
  });

  it("技能与求职期望落位", () => {
    if (!mapped.ok) throw new Error("should map");
    expect(mapped.profile.skills.technical).toContain("RAG知识库构建");
    expect(mapped.profile.skills.certificates).toContain("C1驾照");
    expect(mapped.profile.jobPreferences.expectedPosition).toEqual(["AI应用", "AI运营", "业务自动化"]);
    expect(mapped.profile.jobPreferences.availableDate).toBe("2027年毕业后，具体可协商");
  });
});
