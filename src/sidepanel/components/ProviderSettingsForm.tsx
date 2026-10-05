import { useState } from "react";
import {
  PERSIST_KEY_WARNING,
  checkProviderHealth,
  clearPersistedApiKey,
  describeApiKeyPlacement,
  loadGenerationSettings,
  saveGenerationSettings,
  PROVIDER_PRESETS,
  isReasoningModel,
  type ProviderConfig,
  type ProviderHealth,
} from "../../generation/provider";

/**
 * AI Provider 设置（spec Stage 3.5 第四章）。
 * Provider / Base URL / Model / API Key（password）/ Test Connection。
 *
 * Key 的口径（界面必须说的和代码做的是同一件事）：
 * 默认**只写进本会话内存**，磁盘上那台机器的记录里没有它；
 * 「留在本机」是一个显式勾选项，勾上才写 `chrome.storage.local`，
 * 而那是明文文件 —— 所以勾选框旁边必须把警告一起显示出来，不能只写个「安全保存」。
 * Key 永远不回显完整内容（password 输入框 + 只显示来源说明）。
 *
 * 多 Provider 走「预设」而不是分支：DeepSeek 与 OpenAI 兼容同一套协议，
 * 选 DeepSeek 时自动带出地址与模型，用户只需要粘 Key。
 */

const HEALTH_TEXT: Record<ProviderHealth, string> = {
  available: "连接正常",
  invalid_config: "配置不完整",
  auth_failed: "API Key 无效或无权限",
  insufficient_balance: "账户余额不足",
  bad_request: "请求参数被拒绝",
  network_failed: "网络不可达或超时",
  model_not_found: "模型不存在或不可用",
  rate_limited: "触发限流，稍后重试",
  unknown_error: "未知错误",
};

export function ProviderSettingsForm() {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [status, setStatus] = useState<{ health: ProviderHealth | "testing"; detail?: string } | null>(null);

  const ensureLoaded = async (): Promise<ProviderConfig> => {
    if (config) return config;
    const loaded = await loadGenerationSettings();
    setConfig(loaded);
    return loaded;
  };

  const update = async (patch: Partial<ProviderConfig>) => {
    const next = { ...(await ensureLoaded()), ...patch };
    setConfig(next);
    await saveGenerationSettings(next);
  };

  /** 切换 Provider：套用预设地址与默认模型，但保留用户手改过的地址 */
  const switchProvider = async (next: ProviderConfig["providerType"]) => {
    const current = await ensureLoaded();
    const preset = PROVIDER_PRESETS[next];
    const currentPreset = PROVIDER_PRESETS[current.providerType];
    const untouchedBase = !current.baseUrl || current.baseUrl === currentPreset.baseUrl;
    await update({
      providerType: next,
      baseUrl: untouchedBase ? preset.baseUrl : current.baseUrl,
      model: next === "mock" ? "" : current.model || preset.models[0] || "",
    });
    setStatus(null);
  };

  const testConnection = async () => {
    setStatus({ health: "testing" });
    const result = await checkProviderHealth();
    setStatus(result);
  };

  /** 收回 opt-in：磁盘那份抹掉、内存那份也丢，其它设置原样留着 */
  const clearKey = async () => {
    const next = await clearPersistedApiKey();
    setConfig(next);
    setStatus(null);
  };

  const type = config?.providerType ?? "mock";
  const preset = PROVIDER_PRESETS[type];

  return (
    <details className="provider-settings">
      <summary
        onClick={() => {
          void ensureLoaded();
        }}
      >
        Provider 配置（Base URL / Model / API Key）
      </summary>

      <p className="muted small">
        不配也能用：不配模型时只会填写你已准备好的资料，开放题会提示信息不足而不是编造。
        API Key 默认只留在本次会话的内存里，不进代码仓库、不进日志，也不写磁盘。
      </p>

      <label className="pe-row">
        <span className="pe-k">Provider</span>
        <select value={type} onChange={(e) => void switchProvider(e.target.value as ProviderConfig["providerType"])}>
          {(Object.keys(PROVIDER_PRESETS) as ProviderConfig["providerType"][]).map((key) => (
            <option key={key} value={key}>
              {PROVIDER_PRESETS[key].label}
            </option>
          ))}
        </select>
      </label>

      <p className="muted small">{preset.hint}</p>

      {type !== "mock" && (
        <>
          <label className="pe-row">
            <span className="pe-k">Base URL</span>
            <input
              value={config?.baseUrl ?? ""}
              placeholder={preset.baseUrl || "https://api.example.com/v1"}
              onChange={(e) => void update({ baseUrl: e.target.value })}
            />
          </label>

          <label className="pe-row">
            <span className="pe-k">Model</span>
            {preset.models.length > 0 ? (
              <>
                <input
                  list={`afa-models-${type}`}
                  value={config?.model ?? ""}
                  placeholder={preset.models[0]}
                  onChange={(e) => void update({ model: e.target.value })}
                />
                <datalist id={`afa-models-${type}`}>
                  {preset.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            ) : (
              <input value={config?.model ?? ""} onChange={(e) => void update({ model: e.target.value })} />
            )}
          </label>

          <label className="pe-row">
            <span className="pe-k">API Key</span>
            <input
              type="password"
              value={config?.apiKey ?? ""}
              placeholder="只留在本次会话，不回显"
              onChange={(e) => void update({ apiKey: e.target.value })}
            />
          </label>

          {/* 说的是代码真实做到的事：默认不写盘，勾了才写，而写进去也不是加密 */}
          <p className="muted small">{describeApiKeyPlacement(config ?? {})}</p>

          <label className="pe-row pe-check">
            <input
              type="checkbox"
              checked={config?.persistApiKey === true}
              onChange={(e) => void update({ persistApiKey: e.target.checked })}
            />
            <span>把 API Key 留在这台机器上（不推荐）</span>
          </label>

          <p className="ps-warning">{PERSIST_KEY_WARNING}</p>

          {config?.persistApiKey === true && (
            <div className="ps-actions">
              <button type="button" className="btn-sm" onClick={() => void clearKey()}>
                清除本机保存的 Key
              </button>
            </div>
          )}

          {isReasoningModel(config?.model) && (
            <p className="muted small">推理型模型不接受 temperature，已自动不发送该参数；响应也会更慢。</p>
          )}

          <div className="ps-actions">
            <button type="button" className="btn-sm" onClick={() => void testConnection()}>
              {status?.health === "testing" ? "测试中…" : "测试连接"}
            </button>
            {preset.keyUrl && (
              <a className="link-btn" href={preset.keyUrl} target="_blank" rel="noreferrer">
                申请 API Key ↗
              </a>
            )}
          </div>

          {status && status.health !== "testing" && (
            <p className={status.health === "available" ? "ps-health ok" : "ps-health bad"}>
              {status.health === "available" ? "✓ " : "✗ "}
              {HEALTH_TEXT[status.health]}
              {status.detail ? `（${status.detail}）` : ""}
            </p>
          )}
        </>
      )}
    </details>
  );
}
