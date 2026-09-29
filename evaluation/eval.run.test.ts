import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OpenAICompatibleProvider } from "../src/generation/provider";
import {
  buildFactContext, buildVariantPrompt, extractJobRequirements, selectRelevantFacts, PROMPT_VERSION,
} from "../src/generation/promptBuilder";
import type { Fact, JobContext } from "../src/generation/types";
import type { JobContext as JobCtx } from "../src/job/schema";
import { EVAL_DATASET, DATASET_VERSION, type EvalCase } from "./dataset";
import { evaluateGeneration, summarizeBatch, type EvaluationResult } from "./evaluator";
import { compareRuns, goldenCaseIds, type EvalRun } from "./regression";

/**
 * Batch Evaluation Runner（spec Stage 3.5 第十七/三十章）：npm run eval:generation
 *
 * 环境变量（缺失则 SKIP 并明确提示 PROVIDER_UNAVAILABLE —— 不影响普通测试）：
 *   EVAL_PROVIDER_BASE_URL / EVAL_PROVIDER_MODEL / EVAL_PROVIDER_API_KEY
 *   EVAL_CASE_IDS（可选，逗号分隔） / EVAL_BASELINE_RESULTS（可选，v1 JSON → Regression 对比）
 *
 * 输出：evaluation-results/evaluation-YYYYMMDD-HHmm.json + .md
 * 禁止把 prompt 全文 / 响应全文 / API Key 写入报告与日志。
 */

const baseUrl = process.env.EVAL_PROVIDER_BASE_URL;
const model = process.env.EVAL_PROVIDER_MODEL;
const apiKey = process.env.EVAL_PROVIDER_API_KEY;
const hasProviderConfig = Boolean(baseUrl && model && apiKey);

function makeJobContext(c: EvalCase): JobCtx {
  return {
    id: `eval_${c.id}`,
    company: "",
    position: c.jobTitle,
    location: "",
    jd: c.jd,
    sourceUrl: "",
    pageTitle: c.jobTitle,
    createdAt: new Date().toISOString(),
    jobType: c.profileType,
    keywords: [],
    source: "captured",
  };
}

async function runCase(c: EvalCase, provider: OpenAICompatibleProvider): Promise<{
  result: EvaluationResult;
  durationMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
}> {
  const facts: Fact[] = c.experienceFacts.map((f, i) => ({
    id: `fact_${String(i + 1).padStart(3, "0")}`, type: f.type, text: f.text,
  }));
  const factContext = buildFactContext(c.id, c.experienceLabel, {
    company: "", department: "", position: c.jobTitle, startDate: "", endDate: "",
    descriptionShort: c.defaultDescription, descriptionMedium: "", descriptionLong: "",
    responsibilities: c.experienceFacts.filter((f) => f.type === "responsibility").map((f) => f.text).join("\n"),
    workContent: "",
    achievements: c.experienceFacts.filter((f) => f.type === "metric").map((f) => f.text).join("\n"),
    summary: "",
    keywords: c.experienceFacts.filter((f) => f.type === "technology").map((f) => f.text.replace(/^使用 /, "")),
    variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
  } as never);
  const requirements = extractJobRequirements(makeJobContext(c));
  const selectedFacts = selectRelevantFacts(requirements, factContext, c.profileType);
  const { systemPrompt, userPrompt } = buildVariantPrompt({
    requirementProfile: requirements,
    selectedFacts,
    experienceLabel: c.experienceLabel,
    profileType: c.profileType,
    existingVariant: "",
  });

  console.log(`[PROVIDER_CALL] provider=openai-compatible case=${c.id}`);
  const t0 = Date.now();
  let detailed;
  try {
    detailed = await provider.generateDetailed({ systemPrompt, userPrompt, expectJson: true });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.log(`[PROVIDER_FAILED] case=${c.id} code=${e.code ?? "?"}`);
    return {
      result: { ...evaluateGeneration(c, null), failureTypes: ["PROVIDER_FAILURE"], draft: "" },
      durationMs: Date.now() - t0,
      usage: { inputTokens: null, outputTokens: null },
    };
  }
  console.log(`[PROVIDER_SUCCESS] case=${c.id} ${detailed.durationMs}ms usage=${detailed.usage.inputTokens}/${detailed.usage.outputTokens}`);

  let draft = "";
  try {
    const cleaned = detailed.text.replace(/^[\s\S]*?```(?:json)?\s*|\s*```[\s\S]*$/g, "").trim();
    const parsed = JSON.parse(cleaned.includes("{") ? cleaned : detailed.text) as { draft?: string };
    draft = typeof parsed.draft === "string" ? parsed.draft : "";
  } catch {
    return {
      result: { ...evaluateGeneration(c, null), failureTypes: ["INVALID_OUTPUT"], draft: detailed.text.slice(0, 100) },
      durationMs: detailed.durationMs,
      usage: detailed.usage,
    };
  }
  const result = evaluateGeneration(c, draft);
  console.log(
    `[GENERATION_EVALUATE] case=${c.id} status=${result.validationStatus} precision=${result.factPrecision} unsupported=${result.unsupportedClaims.length} forbidden=${result.forbiddenHits}`,
  );
  return { result, durationMs: detailed.durationMs, usage: detailed.usage };
}

