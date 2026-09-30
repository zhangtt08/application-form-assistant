import { describe, expect, it } from "vitest";
import { matchField } from "../src/matching/matcher";
import type { RawField, RawFieldContext } from "../src/types/field";

/**
 * 真机标签回归：以下标签是从字节跳动校招官网前端产物（jobs.bytedance.com 页面内联的 SPA bundle）
 * 里抠出来的**实际文案**（2026-09-30 用 curl 取回 index.html 后 grep 引号串得到），不是编造的样本。
 * 字节跳动/小红书的可申请表单在登录后（游客不可达，见 §7 不存凭证），
 * 所以这一层是「字段识别」在国内主流平台上的可离线复现证据：站点加字段时这里会先红。
 */

function ctx(partial: Partial<RawFieldContext> = {}): RawFieldContext {
  return {
    labelText: "", placeholder: "", ariaLabel: "", name: "", id: "", title: "",
    fieldsetLabel: "", sectionTitle: "", prevSiblingText: "", parentText: "",
    autocomplete: "", inputType: "text", maxLength: null, required: false,
    disabled: false, readOnly: false, currentValue: "", ...partial,
  };
}

function text(labelText: string, inputType = "text", extra: Partial<RawFieldContext> = {}): RawField {
  return {
    reference: '{"tag":"input"}',
    kind: "text",
    context: ctx({ labelText, inputType, ...extra }),
    options: [],
  };
}

function select(labelText: string, options: string[], extra: Partial<RawFieldContext> = {}): RawField {
  return {
    reference: '{"tag":"select"}',
    kind: "select",
    context: ctx({ labelText, ...extra }),
    options,
  };
}

describe("字节跳动校招真机标签（官网 bundle 实际文案）", () => {
  it("个人信息类标签全部认得到", () => {
    const cases: [RawField, string][] = [
      [text("姓名"), "basic.name"],
      [text("手机号码", "tel"), "basic.phone"],
      [text("邮箱", "email"), "basic.email"],
      [select("婚姻状况", ["未婚", "已婚"]), "basic.maritalStatus"],
      [text("期望工作地点"), "job.expectedCity"],
    ];
    for (const [field, expected] of cases) {
      expect(matchField(field).fieldId, expected).toBe(expected);
    }
  });

  it("教育经历板块内的标签落到教育线", () => {
    const edu = { sectionTitle: "教育经历" };
    const cases: [RawField, string][] = [
      [text("学历", "text", edu), "education.degree"],
      [text("专业", "text", edu), "education.major"],
      [text("学校", "text", edu), "education.school"],
      [text("开始时间", "text", edu), "education.startDate"],
      [text("结束时间", "text", edu), "education.endDate"],
    ];
    for (const [field, expected] of cases) {
      expect(matchField(field).fieldId, `${field.context.labelText} → ${expected}`).toBe(expected);
    }
  });

  it("实习 / 项目板块内的同名字段各归各线（不会串经历）", () => {
    expect(matchField(text("公司名称", "text", { sectionTitle: "实习经历" })).fieldId).toBe("internship.company");
    expect(matchField(text("职位", "text", { sectionTitle: "实习经历" })).fieldId).toBe("internship.position");
    expect(matchField(text("职位描述", "textarea", { sectionTitle: "实习经历" })).fieldId).toBe("internship.responsibilities");
    expect(matchField(text("项目名称", "text", { sectionTitle: "项目经历" })).fieldId).toBe("project.name");
    expect(matchField(text("职位", "text", { sectionTitle: "项目经历" })).fieldId).toBe("project.role");
  });

  it("紧急联系人是「他人」信息，只认自己的两栏，关系一栏绝不代填", () => {
    expect(matchField(text("紧急联系人姓名")).fieldId).toBe("basic.emergencyContactName");
    expect(matchField(text("紧急联系人电话", "tel")).fieldId).toBe("basic.emergencyContactPhone");
    expect(matchField(text("紧急联系人与自己的关系")).fieldId).toBe("unknown");
    // 「姓名」二字不得从他人栏里抢走应聘者自己的名字
    expect(matchField(text("姓名", "text", { prevSiblingText: "紧急联系人信息" })).fieldId).not.toBe("basic.name");
  });

  it("户口/籍贯与「工作地点」不会互相抢，也不把应聘者的城市当工作地点", () => {
    // 「工作地点」是岗位属性，绝不能拿应聘者自己住在哪去填
    expect(matchField(text("工作地点")).fieldId).not.toBe("basic.city");
    expect(matchField(text("户口所在地")).fieldId).not.toBe("unknown");
  });

  it("内推码与证件类不在可填范围（保持 unknown，留人工）", () => {
    expect(matchField(text("内推码")).fieldId).toBe("unknown");
    expect(matchField(text("个人证件", "text", { sectionTitle: "上传附件" })).fieldId).toBe("unknown");
    // 「学历类型」问的是全日制/非全日制这类限定词，资料库没有这一栏，不能拿「学历」的值去顶
    expect(matchField(text("学历类型", "text", { sectionTitle: "教育经历" })).fieldId).toBe("unknown");
    // 而写法完整的「学位类型」是有槽位的，照常识别
    expect(matchField(text("学位类型", "text", { sectionTitle: "教育经历" })).fieldId).toBe("education.degreeType");
  });

  it("板块标题（bundle 里的「请填写XX」）指向的字段各有自己的槽位", () => {
    // 这些是站点板块名去掉「请填写」前缀后的真实字段名
    expect(matchField(text("自我评价")).fieldId).toBe("content.selfEvaluation");
    expect(matchField(text("语言能力")).fieldId).toBe("skills.languages");
    expect(matchField(text("获奖记录")).fieldId).toBe("skills.awards");
    // 「社交账号」资料库里没有对应栏位（微信/微博/抖音混在一起），不猜
    expect(matchField(text("请填写社交账号")).fieldId).toBe("unknown");
    // 简历导入把「工作经历」并进 internship 同一条线，所以工作经历板块按实习线填写是本产品的口径，
    // 不是错配；这条断言把该口径钉住，改动数据模型时必须一起改这里。
    expect(matchField(text("公司名称", "text", { sectionTitle: "工作经历" })).fieldId).toBe("internship.company");
  });
});
