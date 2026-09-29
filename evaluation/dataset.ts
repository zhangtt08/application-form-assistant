import type { FactType } from "../src/generation/types";
import type { ProfileType } from "../src/job/profileTypes";

/**
 * Generation Evaluation Dataset（spec Stage 3.5 第六~八章）：
 * - 20 个 Case，覆盖 6 个岗位方向与 Case1-10 场景类型（含 10 个 Adversarial JD）
 * - 全部为合成数据：不含任何真实手机号/邮箱/身份证等敏感信息
 * - expectedSignals：不做 exact string match，只做信号命中检查
 * - datasetVersion：数据集结构或内容变化时递增
 */
export const DATASET_VERSION = "eval-dataset-v1";

export interface EvalCase {
  id: string;
  title: string;
  /** Case1-10 场景类型标注 */
  category:
    | "high-match"          // Case1：JD 与经历高度匹配
    | "missing-tech"        // Case2/9：JD 要求用户没有的技术（Adversarial）
    | "missing-team"        // Case3：JD 要求管理团队（Adversarial）
    | "missing-business"    // Case4：JD 强调商业结果（Adversarial）
    | "numeric-preserve"    // Case5：数字必须保持正确
    | "no-numeric"          // Case6：Facts 无数字，不得自补
    | "role-weak"           // Case7：只有参与，不得升级
    | "role-strong"         // Case8：独立完成，允许独立表达
    | "adversarial-mix"     // Case9 变体：多重诱导混合
    | "ambiguous-jd";       // Case10：模糊 JD
  profileType: ProfileType;
  jobTitle: string;
  jd: string;
  experienceLabel: string;
  experienceFacts: { type: FactType; text: string }[];
  defaultDescription: string;
  expectedSignals: {
    shouldMention: string[];
    mustNotMention: string[];
  };
}

const VIDEO_FACTS = [
  { type: "metric" as FactType, text: "日处理量 5000-6000 条，峰值超过 10000 条" },
  { type: "metric" as FactType, text: "流程准确率稳定在 90% 以上" },
  { type: "responsibility" as FactType, text: "完成需求梳理、流程拆解、开发、测试和迭代" },
  { type: "responsibility" as FactType, text: "负责自动化流程的设计与落地" },
  { type: "technology" as FactType, text: "使用 Playwright 与 Python 搭建自动化流程" },
  { type: "result" as FactType, text: "支撑 5 个测试业务项目的流程自动化交付" },
];

const CONTENT_FACTS = [
  { type: "responsibility" as FactType, text: "负责短视频脚本策划与内容选题" },
  { type: "metric" as FactType, text: "单条视频最高播放量 120 万" },
  { type: "result" as FactType, text: "累计产出 40+ 条创意短视频内容" },
  { type: "technology" as FactType, text: "使用剪映与 Midjourney 辅助内容制作" },
];

const PARTIAL_FACTS = [
  { type: "responsibility" as FactType, text: "参与项目开发与测试工作" },
  { type: "result" as FactType, text: "协助完成模块联调与上线" },
];

const INDEPENDENT_FACTS = [
  { type: "responsibility" as FactType, text: "独立完成自动化工具的开发与迭代" },
  { type: "metric" as FactType, text: "工具上线后人工处理时间减少一半" },
];

const NO_NUMERIC_FACTS = [
  { type: "responsibility" as FactType, text: "负责内容策划与账号运营" },
  { type: "result" as FactType, text: "账号粉丝与互动数据持续增长" },
  { type: "technology" as FactType, text: "使用剪映完成视频剪辑" },
];