describe.skipIf(!hasProviderConfig)("Real Provider Batch Evaluation", () => {
  it("runs the dataset through the real provider and writes the report", async () => {
    const provider = new OpenAICompatibleProvider({
      providerType: "openai-compatible",
      baseUrl: baseUrl!,
      model: model!,
      apiKey: apiKey!,
      temperature: process.env.EVAL_PROVIDER_TEMPERATURE ? Number(process.env.EVAL_PROVIDER_TEMPERATURE) : undefined,
      maxTokens: process.env.EVAL_PROVIDER_MAX_TOKENS ? Number(process.env.EVAL_PROVIDER_MAX_TOKENS) : undefined,
    });
    const caseFilter = process.env.EVAL_CASE_IDS?.split(",").map((s) => s.trim());
    const cases = caseFilter ? EVAL_DATASET.filter((c) => caseFilter.includes(c.id)) : EVAL_DATASET;

    const caseResults: EvaluationResult[] = [];
    let totalDuration = 0;
    const usageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };
    for (const c of cases) {
      const { result, durationMs, usage } = await runCase(c, provider);
      caseResults.push(result);
      totalDuration += durationMs;
      if (usage.inputTokens != null) usageTotals.inputTokens += usage.inputTokens;
      if (usage.outputTokens != null) usageTotals.outputTokens += usage.outputTokens;
      if (usage.inputTokens != null) usageTotals.calls += 1;
    }
    const metrics = summarizeBatch(caseResults);

    const run: EvalRun = {
      label: `eval-${PROMPT_VERSION}`,
      promptVersion: PROMPT_VERSION,
      provider: "openai-compatible",
      model: model!,
      metrics,
      caseResults,
      ranAt: new Date().toISOString(),
    };

    // Regression 对比（可选）
    const baselinePath = process.env.EVAL_BASELINE_RESULTS;
    let regression = null;
    if (baselinePath && existsSync(baselinePath)) {
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as EvalRun;
      regression = compareRuns(baseline, run);
      console.log(`[GENERATION_REGRESSION] v1=${baseline.promptVersion} v2=${run.promptVersion} verdict=${regression.verdict}`);
    }

    const golden = goldenCaseIds()
      .map((id) => caseResults.find((r) => r.caseId === id))
      .filter((r) => Boolean(r))
      .map((r) => ({ caseId: r!.caseId, status: r!.validationStatus, precision: r!.factPrecision, forbidden: r!.forbiddenHits }));

    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12);
    const outDir = join(process.cwd(), "evaluation-results");
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, `evaluation-${stamp}.json`);
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          provider: "openai-compatible",
          model,
          promptVersion: PROMPT_VERSION,
          datasetVersion: DATASET_VERSION,
          metrics,
          avgDurationMs: Math.round(totalDuration / cases.length),
          usage: usageTotals.calls > 0 ? usageTotals : null,
          golden,
          regression,
          caseResults,
          ranAt: run.ranAt,
        },
        null,
        2,
      ),
    );

    const md = [
      "# Generation Evaluation Report",
      "",
      `- Provider: openai-compatible (${model})`,
      `- Prompt: ${PROMPT_VERSION} / Dataset: ${DATASET_VERSION}`,
      `- Cases: ${metrics.cases}（Golden: ${golden.map((g) => `${g.caseId}=${g.status}`).join(", ")}）`,
      `- Generation success: ${metrics.generationSuccess}/${metrics.cases}`,
      `- Validation pass/review/fail: ${metrics.validationPass}/${metrics.validationReview}/${metrics.validationFail}`,
      `- Unsupported claims: ${metrics.totalUnsupportedClaims}`,
      `- Forbidden hits: ${metrics.totalForbiddenHits}`,
      `- Avg fact precision: ${metrics.avgFactPrecision}`,
      `- Avg requirement coverage: ${metrics.avgRequirementCoverage}`,
      `- Avg latency: ${Math.round(totalDuration / cases.length)}ms / tokens: ${usageTotals.calls > 0 ? `${usageTotals.inputTokens}in/${usageTotals.outputTokens}out` : "n/a"}`,
      regression ? `- Regression verdict: ${regression.verdict}` : "",
      "",
      "## Case Results",
      "",
      "| Case | Status | Precision | Unsupported | Forbidden | Failures |",
      "|---|---|---|---|---|---|",
      ...caseResults.map(
        (r) =>
          `| ${r.caseId} | ${r.validationStatus} | ${r.factPrecision} | ${r.unsupportedClaims.length} | ${r.forbiddenHits} | ${r.failureTypes.join(",") || "-"} |`,
      ),
    ].join("\n");
    writeFileSync(join(outDir, `evaluation-${stamp}.md`), md);

    console.log(`[eval:generation] done → ${jsonPath}`);
    // 软断言：报告已生成即可；质量指标本身用于人工判读
    expect(caseResults).toHaveLength(cases.length);
  });
});

describe.skipIf(hasProviderConfig)("eval:generation without provider config", () => {
  it("exits clearly with PROVIDER_UNAVAILABLE (offline, no real calls)", () => {
    console.log("[eval:generation] PROVIDER_UNAVAILABLE — 设置 EVAL_PROVIDER_BASE_URL / EVAL_PROVIDER_MODEL / EVAL_PROVIDER_API_KEY 后重试");
    expect(hasProviderConfig).toBe(false);
  });
});
