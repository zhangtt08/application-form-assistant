import type {
  BasicProfile,
  CampusExperienceEntry,
  CareerPreferences,
  ContentProfile,
  EducationEntry,
  InternshipEntry,
  JobPreferences,
  Profile,
  ProjectEntry,
  SensitiveProfile,
  SkillsProfile,
} from "../types/profile";
import { PROFILE_TYPES, type ProfileType } from "../job/profileTypes";
import { cloneProfile, defaultProfile } from "./defaultProfile";
import { validateProfile } from "./schema";
import { LogEvent, logger } from "../utils/logger";

/**
 * 资料库（Profile Library）。
 *
 * 为什么要有多个库：一个人的「简历」不是一个整体 —— 投产品岗和投运营岗会准备
 * 两套不同的经历侧重；不同批次的岗位甚至会用不同的版本。单库模型逼用户每次
 * 改来改去，且改完就回不去了。
 *
 * 两层结构：
 * - **公共信息（shared）**：姓名 / 联系方式 / 教育背景 / 敏感信息 —— 每个岗位都一样，
 *   只存一份，改一次全库生效（避免「哪个库里的手机号是旧的」）。
 * - **库内容（content）**：经历 / 技能 / 求职意向 / 常用文本 —— 每个库各自一份。
 *
 * 选库：按识别出的岗位方向自动挑（`selectLibraryForDirection`），投递页可手动换。
 * 库内仍保留「岗位方向变体」（同一段经历换个说法），顺序是
 * **库优先放固定内容，AI 只在缺的时候兜底**。
 *
 * 兼容：单库时代的 `afa.profile.v1` 仍是「当前资料库」的镜像，保存时同步写一份，
 * 旧版扩展 / 脚本 / e2e 继续可用。
 */

export const STORE_KEY = "afa.profiles.v2";
/** 单库时代的 key：作为「当前库」的镜像继续维护 */
export const LEGACY_KEY = "afa.profile.v1";

export interface SharedProfile {
  basic: BasicProfile;
  education: EducationEntry[];
  sensitive: SensitiveProfile;
}

export interface LibraryContent {
  internships: InternshipEntry[];
  campus: CampusExperienceEntry[];
  projects: ProjectEntry[];
  skills: SkillsProfile;
  jobPreferences: JobPreferences;
  careerPreferences?: CareerPreferences;
  content: ContentProfile;
}

