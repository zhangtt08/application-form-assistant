import { beforeEach, describe, expect, it } from "vitest";
import {
  buildInitialPackStorage, createPack, deletePack, getActivePack, getEffectivePack, getSelectionSource,
  copyPack, resolveActivePack, restoreAutoMatch, setActivePack, updatePack, setPackStorageBackend, listPacks,
} from "../src/profile/pack/packStore";
import { matchPacks, scorePack } from "../src/profile/pack/matcher";
import { DEFAULT_PACK_SEEDS, buildDefaultPacks } from "../src/profile/pack/defaultPacks";
import type { ProfilePackStorage } from "../src/profile/pack/types";

function memoryBackend(): { get(k: string): Promise<Record<string, unknown>>; set(k: string, v: unknown): Promise<void>; dump(): Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    async get(key) { return store[key] !== undefined ? { [key]: store[key] } : {}; },
    async set(key, value) { store[key] = JSON.parse(JSON.stringify(value)); },
    dump() { return store; },
  };
}

beforeEach(() => {
  setPackStorageBackend(memoryBackend());
});

// ---------- 1-3. CRUD ----------

describe("Profile Pack CRUD", () => {
  it("首次加载自动创建 6 个默认 Pack", async () => {
    const packs = await listPacks();
    expect(packs.length).toBe(6);
    expect(packs.map((p) => p.name)).toContain("AI 应用 / Agent");
    expect(packs.map((p) => p.name)).toContain("通用");
  });

  it("创建自定义 Pack", async () => {
    const pack = await createPack({ name: "我的定制库", variantType: "aiProduct", matchRules: { jobTitles: ["测试岗位"], keywords: ["测试关键词"], excludeKeywords: [] } });
    expect(pack.id).toMatch(/^pack_/);
    expect((await listPacks()).length).toBe(7);
    expect((await getActivePack()).name).not.toBe("我的定制库"); // 新建不自动激活
  });

  it("修改 Pack（匹配规则/经历选择/固定字段）", async () => {
    const updated = await updatePack("pack-agent", {
      matchRules: { jobTitles: ["新标题"], keywords: ["新关键词"], excludeKeywords: ["排除项"] },
      selectedExperienceIds: ["internships-0"],
      experienceOrder: ["internships-0", "projects-0"],
      fieldContents: { strengths: "定制优势描述" },
    });
    expect(updated?.matchRules.keywords).toEqual(["新关键词"]);
    expect(updated?.fieldContents.strengths).toBe("定制优势描述");
  });

  it("删除 Pack：isDefault 不可删", async () => {
    const r = await deletePack("pack-general");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("cannot-delete-default");
  });

  it("删除普通 Pack 成功", async () => {
    await createPack({ name: "临时库" });
    const packs = await listPacks();
    const temp = packs.find((p) => p.name === "临时库")!;
    const r = await deletePack(temp.id);
    expect(r.ok).toBe(true);
    expect((await listPacks()).length).toBe(6);
  });
});

// ---------- 4-6. Default / Active / fallback ----------

describe("Active Pack & Fallback", () => {
  it("默认 active = general（无迁移信息时）", async () => {
    expect((await getActivePack()).id).toBe("pack-general");
  });

  it("setActivePack 切换；getActivePack 跟随", async () => {
    await setActivePack("pack-ai-product");
    expect((await getActivePack()).id).toBe("pack-ai-product");
  });

  it("删除 active Pack → fallback default", async () => {
    await createPack({ name: "临时使用" });
    const packs = await listPacks();
    const temp = packs.find((p) => p.name === "临时使用")!;
    await setActivePack(temp.id);
    expect((await getActivePack()).id).toBe(temp.id);
    const r = await deletePack(temp.id);
    expect(r.ok).toBe(true);
    expect(r.fallbackTo).toBe("pack-general");
    expect((await getActivePack()).id).toBe("pack-general");
  });

  it("极端情况 packs 空 → resolveActivePack 不崩溃（general 兜底）", () => {
    const empty: ProfilePackStorage = { schemaVersion: 1, packs: buildDefaultPacks("2026"), activeProfilePackId: "nonexistent", selectionSource: "default" };
    // active 不存在 → default pack
    expect(resolveActivePack(empty).isDefault).toBe(true);
    const noPacks: ProfilePackStorage = { schemaVersion: 1, packs: [], activeProfilePackId: "x", selectionSource: "default" };
    expect(resolveActivePack(noPacks).variantType).toBe("general");
  });
});

