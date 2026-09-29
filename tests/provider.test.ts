import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAICompatibleProvider,
  PROVIDER_PRESETS,
  isReasoningModel,
  type ProviderConfig,
} from "../src/generation/provider";

/**
 * Provider 适配器回归。
 * 这里不打真实网络：stub 掉 fetch，只断言「发出去的请求长什么样」与错误码映射。
 * 覆盖点都是 DeepSeek 接入后新增的分支：
 *   - JSON 模式（response_format）
 *   - 推理型模型不能带 temperature
 *   - baseUrl 容错（别把 /chat/completions 拼两遍）
 *   - 402 / 400 的状态码映射
 */

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function stubFetch(status = 200, payload: unknown = { choices: [{ message: { content: '{"ok":true}' } }] }): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => "error body",
    };
  });
  return captured;
}

function makeConfig(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    providerType: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "sk-test",
    ...patch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isReasoningModel", () => {
  it("识别推理型模型", () => {
    expect(isReasoningModel("deepseek-reasoner")).toBe(true);
    expect(isReasoningModel("o1-mini")).toBe(true);
    expect(isReasoningModel("deepseek-chat")).toBe(false);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
    expect(isReasoningModel(undefined)).toBe(false);
  });
});

describe("DeepSeek 预设", () => {
  it("地址与默认模型按官方文档给好", () => {
    const p = PROVIDER_PRESETS.deepseek;
    expect(p.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(p.models).toContain("deepseek-chat");
    expect(p.models).toContain("deepseek-reasoner");
    expect(p.needsKey).toBe(true);
    expect(p.keyUrl).toContain("deepseek.com");
  });
});

describe("OpenAICompatibleProvider（DeepSeek 走同一适配器）", () => {
  it("请求打到 {baseUrl}/chat/completions，带上 Bearer 头", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(makeConfig());
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(captured[0]!.headers.Authorization).toBe("Bearer sk-test");
    expect(captured[0]!.body.model).toBe("deepseek-chat");
    expect(captured[0]!.body.temperature).toBe(0.3);
  });

  it("expectJson 时开启 response_format（prompt 里已要求只输出 JSON）", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(makeConfig());
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "只输出 JSON", expectJson: true });
    expect(captured[0]!.body.response_format).toEqual({ type: "json_object" });
  });

  it("非 JSON 请求不带 response_format", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(makeConfig());
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false });
    expect(captured[0]!.body.response_format).toBeUndefined();
  });

  it("推理型模型不发送 temperature", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(makeConfig({ model: "deepseek-reasoner" }));
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: true });
    expect(captured[0]!.body.temperature).toBeUndefined();
    expect(captured[0]!.body.model).toBe("deepseek-reasoner");
  });

  it("baseUrl 容错：传入完整端点不会拼成 …/chat/completions/chat/completions", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(
      makeConfig({ baseUrl: "https://api.deepseek.com/v1/chat/completions/" }),
    );
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false });
    expect(captured[0]!.url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("Base URL 不合法 / 明文 http 时直接拒绝，不发请求（Key 与简历不外泄）", async () => {
    const captured = stubFetch();
    for (const baseUrl of ["", "http://api.example.com/v1", "not-a-url"]) {
      const provider = new OpenAICompatibleProvider(makeConfig({ baseUrl }));
      await expect(
        provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false }),
      ).rejects.toThrow();
    }
    expect(captured).toHaveLength(0);
  });

  it("本机回环 http 允许（Ollama / LM Studio 等本地模型）", async () => {
    const captured = stubFetch();
    const provider = new OpenAICompatibleProvider(makeConfig({ baseUrl: "http://localhost:11434/v1" }));
    await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false });
    expect(captured[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("401/402/404/429/400 各自映射到明确错误码", async () => {
    const cases: [number, string][] = [
      [401, "PROVIDER_AUTH"],
      [402, "PROVIDER_QUOTA"],
      [404, "PROVIDER_MODEL"],
      [429, "PROVIDER_RATE_LIMIT"],
      [400, "PROVIDER_BAD_REQUEST"],
      [500, "PROVIDER_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      stubFetch(status);
      const provider = new OpenAICompatibleProvider(makeConfig());
      await expect(
        provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: false }),
      ).rejects.toMatchObject({ code });
      vi.unstubAllGlobals();
    }
  });

  it("解析 choices[0].message.content 并记录 token 用量", async () => {
    stubFetch(200, {
      choices: [{ message: { content: '{"draft":"ok"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 45 },
      model: "deepseek-chat",
    });
    const provider = new OpenAICompatibleProvider(makeConfig());
    const r = await provider.generateDetailed({ systemPrompt: "s", userPrompt: "u", expectJson: true });
    expect(r.text).toBe('{"draft":"ok"}');
    expect(r.usage.inputTokens).toBe(120);
    expect(r.usage.outputTokens).toBe(45);
    expect(r.model).toBe("deepseek-chat");
  });
});
