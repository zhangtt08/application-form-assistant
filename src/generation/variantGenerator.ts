import type { ExperienceLike } from "./promptBuilder";
import { buildFactContext, buildVariantPrompt, extractJobRequirements, selectRelevantFacts, PROMPT_VERSION } from "./promptBuilder";
import { createProvider, type InternalProvider } from "./provider";
import { validateDraft } from "./factValidator";
import type { ProfileType } from "../job/profileTypes";
import type { JobContext } from "../job/schema";
import type { StructuredDraft, VariantGenerationResult } from "./types";
import { trace } from "../utils/trace";

/**
 * VariantGenerationService（spec 第二章架构）：
 * UI → Service → LLMProvider → Draft → ClaimExtractor → FactValidator → GenerationResult → Review UI。
 * 生成与保存彻底分离：本服务绝不写 Master Profile。
 */

export interface GenerateVariantArgs {
  jobContext: JobContext;
  effectiveProfileType: ProfileType;
  experienceId: string;
  experienceLabel: string;
  experience: ExperienceLike;
  targetVariant: string;
  existingVariant: string;
}

function parseStructuredResponse(text: string): StructuredDraft {
  let parsed: unknown;
  try {
    // 容忍模型在 JSON 外包裹 ```json 围栏
    const cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*|\s*```[\s\S]*$/g, "").trim();
    parsed = JSON.parse(cleaned.includes("{") ? cleaned : text);
  } catch {
    const err = new Error("LLM 输出不是合法 JSON") as Error & { code?: string };
    err.code = "INVALID_STRUCTURED_OUTPUT";
    throw err;
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.draft !== "string") {
    const err = new Error("缺少 draft 字段") as Error & { code?: string };
    err.code = "INVALID_STRUCTURED_OUTPUT";
    throw err;
  }
  if (!rec.draft.trim()) {
    const err = new Error("draft 为空") as Error & { code?: string };
    err.code = "EMPTY_GENERATION";
    throw err;
  }
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    draft: rec.draft,
    usedFactIds: arr(rec.usedFactIds),
    emphasizedRequirements: arr(rec.emphasizedRequirements),
    unsupportedRequirements: arr(rec.unsupportedRequirements),
  };
}

export async function generateVariant(args: GenerateVariantArgs): Promise<VariantGenerationResult> {
  // 1. Fact Context（最小事实集合）
  const factContext = buildFactContext(args.experienceId, args.experienceLabel, args.experience);

  // 2. JD 需求提取（规则版）
  const requirementProfile = extractJobRequirements(args.jobContext);

  // 3. Fact 选择（确定性规则）
  const selectedFacts = selectRelevantFacts(requirementProfile, factContext, args.effectiveProfileType);

  // 4. Prompt + Provider 调用（trace 记录耗时/token，禁止记录 prompt 与响应全文）
  const { systemPrompt, userPrompt } = buildVariantPrompt({
    requirementProfile,
    selectedFacts,
    experienceLabel: args.experienceLabel,
    profileType: args.effectiveProfileType,
    existingVariant: args.existingVariant,
  });
  const provider: InternalProvider = await createProvider();
  await trace("PROVIDER_CALL", "info", `${provider.name}`, { provider: provider.name });
  let detailed;
  try {
    detailed = await provider.generateDetailed({ systemPrompt, userPrompt, expectJson: true });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (!e.code) e.code = "PROVIDER_UNAVAILABLE";
    await trace("PROVIDER_FAILED", "failed", `${e.code}: ${e.message.slice(0, 60)}`, {
      provider: provider.name,
      errorCode: e.code,
    });
    throw e;
  }
  await trace("PROVIDER_SUCCESS", "success", `${detailed.durationMs}ms model=${detailed.model ?? "?"}`, {
    provider: provider.name,
    model: detailed.model,
    durationMs: detailed.durationMs,
  });
  const response = { text: detailed.text };

  // 5. 结构化解析
  const structured = parseStructuredResponse(response.text);

  // 6. Claim Extraction + Fact Validation（不信任模型自报 usedFactIds）
  const validation = validateDraft(structured.draft, selectedFacts);

  return {
    generationId: `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    jobContextId: args.jobContext.id,
    experienceId: args.experienceId,
    profileType: args.effectiveProfileType,
    targetVariant: args.targetVariant,
    draft: structured.draft,
    usedFactIds: structured.usedFactIds,
    requirements: requirementProfile,
    validation,
    selectedFacts,
    promptVersion: PROMPT_VERSION,
    provider: provider.name,
    model: detailed.model,
    durationMs: detailed.durationMs,
    usage: detailed.usage,
    createdAt: new Date().toISOString(),
  };
}

/** 用户编辑后的草稿重验证（spec 第二十章：编辑后必须重新验证才能保存） */
export function revalidateDraft(draft: string, selectedFacts: VariantGenerationResult["selectedFacts"]) {
  return validateDraft(draft, selectedFacts);
}
