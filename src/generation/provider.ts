import type { GenerationErrorCode, LLMProvider, LLMRequest, LLMResponse } from "./types";

/**
 * Provider 抽象（spec Stage 3.5 第二/三章）：
 * - 业务代码只依赖 LLMProvider 接口，不绑定具体厂商
 * - MockLLMProvider：确定性输出，Unit/Integration/E2E 全部使用（离线/稳定/免费）
 * - OpenAICompatibleProvider：真实适配器；API Key 的存放口径见下面 ProviderConfig 的注释
 *   （默认只在本会话内存里，持久化是显式 opt-in，且它从来不是「加密」）
 * - Local Provider Bridge：将 baseUrl 指向本地代理服务即可（架构无需额外代码）
 */

export interface ProviderConfig {
  providerType: "mock" | "deepseek" | "openai-compatible";
  baseUrl?: string;
  model?: string;
  /**
   * API Key。
   * **默认只在内存里活一次会话**：`saveGenerationSettings` 不把它写盘，
   * 关掉 Side Panel / 浏览器就要重新粘贴。
   * 想让它留下来，必须显式勾选 `persistApiKey`（界面上带警告）。
   * 无论哪种，都绝不进代码 / 日志 / trace / snapshot / bundle 常量。
   */
  apiKey?: string;
  /**
   * 显式 opt-in：把 API Key 留在 `chrome.storage.local`。
   * ⚠ 那是**存储**，不是**保护**：扩展自己的 storage.local 是明文（leveldb），
   *   不加密、不访问控制，本机其它进程读到文件就等于拿到 Key。
   */
  persistApiKey?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Mock 故障注入脚本（一次性）：E2E Scenario L/N 使用 */
  mockScript?: { draft?: string; error?: GenerationErrorCode } | null;
}

/** 勾选「留在本机」时界面上必须原样出现的警告（与 README 的口径同一句话） */
export const PERSIST_KEY_WARNING =
  "勾选后，API Key 会写进这台机器的扩展存储（chrome.storage.local）。那是明文文件，不加密、没有访问控制——本机其它进程读到它就等于读到你的 Key。默认不勾选：Key 只在本次会话内存里，关掉侧边栏或浏览器就要重新粘贴。";

/** 当前 Key 到底落在哪里（界面与测试共用一句判定） */
export type ApiKeyPlacement = "none" | "session" | "persisted";

export function apiKeyPlacement(config: Pick<ProviderConfig, "apiKey" | "persistApiKey">): ApiKeyPlacement {
  if (!config.apiKey) return "none";
  return config.persistApiKey === true ? "persisted" : "session";
}

/** 三态的中文说法；措辞只描述事实，不描述保障 */
export function describeApiKeyPlacement(config: Pick<ProviderConfig, "apiKey" | "persistApiKey">): string {
  switch (apiKeyPlacement(config)) {
    case "none":
      return "当前没有 API Key：只填你资料库里已有的内容，开放题会提示信息不足而不是编造。";
    case "persisted":
      return "当前：API Key 存在这台机器的扩展存储里（明文文件，本机其它进程读得到）。取消勾选即可收回。";
    case "session":
      return "当前：API Key 只在本次会话的内存里，磁盘上没有它；关掉侧边栏或浏览器后需要重新粘贴。";
  }
}

/**
 * Provider 预设。
 * DeepSeek 与 OpenAI 兼容同一套 Chat Completions 协议，区别只在默认地址、
 * 默认模型，以及 reasoner 模型不接受 sampling 参数 —— 用预设而不写死分支。
 */
export interface ProviderPreset {
  label: string;
  hint: string;
  baseUrl: string;
  models: string[];
  needsKey: boolean;
  /** 申请 Key 的地址，UI 直接给链接 */
  keyUrl?: string;
}

