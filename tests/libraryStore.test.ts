import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "../src/types/profile";
import { cloneProfile, defaultProfile } from "../src/profile/defaultProfile";
import { validateProfile } from "../src/profile/schema";
import {
  LEGACY_KEY,
  STORE_KEY,
  addLibrary,
  assembleProfile,
  createDefaultStore,
  createLibrary,
  describeDirections,
  emptyContent,
  findLibrary,
  loadStore,
  migrateFromLegacyProfile,
  profileForLibrary,
  removeLibrary,
  repairProfileShape,
  saveStore,
  selectLibraryForDirection,
  setActiveLibraryId,
  splitProfile,
  updateLibraryMeta,
  writeLibraryContent,
  type ProfileStore,
} from "../src/profile/libraryStore";
import { profileTypeLabel } from "../src/job/profileTypes";

/* ---------------- chrome.storage 桩 ---------------- */

interface ChromeStub {
  data: Record<string, unknown>;
  writes: number;
}

function stubChrome(initial: Record<string, unknown> = {}): ChromeStub {
  const stub: ChromeStub = { data: { ...initial }, writes: 0 };
  const listeners: ((c: Record<string, unknown>, a: string) => void)[] = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: unknown) => {
          if (keys == null) return { ...stub.data };
          const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys as object);
          const out: Record<string, unknown> = {};
          for (const k of list as string[]) out[k] = stub.data[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          stub.writes += 1;
          const changes: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: stub.data[k], newValue: v };
            stub.data[k] = v;
          }
          for (const fn of listeners.slice()) fn(changes, "local");
        },
        remove: async (k: string) => {
          delete stub.data[k];
        },
      },
      onChanged: {
        addListener: (fn: (c: Record<string, unknown>, a: string) => void) => listeners.push(fn),
        removeListener: () => {},
      },
    },
  };
  return stub;
}

function clearChrome(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}

/**
 * 「没有实质内容」判定。
 * 注意：defaultProfile 自带一条空白经历作为填写脚手架，所以「空库」的
 * internships 不是空数组，而是一条全空条目 —— 断言要看的是内容，不是长度。
 */
function isBlank(entries: readonly object[]): boolean {
  return entries.every((entry) =>
    Object.entries(entry).every(([key, v]) => key === "variants" || typeof v !== "string" || v === ""),
  );
}

/* ---------------- Profile 夹具 ---------------- */

function makeProfile(patch: Partial<Profile> = {}): Profile {
  const base = cloneProfile(defaultProfile);
  return {
    ...base,
    basic: { ...base.basic, name: "张小明", phone: "15300001122", email: "test.resume@example.com", city: "杭州" },
    education: [{ ...base.education[0]!, school: "示例科技大学", major: "测试专业", degree: "本科" }],
    internships: [
      {
        ...base.internships[0]!,
        company: "某某科技",
        position: "产品实习生",
        descriptionShort: "负责需求调研",
        descriptionMedium: "负责需求调研与竞品分析",
        descriptionLong: "负责需求调研与竞品分析，输出 PRD",
      },
    ],
    skills: { ...base.skills, technical: ["Python"], tools: ["Figma"] },
    content: { ...base.content, selfEvaluation: { short: "细致", medium: "细致", long: "做事细致" } },
    sensitive: { ...base.sensitive, idNumber: "330106200305011234" },
    ...patch,
  };
}

beforeEach(() => clearChrome());
afterEach(() => clearChrome());

/* ---------------- 拆分 / 组装 ---------------- */

