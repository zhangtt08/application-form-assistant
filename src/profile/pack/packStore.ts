import type { StorageLike } from "../../workspace/jobRepository";
import { buildDefaultPacks, PROFILE_TYPE_TO_PACK_ID } from "./defaultPacks";
import type { ProfilePack, ProfilePackStorage, ProfilePackSelectionSource } from "./types";

/**
 * ProfilePack Storage（spec 第二十五~二十七章）：afa.profilepacks.v1。
 * - 与 Master Profile 分开存储（Pack 是配置层，不是事实源）
 * - activeProfilePackId 是一级状态：无 Job/无 AI 也能选库 → 扫描 → 填写
 * - 删除 active pack → fallback default pack → 再 fallback general
 * - 迁移：旧 afa.jobs.v1 的 effectiveProfileType → 对应默认 Pack
 */

const KEY = "afa.profilepacks.v1";

export type PackBackend = Pick<StorageLike, "get" | "set">;

let backend: PackBackend = {
  async get(key) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
    const res = await chrome.storage.local.get(key);
    return res as Record<string, unknown>;
  },
  async set(key, value) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [key]: value });
  },
};

export function setPackStorageBackend(b: PackBackend): void {
  backend = b;
}

/** 纯函数：注入旧 effectiveProfileType 生成初始存储（迁移，spec 二十四 + Stage 6.5 补丁）：
 * 有 override → manual 锁定；无 override → default */
export function buildInitialPackStorage(oldProfileType: string | null, now: string): ProfilePackStorage {
  const packs = buildDefaultPacks(now);
  const migratedId = oldProfileType ? PROFILE_TYPE_TO_PACK_ID[oldProfileType] : undefined;
  return {
    schemaVersion: 1,
    packs,
    activeProfilePackId: migratedId ?? "pack-general",
    selectionSource: oldProfileType ? "migration" : "default",
  };
}

async function loadStorage(): Promise<ProfilePackStorage> {
  const raw = await backend.get(KEY);
  const rec = raw[KEY] as ProfilePackStorage | undefined;
  if (rec && Array.isArray(rec.packs) && rec.packs.length > 0) return rec;
  // 首次启动 / 数据损坏 → 默认 Pack（spec 三十七章：不崩溃）
  const oldOverride = await readLegacyOverride();
  return buildInitialPackStorage(oldOverride, new Date().toISOString());
}

/** 读旧 profileOverride（afa.jobs.v1.profileOverride）做一次性迁移映射 */
async function readLegacyOverride(): Promise<string | null> {
  try {
    const raw = await backend.get("afa.jobs.v1");
    const rec = raw["afa.jobs.v1"] as { profileOverride?: unknown } | undefined;
    return typeof rec?.profileOverride === "string" ? rec.profileOverride : null;
  } catch {
    return null;
  }
}

async function saveStorage(s: ProfilePackStorage): Promise<void> {
  await backend.set(KEY, s);
}

// ---------- CRUD ----------

export async function listPacks(): Promise<ProfilePack[]> {
  return (await loadStorage()).packs;
}

export async function getActivePack(): Promise<ProfilePack> {
  const s = await loadStorage();
  return resolveActivePack(s);
}

/** 纯函数：active → default → general 三级 fallback（spec 二十六章） */
export function resolveActivePack(s: ProfilePackStorage): ProfilePack {
  const active = s.packs.find((p) => p.id === s.activeProfilePackId);
  if (active) return active;
  const defaultPack = s.packs.find((p) => p.isDefault);
  if (defaultPack) return defaultPack;
  const general = s.packs.find((p) => p.variantType === "general");
  if (general) return general;
  // 极端情况：packs 为空 → 用 default seeds 重建
  return buildDefaultPacks(new Date().toISOString())[5]!;
}

export async function getPack(packId: string): Promise<ProfilePack | null> {
  return (await loadStorage()).packs.find((p) => p.id === packId) ?? null;
}

