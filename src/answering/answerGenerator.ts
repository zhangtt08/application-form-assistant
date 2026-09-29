import { validateAnswer } from "./answerValidator";
import { ANSWER_PROMPT_VERSION, buildAnswerPrompt, lengthTarget } from "./promptBuilder";
import { createProvider } from "../generation/provider";
import type { Fact, JobRequirementProfile } from "../generation/types";
import type { AnswerGenerationInput, AnswerLengthConstraint, AnswerStatus, StructuredAnswer } from "./types";
import { trace } from "../utils/trace";

/**
 * Answer Generator（spec Stage 4 第一章架构）：
 * Question + Intent + Facts（personal/company 分离）→ LLM → StructuredAnswer → Validation。
 * career_plan 且无 careerPreferences 时本地直接判 insufficient_context，不调用 LLM（spec 第十四章）。
 */

export interface GenerateAnswerArgs {
  question: string;
  intent: string;
  jobRequirements: JobRequirementProfile;
  personalFacts: Fact[];
  companyFacts: Fact[];
  careerFacts: Fact[];
  length: AnswerLengthConstraint;
}

export interface AnswerGenerationResult {
  structured: StructuredAnswer;
  validation: import("./types").AnswerValidationReport;
  promptVersion: string;
  provider: string;
  model: string | null;
  durationMs: number;
}

function parseAnswerResponse(text: string): StructuredAnswer {
  let parsed: unknown;
  try {
    const cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*|\s*```[\s\S]*$/g, "").trim();
    parsed = JSON.parse(cleaned.includes("{") ? cleaned : text);
  } catch {
    const err = new Error("Answer 输出不是合法 JSON") as Error & { code?: string };
    err.code = "ANSWER_INVALID_OUTPUT";
    throw err;
  }
  const rec = parsed as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const status: AnswerStatus = rec.status === "insufficient_context" ? "insufficient_context" : "generated";
  const answer = typeof rec.answer === "string" ? rec.answer : "";
  if (status === "generated" && !answer.trim()) {
    const err = new Error("answer 为空") as Error & { code?: string };
    err.code = "ANSWER_INVALID_OUTPUT";
    throw err;
  }
  return {
    answer,
    usedPersonalFactIds: arr(rec.usedPersonalFactIds),
    usedCompanyFactIds: arr(rec.usedCompanyFactIds),
    addressedRequirements: arr(rec.addressedRequirements),
    unsupportedRequirements: arr(rec.unsupportedRequirements),
    status,
    missingContext: arr(rec.missingContext),
  };
}

/** 本地 insufficient_context 判定：career_plan 无 career facts（spec 十四：不要强行回答） */
export function requiresInsufficientContext(
  intent: string,
  careerFacts: Fact[],
): { insufficient: boolean; missing: string[] } {
  if (intent === "career_plan" && careerFacts.length === 0) {
    return { insufficient: true, missing: ["career_goal"] };
  }
  return { insufficient: false, missing: [] };
}

export async function generateAnswer(args: GenerateAnswerArgs): Promise<AnswerGenerationResult> {
  // 本地 insufficient 判定：不调用 LLM
  const localInsufficient = requiresInsufficientContext(args.intent, args.careerFacts);
  const length: AnswerLengthConstraint = args.length;
  const input: AnswerGenerationInput = {
    question: args.question,
    intent: args.intent as AnswerGenerationInput["intent"],
    jobRequirements: args.jobRequirements,
    personalFacts: args.personalFacts,
    companyFacts: args.companyFacts,
    length,
    language: "zh-CN",
    tone: "sincere",
  };

  if (localInsufficient.insufficient) {
    const structured: StructuredAnswer = {
      answer: "",
      usedPersonalFactIds: [],
      usedCompanyFactIds: [],
      addressedRequirements: [],
      unsupportedRequirements: [],
      status: "insufficient_context",
      missingContext: localInsufficient.missing,
    };
    await trace("ANSWER_GENERATE", "info", `insufficient_context missing=${localInsufficient.missing.join(",")}`, {
      intent: args.intent,
    });
    return {
      structured,
      validation: {
        baseStatus: "pass",
        claims: [],
        companyClaims: [],
        careerClaims: [],
        preferenceClaims: [],
        length: { current: 0, target: lengthTarget(length), exceeded: false },
        overall: "review",
      },
      promptVersion: ANSWER_PROMPT_VERSION,
      provider: "local-rule",
      model: null,
      durationMs: 0,
    };
  }

  const { systemPrompt, userPrompt } = buildAnswerPrompt(input);
  const provider = await createProvider();
  await trace("PROVIDER_CALL", "info", provider.name, { provider: provider.name });
  const start = Date.now();
  let text: string;
  let model: string | null = null;
  try {
    const detailed = await provider.generateDetailed({ systemPrompt, userPrompt, expectJson: true });
    text = detailed.text;
    model = detailed.model;
    await trace("PROVIDER_SUCCESS", "success", `${detailed.durationMs}ms`, {
      provider: provider.name,
      durationMs: detailed.durationMs,
    });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (!e.code) e.code = "ANSWER_GENERATION_FAILED";
    await trace("PROVIDER_FAILED", "failed", e.code, { provider: provider.name, errorCode: e.code });
    throw e;
  }
  const structured = parseAnswerResponse(text);
  const validation = validateAnswer(structured.answer, args.personalFacts, args.companyFacts, args.careerFacts, length);
  await trace("ANSWER_VALIDATE", "success", `${validation.overall} len=${validation.length.current}`, {
    intent: args.intent,
    validationStatus: validation.overall,
    length: validation.length.current,
    maxLength: length.maxLength,
  });

  return {
    structured,
    validation,
    promptVersion: ANSWER_PROMPT_VERSION,
    provider: provider.name,
    model,
    durationMs: Date.now() - start,
  };
}