// ---------- Effective Pack 优先级（10-11） ----------

describe("Effective Pack Priority", () => {
  it("Manual Selection（active）优先于 matched", async () => {
    await setActivePack("pack-ai-product");
    const effective = await getEffectivePack("pack-agent"); // matcher 推荐 agent
    expect(effective.id).toBe("pack-ai-product"); // 但用户手选 product
  });

  it("无 manual override（active=general）→ matched 生效", async () => {
    // active 保持 general（非强制手选其他库时 matched 可以生效）
    const effective = await getEffectivePack("pack-agent");
    expect(effective.id).toBe("pack-agent");
  });

  it("matched 无效 → fallback active/default", async () => {
    await setActivePack("pack-ai-product");
    const effective = await getEffectivePack("nonexistent-pack");
    expect(effective.id).toBe("pack-ai-product");
  });
});

// ---------- 7-9. Matcher ----------

describe("ProfilePackMatcher（确定性）", () => {
  const packs = buildDefaultPacks("2026-09-24");

  it("Agent JD → high confidence 推荐 Agent Pack", () => {
    const result = matchPacks(packs, {
      position: "AI Agent 应用开发工程师",
      jd: "负责 Agent 与 RAG 系统开发，使用 Python 与 LangChain，构建 Workflow 自动化。要求熟悉 Prompt 工程与 MCP。",
      keywords: ["Agent", "RAG", "Python"],
    });
    expect(result.recommendedProfilePackId).toBe("pack-agent");
    expect(result.confidence).toBe("high");
    expect(result.matches[0]!.matchedKeywords).toContain("RAG");
  });

  it("AI 产品 JD → 推荐 AI 产品 Pack", () => {
    const result = matchPacks(packs, {
      position: "AI 产品经理",
      jd: "负责 AI 产品需求分析与 PRD 撰写，开展用户研究与产品设计，驱动产品迭代。",
      keywords: ["产品经理", "需求分析"],
    });
    expect(result.recommendedProfilePackId).toBe("pack-ai-product");
  });

  it("模糊 JD → low confidence（不假装确定）", () => {
    const result = matchPacks(packs, {
      position: "运营专员",
      jd: "负责日常运营事务与行政支持。",
      keywords: ["运营"],
    });
    expect(result.confidence).toBe("low");
  });

  it("exclude keyword 命中 → 降权/排除", () => {
    const pack = packs.find((p) => p.id === "pack-agent")!;
    const m = scorePack(pack, {
      position: "Java 后端开发工程师",
      jd: "负责服务端研发，涉及 Agent 平台后台。",
      keywords: [],
    });
    expect(m.excludedKeywords.length).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(0);
  });

  it("空 JD/无关键词 → recommended null", () => {
    const result = matchPacks(packs, { position: "", jd: "", keywords: [] });
    expect(result.recommendedProfilePackId).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("数据驱动：DEFAULT_PACK_SEEDS 覆盖 6 个方向", () => {
    expect(DEFAULT_PACK_SEEDS.length).toBe(6);
    expect(new Set(DEFAULT_PACK_SEEDS.map((s) => s.variantType)).size).toBe(6);
  });

  it("Issue #002：「载具策划 - 3C（望月）」不属于任何内置方向 → confidence=low / 无推荐，不得因「策划」误路由", () => {
    const result = matchPacks(packs, {
      position: "载具策划 - 3C（望月）- 202X",
      jd: "岗位职责：负责 3C 品类的载具策划与玩法设计。\n任职要求：熟悉游戏开发流程。",
      keywords: [],
    });
    // 禁止：因为「策划」误路由到 AI 产品 / AIGC 营销（不得有任何 Pack 得正分）
    expect(result.recommendedProfilePackId).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.matches.every((m) => m.score <= 0)).toBe(true);
    expect(result.matches.find((m) => m.profilePackId === "pack-ai-product")?.matchedKeywords ?? []).toEqual([]);
    expect(result.matches.find((m) => m.profilePackId === "pack-aigc-marketing")?.matchedKeywords ?? []).toEqual([]);
  });

  it("Issue #002：router 对「载具策划」JD 也不高置信路由（general/low 兜底，手选 Pack 继续生效）", async () => {
    const { RuleBasedJobParser } = await import("../src/job/jobParser");
    const { routeJob } = await import("../src/profile/profileRouter");
    const { defaultProfile } = await import("../src/profile/defaultProfile");
    const parser = new RuleBasedJobParser();
    const job = await parser.parse({
      url: "https://careers.shiyue.com/job/1",
      pageTitle: "诗悦招聘",
      metaTitle: "",
      metaCompany: "",
      h1Texts: [],
      jobDetailTitles: ["载具策划 - 3C（望月）- 202X"],
      bodyText: "岗位职责：负责 3C 品类的载具策划与玩法设计。",
    });
    const selection = routeJob(job, defaultProfile);
    // 禁止误路由到 AI 产品 / AIGC；方向不确定时 confidence 必须是 low
    expect(["general", "aiProduct", "aigcMarketing"]).toContain(selection.primaryProfile);
    if (selection.primaryProfile !== "general") {
      expect(selection.routingConfidence).toBe("low");
    }
  });
});

// ---------- 12. AI suggestion 不自动覆盖 ----------

describe("AI Suggestion 边界", () => {
  it("matcher 结果只作为建议数据，不写入 activeProfilePackId", async () => {
    await setActivePack("pack-ai-product");
    const packs = await listPacks();
    const result = matchPacks(packs, { position: "AI Agent 工程师", jd: "RAG Agent 开发", keywords: [] });
    expect(result.recommendedProfilePackId).toBe("pack-agent");
    // active 未被自动切换
    expect((await getActivePack()).id).toBe("pack-ai-product");
  });
});

// ---------- 19. Migration ----------

describe("Old ProfileType Migration", () => {
  it("buildInitialPackStorage：agent → pack-agent", () => {
    const s = buildInitialPackStorage("agent", "2026");
    expect(s.activeProfilePackId).toBe("pack-agent");
    expect(s.schemaVersion).toBe(1);
  });

  it("aiProduct → pack-ai-product；general/未知 → pack-general", () => {
    expect(buildInitialPackStorage("aiProduct", "2026").activeProfilePackId).toBe("pack-ai-product");
    expect(buildInitialPackStorage("general", "2026").activeProfilePackId).toBe("pack-general");
    expect(buildInitialPackStorage("unknown-type", "2026").activeProfilePackId).toBe("pack-general");
    expect(buildInitialPackStorage(null, "2026").activeProfilePackId).toBe("pack-general");
  });
});

// ---------- 20. Master Profile 不受影响 ----------

describe("Master Profile 隔离", () => {
  it("Pack 增删只影响 afa.profilepacks.v1，不触碰 afa.profile.v1", async () => {
    const backend = memoryBackend();
    backend.set("afa.profile.v1", { basic: { name: "张三" } });
    setPackStorageBackend(backend);
    await createPack({ name: "测试库" });
    await deletePack("pack-agent");
    const profile = (await backend.get("afa.profile.v1"))["afa.profile.v1"] as { basic: { name: string } };
    expect(profile.basic.name).toBe("张三");
  });
});

// ---------- Stage 6.5 补丁：selectionSource 显式来源（A-F） ----------

describe("ProfilePackSelectionSource", () => {
  it("A. 手动选 AI产品 + Agent JD（matched=agent）→ effective 仍 AI产品", async () => {
    await setActivePack("pack-ai-product");
    const effective = await getEffectivePack("pack-agent");
    expect(effective.id).toBe("pack-ai-product");
    expect(await getSelectionSource()).toBe("manual");
  });

  it("B. 手动选通用 + Agent JD → effective 仍通用（general 手选不被覆盖）", async () => {
    await setActivePack("pack-general"); // 用户显式选择通用
    expect(await getSelectionSource()).toBe("manual");
    const effective = await getEffectivePack("pack-agent");
    expect(effective.id).toBe("pack-general");
  });

  it("C. default 通用（未手选）+ Agent JD high confidence → effective Agent", async () => {
    expect(await getSelectionSource()).toBe("default");
    const effective = await getEffectivePack("pack-agent");
    expect(effective.id).toBe("pack-agent");
  });

  it("D. manual → 恢复自动匹配 → effective Agent", async () => {
    await setActivePack("pack-ai-product");
    expect(await getSelectionSource()).toBe("manual");
    const restored = await restoreAutoMatch("pack-agent");
    expect(restored.id).toBe("pack-agent");
    expect(await getSelectionSource()).toBe("matched");
    expect(await getEffectivePack("pack-agent").then((p) => p.id)).toBe("pack-agent");
  });

  it("E. 新 Job（matcher 再运行）不清除 manual", async () => {
    await setActivePack("pack-ai-product");
    // 模拟新 Job 捕获后 matcher 再运行：getEffectivePack 只读，不写 source
    await getEffectivePack("pack-agent");
    expect(await getSelectionSource()).toBe("manual");
    expect((await getEffectivePack("pack-agent")).id).toBe("pack-ai-product");
  });

  it("F. migration：override → manual 锁定；无 override → default", () => {
    const withOverride = buildInitialPackStorage("aiProduct", "2026");
    expect(withOverride.selectionSource).toBe("migration");
    expect(withOverride.activeProfilePackId).toBe("pack-ai-product");
    const without = buildInitialPackStorage(null, "2026");
    expect(without.selectionSource).toBe("default");
    expect(without.activeProfilePackId).toBe("pack-general");
  });
});

// ---------- Stage 6.6：copyPack / 新字段 ----------

describe("Stage 6.6 Pack Extensions", () => {
  it("copyPack：深拷贝配置 + 名称加副本 + 不激活 + 不动原包", async () => {
    await setActivePack("pack-ai-product");
    const copy = await copyPack("pack-ai-product");
    expect(copy?.name).toBe("AI 产品 副本");
    expect(copy?.id).not.toBe("pack-ai-product");
    expect(copy?.isDefault).toBe(false);
    expect((await getActivePack()).id).toBe("pack-ai-product"); // 复制不激活
    expect((await listPacks()).length).toBe(7);
    // 深拷贝：改副本不影响原包
    await updatePack(copy!.id, { fieldContents: { ...copy!.fieldContents, strengths: "副本专属" } });
    const original = (await listPacks()).find((p) => p.id === "pack-ai-product")!;
    expect(original.fieldContents.strengths ?? "").not.toBe("副本专属");
  });

  it("copyPack 不存在的 id → null", async () => {
    expect(await copyPack("nope")).toBeNull();
  });

  it("fieldContents 新字段（extraNote/commonSupplement）可存取", async () => {
    const updated = await updatePack("pack-general", {
      fieldContents: { extraNote: "常用补充说明内容", commonSupplement: "常用开放题基础回答" },
    });
    expect(updated?.fieldContents.extraNote).toBe("常用补充说明内容");
    expect(updated?.fieldContents.commonSupplement).toBe("常用开放题基础回答");
  });

  it("preferences（answerTone/allowAIAssist/notes）可存取", async () => {
    const updated = await updatePack("pack-agent", {
      preferences: { answerTone: "detailed", allowAIAssist: true, notes: "内部备注" },
    });
    expect(updated?.preferences?.answerTone).toBe("detailed");
    expect(updated?.preferences?.allowAIAssist).toBe(true);
  });
});
