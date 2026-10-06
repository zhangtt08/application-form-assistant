// src/job/profileTypes.ts
var VARIANT_KEY_BY_TYPE = {
  agent: "agent",
  aiApplication: "aiApplication",
  aiProduct: "aiProduct",
  aiOperation: "aiOperation",
  aiSolution: "aiSolution",
  aigcMarketing: "aigcMarketing",
  general: null
};

// src/profile/installed-profile-resolver.ts
var DERIVED_PRESENCE_IDS = {
  "internship.hasExperience": "internships",
  "project.hasExperience": "projects"
};
var LEGACY_SENSITIVE_SOURCE = {
  politicalStatus: "politicalStatus",
  maritalStatus: "maritalStatus",
  idNumber: "idNumber"
};
function chooseVariant(maxLength) {
  if (maxLength == null) return "medium";
  if (maxLength <= 120) return "short";
  if (maxLength <= 350) return "medium";
  return "long";
}
function effectiveVariant(options) {
  return options.variantOverride ?? chooseVariant(options.maxLength);
}
function pickDescriptionVariant(entry, preferred) {
  const order = preferred === "short" ? ["short", "medium", "long"] : preferred === "long" ? ["long", "medium", "short"] : ["medium", "long", "short"];
  for (const key of order) {
    const value = entry[`description${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    if (typeof value === "string" && value.trim()) return { value, variant: key };
  }
  return void 0;
}
function pickEntry(entries, index) {
  const i = index ?? 0;
  if (i < 0 || i >= entries.length) return void 0;
  return entries[i];
}
function variantFor(entry, profileType) {
  if (!profileType || profileType === "general") return void 0;
  const key = VARIANT_KEY_BY_TYPE[profileType];
  if (!key) return void 0;
  const text = entry.variants?.[key];
  return text ? { text, key } : void 0;
}
function resolveValue(fieldId, profile, options = {}) {
  if (fieldId.startsWith("sensitive.") || fieldId === "risk.manual" || fieldId === "unknown") {
    return void 0;
  }
  const entryIdx = options.entryIndex ?? 0;
  const variant = effectiveVariant(options);
  const dirType = options.pack?.variantType ?? options.profileType;
  const packEntryIdx = (collection, total) => {
    const order = options.pack?.experienceOrder ?? [];
    const selected = options.pack?.selectedExperienceIds ?? [];
    const ids = order.length > 0 ? order : selected;
    if (ids.length === 0) return entryIdx;
    const prefix = `${collection}-`;
    const scoped = ids.filter((id2) => id2.startsWith(prefix));
    if (scoped.length === 0) return entryIdx;
    const id = scoped[entryIdx] ?? scoped[scoped.length - 1];
    const parsed = Number(id.split("-")[1]);
    return Number.isFinite(parsed) && parsed < total ? parsed : entryIdx;
  };
  if (fieldId.startsWith("basic.")) {
    const key = fieldId.slice("basic.".length);
    let value = profile.basic[key];
    if (value === void 0 || value === "") {
      const legacy = LEGACY_SENSITIVE_SOURCE[key];
      const fallback = legacy ? profile.sensitive?.[legacy] : void 0;
      if (fallback) value = fallback;
    }
    if (value === void 0 || value === "") return void 0;
    return { fieldId, value, variant: "plain", editable: false, sourceType: "fact" };
  }
  const derived = DERIVED_PRESENCE_IDS[fieldId];
  if (derived) {
    return profile[derived].length > 0 ? { fieldId, value: "\u662F", variant: "plain", editable: false, sourceType: "fact", sourcePath: `derived(${derived}.length>0)` } : void 0;
  }
  if (fieldId.startsWith("education.")) {
    const entry = pickEntry(profile.education, entryIdx);
    if (!entry) return void 0;
    const key = fieldId.slice("education.".length);
    const value = entry[key];
    if (value === void 0 || value === "") return void 0;
    return {
      fieldId,
      value,
      variant: "plain",
      editable: false,
      entryIndex: entryIdx,
      entryCount: profile.education.length
    };
  }
  if (fieldId.startsWith("internship.")) {
    const entry = pickEntry(profile.internships, packEntryIdx("internships", profile.internships.length));
    if (!entry) return void 0;
    if (fieldId === "internship.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId,
          value: dirVariant.text,
          variant,
          editable: true,
          sourceType: "variant",
          sourcePath: `internships[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false,
          profileType: dirType,
          entryIndex: entryIdx,
          entryCount: profile.internships.length
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return void 0;
      return {
        fieldId,
        value: picked.value,
        variant: picked.variant,
        editable: true,
        sourceType: "default",
        fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx,
        entryCount: profile.internships.length
      };
    }
    const key = fieldId.slice("internship.".length);
    const value = entry[key];
    if (typeof value !== "string" || value === "") return void 0;
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.internships.length };
  }
  if (fieldId.startsWith("campus.")) {
    const entry = pickEntry(profile.campus, packEntryIdx("campus", profile.campus.length));
    if (!entry) return void 0;
    if (fieldId === "campus.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId,
          value: dirVariant.text,
          variant,
          editable: true,
          sourceType: "variant",
          sourcePath: `campus[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false,
          profileType: dirType,
          entryIndex: entryIdx,
          entryCount: profile.campus.length
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return void 0;
      return {
        fieldId,
        value: picked.value,
        variant: picked.variant,
        editable: true,
        sourceType: "default",
        fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx,
        entryCount: profile.campus.length
      };
    }
    const key = fieldId.slice("campus.".length);
    const value = entry[key];
    if (typeof value !== "string" || value === "") return void 0;
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.campus.length };
  }
  if (fieldId.startsWith("project.")) {
    const entry = pickEntry(profile.projects, packEntryIdx("projects", profile.projects.length));
    if (!entry) return void 0;
    if (fieldId === "project.description") {
      const dirVariant = variantFor(entry, dirType);
      if (dirVariant) {
        return {
          fieldId,
          value: dirVariant.text,
          variant,
          editable: true,
          sourceType: "variant",
          sourcePath: `projects[${entryIdx}].variants.${dirVariant.key}`,
          fallbackUsed: false,
          profileType: dirType,
          entryIndex: entryIdx,
          entryCount: profile.projects.length
        };
      }
      const picked = pickDescriptionVariant(entry, variant);
      if (!picked) return void 0;
      return {
        fieldId,
        value: picked.value,
        variant: picked.variant,
        editable: true,
        sourceType: "default",
        fallbackUsed: Boolean(dirType && dirType !== "general"),
        profileType: dirType,
        entryIndex: entryIdx,
        entryCount: profile.projects.length
      };
    }
    const key = fieldId.slice("project.".length);
    const value = entry[key];
    if (typeof value !== "string" || value === "") return void 0;
    return { fieldId, value, variant: "plain", editable: false, entryIndex: entryIdx, entryCount: profile.projects.length };
  }
  if (fieldId.startsWith("skills.")) {
    const key = fieldId.slice("skills.".length);
    const arr = profile.skills[key];
    if (!arr || arr.length === 0) return void 0;
    return { fieldId, value: arr.join("\u3001"), variant: "plain", editable: true, sourceType: "fact" };
  }
  if (fieldId.startsWith("job.")) {
    const key = fieldId.slice("job.".length);
    const v = profile.jobPreferences[key];
    if (v === void 0 || v === "") return void 0;
    const value = Array.isArray(v) ? v.join("\u3001") : v;
    return { fieldId, value, variant: "plain", editable: true, sourceType: "fact" };
  }
  if (fieldId.startsWith("content.")) {
    const key = fieldId.slice("content.".length);
    const packFields = options.pack?.fieldContents;
    const packText = key === "selfIntroduction" ? packFields?.selfIntroduction : key === "selfEvaluation" ? packFields?.strengths : key === "personalAdvantages" ? packFields?.strengths : void 0;
    if (packText && packText.trim()) {
      return { fieldId, value: packText, variant: variant === "plain" ? "medium" : variant, editable: true, sourceType: "fact", sourcePath: `profilePack(${options.pack?.id}).${key}` };
    }
    const block = profile.content[key];
    if (!block) return void 0;
    const textVariant = variant === "plain" ? "medium" : variant;
    const order = {
      short: ["short", "medium", "long"],
      medium: ["medium", "long", "short"],
      long: ["long", "medium", "short"]
    };
    const pickedVariant = order[textVariant].find((v) => block[v] && block[v].trim());
    const value = pickedVariant ? block[pickedVariant] : void 0;
    if (!value) return void 0;
    return { fieldId, value, variant: pickedVariant, editable: true, sourceType: "fact" };
  }
  return void 0;
}
export {
  chooseVariant,
  resolveValue
};