export interface ProfileLibrary {
  id: string;
  name: string;
  /** 适用的岗位方向（可多选）；空数组 = 通用兜底库，任何方向都能用 */
  directions: ProfileType[];
  note: string;
  content: LibraryContent;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileStore {
  schemaVersion: 2;
  shared: SharedProfile;
  libraries: ProfileLibrary[];
  activeLibraryId: string;
}

/* ------------------------------------------------------------------ *
 * 拆分 / 组装
 * ------------------------------------------------------------------ */

export function splitProfile(profile: Profile): { shared: SharedProfile; content: LibraryContent } {
  return {
    shared: {
      basic: structuredClone(profile.basic),
      education: structuredClone(profile.education),
      sensitive: structuredClone(profile.sensitive),
    },
    content: {
      internships: structuredClone(profile.internships),
      campus: structuredClone(profile.campus),
      projects: structuredClone(profile.projects),
      skills: structuredClone(profile.skills),
      jobPreferences: structuredClone(profile.jobPreferences),
      ...(profile.careerPreferences ? { careerPreferences: structuredClone(profile.careerPreferences) } : {}),
      content: structuredClone(profile.content),
    },
  };
}

/** 公共信息 + 某个库的内容 → 运行时使用的完整 Profile（管线的输入） */
export function assembleProfile(shared: SharedProfile, content: LibraryContent): Profile {
  return {
    basic: structuredClone(shared.basic),
    education: structuredClone(shared.education),
    sensitive: structuredClone(shared.sensitive),
    internships: structuredClone(content.internships),
    campus: structuredClone(content.campus),
    projects: structuredClone(content.projects),
    skills: structuredClone(content.skills),
    jobPreferences: structuredClone(content.jobPreferences),
    ...(content.careerPreferences ? { careerPreferences: structuredClone(content.careerPreferences) } : {}),
    content: structuredClone(content.content),
  };
}

export function emptyContent(): LibraryContent {
  const split = splitProfile(cloneProfile(defaultProfile));
  return split.content;
}

export function emptyShared(): SharedProfile {
  const split = splitProfile(cloneProfile(defaultProfile));
  return split.shared;
}

/* ------------------------------------------------------------------ *
 * 建库 / 选库（纯函数，可测试）
 * ------------------------------------------------------------------ */

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function makeLibraryId(): string {
  let s = "";
  for (let i = 0; i < 8; i += 1) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return `lib_${Date.now().toString(36)}_${s}`;
}

export function createLibrary(input: {
  name: string;
  directions?: ProfileType[];
  note?: string;
  content?: LibraryContent;
}): ProfileLibrary {
  const now = new Date().toISOString();
  return {
    id: makeLibraryId(),
    name: input.name.trim() || "未命名资料库",
    directions: sanitizeDirections(input.directions ?? []),
    note: input.note ?? "",
    content: input.content ? structuredClone(input.content) : emptyContent(),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeDirections(list: ProfileType[]): ProfileType[] {
  return Array.from(new Set(list.filter((t) => PROFILE_TYPES.includes(t))));
}

export function createDefaultStore(): ProfileStore {
  const shared = emptyShared();
  const library = createLibrary({ name: "默认资料库", directions: [] });
  return { schemaVersion: 2, shared, libraries: [library], activeLibraryId: library.id };
}

export function findLibrary(store: ProfileStore, id: string | null): ProfileLibrary | undefined {
  if (!id) return undefined;
  return store.libraries.find((l) => l.id === id);
}

export function activeLibrary(store: ProfileStore): ProfileLibrary {
  return findLibrary(store, store.activeLibraryId) ?? store.libraries[0]!;
}

/** 当前库对应的完整 Profile */
export function profileForLibrary(store: ProfileStore, id: string): Profile {
  const lib = findLibrary(store, id) ?? activeLibrary(store);
  return assembleProfile(store.shared, lib.content);
}

/**
 * 按岗位方向挑库。
 * 优先级：方向精确命中（命中越少的越「专用」）> 通用兜底库（directions 为空）> 当前库 > 第一个。
 */
export function selectLibraryForDirection(store: ProfileStore, direction: ProfileType): ProfileLibrary {
  const exact = store.libraries
    .filter((l) => l.directions.includes(direction))
    .sort((a, b) => a.directions.length - b.directions.length);
  const first = exact[0];
  if (first) return first;

  const fallback = store.libraries.find((l) => l.directions.length === 0);
  if (fallback) return fallback;

  return findLibrary(store, store.activeLibraryId) ?? store.libraries[0]!;
}

/** 该库是否「专门」覆盖这个方向（用于 UI 提示「这是兜底库」） */
export function isDirectionCovered(library: ProfileLibrary, direction: ProfileType): boolean {
  if (library.directions.length === 0) return false;
  return library.directions.includes(direction);
}

/* ------------------------------------------------------------------ *
 * 结构修复（读盘时用：老版本数据缺新字段要补，不整库丢弃）
 * ------------------------------------------------------------------ */

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function strRecord(v: unknown, template: Record<string, string>): Record<string, string> {
  const src = rec(v);
  const out: Record<string, string> = {};
  for (const key of Object.keys(template)) out[key] = str(src[key], template[key] ?? "");
  return out;
}

function repairEntries<T extends Record<string, unknown>>(v: unknown, template: T): T[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    const src = rec(item);
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(template)) {
      if (Array.isArray(def)) out[key] = strArr(src[key]);
      else if (typeof def === "object" && def !== null) out[key] = strRecord(src[key], def as Record<string, string>);
      else out[key] = str(src[key], typeof def === "string" ? def : "");
    }
    return out as T;
  });
}

