import { cloneProfile, defaultProfile } from "./defaultProfile";
import { validateProfile } from "./schema";
import { mapResumeJsonToProfile } from "./importMapper";
import { parseResumeText } from "./resumeTextParser";
import {
  activeLibrary,
  addLibrary,
  assembleProfile,
  loadStore,
  profileForLibrary,
  saveStore,
  splitProfile,
  subscribeStoreChanges,
  writeLibraryContent,
  type ProfileLibrary,
  type ProfileStore,
} from "./libraryStore";
import type { Profile, ProfileExportFile } from "../types/profile";
import type { ProfileType } from "../job/profileTypes";
import { LogEvent, logger } from "../utils/logger";

/**
 * Profile 读写门面。
 *
 * 存储层已经变成「多资料库」（见 libraryStore.ts），本模块负责把
 * 「当前资料库」暴露成单份 Profile —— 管线（Matcher / Resolver / Risk）与
 * 编辑器都不需要知道多库的存在。
 *
 * 约定：
 * - 读：公共信息 + 当前库内容 → 完整 Profile
 * - 写：完整 Profile 拆回（公共信息写 shared，其余写当前库）
 * - 校验失败一律拒绝写入，现有资料不受影响
 */

export { loadStore, saveStore, defaultProfile };
export type { ProfileLibrary, ProfileStore };

/** 导入落点：覆盖当前库，还是新建一个库 */
export type ImportTarget =
  | { kind: "active" }
  | { kind: "new"; name: string; directions: ProfileType[] };

export interface ImportOptions {
  mode?: "replace" | "merge";
  current?: Profile;
  target?: ImportTarget;
}

export type CommitResult =
  | {
      ok: true;
      profile: Profile;
      libraryId: string;
      libraryName: string;
      /** 部分导入时必须如实告知：输入里有内容、却没映射进 Profile 的块 */
      warnings?: string[];
    }
  | { ok: false; errors: string[] };

/* ------------------------------------------------------------------ *
 * 单份 Profile 的读写（管线与编辑器的入口）
 * ------------------------------------------------------------------ */

/** 读取当前资料库对应的完整 Profile */
export async function loadProfile(): Promise<Profile> {
  const store = await loadStore();
  return profileForLibrary(store, store.activeLibraryId);
}

/** 把完整 Profile 写回：公共信息进 shared，其余进当前库 */
export async function saveProfile(profile: Profile): Promise<void> {
  const store = await loadStore();
  const split = splitProfile(profile);
  await saveStore(writeLibraryContent(store, store.activeLibraryId, split.content, split.shared));
  logger.event(LogEvent.PROFILE_SAVED, "资料已保存到当前资料库");
}

export function buildExportFile(profile: Profile): ProfileExportFile {
  return { kind: "application-form-assistant/profile", version: 1, profile };
}

/**
 * 把一份完整 Profile 落到指定库。
 * target=active → 覆盖当前库（公共信息同时更新）；
 * target=new    → 新建一个库装这份资料，并把它设为当前库。
 */
export async function commitProfile(incoming: Profile, opts: ImportOptions = {}): Promise<CommitResult> {
  const validated = validateProfile(incoming);
  if (!validated.ok) {
    logger.event(LogEvent.PROFILE_IMPORT_REJECTED, "资料未通过校验，已拒绝写入", validated.errors);
    return {
      ok: false,
      errors: ["资料未通过校验（现有资料未受影响）", ...validated.errors.slice(0, 8)],
    };
  }

  const split = splitProfile(validated.profile);
  let store = await loadStore();

  if (opts.target?.kind === "new") {
    const added = addLibrary(store, { name: opts.target.name, directions: opts.target.directions });
    store = added.store;
    store = writeLibraryContent(store, added.library.id, split.content, split.shared);
  } else {
    store = writeLibraryContent(store, store.activeLibraryId, split.content, split.shared);
  }

  await saveStore(store);
  const lib = activeLibrary(store);
  logger.event(LogEvent.PROFILE_IMPORTED, `资料已写入资料库「${lib.name}」`);
  return {
    ok: true,
    profile: assembleProfile(store.shared, lib.content),
    libraryId: lib.id,
    libraryName: lib.name,
  };
}

