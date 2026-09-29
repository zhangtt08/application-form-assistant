import type { RiskLevel } from "../types/field";
import { normalizeText } from "../utils/normalizeText";

/**
 * 风险分级：
 *  - MANUAL_ONLY 命中关键词 → 恒为 MANUAL_ONLY（即使 matcher 已识别）。
 *  - 其余按 canonical field id 分组映射。
 *  - 未识别字段由 UI 显示 UNKNOWN 灰色（不属于三级 Risk）。
 */

/**
 * MANUAL_ONLY 关键词（normalize 后）。
 *
 * 这里只保留「不是资料、而是承诺或授权」的字段：勾选承诺、电子签名、同意调剂、
 * 背景调查授权、签证/工作许可声明等。它们没有对应的资料库内容，自动写等于替用户做承诺。
 *
 * 曾经被列入的政治面貌 / 身份证 / 婚姻状况 / 籍贯 / 户口 / 紧急联系人等，
 * 是资料库里就有的客观信息；按产品要求「识别到就填，不做人工确认」，
 * 它们现在走普通字段路径：资料库有值就填，没值就留空由用户自己补。
 */
const MANUAL_ONLY_KEYWORDS: string[] = [
  "竞业", "保密协议", "诚信",
  "本人承诺", "本人确认", "本人保证", "本人同意", "本人声明", "本人授权",
  "我承诺", "我确认", "我保证", "我同意", "我声明", "真实性", "属实", "法律声明", "上述信息",
  // 知情同意 / 协议勾选：替用户点同意是代做承诺，不属于「填资料」
  "已阅读", "同意并", "同意上述", "同意协议", "服务协议", "隐私政策", "用户协议", "consent", "terms",
  "declaration", "legally", "signature", "electronic signature", "e-signature", "签字", "签名",
  "调剂", "服从分配",
  "背景调查", "背调", "犯罪", "案底", "criminal", "background check",
  "sponsorship", "工作许可", "work authorization", "right to work", "visa",
];

/** REVIEW 级 canonical id：内容可自动准备，但必须逐项确认 */
const REVIEW_FIELD_IDS = new Set([
  "internship.description",
  "internship.responsibilities",
  "internship.workContent",
  "internship.achievements",
  "internship.summary",
  "campus.description",
  "campus.responsibilities",
  "campus.workContent",
  "campus.achievements",
  "campus.summary",
  "project.description",
  "project.background",
  "project.responsibilities",
  "project.workContent",
  "project.achievements",
  "project.summary",
  "skills.technical",
  "skills.tools",
  "skills.languages",
  "skills.certificates",
  "skills.awards",
  "job.expectedCity",
  "job.expectedPosition",
  "job.expectedSalary",
  "job.availableDate",
  "job.employmentType",
  "job.expectedIndustry",
  "content.selfIntroduction",
  "content.selfEvaluation",
  "content.personalAdvantages",
  "content.careerPlan",
  "content.hobbies",
]);

export interface RiskAssessment {
  risk: RiskLevel;
  reason: string;
}

/** 基于页面文本信号判断是否 MANUAL_ONLY（优先级最高） */
export function assessTextRisk(signals: {
  labelText: string;
  ariaLabel: string;
  placeholder: string;
  title: string;
  fieldsetLabel: string;
  sectionTitle: string;
}): RiskAssessment | null {
  const combined = normalizeText(
    [
      signals.labelText,
      signals.ariaLabel,
      signals.placeholder,
      signals.title,
      signals.fieldsetLabel,
      signals.sectionTitle,
    ].join(" | "),
  );
  for (const kw of MANUAL_ONLY_KEYWORDS) {
    if (combined.includes(normalizeText(kw))) {
      return { risk: "MANUAL_ONLY", reason: `页面文本命中敏感关键词「${kw}」` };
    }
  }
  return null;
}

/** 基于 canonical id 映射风险 */
export function riskOfFieldId(fieldId: string): RiskAssessment {
  if (fieldId.startsWith("sensitive.") || fieldId === "risk.manual") {
    return { risk: "MANUAL_ONLY", reason: "敏感字段：默认不自动填写" };
  }
  if (REVIEW_FIELD_IDS.has(fieldId)) {
    return { risk: "REVIEW", reason: "主观/偏好类内容：需逐项确认" };
  }
  if (
    fieldId.startsWith("basic.") ||
    fieldId.startsWith("education.") ||
    fieldId === "internship.company" ||
    fieldId === "internship.department" ||
    fieldId === "internship.position" ||
    fieldId === "internship.startDate" ||
    fieldId === "internship.endDate" ||
    fieldId === "campus.organization" ||
    fieldId === "campus.department" ||
    fieldId === "campus.position" ||
    fieldId === "campus.startDate" ||
    fieldId === "campus.endDate" ||
    fieldId === "project.name" ||
    fieldId === "project.role" ||
    fieldId === "project.startDate" ||
    fieldId === "project.endDate"
  ) {
    return { risk: "SAFE", reason: "客观事实类字段" };
  }
  return { risk: "REVIEW", reason: "未归类字段：保守处理为需确认" };
}

/** 组合评估：文本关键词优先，其次 canonical id */
export function assessRisk(
  fieldId: string,
  signals: Parameters<typeof assessTextRisk>[0],
): RiskAssessment {
  return assessTextRisk(signals) ?? riskOfFieldId(fieldId);
}