export async function createPack(input: Partial<ProfilePack> & { name: string }): Promise<ProfilePack> {
  const s = await loadStorage();
  const now = new Date().toISOString();
  const pack: ProfilePack = {
    id: `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    description: input.description ?? "",
    enabled: input.enabled ?? true,
    isDefault: false, // 默认标记只属于内置 general（用户可另设 default，但系统初始 general）
    matchRules: input.matchRules ?? { jobTitles: [], keywords: [], excludeKeywords: [] },
    selectedExperienceIds: input.selectedExperienceIds ?? [],
    experienceOrder: input.experienceOrder ?? [],
    variantType: input.variantType ?? "general",
    fieldContents: input.fieldContents ?? {},
    createdAt: now,
    updatedAt: now,
  };
  s.packs.push(pack);
  await saveStorage(s);
  return pack;
}

export async function updatePack(packId: string, patch: Partial<ProfilePack>): Promise<ProfilePack | null> {
  const s = await loadStorage();
  const pack = s.packs.find((p) => p.id === packId);
  if (!pack) return null;
  const updated: ProfilePack = { ...pack, ...patch, id: pack.id, createdAt: pack.createdAt, updatedAt: new Date().toISOString() };
  s.packs = s.packs.map((p) => (p.id === packId ? updated : p));
  await saveStorage(s);
  return updated;
}

/** 删除（spec 二十七章）：删除的只是配置层；若删的是 active → fallback；isDefault 不可删 */
export async function deletePack(packId: string): Promise<{ ok: boolean; reason?: string; fallbackTo?: string }> {
  const s = await loadStorage();
  const pack = s.packs.find((p) => p.id === packId);
  if (!pack) return { ok: false, reason: "not-found" };
  if (pack.isDefault) return { ok: false, reason: "cannot-delete-default" };
  s.packs = s.packs.filter((p) => p.id !== packId);
  let fallbackTo: string | undefined;
  if (s.activeProfilePackId === packId) {
    const fallback = resolveActivePack({ ...s, activeProfilePackId: packId });
    s.activeProfilePackId = fallback.id;
    fallbackTo = fallback.id;
  }
  await saveStorage(s);
  return { ok: true, fallbackTo };
}

/** 用户手动选择（含「使用」按钮与推荐 banner 点「切换」——用户确认即 manual） */
export async function setActivePack(packId: string): Promise<boolean> {
  const s = await loadStorage();
  if (!s.packs.some((p) => p.id === packId)) return false;
  s.activeProfilePackId = packId;
  s.selectionSource = "manual";
  await saveStorage(s);
  return true;
}

/** 「恢复自动匹配」：清除 manual 锁定，deterministic matcher 重新成为 effective source */
export async function restoreAutoMatch(matchedPackId: string | null): Promise<ProfilePack> {
  const s = await loadStorage();
  const target = matchedPackId && s.packs.some((p) => p.id === matchedPackId) ? matchedPackId : resolveActivePack(s).id;
  s.activeProfilePackId = target;
  s.selectionSource = "matched";
  await saveStorage(s);
  return resolveActivePack(s);
}

export async function getSelectionSource(): Promise<ProfilePackSelectionSource> {
  return (await loadStorage()).selectionSource;
}

export async function getActivePackId(): Promise<string> {
  return (await loadStorage()).activeProfilePackId;
}

/**
 * Effective Pack 优先级（显式 selectionSource，禁止推断）：
 * manual/migration → active 永不自动替换（matched 只出 banner）；
 * matched → deterministic matcher 生效；default → matched ?? active。
 */
export async function getEffectivePack(matchedPackId: string | null): Promise<ProfilePack> {
  const s = await loadStorage();
  const active = resolveActivePack(s);
  if (s.selectionSource === "manual" || s.selectionSource === "migration") return active;
  if (matchedPackId) {
    const matched = s.packs.find((p) => p.id === matchedPackId);
    if (matched) return matched;
  }
  return active;
}

/** 复制资料库（Stage 6.6 资料库列表页）：名称加「副本」，深拷贝全部配置；复制结果不自动激活 */
export async function copyPack(packId: string): Promise<ProfilePack | null> {
  const s = await loadStorage();
  const src = s.packs.find((p) => p.id === packId);
  if (!src) return null;
  const now = new Date().toISOString();
  const copy: ProfilePack = {
    ...JSON.parse(JSON.stringify(src)),
    id: `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${src.name} 副本`,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  s.packs.push(copy);
  await saveStorage(s);
  return copy;
}
