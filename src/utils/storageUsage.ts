/**
 * 本机存储用量（chrome.storage.local）。
 *
 * 为什么要有这一格：这个扩展把所有东西都存在浏览器本地 —— 简历、岗位记录、
 * 会话、站点设定、AI 回答缓存。MV3 下 `storage.local` 默认配额是 10 MiB
 * （本项目**没有**申请 `unlimitedStorage`，这是权限最小化的代价），
 * 而投递几十个岗位之后 answer 缓存与 session 是会长的。
 * 写满之后 chrome.storage.set 会 reject —— 那时候用户看到的应该是
 * 「存储满了，去设置页清一下」，而不是「保存没反应」。
 *
 * 这里只做**读数**：不改任何数据、不删任何东西（清理入口在设置页另外）。
 * 输出只有 key 名与字节数，绝不返回内容 —— 内容里是用户的简历。
 */

/** MV3 未申请 unlimitedStorage 时的默认配额 */
export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024;
/** 到这个比例就把这一格从「信息」升成「提醒」 */
export const WARN_RATIO = 0.8;

export interface StorageKeyUsage {
  key: string;
  bytes: number;
}

export interface StorageUsage {
  available: boolean;
  /** 实测字节数（chrome.getBytesInUse 优先，取不到就按 JSON 长度估） */
  totalBytes: number;
  quotaBytes: number;
  ratio: number;
  keys: StorageKeyUsage[];
  /** 超出提醒线 */
  warn: boolean;
}

/** UTF-8 字节数（中文一条简历值按 3 字节/字算，不能用 string.length 糊过去） */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1; // 代理对
    } else n += 3;
  }
  return n;
}

/** 纯计算：从 key→value 的快照算出用量（可单测，不碰 chrome） */
export function computeUsage(snapshot: Record<string, unknown>, quotaBytes = DEFAULT_QUOTA_BYTES): StorageUsage {
  const keys: StorageKeyUsage[] = Object.entries(snapshot)
    .map(([key, value]) => {
      let bytes = 0;
      try {
        bytes = utf8Bytes(key) + utf8Bytes(JSON.stringify(value) ?? "");
      } catch {
        bytes = utf8Bytes(key);
      }
      return { key, bytes };
    })
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = keys.reduce((sum, k) => sum + k.bytes, 0);
  const ratio = quotaBytes > 0 ? totalBytes / quotaBytes : 0;
  return {
    available: true,
    totalBytes,
    quotaBytes,
    ratio,
    keys,
    warn: ratio >= WARN_RATIO,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 读真实用量。chrome 不可用（单测 / 非扩展环境）时返回 available:false，
 * 界面就照实说「读不到」，不许显示 0 B 冒充「没用空间」。
 */
export async function readStorageUsage(): Promise<StorageUsage> {
  const empty: StorageUsage = { available: false, totalBytes: 0, quotaBytes: DEFAULT_QUOTA_BYTES, ratio: 0, keys: [], warn: false };
  if (typeof chrome === "undefined" || !chrome.storage?.local) return empty;
  try {
    const all = await chrome.storage.local.get(null);
    const usage = computeUsage((all ?? {}) as Record<string, unknown>);
    // 浏览器自己的计数更准（含索引开销），拿得到就用它当总数
    if (typeof chrome.storage.local.getBytesInUse === "function") {
      const real = await chrome.storage.local.getBytesInUse(null);
      if (typeof real === "number" && Number.isFinite(real)) {
        return { ...usage, totalBytes: Math.max(real, usage.totalBytes), ratio: real / DEFAULT_QUOTA_BYTES, warn: real / DEFAULT_QUOTA_BYTES >= WARN_RATIO };
      }
    }
    return usage;
  } catch {
    return empty;
  }
}