describe("splitProfile / assembleProfile", () => {
  it("往返不丢内容", () => {
    const profile = makeProfile();
    const { shared, content } = splitProfile(profile);
    const back = assembleProfile(shared, content);
    expect(back).toEqual(profile);
  });

  it("公共信息只包含 basic / education / sensitive", () => {
    const { shared, content } = splitProfile(makeProfile());
    expect(Object.keys(shared).sort()).toEqual(["basic", "education", "sensitive"]);
    expect(shared.basic.name).toBe("张小明");
    expect(content.internships).toHaveLength(1);
    expect(content.skills.technical).toEqual(["Python"]);
    expect((content as unknown as Record<string, unknown>).basic).toBeUndefined();
  });

  it("组装出来的对象能通过 validateProfile（多库不会绕开校验）", () => {
    const { shared, content } = splitProfile(makeProfile());
    const result = validateProfile(assembleProfile(shared, content));
    expect(result.ok).toBe(true);
  });

  it("careerPreferences 存在时跟着库内容走", () => {
    const profile = makeProfile({
      careerPreferences: { targetDirections: ["AI 产品"], preferredWorkTypes: [], developmentGoals: [] },
    });
    const { content } = splitProfile(profile);
    expect(content.careerPreferences?.targetDirections).toEqual(["AI 产品"]);
    expect(assembleProfile(splitProfile(profile).shared, content).careerPreferences?.targetDirections).toEqual([
      "AI 产品",
    ]);
  });
});

/* ---------------- 建库 ---------------- */

describe("createLibrary / addLibrary", () => {
  it("新建的库默认是空的、通用兜底", () => {
    const lib = createLibrary({ name: "  AI 产品（校招） " });
    expect(lib.name).toBe("AI 产品（校招）");
    expect(lib.directions).toEqual([]);
    expect(isBlank(lib.content.internships)).toBe(true);
    expect(isBlank(lib.content.projects)).toBe(true);
    expect(lib.content.skills.technical).toEqual([]);
    expect(lib.id).toMatch(/^lib_/);
  });

  it("非法方向被过滤掉", () => {
    const lib = createLibrary({ name: "x", directions: ["aiProduct", "不存在" as never] });
    expect(lib.directions).toEqual(["aiProduct"]);
  });

  it("复制建库带上来源内容，并成为当前库", () => {
    const store = createDefaultStore();
    store.libraries[0]!.content = splitProfile(makeProfile()).content;

    const added = addLibrary(store, { name: "副本", copyFromLibraryId: store.libraries[0]!.id });
    expect(added.store.libraries).toHaveLength(2);
    expect(added.store.activeLibraryId).toBe(added.library.id);
    expect(added.library.content.internships[0]!.company).toBe("某某科技");
  });

  it("新建空库不影响来源库", () => {
    const store = createDefaultStore();
    const added = addLibrary(store, { name: "空库" });
    expect(isBlank(added.library.content.internships)).toBe(true);
    expect(isBlank(added.store.libraries[0]!.content.internships)).toBe(true);
  });
});

/* ---------------- 选库 ---------------- */

describe("selectLibraryForDirection", () => {
  function storeWith(specs: { name: string; directions: string[] }[]): ProfileStore {
    const store = createDefaultStore();
    store.libraries = specs.map((s) => ({
      ...createLibrary({ name: s.name, directions: s.directions as never }),
    }));
    store.activeLibraryId = store.libraries[0]!.id;
    return store;
  }

  it("方向精确命中时选对应库", () => {
    const store = storeWith([
      { name: "通用", directions: [] },
      { name: "AI 产品", directions: ["aiProduct"] },
    ]);
    expect(selectLibraryForDirection(store, "aiProduct").name).toBe("AI 产品");
  });

  it("多个库都覆盖时选更专用的（勾选方向更少）", () => {
    const store = storeWith([
      { name: "非技术岗", directions: ["aiProduct", "aiOperation", "aigcMarketing"] },
      { name: "AI 产品", directions: ["aiProduct"] },
    ]);
    expect(selectLibraryForDirection(store, "aiProduct").name).toBe("AI 产品");
  });

  it("没有专用库时回退到通用兜底库", () => {
    const store = storeWith([
      { name: "AI 产品", directions: ["aiProduct"] },
      { name: "通用", directions: [] },
    ]);
    expect(selectLibraryForDirection(store, "aiOperation").name).toBe("通用");
  });

  it("既没专用也没兜底时用当前库", () => {
    const store = storeWith([
      { name: "AI 产品", directions: ["aiProduct"] },
      { name: "AI 运营", directions: ["aiOperation"] },
    ]);
    store.activeLibraryId = store.libraries[1]!.id;
    expect(selectLibraryForDirection(store, "agent").name).toBe("AI 运营");
  });

  it("方向为 general 时同样走兜底", () => {
    const store = storeWith([
      { name: "AI 产品", directions: ["aiProduct"] },
      { name: "通用", directions: [] },
    ]);
    expect(selectLibraryForDirection(store, "general").name).toBe("通用");
  });
});

