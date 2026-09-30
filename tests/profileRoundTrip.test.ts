import { describe, expect, it } from "vitest";
import { cloneProfile, defaultProfile } from "../src/profile/defaultProfile";
import { repairProfileShape } from "../src/profile/libraryStore";
import { validateProfile } from "../src/profile/schema";
import { resolveValue } from "../src/profile/profileResolver";
import { YES_NO_PREFERENCE_KEYS } from "../src/types/profile";
import type { Profile } from "../src/types/profile";

/**
 * 资料「存进去又消失」回归。
 *
 * 读盘路径 repairProfileShape 会按模板重建对象：任何**新增字段**没在模板里被带过，
 * 用户在资料页填的内容就会在下次启动时静默丢失，表现成「我明明选过『是』，网站还是空的」。
 * 这类 bug 单看 resolver / schema 都测不出来，必须走一遍真实的读盘形状修复。
 */

function filled(): Profile {
  const p = cloneProfile(defaultProfile);
  p.basic.surname = "赵";
  p.basic.givenName = "合一";
  p.basic.linkedin = "https://www.linkedin.com/in/syn";
  for (const key of YES_NO_PREFERENCE_KEYS) p.jobPreferences[key] = "是";
  return p;
}

describe("新增字段的存储往返", () => {
  it("repairProfileShape 带过「是否…」偏好与姓 / 名 / 领英", () => {
    const repaired = repairProfileShape(JSON.parse(JSON.stringify(filled())));
    for (const key of YES_NO_PREFERENCE_KEYS) {
      expect(repaired.jobPreferences[key], `jobPreferences.${key}`).toBe("是");
    }
    expect(repaired.basic.surname).toBe("赵");
    expect(repaired.basic.givenName).toBe("合一");
    expect(repaired.basic.linkedin).toBe("https://www.linkedin.com/in/syn");
  });

  it("读盘之后解析器仍然取到值（不是只在对象里存在）", () => {
    const repaired = repairProfileShape(JSON.parse(JSON.stringify(filled())));
    expect(resolveValue("job.acceptOfflineInterview", repaired)?.value).toBe("是");
    expect(resolveValue("basic.surname", repaired)?.value).toBe("赵");
    expect(resolveValue("basic.givenName", repaired)?.value).toBe("合一");
  });

  it("旧版 Profile（没有这些键）读盘不报错，键补成空串", () => {
    const legacy = JSON.parse(JSON.stringify(defaultProfile)) as Record<string, unknown>;
    const legacyJob = legacy.jobPreferences as Record<string, unknown>;
    delete legacyJob.acceptOfflineInterview;
    delete legacyJob.acceptOvertime;
    const basic = legacy.basic as Record<string, unknown>;
    delete basic.surname;
    delete basic.givenName;
    delete basic.linkedin;

    const repaired = repairProfileShape(legacy);
    expect(repaired.jobPreferences.acceptOfflineInterview).toBe("");
    expect(repaired.basic.surname).toBe("");
    expect(validateProfile(repaired).ok).toBe(true);
  });
});
