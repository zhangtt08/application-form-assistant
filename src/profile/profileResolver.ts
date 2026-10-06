import type { ExperienceVariants, Profile } from "../types/profile";
import type { ResolvedValue } from "../types/field";
import { VARIANT_KEY_BY_TYPE, type ProfileType } from "../job/profileTypes";
import type { ProfilePack } from "./pack/types";

/**
 * Profile Resolver：canonical field id → 用户 Profile 值。
 * 敏感字段（sensitive.*）与未知 id 一律返回 undefined，绝不提供可填写内容。
 *
 * v2.0：ResolveOptions.profileType 由 Active Job Context 的岗位方向决定；
 * 经历描述类字段（internship/project/campus description）优先取该方向的
 * variants 表达版本（若有），未配置变体则回退默认事实表达。
 */

export interface ResolveOptions {
  /** 多条目字段（教育/实习/项目）取第几条，默认 0 */
  entryIndex?: number;
  /** 当前岗位方向（Active Job Context → Profile Router），决定经历表达变体 */
  profileType?: ProfileType;
  /** Stage 6.5：Effective Profile Pack（优先级高于 profileType；只引用不复制事实） */
  pack?: ProfilePack;
}

/** 「是否有 X 经历」这类是非题 → 依据哪一段条目的存在性推导（只在有条目时答「是」） */
const DERIVED_PRESENCE_IDS: Record<string, "internships" | "projects"> = {
  "internship.hasExperience": "internships",
  "project.hasExperience": "projects",
};

/** 旧版 Profile 里这几项存在 sensitive 块，新字段为空时的回退来源 */
const LEGACY_SENSITIVE_SOURCE: Partial<Record<string, keyof Profile["sensitive"]>> = {
  politicalStatus: "politicalStatus",
  maritalStatus: "maritalStatus",
  idNumber: "idNumber",
};

/**
 * 多条目取第 index 条。
 * index 越界时返回 undefined（这一栏留空），绝不把最后一条重复填进多余的表单块——
 * 「三条实习栏填了同一家公司」就是用户说的填错位置。
 */
function pickEntry<T>(entries: T[], index: number | undefined): T | undefined {
  const i = index ?? 0;
  if (i < 0 || i >= entries.length) return undefined;
  return entries[i];
}

/** 当前岗位方向对应的经历变体（general/未配置 → undefined，回退默认表达） */
function variantFor(
  entry: { variants?: ExperienceVariants },
  profileType: ProfileType | undefined,
): { text: string; key: string } | undefined {
  if (!profileType || profileType === "general") return undefined;
  const key = VARIANT_KEY_BY_TYPE[profileType];
  if (!key) return undefined;
  const text = entry.variants?.[key];
  return text ? { text, key } : undefined;
}

