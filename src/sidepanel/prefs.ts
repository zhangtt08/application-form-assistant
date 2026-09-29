/**
 * 「投递」主流程的用户偏好。
 * 与业务数据分开存（afa.apply.prefs.v1），避免和 Profile / Job 混淆。
 */

const STORAGE_KEY = "afa.apply.prefs.v1";

export interface ApplyPrefs {
  /** 识别时顺带尝试从当前页捕获 JD（抓不到就跳过，不报错） */
  autoCaptureJob: boolean;
  /**
   * 识别完成后直接把资料库内容写进页面（默认开）。
   * 关掉之后回到「先看清单、勾选、再填写」的节奏，适合第一次用某个站点时试跑。
   */
  autoFill: boolean;
  /** 开发者模式：显示 Trace 与字段调试信息（放在设置页） */
  showDev: boolean;
}

export const DEFAULT_PREFS: ApplyPrefs = {
  autoCaptureJob: true,
  autoFill: true,
  showDev: false,
};

export async function loadApplyPrefs(): Promise<ApplyPrefs> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return { ...DEFAULT_PREFS };
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (raw && typeof raw === "object") return { ...DEFAULT_PREFS, ...(raw as Partial<ApplyPrefs>) };
  } catch {
    // fallthrough：读取失败用默认值，不阻塞 UI
  }
  return { ...DEFAULT_PREFS };
}

export async function saveApplyPrefs(prefs: ApplyPrefs): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: prefs });
}