/* ---------------- 库管理 ---------------- */

describe("库管理（不可变操作）", () => {
  it("改名与方向更新只影响目标库", () => {
    const store = createDefaultStore();
    const added = addLibrary(store, { name: "B" });
    const next = updateLibraryMeta(added.store, added.library.id, { name: "AI 运营", directions: ["aiOperation"] });
    expect(findLibrary(next, added.library.id)!.name).toBe("AI 运营");
    expect(findLibrary(next, added.library.id)!.directions).toEqual(["aiOperation"]);
    expect(next.libraries[0]!.name).toBe("默认资料库");
    // 空名字不覆盖原值
    expect(updateLibraryMeta(next, added.library.id, { name: "   " }).libraries[1]!.name).toBe("AI 运营");
  });

  it("删除后当前库被换成剩下的第一个", () => {
    const store = createDefaultStore();
    const added = addLibrary(store, { name: "B" });
    const next = removeLibrary(added.store, added.library.id);
    expect(next.libraries).toHaveLength(1);
    expect(next.activeLibraryId).toBe(next.libraries[0]!.id);
  });

  it("只剩一个库时拒绝删除（返回原对象）", () => {
    const store = createDefaultStore();
    expect(removeLibrary(store, store.libraries[0]!.id)).toBe(store);
  });

  it("setActiveLibraryId 对不存在的 id 不生效", () => {
    const store = createDefaultStore();
    expect(setActiveLibraryId(store, "nope")).toBe(store);
  });

  it("写入内容可以同时更新公共信息", () => {
    const store = createDefaultStore();
    const { shared, content } = splitProfile(makeProfile());
    const next = writeLibraryContent(store, store.activeLibraryId, content, shared);
    expect(next.shared.basic.name).toBe("张小明");
    expect(next.libraries[0]!.content.internships).toHaveLength(1);
  });

  it("describeDirections 说人话", () => {
    expect(describeDirections(createLibrary({ name: "x" }), profileTypeLabel)).toContain("通用");
    expect(
      describeDirections(createLibrary({ name: "x", directions: ["aiProduct"] }), profileTypeLabel),
    ).toBe("AI 产品");
  });
});

/* ---------------- 结构修复 ---------------- */

describe("repairProfileShape", () => {
  it("缺字段补齐而不是整库丢弃", () => {
    const repaired = repairProfileShape({ basic: { name: "李雷" }, skills: { technical: ["Go"] } });
    expect(repaired.basic.name).toBe("李雷");
    expect(repaired.basic.phone).toBe("");
    expect(repaired.skills.technical).toEqual(["Go"]);
    expect(repaired.skills.tools).toEqual([]);
    expect(repaired.content.selfEvaluation).toEqual({ short: "", medium: "", long: "" });
    expect(repaired.education).toEqual([]);
    expect(validateProfile(repaired).ok).toBe(true);
  });

  it("条目缺 variants 时补全空变体", () => {
    const repaired = repairProfileShape({ internships: [{ company: "A" }] });
    expect(repaired.internships[0]!.company).toBe("A");
    expect(Object.values(repaired.internships[0]!.variants).every((v) => v === "")).toBe(true);
  });

  it("完全不是对象也不崩（回落到空资料）", () => {
    expect(() => repairProfileShape(null)).not.toThrow();
    expect(repairProfileShape(null).basic.name).toBe("");
  });
});

describe("migrateFromLegacyProfile（单库 → 多库）", () => {
  it("原 Profile 变成「默认资料库」，公共信息落到 shared", () => {
    const store = migrateFromLegacyProfile(makeProfile());
    expect(store.schemaVersion).toBe(2);
    expect(store.libraries).toHaveLength(1);
    expect(store.libraries[0]!.name).toBe("默认资料库");
    expect(store.libraries[0]!.directions).toEqual([]);
    expect(store.activeLibraryId).toBe(store.libraries[0]!.id);
    expect(store.shared.basic.name).toBe("张小明");
    expect(store.shared.education[0]!.school).toBe("示例科技大学");
    expect(store.shared.sensitive.idNumber).toBe("330106200305011234");
    expect(store.libraries[0]!.content.internships[0]!.company).toBe("某某科技");
  });

  it("迁移结果与原始 Profile 等价", () => {
    const original = makeProfile();
    const store = migrateFromLegacyProfile(original);
    expect(profileForLibrary(store, store.activeLibraryId)).toEqual(original);
  });

  it("畸形输入也能迁移成可用的空库", () => {
    const store = migrateFromLegacyProfile("<garbage>");
    expect(store.libraries).toHaveLength(1);
    expect(validateProfile(profileForLibrary(store, store.activeLibraryId)).ok).toBe(true);
  });
});