export function resolveValue(
  fieldId: string,
  profile: Profile,
  options: ResolveOptions = {},
): ResolvedValue | undefined {
  if (fieldId.startsWith("sensitive.") || fieldId === "risk.manual" || fieldId === "unknown") {
    return undefined;
  }

  const entryIdx = options.entryIndex ?? 0;
  // Stage 6.5：Pack 的 variantType 优先于 Router profileType（Manual Selection > Router）
  const dirType: ProfileType | undefined = options.pack?.variantType ?? options.profileType;
  // Pack experienceOrder：Entry N → pack 排序后的第 N 个经历（`collection-index` 格式）
  const packEntryIdx = (collection: string, total: number): number => {
    const order = options.pack?.experienceOrder ?? [];
    const selected = options.pack?.selectedExperienceIds ?? [];
    const ids = order.length > 0 ? order : selected;
    if (ids.length === 0) return entryIdx;
    const prefix = `${collection}-`;
    const scoped = ids.filter((id: string) => id.startsWith(prefix));
    if (scoped.length === 0) return entryIdx;
    const id = scoped[entryIdx] ?? scoped[scoped.length - 1]!;
    const parsed = Number(id.split("-")[1]);
    return Number.isFinite(parsed) && parsed < total ? parsed : entryIdx;
  };



  // basic.*
  if (fieldId.startsWith("basic.")) {
    const key = fieldId.slice("basic.".length) as keyof Profile["basic"];
    let value = profile.basic[key];
    if (value === undefined || value === "") {
      // 旧版 Profile 把这几项存在 sensitive 块里：新字段为空时沿用旧位置的值，
      // 免得升级后原本已有的内容突然填不出来（表现为「少填」）。
      const legacy = LEGACY_SENSITIVE_SOURCE[key];
      const fallback = legacy ? profile.sensitive?.[legacy] : undefined;
      if (fallback) value = fallback;
    }
    if (value === undefined || value === "") return undefined;
    return { fieldId, value, variant: "plain", editable: false, sourceType: "fact" };
  }

  /**
   * 「是否有实习经历 / 是否有项目经验」这类是非题：答案由资料库里**已存在的条目**推出。
   *
   * 只单向推导：有条目 → 「是」；条目为空 → 不回答（undefined）。
   * 绝不因为库里暂时没录就答「否」——那是替用户做一个可能不实的声明，
   * 而「没填」和「没有」是两回事。
   */
  const derived = DERIVED_PRESENCE_IDS[fieldId];
  if (derived) {
    return profile[derived].length > 0
      ? { fieldId, value: "是", variant: "plain", editable: false, sourceType: "fact", sourcePath: `derived(${derived}.length>0)` }
      : undefined;
  }

  // education.*
  if (fieldId.startsWith("education.")) {
    const entry = pickEntry(profile.education, entryIdx);
    if (!entry) return undefined;
    const key = fieldId.slice("education.".length) as keyof typeof entry;
    const value = entry[key];
    if (value === undefined || value === "") return undefined;
    return {
      fieldId,
      value,
      variant: "plain",
      editable: false,
      entryIndex: entryIdx,
      entryCount: profile.education.length,
    };
  }

  // internship.*
  if (fieldId.startsWith("internship.")) {
    const entry = pickEntry(profile.internships, packEntryIdx("internships", profile.internships.length));
    if (!entry) return undefined;
    if (fieldId === "internship.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId, value: dirVariant.text, variant: "plain", editable: true,
          sourceType: "variant", sourcePath: `internships[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.internships.length,
        };
      }
      if (!entry.description.trim()) return undefined;
      return {
        fieldId, value: entry.description, variant: "plain", editable: true,
        sourceType: "default", fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx, entryCount: profile.internships.length,
      };
    }
    const key = fieldId.slice("internship.".length) as keyof typeof entry;
    const value = entry[key];
    if (typeof value !== "string" || value === "") return undefined; // variants 等非文本字段不填
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.internships.length };
  }

  // campus.*（校园经历，结构与 internship 一致）
  if (fieldId.startsWith("campus.")) {
    const entry = pickEntry(profile.campus, packEntryIdx("campus", profile.campus.length));
    if (!entry) return undefined;
    if (fieldId === "campus.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId, value: dirVariant.text, variant: "plain", editable: true,
          sourceType: "variant", sourcePath: `campus[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.campus.length,
        };
      }
      if (!entry.description.trim()) return undefined;
      return {
        fieldId, value: entry.description, variant: "plain", editable: true,
        sourceType: "default", fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx, entryCount: profile.campus.length,
      };
    }
    const key = fieldId.slice("campus.".length) as keyof typeof entry;
    const value = entry[key];
    if (typeof value !== "string" || value === "") return undefined; // variants 等非文本字段不填
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.campus.length };
  }

  // project.*
  if (fieldId.startsWith("project.")) {
    const entry = pickEntry(profile.projects, packEntryIdx("projects", profile.projects.length));
    if (!entry) return undefined;
    if (fieldId === "project.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId, value: dirVariant.text, variant: "plain", editable: true,
          sourceType: "variant", sourcePath: `projects[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.projects.length,
        };
      }
      if (!entry.description.trim()) return undefined;
      return {
        fieldId, value: entry.description, variant: "plain", editable: true,
        sourceType: "default", fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx, entryCount: profile.projects.length,
      };
    }
    const key = fieldId.slice("project.".length) as keyof typeof entry;
    const value = entry[key];
    if (typeof value !== "string" || value === "") return undefined; // keywords 等非文本字段不填
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.projects.length };
  }

  // skills.*
  if (fieldId.startsWith("skills.")) {
    const key = fieldId.slice("skills.".length) as keyof Profile["skills"];
    const arr = profile.skills[key];
    if (!arr || arr.length === 0) return undefined;
    return { fieldId, value: arr.join("、"), variant: "plain", editable: true, sourceType: "fact" };
  }

  // job.*
  if (fieldId.startsWith("job.")) {
    const key = fieldId.slice("job.".length) as keyof Profile["jobPreferences"];
    const v = profile.jobPreferences[key];
    if (v === undefined || v === "") return undefined;
    const value = Array.isArray(v) ? v.join("、") : v;
    return { fieldId, value, variant: "plain", editable: true, sourceType: "fact" };
  }

  // content.*
  if (fieldId.startsWith("content.")) {
    const key = fieldId.slice("content.".length) as keyof Profile["content"];
    // Stage 6.5：Pack.fieldContents 优先（selfIntroduction/strengths/skills/portfolio）
    const packFields = options.pack?.fieldContents;
    const packText =
      key === "selfIntroduction" ? packFields?.selfIntroduction :
      key === "selfEvaluation" ? packFields?.strengths :
      key === "personalAdvantages" ? packFields?.strengths :
      undefined;
    if (packText && packText.trim()) {
      return { fieldId, value: packText, variant: "plain", editable: true, sourceType: "fact", sourcePath: `profilePack(${options.pack?.id}).${key}` };
    }
    const text = profile.content[key];
    if (!text || !text.trim()) return undefined;
    return { fieldId, value: text, variant: "plain", editable: true, sourceType: "fact" };
  }

  return undefined;
}
