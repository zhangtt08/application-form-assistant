import type { ExperienceVariants, Profile } from "../types/profile";
import type { ResolvedValue, ValueVariant } from "../types/field";
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
  /** 页面 maxlength，决定开放文本用 short/medium/long；null 表示页面无限制 */
  maxLength?: number | null;
  /** 直接指定文本变体（预览 UI 切换 short/medium/long 时用），优先于 maxLength 推断 */
  variantOverride?: "short" | "medium" | "long";
  /** 当前岗位方向（Active Job Context → Profile Router），决定经历表达变体 */
  profileType?: ProfileType;
  /** Stage 6.5：Effective Profile Pack（优先级高于 profileType；只引用不复制事实） */
  pack?: ProfilePack;
}

/** 旧版 Profile 里这几项存在 sensitive 块，新字段为空时的回退来源 */
const LEGACY_SENSITIVE_SOURCE: Partial<Record<string, keyof Profile["sensitive"]>> = {
  politicalStatus: "politicalStatus",
  maritalStatus: "maritalStatus",
  idNumber: "idNumber",
};

/** maxlength → 文本变体。无限制默认 medium（与 spec 十一致） */
export function chooseVariant(maxLength: number | null | undefined): ValueVariant {  if (maxLength == null) return "medium";
  if (maxLength <= 120) return "short";
  if (maxLength <= 350) return "medium";
  return "long";
}

function effectiveVariant(options: ResolveOptions): ValueVariant {
  return options.variantOverride ?? chooseVariant(options.maxLength);
}

/** 资料可能只填写了 medium/short；页面上限很大时不能因 long 为空而丢失已有内容。 */
function pickDescriptionVariant(
  entry: { descriptionShort?: string; descriptionMedium?: string; descriptionLong?: string },
  preferred: ValueVariant,
): { value: string; variant: "short" | "medium" | "long" } | undefined {
  const order: ("short" | "medium" | "long")[] =
    preferred === "short" ? ["short", "medium", "long"] :
      preferred === "long" ? ["long", "medium", "short"] :
        ["medium", "long", "short"];
  for (const key of order) {
    const value = entry[`description${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof entry];
    if (typeof value === "string" && value.trim()) return { value, variant: key };
  }
  return undefined;
}

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
  const variant = effectiveVariant(options);
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
          fieldId, value: dirVariant.text, variant, editable: true,
          sourceType: "variant", sourcePath: `internships[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.internships.length,
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return undefined;
      return {
        fieldId, value: picked.value, variant: picked.variant, editable: true,
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
          fieldId, value: dirVariant.text, variant, editable: true,
          sourceType: "variant", sourcePath: `campus[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.campus.length,
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return undefined;
      return {
        fieldId, value: picked.value, variant: picked.variant, editable: true,
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
          fieldId, value: dirVariant.text, variant, editable: true,
          sourceType: "variant", sourcePath: `projects[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false, profileType: dirType,
          entryIndex: entryIdx, entryCount: profile.projects.length,
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return undefined;
      return {
        fieldId, value: picked.value, variant: picked.variant, editable: true,
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
      return { fieldId, value: packText, variant: variant === "plain" ? "medium" : variant, editable: true, sourceType: "fact", sourcePath: `profilePack(${options.pack?.id}).${key}` };
    }
    const block = profile.content[key];
    if (!block) return undefined;
    const textVariant: "short" | "medium" | "long" =
      variant === "plain" ? "medium" : variant;
    // 资料里常常只写了其中一个长度：目标档为空就退到最近的一档，
    // 否则「用户明明写了个人优势长文，字段却是空的」会表现成少填。
    const order: Record<"short" | "medium" | "long", ("short" | "medium" | "long")[]> = {
      short: ["short", "medium", "long"],
      medium: ["medium", "long", "short"],
      long: ["long", "medium", "short"],
    };
    const pickedVariant = order[textVariant].find((v) => block[v] && block[v].trim());
    const value = pickedVariant ? block[pickedVariant] : undefined;
    if (!value) return undefined;
    return { fieldId, value, variant: pickedVariant!, editable: true, sourceType: "fact" };
  }

  return undefined;
}