/* ------------------------------------------------------------------ *
 * JSON 导入
 * ------------------------------------------------------------------ */

/**
 * 导入 Profile JSON：
 * 校验失败 → 拒绝写入并返回错误列表（现有 Profile 不受影响）。
 */
export async function importProfileJson(jsonText: string, opts: ImportOptions = {}): Promise<CommitResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    logger.event(LogEvent.PROFILE_IMPORT_REJECTED, "导入失败：JSON 语法错误");
    return { ok: false, errors: [`JSON 语法错误: ${String(err)}`] };
  }

  // 兼容裸 Profile 与导出包装格式两种输入
  const candidate = isRecordWrapper(parsed) ? parsed.profile : parsed;

  const validated = validateProfile(candidate);
  if (validated.ok) return commitProfile(validated.profile, opts);

  // 原生校验失败 → 尝试按「简历母版 JSON」自适应映射；
  // 映射产物必须再过一次 validateProfile 复检才允许写入（fail-safe 双保险）。
  const mapped = mapResumeJsonToProfile(candidate);
  if (mapped.ok) {
    const committed = await commitProfile(mapped.profile, opts);
    if (committed.ok) {
      logger.event(LogEvent.PROFILE_IMPORTED, "Profile 导入成功（简历格式自适应映射）");
      // 允许部分导入，但绝不谎报：哪些块没吃进去、哪些顶层键不认识，一律回给用户
      const warnings: string[] = [];
      if (mapped.ignoredBlocks.length) {
        warnings.push(`以下块在 JSON 里有内容，但没能映射进资料（请检查块名或字段名）：${mapped.ignoredBlocks.join("、")}`);
      }
      if (mapped.unknownTopKeys.length) {
        warnings.push(`这些顶层键本应用不认识，已跳过：${mapped.unknownTopKeys.join("、")}`);
      }
      if (warnings.length) {
        committed.warnings = warnings;
        logger.event(LogEvent.PROFILE_IMPORTED, `部分导入完成，${warnings.length} 条提示`);
      }
    } else {
      logger.event(LogEvent.PROFILE_IMPORT_REJECTED, "导入失败：简历映射产物未通过复检", committed.errors);
      committed.errors.unshift("简历格式映射后的数据未通过校验（现有数据未受影响）");
    }
    return committed;
  }

  logger.event(LogEvent.PROFILE_IMPORT_REJECTED, "导入失败：不符合 Profile / 简历格式", mapped.errors);
  return {
    ok: false,
    errors: [
      "不符合 Profile 格式，也无法识别为可映射的简历格式（现有数据未受影响）",
      ...mapped.errors.slice(0, 8),
    ],
  };
}

function isRecordWrapper(v: unknown): v is { kind: string; profile: Profile } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (v as Record<string, unknown>).kind === "application-form-assistant/profile"
  );
}

/* ------------------------------------------------------------------ *
 * 纯文本导入
 * ------------------------------------------------------------------ */

/**
 * 导入简历纯文本（粘贴 → 解析 → 复检 → 保存）。
 *
 * 与 importProfileJson 同一套安全约定：
 * - 解析不出有效板块 → 拒绝，现有资料不受影响；
 * - 解析产物必须再过一次 validateProfile 才允许写盘（fail-safe 双保险）。
 *
 * mode：
 * - `replace`（默认）：用解析结果替换目标库内容；
 * - `merge`：只补空白项，已有内容一律保留（需传 current）。
 *
 * 预览（不落盘）请直接调用 resumeTextParser 的 parseResumeText。
 */
export async function importResumeText(
  text: string,
  opts: ImportOptions = {},
): Promise<
  { ok: true; profile: Profile; notes: string[]; libraryName: string } | { ok: false; errors: string[] }
