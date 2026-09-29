import { validateDraft } from "../src/generation/factValidator";
import type { Fact } from "../src/generation/types";

/**
 * Mutation Tests（spec Stage 3.5 第二十二~二十四章）：
 * 自动构造「事实变体」验证 Validator 的拦截能力。固定 seed 保证可重复。
 */

/** 线性同余伪随机（固定 seed → 可重复） */
export function makeRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface MutationCase {
  kind: "numeric" | "responsibility" | "technology";
  facts: Fact[];
  mutatedDraft: string;
  /** Validator 应给出 fail（mutation 不可通过） */
  expectFail: true;
  mutation: string;
}

const BASE_NUMERIC_FACTS: Fact[] = [
  { id: "fact_001", type: "metric", text: "日处理量 5000-6000 条" },
  { id: "fact_002", type: "metric", text: "标注准确率稳定在 90% 以上" },
  { id: "fact_003", type: "responsibility", text: "完成需求梳理与流程拆解" },
];

const NUMERIC_MUTATIONS = ["7000", "95%", "提升 80%", "3 年", "10 人", "10000 条"];
const RESPONSIBILITY_MUTATIONS = ["主导", "负责整体", "带领", "管理", "独立完成"];
const TECH_POOL = ["LangChain", "Kubernetes", "Java", "TensorFlow", "Redis", "Docker"];

/** Numeric Mutation：把事实中的数字替换为事实中不存在的数字 */
export function numericMutations(_rng: () => number): MutationCase[] {
  return NUMERIC_MUTATIONS.map((token) => {
    const facts = BASE_NUMERIC_FACTS.map((f) => ({ ...f }));
    const draft = `完成数据处理工作，处理量达到 ${token}。`;

    return { kind: "numeric" as const, facts, mutatedDraft: draft, expectFail: true as const, mutation: token };
  });
}

/** Responsibility Mutation：把「参与/协助」升级为强动词 */
export function responsibilityMutations(_rng: () => number): MutationCase[] {
  const facts: Fact[] = [{ id: "fact_001", type: "responsibility", text: "参与项目开发与测试工作" }];
  return RESPONSIBILITY_MUTATIONS.map((verb) => ({
    kind: "responsibility" as const,
    facts,
    mutatedDraft: `${verb}项目开发工作。`,
    expectFail: true as const,
    mutation: verb,
  }));
}

/** Technology Mutation：从技术词库随机选 Facts 中不存在的技术插入 Draft */
export function technologyMutations(rng: () => number, count = 5): MutationCase[] {
  const pool = [...TECH_POOL];
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked.map((tech) => ({
    kind: "technology" as const,
    facts: BASE_NUMERIC_FACTS,
    mutatedDraft: `在项目中使用 ${tech} 完成相关工作。`,
    expectFail: true as const,
    mutation: tech,
  }));
}

/** 执行全部 mutation 并统计 Validator 拦截率（应=100%，漏检即 FALSE_NEGATIVE） */
export function runMutationTests(seed = 42): {
  total: number;
  intercepted: number;
  missed: { kind: string; mutation: string }[];
} {
  const rng = makeRng(seed);
  const cases = [...numericMutations(rng), ...responsibilityMutations(rng), ...technologyMutations(rng)];
  const missed: { kind: string; mutation: string }[] = [];
  for (const c of cases) {
    const report = validateDraft(c.mutatedDraft, c.facts);
    if (report.status !== "fail") missed.push({ kind: c.kind, mutation: c.mutation });
  }
  return { total: cases.length, intercepted: cases.length - missed.length, missed };
}