/** 按默认 Profile 的形状补齐缺失字段（只修形状，不改内容） */
export function repairProfileShape(input: unknown): Profile {
  const base = cloneProfile(defaultProfile);
  const src = rec(input);
  return {
    basic: strRecord(src.basic, base.basic as unknown as Record<string, string>) as unknown as BasicProfile,
    education: repairEntries(src.education, base.education[0]! as unknown as Record<string, unknown>) as unknown as EducationEntry[],
    internships: repairEntries(src.internships, base.internships[0]! as unknown as Record<string, unknown>) as unknown as InternshipEntry[],
    campus: repairEntries(src.campus, {
      organization: "", department: "", position: "", startDate: "", endDate: "",
      descriptionShort: "", descriptionMedium: "", descriptionLong: "",
      responsibilities: "", workContent: "", achievements: "", summary: "",
      variants: { ...base.campus[0]?.variants ?? base.internships[0]!.variants },
    } as unknown as Record<string, unknown>) as unknown as CampusExperienceEntry[],
    projects: repairEntries(src.projects, base.projects[0]! as unknown as Record<string, unknown>) as unknown as ProjectEntry[],
    skills: {
      technical: strArr(rec(src.skills).technical),
      tools: strArr(rec(src.skills).tools),
      languages: strArr(rec(src.skills).languages),
      certificates: strArr(rec(src.skills).certificates),
      awards: strArr(rec(src.skills).awards),
    } as SkillsProfile,
    jobPreferences: {
      expectedCity: strArr(rec(src.jobPreferences).expectedCity),
      expectedPosition: strArr(rec(src.jobPreferences).expectedPosition),
      expectedSalary: str(rec(src.jobPreferences).expectedSalary),
      availableDate: str(rec(src.jobPreferences).availableDate),
      employmentType: str(rec(src.jobPreferences).employmentType),
      expectedIndustry: str(rec(src.jobPreferences).expectedIndustry),
    } as JobPreferences,
    ...(rec(src.careerPreferences).targetDirections !== undefined
      ? {
          careerPreferences: {
            targetDirections: strArr(rec(src.careerPreferences).targetDirections),
            preferredWorkTypes: strArr(rec(src.careerPreferences).preferredWorkTypes),
            developmentGoals: strArr(rec(src.careerPreferences).developmentGoals),
          } as CareerPreferences,
        }
      : {}),
    content: {
      selfIntroduction: strRecord(rec(src.content).selfIntroduction, base.content.selfIntroduction as unknown as Record<string, string>) as unknown as ContentProfile["selfIntroduction"],
      selfEvaluation: strRecord(rec(src.content).selfEvaluation, base.content.selfEvaluation as unknown as Record<string, string>) as unknown as ContentProfile["selfEvaluation"],
      personalAdvantages: strRecord(rec(src.content).personalAdvantages, base.content.personalAdvantages as unknown as Record<string, string>) as unknown as ContentProfile["personalAdvantages"],
      careerPlan: strRecord(rec(src.content).careerPlan, base.content.careerPlan as unknown as Record<string, string>) as unknown as ContentProfile["careerPlan"],
      hobbies: strRecord(rec(src.content).hobbies, base.content.hobbies as unknown as Record<string, string>) as unknown as ContentProfile["hobbies"],
    },
    sensitive: strRecord(src.sensitive, base.sensitive as unknown as Record<string, string>) as unknown as SensitiveProfile,
  };
}

/* ------------------------------------------------------------------ *
 * 读盘 / 落盘
 * ------------------------------------------------------------------ */

function coerceStore(raw: unknown): ProfileStore | null {
  const src = rec(raw);
  if (!Array.isArray(src.libraries)) return null;

  const sharedSplit = splitProfile(repairProfileShape(src.shared));

  const libraries: ProfileLibrary[] = [];
  for (const item of src.libraries) {
    const l = rec(item);
    const id = str(l.id);
    if (!id) continue;
    const contentProfile = repairProfileShape({ ...rec(l.content), basic: {}, education: [], sensitive: {} });
    const contentSplit = splitProfile(contentProfile);
    libraries.push({
      id,
      name: str(l.name) || "未命名资料库",
      directions: sanitizeDirections(
        (Array.isArray(l.directions) ? l.directions : []).filter((x): x is ProfileType =>
          PROFILE_TYPES.includes(x as ProfileType),
        ),
      ),
      note: str(l.note),
      content: contentSplit.content,
      createdAt: str(l.createdAt) || new Date().toISOString(),
      updatedAt: str(l.updatedAt) || new Date().toISOString(),
    });
  }

  if (libraries.length === 0) return null;

  const activeId = str(src.activeLibraryId);
  return {
    schemaVersion: 2,
    shared: sharedSplit.shared,
    libraries,
    activeLibraryId: libraries.some((l) => l.id === activeId) ? activeId : libraries[0]!.id,
  };
}

/** 单库时代的 Profile → v2 store（一个「默认资料库」，覆盖全部方向） */
export function migrateFromLegacyProfile(raw: unknown): ProfileStore {
  const validated = validateProfile(raw);
  const profile = validated.ok ? validated.profile : repairProfileShape(raw);
  const split = splitProfile(profile);
  const library = createLibrary({
    name: "默认资料库",
    directions: [],
    note: "由单资料库版本自动迁移",
    content: split.content,
  });
  return { schemaVersion: 2, shared: split.shared, libraries: [library], activeLibraryId: library.id };
}

