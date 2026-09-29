import type { GenerationSnapshot } from "./types";

/** Generation Snapshot 存储（spec 第二十一章）：最近 20 条，Debug 用 */
const STORAGE_KEY = "afa.generation.snapshots.v1";
const MAX_SNAPSHOTS = 20;

export async function saveSnapshot(snapshot: GenerationSnapshot): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const list = await loadSnapshots();
  list.unshift(snapshot);
  await chrome.storage.local.set({
    [STORAGE_KEY]: list.slice(0, MAX_SNAPSHOTS),
  });
}

export async function loadSnapshots(): Promise<GenerationSnapshot[]> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return [];
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (Array.isArray(raw)) return raw as GenerationSnapshot[];
  } catch {
    // ignore
  }
  return [];
}
