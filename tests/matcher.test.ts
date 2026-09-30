import { describe, expect, it } from "vitest";
import { matchField, confidenceLevel } from "../src/matching/matcher";
import { assessRisk, riskOfFieldId } from "../src/rules/riskRules";
import { normalizeText, deCamelize } from "../src/utils/normalizeText";
import type { RawField, RawFieldContext } from "../src/types/field";

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

function field(partial: { context?: Partial<RawFieldContext>; options?: string[] }): RawField {
  return {
    reference: '{"tag":"input"}',
    kind: "text",
    context: ctx(partial.context),
    options: partial.options ?? [],
  };
}

describe("文本标准化", () => {
  it("去星号/冒号/空白", () => {
    expect(normalizeText("* 手机号码：")).toBe("手机号码");
    expect(normalizeText("  邮箱（必填）: ")).toBe("邮箱");
    expect(normalizeText("ＥｍａｉｌＡｄｄｒｅｓｓ")).toBe("emailaddress");
  });
  it("驼峰展开", () => {
    expect(deCamelize("phoneNumber")).toBe("phone number");
    expect(deCamelize("user_phone_number")).toBe("user phone number");
  });
});

describe("字段映射（验收 2）", () => {
  it("手机号 → basic.phone", () => {
    const m = matchField(field({ context: { labelText: "手机号" } }));
    expect(m.fieldId).toBe("basic.phone");
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("联系电话 → basic.phone", () => {
    const m = matchField(field({ context: { labelText: "联系电话" } }));
    expect(m.fieldId).toBe("basic.phone");
  });

  it("Mobile Phone (placeholder) → basic.phone", () => {
    const m = matchField(field({ context: { placeholder: "Mobile Phone" } }));
    expect(m.fieldId).toBe("basic.phone");
  });

  it("name=phoneNumber（驼峰）→ basic.phone", () => {
    const m = matchField(field({ context: { name: "phoneNumber" } }));
    expect(m.fieldId).toBe("basic.phone");
  });

  it("学校 → education.school", () => {
    const m = matchField(field({ context: { labelText: "学校名称" } }));
    expect(m.fieldId).toBe("education.school");
  });

  it("毕业院校 → education.school", () => {
    const m = matchField(field({ context: { labelText: "毕业院校" } }));
    expect(m.fieldId).toBe("education.school");
  });

  it("University (aria-label) → education.school", () => {
    const m = matchField(field({ context: { ariaLabel: "University" } }));
    expect(m.fieldId).toBe("education.school");
  });

  it("section=教育经历 + label=学校 → education.school 加成", () => {
    const m = matchField(field({ context: { labelText: "学校", sectionTitle: "教育经历" } }));
    expect(m.fieldId).toBe("education.school");
    expect(m.evidence.some((e) => e.startsWith("section="))).toBe(true);
  });

  it("邮箱 input type=email 无 label → basic.email (type-hint)", () => {
    const m = matchField(field({ context: { inputType: "email" } }));
    expect(m.fieldId).toBe("basic.email");
    expect(m.matchedBy).toBe("type-hint");
  });
});

describe("低置信度保护（验收 3）", () => {
  it("『其他信息』→ unknown", () => {
    const m = matchField(field({ context: { labelText: "其他信息" } }));
    expect(m.fieldId).toBe("unknown");
    expect(m.confidence).toBeLessThan(0.7);
  });

  it("『补充内容』→ unknown", () => {
    const m = matchField(field({ context: { labelText: "补充内容" } }));
    expect(m.fieldId).toBe("unknown");
  });

  it("空信号 → unknown", () => {
    const m = matchField(field({}));
    expect(m.fieldId).toBe("unknown");
    expect(m.confidence).toBe(0);
  });

  it("『描述』裸词在语义拆分后不再强行归属（歧义 → unknown，fail-safe）", () => {
    // 语义拆分后「实习描述」「项目描述」各有明确词表，裸「描述」无法区分归属
    // → 两个候选同分冲突，宁可 unknown 让用户手动指派，绝不猜
    const noSection = matchField(field({ context: { labelText: "描述" } }));
    expect(noSection.fieldId).toBe("unknown");

    const withSection = matchField(
      field({ context: { labelText: "描述", sectionTitle: "实习经历" } }),
    );
    expect(withSection.fieldId).toBe("unknown");
  });

  it("笼统描述栏有明确词 → 正确归属", () => {
    expect(matchField(field({ context: { labelText: "实习描述", sectionTitle: "实习经历" } })).fieldId).toBe("internship.description");
    expect(matchField(field({ context: { labelText: "实习内容" } })).fieldId).toBe("internship.description");
    expect(matchField(field({ context: { labelText: "项目介绍" } })).fieldId).toBe("project.description");
  });
});

describe("置信度分级", () => {
  it("HIGH/MEDIUM/LOW 边界", () => {
    expect(confidenceLevel(0.98)).toBe("HIGH");
    expect(confidenceLevel(0.9)).toBe("HIGH");
    expect(confidenceLevel(0.89)).toBe("MEDIUM");
    expect(confidenceLevel(0.7)).toBe("MEDIUM");
    expect(confidenceLevel(0.69)).toBe("LOW");
  });
});

describe("风险分级（验收 5 · 一键填写策略）", () => {
  it("政治面貌 → 不再是人工专属：匹配到 basic.politicalStatus 后按资料库填写", () => {
    const r = assessRisk("basic.politicalStatus", {
      labelText: "政治面貌",
      ariaLabel: "",
      placeholder: "",
      title: "",
      fieldsetLabel: "",
      sectionTitle: "",
    });
    expect(r.risk).toBe("SAFE");
    expect(matchField(field({ context: { labelText: "政治面貌" } })).fieldId).toBe("basic.politicalStatus");
  });

  it("身份证号码 → 匹配 basic.idNumber 并按资料库填写（无值时留空，不猜）", () => {
    const r = assessRisk("basic.idNumber", {
      labelText: "身份证号码",
      ariaLabel: "",
      placeholder: "",
      title: "",
      fieldsetLabel: "",
      sectionTitle: "",
    });
    expect(r.risk).toBe("SAFE");
    expect(matchField(field({ context: { labelText: "身份证号码" } })).fieldId).toBe("basic.idNumber");
  });

  it("是否接受调剂 → MANUAL_ONLY（替用户做承诺，不是资料）", () => {
    const r = assessRisk("unknown", {
      labelText: "是否接受岗位调剂",
      ariaLabel: "",
      placeholder: "",
      title: "",
      fieldsetLabel: "",
      sectionTitle: "",
    });
    expect(r.risk).toBe("MANUAL_ONLY");
  });

  it("法律声明 / 电子签名 / 诚信确认 → MANUAL_ONLY", () => {
    for (const label of ["法律声明", "电子签名", "诚信确认", "本人确认以上信息属实"]) {
      const r = assessRisk("unknown", {
        labelText: label,
        ariaLabel: "",
        placeholder: "",
        title: "",
        fieldsetLabel: "",
        sectionTitle: "",
      });
      expect(r.risk).toBe("MANUAL_ONLY");
    }
  });

  it("知情同意 / 协议勾选 → MANUAL_ONLY（替用户点同意不是填资料）", () => {
    for (const label of ["我已阅读并同意招聘服务协议", "同意上述条款", "本人已阅读隐私政策", "accept terms"]) {
      const r = assessRisk("unknown", {
        labelText: label,
        ariaLabel: "",
        placeholder: "",
        title: "",
        fieldsetLabel: "",
        sectionTitle: "",
      });
      expect(r.risk).toBe("MANUAL_ONLY");
    }
  });

  it("sensitive.idNumber → MANUAL_ONLY（旧敏感 id 永不自动写）", () => {
    expect(riskOfFieldId("sensitive.idNumber").risk).toBe("MANUAL_ONLY");
  });

  it("户口 / 户籍 / 家庭住址 → 匹配到资料库字段，不再一律人工", () => {
    const cases: [string, string][] = [
      ["户口所在地", "basic.hukou"],
      ["户籍地址", "basic.hukou"],
      ["家庭住址", "basic.address"],
    ];
    for (const [label, fieldId] of cases) {
      const r = assessRisk(fieldId, {
        labelText: label,
        ariaLabel: "",
        placeholder: "",
        title: "",
        fieldsetLabel: "",
        sectionTitle: "",
      });
      expect(r.risk).toBe("SAFE");
      expect(matchField(field({ context: { labelText: label } })).fieldId).toBe(fieldId);
    }
  });

  it("单选组不因容器里出现隔壁字段标签而误配（姚记真机回归）", () => {
    const m = matchField({
      reference: "{}",
      kind: "radio",
      context: ctx({
        labelText: "是否接受线下面试",
        parentText: "政治面貌 身份证号 是否接受线下面试 期望城市",
      }),
      options: ["是", "否"],
    });
    expect(m.fieldId).not.toBe("basic.politicalStatus");
    // 真实岗位偏好题：识别成 job.acceptOfflineInterview，资料库里答过一次即可自动勾选
    expect(m.fieldId).toBe("job.acceptOfflineInterview");
    expect(riskOfFieldId("job.acceptOfflineInterview").risk).toBe("SAFE");
  });

  it("basic.name → SAFE；content.selfEvaluation → REVIEW", () => {
    expect(riskOfFieldId("basic.name").risk).toBe("SAFE");
    expect(riskOfFieldId("content.selfEvaluation").risk).toBe("REVIEW");
    expect(riskOfFieldId("job.expectedSalary").risk).toBe("REVIEW");
  });

  it("internship.department → SAFE（客观事实类）", () => {
    expect(riskOfFieldId("internship.department").risk).toBe("SAFE");
  });
});

describe("词表泛化回归（常见 ATS 标签）", () => {
  it("工作职责 / 岗位职责 → internship.responsibilities；工作内容 → internship.workContent", () => {
    for (const label of ["工作职责", "岗位职责", "职责描述", "主要职责"]) {
      const m = matchField(field({ context: { labelText: label } }));
      expect(m.fieldId).toBe("internship.responsibilities");
    }
    for (const label of ["工作内容", "主要工作内容", "具体工作内容"]) {
      const m = matchField(field({ context: { labelText: label } }));
      expect(m.fieldId).toBe("internship.workContent");
    }
  });

  it("工作业绩 → internship.achievements；实习总结 → internship.summary", () => {
    for (const label of ["工作业绩", "主要业绩", "工作成果", "工作亮点"]) {
      const m = matchField(field({ context: { labelText: label } }));
      expect(m.fieldId).toBe("internship.achievements");
    }
    for (const label of ["实习总结", "实习收获", "工作收获", "心得体会"]) {
      const m = matchField(field({ context: { labelText: label } }));
      expect(m.fieldId).toBe("internship.summary");
    }
  });

  it("项目背景 / 项目职责 / 项目成果 → project 对应语义槽位", () => {
    expect(matchField(field({ context: { labelText: "项目背景" } })).fieldId).toBe("project.background");
    expect(matchField(field({ context: { labelText: "项目工作职责" } })).fieldId).toBe("project.responsibilities");
    expect(matchField(field({ context: { labelText: "项目内容" } })).fieldId).toBe("project.workContent");
    expect(matchField(field({ context: { labelText: "项目成果" } })).fieldId).toBe("project.achievements");
    expect(matchField(field({ context: { labelText: "项目总结" } })).fieldId).toBe("project.summary");
  });

  it("校园经历语义槽位 → campus.*", () => {
    expect(matchField(field({ context: { labelText: "学生工作职责" } })).fieldId).toBe("campus.responsibilities");
    expect(matchField(field({ context: { labelText: "学生工作内容" } })).fieldId).toBe("campus.workContent");
  });

  it("纯教育板块的时间栏归教育线；混合标题不替用户猜是哪一段经历", () => {
    // 真机字节跳动：教育经历下的「开始时间」原来被实习线词表抢走
    expect(matchField(field({ context: { labelText: "开始时间", sectionTitle: "教育经历" } })).fieldId).toBe("education.startDate");
    expect(matchField(field({ context: { labelText: "结束时间", sectionTitle: "教育经历" } })).fieldId).toBe("education.endDate");
    // 「教育及实习经历」两段共用一个板块，转移会把时间判给教育线 → 保持既有行为，不启用
    expect(matchField(field({ context: { labelText: "开始时间", sectionTitle: "教育及实习经历" } })).fieldId).not.toBe("education.startDate");
  });

  it("板块写着实习经历时，时间栏仍归实习线", () => {
    expect(matchField(field({ context: { labelText: "开始时间", sectionTitle: "实习经历" } })).fieldId).toBe("internship.startDate");
  });

  it("placeholder『请输入工作内容』→ internship.workContent", () => {
    const m = matchField(field({ context: { placeholder: "请输入工作内容" } }));
    expect(m.fieldId).toBe("internship.workContent");
  });

  it("部门 / 所在部门 → internship.department；英文 department 歧义时不强配", () => {
    expect(matchField(field({ context: { labelText: "部门" } })).fieldId).toBe("internship.department");
    expect(matchField(field({ context: { labelText: "所在部门" } })).fieldId).toBe("internship.department");
  });

  it("项目详情 / 项目经历描述 → project.description；项目收获 → project.achievements", () => {
    for (const label of ["项目详情", "项目经历描述"]) {
      expect(matchField(field({ context: { labelText: label } })).fieldId).toBe("project.description");
    }
    expect(matchField(field({ context: { labelText: "项目收获" } })).fieldId).toBe("project.achievements");
  });

  it("应聘岗位 / 求职岗位 → job.expectedPosition", () => {
    for (const label of ["应聘岗位", "求职岗位", "申请职位"]) {
      expect(matchField(field({ context: { labelText: label } })).fieldId).toBe("job.expectedPosition");
    }
  });

  it("联系方式 → basic.phone；联系邮箱 → basic.email", () => {
    expect(matchField(field({ context: { labelText: "联系方式" } })).fieldId).toBe("basic.phone");
    expect(matchField(field({ context: { labelText: "联系邮箱" } })).fieldId).toBe("basic.email");
  });

  it("预计毕业时间 → education.endDate；入学年月 → education.startDate", () => {
    expect(matchField(field({ context: { labelText: "预计毕业时间" } })).fieldId).toBe("education.endDate");
    expect(matchField(field({ context: { labelText: "入学年月" } })).fieldId).toBe("education.startDate");
  });

  it("自我总结 → content.selfEvaluation；职业目标 → content.careerPlan", () => {
    expect(matchField(field({ context: { labelText: "自我总结" } })).fieldId).toBe("content.selfEvaluation");
    expect(matchField(field({ context: { labelText: "职业目标" } })).fieldId).toBe("content.careerPlan");
  });

  it("『其他信息』『补充内容』仍为 unknown（未误伤泛化词表）", () => {
    expect(matchField(field({ context: { labelText: "其他信息" } })).fieldId).toBe("unknown");
    expect(matchField(field({ context: { labelText: "补充内容" } })).fieldId).toBe("unknown");
  });

  it("Profile 新增槽位的别名词表", () => {
    expect(matchField(field({ context: { labelText: "年龄" } })).fieldId).toBe("basic.age");
    expect(matchField(field({ context: { labelText: "QQ号" } })).fieldId).toBe("basic.qq");
    expect(matchField(field({ context: { labelText: "作品集链接" } })).fieldId).toBe("basic.portfolio");
    expect(matchField(field({ context: { labelText: "获奖情况" } })).fieldId).toBe("skills.awards");
    expect(matchField(field({ context: { labelText: "兴趣爱好" } })).fieldId).toBe("content.hobbies");
    expect(matchField(field({ context: { labelText: "期望行业" } })).fieldId).toBe("job.expectedIndustry");
    expect(matchField(field({ context: { labelText: "社团经历" } })).fieldId).toBe("campus.description");
    expect(matchField(field({ context: { labelText: "社团名称" } })).fieldId).toBe("campus.organization");
  });

  it("qq邮箱 → basic.email（不会被 qq 号词表抢走）", () => {
    const m = matchField(field({ context: { labelText: "QQ邮箱" } }));
    expect(m.fieldId).toBe("basic.email");
  });
});