> {
  const parsed = parseResumeText(text);
  if (!parsed.ok) {
    logger.event(LogEvent.PROFILE_IMPORT_REJECTED, "简历纯文本解析失败", parsed.errors);
    return { ok: false, errors: parsed.errors };
  }

  const incoming =
    opts.mode === "merge" && opts.current ? mergeBlankProfile(opts.current, parsed.profile) : parsed.profile;

  const committed = await commitProfile(incoming, opts);
  if (!committed.ok) return committed;

  return {
    ok: true,
    profile: committed.profile,
    notes: parsed.notes,
    libraryName: committed.libraryName,
  };
}

/* ------------------------------------------------------------------ *
 * 合并（只补空白项）
 * ------------------------------------------------------------------ */

/** 条目是否已有实质内容（任一段文本非空） */
function hasEntryContent(entries: Record<string, unknown>[]): boolean {
  return entries.some((entry) => Object.values(entry).some((v) => typeof v === "string" && v.trim().length > 0));
}

/**
 * 「只填空白项」合并：
 * 基本信息逐字段补空；整块经历 / 技能 / 常用文本仅在现有为空时采用导入结果。
 * 用于「我已经手填了一部分，只想把缺的补上」的场景。
 */
export function mergeBlankProfile(current: Profile, incoming: Profile): Profile {
  const out = cloneProfile(current);

  for (const key of Object.keys(out.basic) as (keyof Profile["basic"])[]) {
    if (!out.basic[key]) out.basic[key] = incoming.basic[key] ?? "";
  }

  if (!hasEntryContent(out.education as unknown as Record<string, unknown>[])) out.education = incoming.education;
  if (!hasEntryContent(out.internships as unknown as Record<string, unknown>[])) out.internships = incoming.internships;
  if (!hasEntryContent(out.campus as unknown as Record<string, unknown>[])) out.campus = incoming.campus;
  if (!hasEntryContent(out.projects as unknown as Record<string, unknown>[])) out.projects = incoming.projects;

  for (const key of ["technical", "tools", "languages", "certificates", "awards"] as const) {
    if (out.skills[key].length === 0) out.skills[key] = incoming.skills[key];
  }

  for (const key of ["expectedCity", "expectedPosition"] as const) {
    if (out.jobPreferences[key].length === 0) out.jobPreferences[key] = incoming.jobPreferences[key];
  }
  for (const key of ["expectedSalary", "availableDate", "employmentType", "expectedIndustry"] as const) {
    if (!out.jobPreferences[key]) out.jobPreferences[key] = incoming.jobPreferences[key];
  }

  for (const key of ["selfIntroduction", "selfEvaluation", "personalAdvantages", "careerPlan", "hobbies"] as const) {
    if (!out.content[key].long) out.content[key] = incoming.content[key];
  }

  if (out.careerPreferences && incoming.careerPreferences && out.careerPreferences.targetDirections.length === 0) {
    out.careerPreferences = incoming.careerPreferences;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 完成度
 * ------------------------------------------------------------------ */

/**
 * 这份 Profile 到底有没有内容。
 * 空白 Profile 是合法状态（首次安装），但「开始识别」在空资料下必然一项都填不了，
 * 所以投递页要先把它和「可以开始」区分开。
 */
export function profileHasContent(p: Profile): boolean {
  if (Object.values(p.basic).some((v) => v && v.trim())) return true;
  if (p.education.some((e) => e.school.trim() || e.major.trim())) return true;
  if (p.internships.some((e) => e.company.trim() || e.position.trim())) return true;
  if (p.projects.some((e) => e.name.trim())) return true;
  if (p.campus.some((e) => e.organization.trim() || e.position.trim())) return true;
  if (p.skills.technical.length || p.skills.tools.length || p.skills.certificates.length) return true;
  if (Object.values(p.content).some((c) => c.short.trim() || c.medium.trim() || c.long.trim())) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * 订阅
 * ------------------------------------------------------------------ */

/** 监听「当前资料库」的外部变化（例如多个 Side Panel 实例） */
export function subscribeProfileChanges(cb: (profile: Profile | null) => void): () => void {
  return subscribeStoreChanges((store) => {
    cb(store ? profileForLibrary(store, store.activeLibraryId) : null);
  });
}