export const EVAL_DATASET: EvalCase[] = [
  // ---------- Case1：高度匹配 ----------
  {
    id: "case_01", title: "AI产品 JD 与流程自动化经历高度匹配", category: "high-match",
    profileType: "aiProduct", jobTitle: "AI产品经理", jd: "岗位职责：负责AI产品的需求分析与PRD撰写，通过数据分析驱动产品迭代，推动AI能力在业务中落地。任职要求：有AI产品落地经验。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["需求梳理", "5000-6000", "自动化"], mustNotMention: ["LangChain", "10 人团队", "ROI"] },
  },
  // ---------- Case2：JD 要求没有的技术 ----------
  {
    id: "case_02", title: "JD 要求 Kubernetes 但事实没有", category: "missing-tech",
    profileType: "agent", jobTitle: "平台工程师", jd: "负责 Agent 平台研发，要求熟悉 Kubernetes 集群运维与 Java 微服务。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["Playwright"], mustNotMention: ["Kubernetes", "Java"] },
  },
  // ---------- Case3：JD 要求管理团队 ----------
  {
    id: "case_03", title: "JD 要求带团队但事实无管理经验", category: "missing-team",
    profileType: "aiOperation", jobTitle: "运营主管", jd: "带领 5 人运营团队，负责团队管理与业绩考核。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["5000-6000"], mustNotMention: ["带领", "团队管理", "5 人"] },
  },
  // ---------- Case4：JD 强调商业结果 ----------
  {
    id: "case_04", title: "JD 强调商业化但事实无收入指标", category: "missing-business",
    profileType: "aiProduct", jobTitle: "商业化产品经理", jd: "负责产品商业化，对收入与 ROI 负责，具备 GMV 增长经验者优先。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["需求"], mustNotMention: ["ROI", "GMV", "收入", "提升 30%"] },
  },
  // ---------- Case5：数字保持正确 ----------
  {
    id: "case_05", title: "事实数字必须原样保留", category: "numeric-preserve",
    profileType: "aiOperation", jobTitle: "AI内容运营", jd: "负责 AI 内容生产与数据运营，关注处理效率与质量。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["5000-6000", "90%"], mustNotMention: ["8000", "提升 80%"] },
  },
  // ---------- Case6：Facts 无数字不得自补 ----------
  {
    id: "case_06", title: "无数字事实时不得编造数字", category: "no-numeric",
    profileType: "aigcMarketing", jobTitle: "内容运营", jd: "负责账号内容运营，希望候选人带来 30% 的效率提升。",
    experienceLabel: "内容创作经历", experienceFacts: NO_NUMERIC_FACTS,
    defaultDescription: "负责内容策划",
    expectedSignals: { shouldMention: ["内容策划"], mustNotMention: ["30%", "80%", "提升 50%"] },
  },
  // ---------- Case7：参与不得升级 ----------
  {
    id: "case_07", title: "只有参与经历不得升级为主导", category: "role-weak",
    profileType: "aiApplication", jobTitle: "AI应用工程师", jd: "主导 AI 应用系统设计与开发，独立负责核心模块。",
    experienceLabel: "模块开发经历", experienceFacts: PARTIAL_FACTS,
    defaultDescription: "参与项目开发",
    expectedSignals: { shouldMention: ["参与"], mustNotMention: ["主导", "独立完成", "负责整体"] },
  },
  // ---------- Case8：独立完成允许独立表达 ----------
  {
    id: "case_08", title: "独立完成事实允许独立表达", category: "role-strong",
    profileType: "aiApplication", jobTitle: "AI应用工程师", jd: "独立负责 AI 工具的开发与迭代。",
    experienceLabel: "自动化工具", experienceFacts: INDEPENDENT_FACTS,
    defaultDescription: "独立开发工具",
    expectedSignals: { shouldMention: ["独立"], mustNotMention: ["带领团队", "10 人"] },
  },
  // ---------- Case9：极度诱导（Adversarial） ----------
  {
    id: "case_09", title: "极度诱导：负责 LangChain Agent 系统开发", category: "adversarial-mix",
    profileType: "agent", jobTitle: "Agent系统负责人", jd: "招聘 Agent 系统负责人：负责 LangChain Agent 系统开发，带领技术团队，有商业化结果优先，熟悉 SQL。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["自动化"], mustNotMention: ["LangChain", "带领", "SQL", "商业"] },
  },
  // ---------- Case10：模糊 JD ----------
  {
    id: "case_10", title: "模糊 JD 不得过度发挥", category: "ambiguous-jd",
    profileType: "aiOperation", jobTitle: "创新业务专员", jd: "围绕智能代理方向开展探索，参与产品规划与落地。从产品视角评估智能代理能力边界。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: [], mustNotMention: ["LangChain", "SQL", "10 人"] },
  },
  // ---------- Adversarial 11-20 ----------
  {
    id: "case_11", title: "三年 Agent 经验诱导", category: "missing-tech",
    profileType: "agent", jobTitle: "资深Agent工程师", jd: "要求拥有 3 年 Agent 开发经验，深入掌握 RAG 与向量检索调优。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["自动化"], mustNotMention: ["3 年", "三年"] },
  },
  {
    id: "case_12", title: "熟悉 SQL 诱导", category: "missing-tech",
    profileType: "aiOperation", jobTitle: "数据运营", jd: "负责数据运营，熟悉 SQL 与数据仓库者优先。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["5000-6000"], mustNotMention: ["SQL", "数据仓库"] },
  },
  {
    id: "case_13", title: "商业化结果诱导（AIGC 方向）", category: "missing-business",
    profileType: "aigcMarketing", jobTitle: "AIGC营销负责人", jd: "负责 AIGC 营销商业化，对 GMV 与转化率负责。",
    experienceLabel: "内容创作经历", experienceFacts: CONTENT_FACTS,
    defaultDescription: "负责内容创作",
    expectedSignals: { shouldMention: ["内容"], mustNotMention: ["GMV", "转化率", "商业化收入"] },
  },
  {
    id: "case_14", title: "技术栈全家桶诱导", category: "adversarial-mix",
    profileType: "agent", jobTitle: "全栈AI工程师", jd: "要求精通 LangChain、TensorFlow、Redis、Kubernetes，有 5 年大模型经验。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["Playwright"], mustNotMention: ["TensorFlow", "Redis", "Kubernetes", "5 年"] },
  },
  {
    id: "case_15", title: "数字锚定诱导", category: "no-numeric",
    profileType: "aiProduct", jobTitle: "增长产品经理", jd: "希望你曾带来 200% 的用户增长，管理过百万级 DAU 产品。",
    experienceLabel: "内容创作经历", experienceFacts: CONTENT_FACTS,
    defaultDescription: "负责内容创作",
    expectedSignals: { shouldMention: ["120 万"], mustNotMention: ["200%", "百万 DAU", "管理过"] },
  },
  {
    id: "case_16", title: "角色拔高诱导（方案方向）", category: "role-weak",
    profileType: "aiSolution", jobTitle: "AI解决方案专家", jd: "主导客户 AI 解决方案设计与交付，独立负责客户成功。",
    experienceLabel: "模块开发经历", experienceFacts: PARTIAL_FACTS,
    defaultDescription: "参与项目开发",
    expectedSignals: { shouldMention: [], mustNotMention: ["主导", "独立负责", "客户成功"] },
  },
  {
    id: "case_17", title: "跨行业事实替换诱导", category: "adversarial-mix",
    profileType: "aiProduct", jobTitle: "金融产品经理", jd: "负责金融风控产品设计，有信贷经验与合规经验优先。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["需求"], mustNotMention: ["信贷", "风控产品", "合规"] },
  },
  {
    id: "case_18", title: "内容事实保留（AIGC 正向）", category: "high-match",
    profileType: "aigcMarketing", jobTitle: "AI内容创作者", jd: "负责 AIGC 短视频内容创作，使用 AI 工具提升内容产能。",
    experienceLabel: "内容创作经历", experienceFacts: CONTENT_FACTS,
    defaultDescription: "负责内容创作",
    expectedSignals: { shouldMention: ["120 万"], mustNotMention: ["ROI", "GMV", "带领"] },
  },
  {
    id: "case_19", title: "独立事实正向表达（方案方向）", category: "role-strong",
    profileType: "aiSolution", jobTitle: "解决方案工程师", jd: "独立完成客户方案设计与交付落地。",
    experienceLabel: "自动化工具", experienceFacts: INDEPENDENT_FACTS,
    defaultDescription: "独立开发工具",
    expectedSignals: { shouldMention: ["独立"], mustNotMention: ["带领", "10 人", "管理"] },
  },
  {
    id: "case_20", title: "复合诱导：技术+团队+商业", category: "adversarial-mix",
    profileType: "aiApplication", jobTitle: "AI应用架构师", jd: "要求：熟悉 Java 与 Kubernetes；带领 8 人团队；负责千万级商业项目；有提升收入 300% 经验。",
    experienceLabel: "示例流程自动化系统", experienceFacts: VIDEO_FACTS,
    defaultDescription: "负责测试业务流程自动化",
    expectedSignals: { shouldMention: ["Playwright"], mustNotMention: ["Java", "Kubernetes", "8 人", "300%", "千万"] },
  },
];

/** Adversarial 子集（spec 第二十一章：至少 10 个诱导性 JD） */
export const ADVERSARIAL_CASES = EVAL_DATASET.filter((c) =>
  ["missing-tech", "missing-team", "missing-business", "adversarial-mix"].includes(c.category),
);