function storageAvailable(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

/**
 * 上一次 loadStore 发现的问题（例如资料库数据损坏）。
 * 侧边栏是单实例，用模块级状态把它带到界面上提示，而不是静默用空数据覆盖用户简历。
 */
let loadProblem: string | null = null;
export function getStoreLoadProblem(): string | null {
  return loadProblem;
}

const CORRUPT_BACKUP_KEY = "afa.profiles.v2.corrupt";

export async function loadStore(): Promise<ProfileStore> {
  if (!storageAvailable()) return createDefaultStore();
  try {
    const result = await chrome.storage.local.get([STORE_KEY, LEGACY_KEY]);
    const v2 = coerceStore(result[STORE_KEY]);
    if (v2) {
      loadProblem = null;
      return v2;
    }

    const legacy = result[LEGACY_KEY];
    if (legacy) {
      const migrated = migrateFromLegacyProfile(legacy);
      await saveStore(migrated);
      logger.event(LogEvent.PROFILE_IMPORTED, "afa.profile.v1 → afa.profiles.v2 已迁移");
      return migrated;
    }

    // v2 有内容但解析不出来 = 数据损坏。必须先原样备份再回退默认值：
    // 回退后的第一次保存会直接覆盖这个 key，不备份就是简历永久丢失。
    if (result[STORE_KEY] != null) {
      await chrome.storage.local.set({ [CORRUPT_BACKUP_KEY]: result[STORE_KEY] });
      loadProblem = `资料库数据无法读取，已把原始内容备份到「${CORRUPT_BACKUP_KEY}」。现在显示的是空白资料，请先导出留底再联系排查。`;
      logger.error(loadProblem);
    }
  } catch (err) {
    logger.error("读取资料库失败，回退默认值", err);
    loadProblem = `读取资料库失败：${String(err)}`;
  }
  return createDefaultStore();
}

export async function saveStore(store: ProfileStore): Promise<void> {
  if (!storageAvailable()) return;
  const profile = assembleProfile(store.shared, activeLibrary(store).content);
  await chrome.storage.local.set({
    [STORE_KEY]: store,
    // 镜像：单库时代的 key 仍指向「当前资料库」，保持向下兼容
    [LEGACY_KEY]: profile,
  });
  logger.event(LogEvent.PROFILE_SAVED, `资料库已保存（${store.libraries.length} 个库）`);
}

/** 监听资料库变化（多个 Side Panel 实例同步） */
export function subscribeStoreChanges(cb: (store: ProfileStore | null) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local") return;
    if (!(STORE_KEY in changes) && !(LEGACY_KEY in changes)) return;
    const raw = changes[STORE_KEY]?.newValue;
    cb(coerceStore(raw));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* ------------------------------------------------------------------ *
 * 库管理（不可变操作，返回新 store）
 * ------------------------------------------------------------------ */

export function addLibrary(
  store: ProfileStore,
  input: { name: string; directions?: ProfileType[]; note?: string; copyFromLibraryId?: string },
): { store: ProfileStore; library: ProfileLibrary } {
  const source = input.copyFromLibraryId ? findLibrary(store, input.copyFromLibraryId) : undefined;
  const library = createLibrary({
    name: input.name,
    directions: input.directions,
    note: input.note,
    content: source ? source.content : undefined,
  });
  return {
    store: { ...store, libraries: [...store.libraries, library], activeLibraryId: library.id },
    library,
  };
}

export function updateLibraryMeta(
  store: ProfileStore,
  id: string,
  patch: Partial<Pick<ProfileLibrary, "name" | "directions" | "note">>,
): ProfileStore {
  return {
    ...store,
    libraries: store.libraries.map((l) =>
      l.id === id
        ? {
            ...l,
            ...(patch.name !== undefined ? { name: patch.name.trim() || l.name } : {}),
            ...(patch.directions !== undefined ? { directions: sanitizeDirections(patch.directions) } : {}),
            ...(patch.note !== undefined ? { note: patch.note } : {}),
            updatedAt: new Date().toISOString(),
          }
        : l,
    ),
  };
}

export function writeLibraryContent(
  store: ProfileStore,
  id: string,
  content: LibraryContent,
  shared?: SharedProfile,
): ProfileStore {
  return {
    ...store,
    ...(shared ? { shared: structuredClone(shared) } : {}),
    libraries: store.libraries.map((l) =>
      l.id === id ? { ...l, content: structuredClone(content), updatedAt: new Date().toISOString() } : l,
    ),
  };
}

export function removeLibrary(store: ProfileStore, id: string): ProfileStore {
  if (store.libraries.length <= 1) return store; // 至少留一个库
  const libraries = store.libraries.filter((l) => l.id !== id);
  return {
    ...store,
    libraries,
    activeLibraryId: store.activeLibraryId === id ? libraries[0]!.id : store.activeLibraryId,
  };
}

export function setActiveLibraryId(store: ProfileStore, id: string): ProfileStore {
  if (!findLibrary(store, id)) return store;
  return { ...store, activeLibraryId: id };
}

/** 库的展示副标题：覆盖了哪些方向 */
export function describeDirections(library: ProfileLibrary, labelOf: (t: ProfileType) => string): string {
  if (library.directions.length === 0) return "通用（任何方向都能用）";
  return library.directions.map(labelOf).join(" · ");
}
