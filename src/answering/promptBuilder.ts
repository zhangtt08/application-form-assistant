import type { AnswerGenerationInput, AnswerLengthConstraint } from "./types";

/**
 * Answer Prompt（spec Stage 4 第十二~十三章）：
 * PERSONAL_FACTS / COMPANY_FACTS / JD_REQUIREMENTS 三块严格分离；
 * 证据不足必须返回 insufficient_context；明确 maximumCharacters；
 * 输出结构化 JSON。Mock Provider 复用 [FACTS_BEGIN] 块格式，并解析 [INTENT] 行。
 */

export const ANSWER_PROMPT_VERSION = "answer-engine-v1";

export function buildAnswerPrompt(input: AnswerGenerationInput): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "你正在回答求职申请表中的开放式问题。",
    "个人事实只能来自 PERSONAL_FACTS。",
    "公司事实只能来自 COMPANY_FACTS（通常只有公司名称，不足以评价公司本身）。",
    "JD_REQUIREMENTS 仅描述岗位要求，不代表用户已经拥有相关经验。",
    "禁止将 JD 要求改写成用户经历。",
    "禁止编造：工作年限、技术栈、项目、成果、数字、团队规模、职责、兴趣经历、公司信息、企业文化、职业目标、个人偏好。",
    "如果证据不足以支撑回答（例如缺少职业规划配置、缺少公司具体信息），输出 status=insufficient_context 并在 missingContext 中列出缺失项，不要编造。",
    "回答必须符合 maximumCharacters 字数上限，禁止超长。",
    "必须输出 JSON：{\"answer\": string, \"usedPersonalFactIds\": string[], \"usedCompanyFactIds\": string[], \"addressedRequirements\": string[], \"unsupportedRequirements\": string[], \"status\": \"generated\" | \"insufficient_context\", \"missingContext\": string[]}",
  ].join("\n");

  const req = input.jobRequirements;
  const factLines = input.personalFacts.map((f) => `${f.id} | ${f.type} | ${f.text}`);
  const companyLines = input.companyFacts.map((f) => `${f.id} | ${f.type} | ${f.text}`);

  const userPrompt = [
    `[INTENT] ${input.intent}`,
    `[QUESTION] ${input.question}`,
    `[MAXIMUM_CHARACTERS] ${input.length.targetCharacters}`,
    `[LANGUAGE] ${input.language}`,
    "[JD_REQUIREMENTS]",
    `hardSkills: ${req.hardSkills.join("、") || "（无）"}`,
    `responsibilities: ${req.responsibilities.join("；") || "（无）"}`,
    "[PERSONAL_FACTS_BEGIN]",
    ...factLines,
    "[PERSONAL_FACTS_END]",
    "[COMPANY_FACTS_BEGIN]",
    ...companyLines,
    "[COMPANY_FACTS_END]",
    "[OUTPUT_FORMAT]",
    '只输出 JSON：{"answer": "...", "usedPersonalFactIds": [...], "usedCompanyFactIds": [...], "addressedRequirements": [...], "unsupportedRequirements": [...], "status": "generated", "missingContext": []}',
  ].join("\n");

  return { systemPrompt, userPrompt };
}

/** 从 answer prompt 的 PERSONAL_FACTS 块解析事实（Mock Provider 复用） */
export function parseAnswerFacts(userPrompt: string, begin: string, end: string): { id: string; text: string }[] {
  const facts: { id: string; text: string }[] = [];
  let inBlock = false;
  for (const line of userPrompt.split("\n")) {
    if (line.includes(begin)) {
      inBlock = true;
      continue;
    }
    if (line.includes(end)) break;
    if (!inBlock) continue;
    const m = line.match(/^(fact_\d+|career_\d+|company_\d+)\s*\|\s*\w+\s*\|\s*(.+)$/);
    if (m && m[1] && m[2]) facts.push({ id: m[1], text: m[2] });
  }
  return facts;
}

/** 长度档位目标（spec 二十：目标不是硬截断） */
export function lengthTarget(constraint: AnswerLengthConstraint): number {
  if (constraint.maxLength != null) return constraint.maxLength;
  switch (constraint.preset) {
    case "short": return 150;
    case "detailed": return 500;
    default: return 300;
  }
}

export function lengthPresetLabel(preset: AnswerLengthConstraint["preset"]): string {
  switch (preset) {
    case "short": return "简短（100-150 字）";
    case "detailed": return "详细（400-500 字）";
    default: return "标准（200-300 字）";
  }
}