/* ---------------- 存储层 ---------------- */

describe("loadStore / saveStore", () => {
  it("空存储 → 一个默认库", async () => {
    stubChrome();
    const store = await loadStore();
    expect(store.libraries).toHaveLength(1);
    expect(store.libraries[0]!.name).toBe("默认资料库");
    expect(store.activeLibraryId).toBe(store.libraries[0]!.id);
  });

  it("只有 v1 时自动迁移并落盘 v2", async () => {
    const chrome = stubChrome({ [LEGACY_KEY]: makeProfile() });
    const store = await loadStore();
    expect(store.libraries[0]!.content.internships[0]!.company).toBe("某某科技");
    expect(chrome.data[STORE_KEY]).toBeTruthy();
  });

  it("v2 优先于 v1（迁移不会覆盖新数据）", async () => {
    const store = createDefaultStore();
    const added = addLibrary(store, { name: "AI 产品", directions: ["aiProduct"] });
    stubChrome({ [STORE_KEY]: added.store, [LEGACY_KEY]: makeProfile() });

    const loaded = await loadStore();
    expect(loaded.libraries).toHaveLength(2);
    expect(loaded.libraries.map((l) => l.name)).toEqual(["默认资料库", "AI 产品"]);
  });

  it("v2 数据损坏 → 回落到默认，不崩", async () => {
    stubChrome({ [STORE_KEY]: { libraries: "not-an-array" } });
    const loaded = await loadStore();
    expect(loaded.libraries).toHaveLength(1);
  });

  it("activeLibraryId 指向已删除的库时自动纠正", async () => {
    const store = createDefaultStore();
    stubChrome({ [STORE_KEY]: { ...store, activeLibraryId: "gone" } });
    const loaded = await loadStore();
    expect(loaded.activeLibraryId).toBe(loaded.libraries[0]!.id);
  });

  it("保存时同步写 v1 镜像（当前库的完整 Profile）", async () => {
    const chrome = stubChrome();
    const store = createDefaultStore();
    const { shared, content } = splitProfile(makeProfile());
    const next = writeLibraryContent(store, store.activeLibraryId, content, shared);

    await saveStore(next);

    expect(chrome.data[STORE_KEY]).toBe(next);
    const mirror = chrome.data[LEGACY_KEY] as Profile;
    expect(mirror.basic.name).toBe("张小明");
    expect(mirror.internships).toHaveLength(1);
    expect(validateProfile(mirror).ok).toBe(true);
  });

  it("v2 里没有的库字段（新版本新增）读盘时补默认", async () => {
    const store = createDefaultStore();
    const broken = structuredClone(store) as unknown as Record<string, unknown>;
    (broken.libraries as Record<string, unknown>[])[0]!.directions = undefined;
    stubChrome({ [STORE_KEY]: broken });
    const loaded = await loadStore();
    expect(loaded.libraries[0]!.directions).toEqual([]);
  });

  it("没有任何存储时 saveStore 不抛错（chrome 不可用场景）", async () => {
    clearChrome();
    await expect(saveStore(createDefaultStore())).resolves.toBeUndefined();
    const store = await loadStore();
    expect(store.libraries).toHaveLength(1);
  });
});

describe("emptyContent", () => {
  it("是一个没有实质内容、且能通过校验的空库内容", () => {
    const content = emptyContent();
    expect(isBlank(content.internships)).toBe(true);
    expect(isBlank(content.projects)).toBe(true);
    expect(content.skills.technical).toEqual([]);
    const result = validateProfile(assembleProfile(splitProfile(makeProfile()).shared, content));
    expect(result.ok).toBe(true);
  });
});
