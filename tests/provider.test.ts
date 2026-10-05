import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockLLMProvider,
  OpenAICompatibleProvider,
  PROVIDER_PRESETS,
  apiKeyPlacement,
  checkProviderHealth,
  clearPersistedApiKey,
  clearSessionApiKey,
  createProvider,
  describeApiKeyPlacement,
  isReasoningModel,
  loadGenerationSettings,
  saveGenerationSettings,
  PERSIST_KEY_WARNING,
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

/* ------------------------------------------------------------------ *
 * API Key 到底存在哪儿（ITEM 2）
 *
 * 旧口径把「写进 chrome.storage.local」当成保护措施，那是 storage 不是 protection：
 * storage.local 是明文的 leveldb 文件，不加密、没有访问控制。
 * 现在默认**只在内存**，持久化是显式 opt-in。这组用例两侧都测：
 *   正 —— opt-in 之后磁盘上真的有；
 *   反 —— 默认模式下磁盘上**不能有**，而且老版本残留的那份要被抹掉。
 * 断言打在桩出来的那份存储对象上（可以逐字节核对），不是打在文案上。
 * ------------------------------------------------------------------ */

const SETTINGS_KEY = "afa.generation.settings.v1";

interface StorageStub {
  data: Record<string, unknown>;
}

function stubChromeStorage(initial: Record<string, unknown> = {}): StorageStub {
  const stub: StorageStub = { data: { ...initial } };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stub.data[key] }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) stub.data[k] = JSON.parse(JSON.stringify(v));
        },
      },
    },
  };
  return stub;
}

/** 磁盘上那份记录（不是内存里的对象）—— 这才是「有没有落盘」的判据 */
function onDisk(stub: StorageStub): Record<string, unknown> {
  return (stub.data[SETTINGS_KEY] ?? {}) as Record<string, unknown>;
}

function deepHasApiKey(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([k, v]) => (/apikey|api_key/i.test(k) && typeof v === "string" && v.length > 0) || deepHasApiKey(v),
  );
}