export const PROVIDER_PRESETS: Record<ProviderConfig["providerType"], ProviderPreset> = {
  mock: {
    label: "离线（不联网）",
    hint: "不调用任何模型：开放题的回答由你资料库里的条目拼装，内容不出这台机器。想要更连贯的表达，再选下面的 DeepSeek 或 OpenAI 兼容。",
    baseUrl: "",
    models: [],
    needsKey: false,
  },
  deepseek: {
    label: "DeepSeek",
    hint: "OpenAI 兼容协议。deepseek-chat 更快更便宜，deepseek-reasoner 推理更强但更慢更贵。",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  "openai-compatible": {
    label: "OpenAI 兼容（自定义 / 本地代理）",
    hint: "任何兼容 /chat/completions 的服务：OpenAI、通义、Kimi、Ollama、自建代理都行。",
    baseUrl: "",
    models: [],
    needsKey: true,
  },
};

/** 推理型模型不接受 temperature / top_p，传了可能报错 */
export function isReasoningModel(model: string | undefined): boolean {
  if (!model) return false;
  return /reasoner|thinking|-r1|^r1|o1-|o3-|o4-/i.test(model);
}

/**
 * Base URL 白名单校验：只允许 https，或本机回环 http（Ollama / LM Studio 等本地模型）。
 * 这个请求会带上 API Key 和整份简历明文，走非回环的 http 等于把两者丢在网络上裸奔。
 * 返回 null 表示可用，否则返回给用户看的拒绝理由。
 */
export function unsafeBaseUrlReason(raw: string | undefined): string | null {
  const url = (raw ?? "").trim();
  if (!url) return "Base URL 未配置";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Base URL 不是合法地址：${url.slice(0, 60)}`;
  }
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:" && loopback) return null;
  return `Base URL 必须是 https（本机模型可用 http://localhost）：当前 ${parsed.protocol}//${parsed.host}`;
}

const SETTINGS_KEY = "afa.generation.settings.v1";

const DEFAULT_CONFIG: ProviderConfig = { providerType: "mock" };

/**
 * 本会话内存里的 API Key。
 * 模块级变量：Side Panel 文档活着它就活着，面板关掉 / 浏览器重启即失效。
 * 这不是加密存储，也不是安全边界 —— 它只是「不落到磁盘」这件事的唯一实现处。
 * 只有 `persistApiKey === true` 时磁盘上那份才算数（见 load / save）。
 */
let sessionApiKey: string | null = null;

/** 测试与「清除」用：把内存里那份也丢掉 */
export function clearSessionApiKey(): void {
  sessionApiKey = null;
}

function hasText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function storageAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

async function readStoredSettings(): Promise<Record<string, unknown> | null> {
  if (!storageAvailable()) return null;
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const raw = result[SETTINGS_KEY];
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 唯一写盘入口：apiKey 只在 `persistApiKey === true` 时才会出现在这份记录里 */
async function writeStoredSettings(record: Record<string, unknown>): Promise<void> {
  if (!storageAvailable()) return;
  await chrome.storage.local.set({ [SETTINGS_KEY]: record });
}

export async function loadGenerationSettings(): Promise<ProviderConfig> {
  const stored = await readStoredSettings();
  if (!stored) return { ...DEFAULT_CONFIG, apiKey: sessionApiKey ?? undefined };

  const storedKey = hasText(stored.apiKey) ? stored.apiKey : null;
  if (stored.persistApiKey === true) {
    // 勾了「留在本机」：磁盘是唯一事实源（内存跟它对齐，含被外部清掉的情况）
    sessionApiKey = storedKey;
  } else if (storedKey) {
    // 历史遗留：默认改成「不落盘」之前，整个配置（含 Key）是写盘的，很多机器上 Key 还躺着。
    // 读到就顺手从磁盘抹掉，本会话继续用（不让用户白粘一次）——
    // 磁盘状态从此才能和文档那句话对上，而且这句话是可以用文件本身核对的。
    sessionApiKey = storedKey;
    const { apiKey: _dropped, ...rest } = stored;
    await writeStoredSettings({ ...rest, persistApiKey: false });
  }

  const { apiKey: _ignored, ...rest } = stored;
  // 合并默认值：部分写入（如仅 mockScript）不丢失 providerType 默认 mock
  return { ...DEFAULT_CONFIG, ...(rest as Partial<ProviderConfig>), apiKey: sessionApiKey ?? undefined };
}

/**
 * 保存配置。
 * 默认（`persistApiKey` 非 true）：**apiKey 不落盘**，只进本会话内存；
 * 磁盘记录里也不留残留（显式写 `persistApiKey: false`，顺带覆盖老版本存的那份）。
 */
export async function saveGenerationSettings(config: ProviderConfig): Promise<void> {
  sessionApiKey = hasText(config.apiKey) ? config.apiKey : null;
  const { apiKey, persistApiKey, ...rest } = config;
  const record: Record<string, unknown> = { ...rest, persistApiKey: persistApiKey === true };
  if (persistApiKey === true && hasText(apiKey)) record.apiKey = apiKey;
  await writeStoredSettings(record);
}

/**
 * 取消「留在本机」：磁盘那份抹掉、opt-in 关掉，内存那份也一起丢。
 * 返回清除后的配置（其它设置原样保留）。
 */
export async function clearPersistedApiKey(): Promise<ProviderConfig> {
  const stored = (await readStoredSettings()) ?? {};
  const { apiKey: _dropped, ...rest } = stored;
  await writeStoredSettings({ ...rest, persistApiKey: false });
  clearSessionApiKey();
  const cleaned = rest as Partial<ProviderConfig>;
  return { ...DEFAULT_CONFIG, ...cleaned, apiKey: undefined, persistApiKey: false };
}

/** Mock 故障注入（一次性）：E2E 用它驱动「unsupported draft / provider 抛错」 */
export async function setMockScript(script: ProviderConfig["mockScript"]): Promise<void> {
  const config = await loadGenerationSettings();
  config.mockScript = script;
  await saveGenerationSettings(config);
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMResult extends LLMResponse {
  usage: LLMUsage;
  durationMs: number;
  model: string | null;
}

/** 内部统一生成接口（含耗时与 token 记录；对外仍保持 LLMProvider 简单接口） */
export interface InternalProvider extends LLMProvider {
  generateDetailed(request: LLMRequest): Promise<LLMResult>;
}

/**
 * Mock Provider：
 * - 默认：从 Prompt 的结构化 FACTS 块提取事实，按序拼接为 Draft（确定性使用全部事实 → validation pass）
 * - 注入脚本：返回固定 draft（如「带领 10 人团队完成……」）或抛出指定错误码
 */
export class MockLLMProvider implements InternalProvider {
  readonly name = "mock";

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const r = await this.generateDetailed(request);
    return { text: r.text };
  }

  async generateDetailed(request: LLMRequest): Promise<LLMResult> {
    const start = Date.now();
    const config = await loadGenerationSettings();
    const script = config.mockScript;
    if (script?.error) {
      const err = new Error(`Mock error: ${script.error}`) as Error & { code?: string };
      err.code = script.error;
      // 一次性脚本：用完即清
      await setMockScript(null);
      throw err;
    }
    // Answer Engine 路径（Stage 4）：prompt 含 [INTENT]
    if (request.userPrompt.includes("[INTENT]")) {
      return this.generateAnswerMock(request, script, start);
    }
    let draft: string;
    const parsedFacts = parseFactsFromPrompt(request.userPrompt);
    if (typeof script?.draft === "string") {
      draft = script.draft;
      await setMockScript(null);
    } else {
      draft = parsedFacts.length > 0 ? buildMockDraft(parsedFacts) : "";
    }
    return {
      text: JSON.stringify({
        draft,
        usedFactIds: parsedFacts.map((f) => f.id),
        emphasizedRequirements: [],
        unsupportedRequirements: [],
      }),
      usage: { inputTokens: null, outputTokens: null },
      durationMs: Date.now() - start,
      model: "mock",
    };
  }

  /** Answer Engine Mock：按 intent 返回稳定回答；career_plan 无 career facts → insufficient_context */
  private async generateAnswerMock(
    request: LLMRequest,
    script: ProviderConfig["mockScript"],
    start: number,
  ): Promise<LLMResult> {
    const prompt = request.userPrompt;
    const intent = /\[INTENT\]\s*(\w+)/.exec(prompt)?.[1] ?? "other";
    const maxChars = Number(/\[MAXIMUM_CHARACTERS\]\s*(\d+)/.exec(prompt)?.[1] ?? 300);
    const personal = parseAnswerFactsLocal(prompt, "[PERSONAL_FACTS_BEGIN]", "[PERSONAL_FACTS_END]");
    const company = parseAnswerFactsLocal(prompt, "[COMPANY_FACTS_BEGIN]", "[COMPANY_FACTS_END]");

    let payload: Record<string, unknown>;
    if (typeof script?.draft === "string") {
      // 注入脚本（超长/公司评价等 unsupported 场景）：一次性
      payload = {
        answer: script.draft,
        usedPersonalFactIds: personal.map((f) => f.id),
        usedCompanyFactIds: [],
        addressedRequirements: [],
        unsupportedRequirements: [],
        status: "generated",
        missingContext: [],
      };
      await setMockScript(null);
    } else if (intent === "career_plan" && !personal.some((f) => f.id.startsWith("career_"))) {
      payload = {
        answer: "",
        usedPersonalFactIds: [],
        usedCompanyFactIds: [],
        addressedRequirements: [],
        unsupportedRequirements: [],
        status: "insufficient_context",
        missingContext: ["career_goal"],
      };
    } else if (personal.length === 0) {
      payload = {
        answer: "",
        usedPersonalFactIds: [],
        usedCompanyFactIds: [],
        addressedRequirements: [],
        unsupportedRequirements: [],
        status: "insufficient_context",
        missingContext: ["personal_facts"],
      };
    } else {
      // why_company：只基于岗位方向与个人事实，不评价公司（COMPANY_FACTS 通常只有公司名）
      const body = personal.map((f) => f.text.replace(/^[\d.、\s]+/, "")).join("；");
      const answer = intent === "why_company"
        ? `希望申请该岗位，岗位方向与我的经历匹配：${body}。希望参与相关工作。`
        : `${body}。`;
      payload = {
        answer: answer.slice(0, maxChars),
        usedPersonalFactIds: personal.map((f) => f.id),
        usedCompanyFactIds: intent === "why_company" ? company.map((f) => f.id) : [],
        addressedRequirements: [],
        unsupportedRequirements: [],
        status: "generated",
        missingContext: [],
      };
    }
    return {
      text: JSON.stringify(payload),
      usage: { inputTokens: null, outputTokens: null },
      durationMs: Date.now() - start,
      model: "mock",
    };
  }
}

export type ProviderHealth =
  | "available"
  | "invalid_config"
  | "auth_failed"
  /** 余额不足 / 欠费（DeepSeek 返回 402） */
  | "insufficient_balance"
  /** 请求参数被拒绝（如给 reasoner 模型传了 temperature） */
  | "bad_request"
  | "network_failed"
  | "model_not_found"
  | "rate_limited"
  | "unknown_error";

/**
 * Provider Health Check（spec Stage 3.5 第五章）：
 * 配置完整 → 网络可达 → 认证有效 → 模型可调用。
 * 生成前不可用则禁止进入生成。
 */
export async function checkProviderHealth(): Promise<{ health: ProviderHealth; detail?: string }> {
  const config = await loadGenerationSettings();
  if (config.providerType === "mock") return { health: "available" }; // mock 兜底（含未配置）
  if (!config.baseUrl || !config.model || !config.apiKey) {
    return { health: "invalid_config", detail: "Base URL / Model / API Key 未配置完整" };
  }
  const badUrl = unsafeBaseUrlReason(config.baseUrl);
  if (badUrl) return { health: "invalid_config", detail: badUrl };
  const provider = new OpenAICompatibleProvider(config);
  // 用一条极小请求验证全链路（认证 + 模型可调用 + 响应格式）
  try {
    await provider.generateDetailed({
      systemPrompt: "You are a health check.",
      userPrompt: "Reply with the single word: OK",
      expectJson: false,
    });
    return { health: "available" };
  } catch (err) {
    const e = err as Error & { code?: string };
    const mapping: Record<string, ProviderHealth> = {
      PROVIDER_TIMEOUT: "network_failed",
      PROVIDER_NETWORK: "network_failed",
      PROVIDER_AUTH: "auth_failed",
      PROVIDER_QUOTA: "insufficient_balance",
      PROVIDER_BAD_REQUEST: "bad_request",
      PROVIDER_MODEL: "model_not_found",
      PROVIDER_RATE_LIMIT: "rate_limited",
      PROVIDER_CONFIG: "invalid_config",
      PROVIDER_UNAVAILABLE: "network_failed",
    };
    return { health: mapping[e.code ?? ""] ?? "unknown_error", detail: e.message };
  }
}

/**
 * OpenAI 兼容 Chat Completions 适配器。
 * DeepSeek、通义、Kimi、Ollama、自建代理都走这里 —— 协议一致，差异用配置表达。
 */
export class OpenAICompatibleProvider implements InternalProvider {
  readonly name = "openai-compatible";
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    // 容忍用户直接粘贴完整端点（…/chat/completions），避免拼成 …/chat/completions/chat/completions
    return (this.config.baseUrl ?? "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/i, "");
  }

  /** 请求体：reasoner 类模型不接受 temperature；期望 JSON 时开 response_format */
  private buildBody(request: LLMRequest): Record<string, unknown> {
    const model = this.config.model ?? "";
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: this.config.maxTokens ?? 1500,
    };
    if (!isReasoningModel(model)) body.temperature = this.config.temperature ?? 0.3;
    // prompt 里已明确要求「只输出 JSON」，服务端强约束能显著降低解析失败率
    if (request.expectJson) body.response_format = { type: "json_object" };
    return body;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const r = await this.generateDetailed(request);
    return { text: r.text };
  }

  async generateDetailed(request: LLMRequest): Promise<LLMResult> {
    const badUrl = unsafeBaseUrlReason(this.config.baseUrl);
    if (badUrl) {
      const err = new Error(badUrl) as Error & { code?: string };
      err.code = "PROVIDER_CONFIG";
      throw err;
    }
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(this.buildBody(request)),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`Provider HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`) as Error & {
          code?: string;
        };
        if (res.status === 401 || res.status === 403) err.code = "PROVIDER_AUTH";
        else if (res.status === 402) err.code = "PROVIDER_QUOTA"; // DeepSeek 余额不足
        else if (res.status === 404) err.code = "PROVIDER_MODEL";
        else if (res.status === 429) err.code = "PROVIDER_RATE_LIMIT";
        else if (res.status === 400) err.code = "PROVIDER_BAD_REQUEST";
        else err.code = "PROVIDER_UNAVAILABLE";
        throw err;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
        },
        durationMs: Date.now() - start,
        model: data.model ?? this.config.model ?? null,
      };
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.name === "AbortError") {
        e.code = "PROVIDER_TIMEOUT";
        e.message = "Provider timeout (45s)";
      } else if (!e.code) {
        e.code = "PROVIDER_NETWORK";
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 按 settings 构造当前 Provider；mock 永远可用（没有 Key 也能完整测试） */
export async function createProvider(): Promise<InternalProvider> {
  const config = await loadGenerationSettings();
  if (
    config.providerType !== "mock" &&
    config.baseUrl &&
    config.model &&
    config.apiKey
  ) {
    return new OpenAICompatibleProvider(config);
  }
  return new MockLLMProvider();
}

// ---- Mock 内部工具 ----

interface ParsedFact {
  id: string;
  text: string;
}

/** 从 userPrompt 的 FACTS 块解析事实行（格式：fact_001 | type | text） */
export function parseFactsFromPrompt(userPrompt: string): ParsedFact[] {
  const facts: ParsedFact[] = [];
  let inBlock = false;
  for (const line of userPrompt.split("\n")) {
    if (line.includes("[FACTS_BEGIN]")) {
      inBlock = true;
      continue;
    }
    if (line.includes("[FACTS_END]")) break;
    if (!inBlock) continue;
    const m = line.match(/^(fact_\d+)\s*\|\s*\w+\s*\|\s*(.+)$/);
    if (m && m[1] && m[2]) facts.push({ id: m[1], text: m[2] });
  }
  return facts;
}

/** 从 answer prompt 的 FACTS 块解析事实行（Mock 内部工具） */
function parseAnswerFactsLocal(prompt: string, begin: string, end: string): { id: string; text: string }[] {
  const facts: { id: string; text: string }[] = [];
  let inBlock = false;
  for (const line of prompt.split("\n")) {
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

/** Mock draft：事实文本按序拼接（不加任何事实外的前缀/总结句，保证自身 validation pass） */
function buildMockDraft(facts: ParsedFact[]): string {
  const body = facts.map((f) => f.text.replace(/^[\d.、\s]+/, "")).join("；");
  return `${body}。`;
}
