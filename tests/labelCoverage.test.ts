import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 中文网申常见标签覆盖面。
 *
 * 词条来源：三个真机站点（姚记 / Lever / Greenhouse）实际渲染出来的字段文案，
 * 加上国内校招网申的高频问法。这一张表的作用是：**任何一条掉进 unknown，测试就红**，
 * 而不是等用户在某个网站上发现「识别不了」。
 *
 * 明确允许 unknown 的只有两类：资料库里根本没有来源的东西（生源地证明、内推码…），
 * 以及「不该代填」的东西（民族等自证类、承诺类）。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function f(label: string, extra: Partial<RawFieldContext> = {}, kind: RawField["kind"] = "text"): RawField {
  return { reference: "{}", kind, context: ctx({ labelText: label, ...extra }), options: [] };
}

const CASES: [string, string][] = [
  // 基本信息
  ["姓名", "basic.name"],
  ["应聘者姓名", "basic.name"],
  ["性别", "basic.gender"],
  ["出生日期", "basic.birthDate"],
  ["年龄", "basic.age"],
  ["手机号", "basic.phone"],
  ["联系电话", "basic.phone"],
  ["电子邮箱", "basic.email"],
  ["微信号", "basic.wechat"],
  ["QQ号", "basic.qq"],
  ["现居住地", "basic.city"],
  ["家庭住址", "basic.address"],
  ["籍贯", "basic.nativePlace"],
  ["户口所在地", "basic.hukou"],
  ["政治面貌", "basic.politicalStatus"],
  ["婚姻状况", "basic.maritalStatus"],
  ["身份证号码", "basic.idNumber"],
  ["身高", "basic.height"],
  ["体重", "basic.weight"],
  ["工作年限", "basic.workYears"],
  ["个人主页", "basic.portfolio"],
  // 教育经历
  ["学校名称", "education.school"],
  ["毕业院校", "education.school"],
  ["所在院系", "education.college"],
  ["专业", "education.major"],
  ["最高学历", "education.degree"],
  ["学位", "education.degreeType"],
  ["入学时间", "education.startDate"],
  ["毕业时间", "education.endDate"],
  ["GPA", "education.gpa"],
  ["专业排名", "education.rank"],
  // 经历
  ["公司名称", "internship.company"],
  ["实习单位", "internship.company"],
  ["职位名称", "internship.position"],
  ["实习岗位", "internship.position"],
  ["开始时间", "internship.startDate"],
  ["结束时间", "internship.endDate"],
  ["工作内容", "internship.workContent"],
  ["工作描述", "internship.description"],
  ["项目名称", "project.name"],
  ["项目描述", "project.description"],
  ["担任职务", "internship.position"],
  ["社团名称", "campus.organization"],
  // 技能与证书
  ["专业技能", "skills.technical"],
  ["证书名称", "skills.certificates"],
  ["英语等级", "skills.certificates"],
  ["计算机等级", "skills.certificates"],
  ["获奖情况", "skills.awards"],
  // 求职意向
  ["期望工作城市", "job.expectedCity"],
  ["期望职位", "job.expectedPosition"],
  ["期望薪资", "job.expectedSalary"],
  ["到岗时间", "job.availableDate"],
  ["工作性质", "job.employmentType"],
  ["期望行业", "job.expectedIndustry"],
  // 长文本
  ["自我介绍", "content.selfIntroduction"],
  ["自我评价", "content.selfEvaluation"],
  ["个人优势", "content.personalAdvantages"],
  ["职业规划", "content.careerPlan"],
  ["兴趣爱好", "content.hobbies"],
  // 他人信息（有专属 canonical，不能被本人资料顶替）
  ["紧急联系人", "basic.emergencyContactName"],
  ["紧急联系人电话", "basic.emergencyContactPhone"],
];

describe("中文网申标签覆盖面", () => {
  it("高频标签逐条落到正确的 canonical", () => {
    const wrong: string[] = [];
    for (const [label, expected] of CASES) {
      const got = matchField(f(label)).fieldId;
      if (got !== expected) wrong.push(`${label}: 期望 ${expected}，实际 ${got}`);
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("「担任职务」这类两边都用的标签靠所在板块消歧", () => {
    // 没有板块信息时落在实习线；站点标了校园经历就要落到校园线
    expect(matchField(f("担任职务")).fieldId).toBe("internship.position");
    expect(matchField(f("担任职务", { sectionTitle: "校园经历 / 学生会" })).fieldId).toBe("campus.position");
  });

  it("资料库没有来源 / 不该代填的标签保持 unknown", () => {
    for (const label of ["内推码", "推荐人姓名", "民族", "已阅读并同意《用户协议》", "本人承诺以上信息真实"]) {
      expect(matchField(f(label)).fieldId, label).toBe("unknown");
    }
  });
});