beforeEach(() => {
  // 内存态是模块级的，用例之间必须隔离，否则上一条用例的 Key 会串进来
  clearSessionApiKey();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("默认：API Key 不落盘，只活在本会话内存里", () => {
  it("保存带 Key 的配置后，磁盘记录里查不到任何 key 形状的字段", async () => {
    const stub = stubChromeStorage();
    await saveGenerationSettings({
      providerType: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "sk-MUST-NOT-HIT-DISK",
    });
    expect(deepHasApiKey(onDisk(stub))).toBe(false);
    expect(JSON.stringify(onDisk(stub))).not.toContain("sk-MUST-NOT-HIT-DISK");
    expect(onDisk(stub).persistApiKey).toBe(false);
  });

  it("但同一会话内仍然读得到（否则功能就断了）", async () => {
    stubChromeStorage();
    await saveGenerationSettings({ providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-in-memory" });
    const loaded = await loadGenerationSettings();
    expect(loaded.apiKey).toBe("sk-in-memory");
    expect(loaded.persistApiKey).toBeFalsy();
  });

  it("关掉会话（内存清空）后 Key 就没了，Provider 如实回落 Mock 而不是假装可用", async () => {
    stubChromeStorage();
    await saveGenerationSettings({ providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-x" });
    clearSessionApiKey(); // 相当于关掉侧边栏 / 重启浏览器
    const loaded = await loadGenerationSettings();
    expect(loaded.apiKey).toBeUndefined();
    expect(await createProvider()).toBeInstanceOf(MockLLMProvider);
    expect(await checkProviderHealth()).toMatchObject({ health: "invalid_config" });
  });

  it("老版本留在磁盘上的那份 Key：读到时顺手抹掉，本会话继续可用", async () => {
    const legacyKey = "sk-legacy-disk-copy";
    const stub = stubChromeStorage({
      [SETTINGS_KEY]: { providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: legacyKey },
    });
    const loaded = await loadGenerationSettings();
    expect(loaded.apiKey).toBe(legacyKey); // 不让用户白粘一次
    expect(onDisk(stub).apiKey).toBeUndefined(); // 但磁盘上从此没有
    expect(JSON.stringify(onDisk(stub))).not.toContain(legacyKey);
    expect(onDisk(stub).persistApiKey).toBe(false);
  });

  it("scrub 之后再来一次 load：磁盘和内存都不再出现那份 Key", async () => {
    const legacyKey = "sk-legacy-two";
    const stub = stubChromeStorage({ [SETTINGS_KEY]: { providerType: "mock", apiKey: legacyKey } });
    await loadGenerationSettings();
    clearSessionApiKey();
    const again = await loadGenerationSettings();
    expect(again.apiKey).toBeUndefined();
    expect(deepHasApiKey(onDisk(stub))).toBe(false);
  });
});

describe("显式 opt-in：留在本机（带警告）", () => {
  it("persistApiKey: true 时磁盘上真的有（这才叫「保存」）", async () => {
    const stub = stubChromeStorage();
    await saveGenerationSettings({
      providerType: "deepseek",
      baseUrl: "https://x/v1",
      model: "m",
      apiKey: "sk-persisted",
      persistApiKey: true,
    });
    expect(onDisk(stub).apiKey).toBe("sk-persisted");
    expect(onDisk(stub).persistApiKey).toBe(true);
  });

  it("opt-in 之后跨会话（内存空了）仍然读得到磁盘那份", async () => {
    stubChromeStorage();
    await saveGenerationSettings({ providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-p", persistApiKey: true });
    clearSessionApiKey();
    const loaded = await loadGenerationSettings();
    expect(loaded.apiKey).toBe("sk-p");
  });

  it("opt-in 时磁盘是唯一事实源：外部把那份改掉 / 删掉，load 跟着变", async () => {
    const stub = stubChromeStorage({
      [SETTINGS_KEY]: { providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-p", persistApiKey: true },
    });
    clearSessionApiKey();
    stub.data[SETTINGS_KEY] = { providerType: "deepseek", baseUrl: "https://x/v1", model: "m", persistApiKey: true };
    const loaded = await loadGenerationSettings();
    expect(loaded.apiKey).toBeUndefined();
  });

  it("取消勾选：磁盘那份立刻抹掉", async () => {
    const stub = stubChromeStorage({
      [SETTINGS_KEY]: { providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-p", persistApiKey: true },
    });
    await saveGenerationSettings({ providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-p", persistApiKey: false });
    expect(onDisk(stub).apiKey).toBeUndefined();
    expect(onDisk(stub).persistApiKey).toBe(false);
  });

  it("clearPersistedApiKey()：磁盘与内存两份一起没了，其它设置留着", async () => {
    const stub = stubChromeStorage({
      [SETTINGS_KEY]: { providerType: "deepseek", baseUrl: "https://x/v1", model: "m", apiKey: "sk-p", persistApiKey: true },
    });
    const next = await clearPersistedApiKey();
    expect(deepHasApiKey(onDisk(stub))).toBe(false);
    expect(next.baseUrl).toBe("https://x/v1");
    expect(next.apiKey).toBeUndefined();
    expect(await loadGenerationSettings()).toMatchObject({ apiKey: undefined, baseUrl: "https://x/v1" });
  });
});

describe("界面口径与实现说的是同一件事", () => {
  it("三态文案：没有 Key / 只在内存 / 已写进本机", () => {
    expect(describeApiKeyPlacement({})).toContain("没有 API Key");
    expect(describeApiKeyPlacement({ apiKey: "sk" })).toContain("本次会话的内存");
    expect(describeApiKeyPlacement({ apiKey: "sk", persistApiKey: true })).toContain("明文文件");
  });

  it("apiKeyPlacement 的判定与文案同源", () => {
    expect(apiKeyPlacement({})).toBe("none");
    expect(apiKeyPlacement({ apiKey: "sk" })).toBe("session");
    expect(apiKeyPlacement({ apiKey: "sk", persistApiKey: true })).toBe("persisted");
    expect(apiKeyPlacement({ apiKey: "", persistApiKey: true })).toBe("none");
  });

  it("警告文案不许把持久化说成安全（它必须明说是明文文件）", () => {
    expect(PERSIST_KEY_WARNING).toContain("明文");
    expect(PERSIST_KEY_WARNING).toContain("chrome.storage.local");
    expect(PERSIST_KEY_WARNING).not.toMatch(/安全地|加密保存|放心保存/);
  });
});
