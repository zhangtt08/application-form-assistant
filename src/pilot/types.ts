/**
 * Stage 6：Real-world Validation Pilot 数据模型（spec 第五/七/十九~二十一/三十四章）。
 * 原则：只记录结构化兼容性信息，绝不保存 input value / 手机号 / 身份证 / 邮箱 / 完整回答文本 / API Key。
 */

export type IssueSeverity = "P0" | "P1" | "P2" | "P3" | "P4";
export type IssueStatus = "new" | "reproduced" | "fixture_created" | "fixing" | "fixed" | "verified" | "wont_fix";
export type TrustLevel = "unverified" | "experimental" | "verified";

export interface RealValidationSession {
  id: string;
  jobId?: string;
  hostname: string;
  urlPattern: string;
  platformFamily: string;
  testedAt: string;
  environment: {
    spa: boolean;
    frameworkHints: string[];
    sameOriginIframeCount: number;
    crossOriginIframeCount: number;
    shadowRootCount: number;
    customSelectCount: number;
  };
  detectedFields: number;
  /** 页面真实字段数（人工清点） */
  actualFieldCount: number | null;
  writableFields: number;
  manualFields: number;
  scanDurationMs: number;
  writeDurationMs: number | null;
  /** 人工抽查结果（spec 二十三/二十四） */
  semanticCorrectnessChecked: boolean;
  semanticFalseFills: number;
  /** classificationCorrection（spec 二十五）：用户纠正的误识别 */
  classificationCorrections: { fieldLabel: string; detectedAs: string; actually: string }[];
  issues: string[];
}

export interface RealIssue {
  issueId: string;
  validationSessionId: string;
  hostname: string;
  severity: IssueSeverity;
  /** scan | classify | binding | resolve | write | verify | ux */
  stage: string;
  errorCode: string;
  fieldType: string;
  /** label normalized（允许） */
  fieldLabel: string;
  environment: string;
  expectedBehavior: string;
  actualBehavior: string;
  reproducible: boolean;
  screenshotAvailable: boolean;
  traceId: string | null;
  status: IssueStatus;
  createdAt: string;
}

/** Platform Family（spec 十九~二十一）：粗粒度识别共用招聘系统，不做网站追踪 */
export interface PlatformFamilyRecord {
  family: string;
  /** hostname 模式列表（如 boss.zhipin.com、apply.xxx.com） */
  hostnamePatterns: string[];
  trustLevel: TrustLevel;
  pagesTested: number;
  lastTestedAt: string | null;
  unresolvedP0P1: number;
}

/** Known Limitation Registry（spec 三十三章） */
export interface KnownLimitation {
  code: string;
  description: string;
  /** environment 命中条件 */
  matches: (env: { sameOriginIframeCount: number; crossOriginIframeCount: number; shadowRootCount: number; customSelectCount: number }) => boolean;
  guidance: string;
}

export const KNOWN_LIMITATIONS: KnownLimitation[] = [
  {
    code: "SANDBOXED_FRAME_NO_INJECTION",
    description:
      "iframe 内的字段已按 frame 路由识别与填写（同源与跨域都走 all_frames 注入）；" +
      "只有被 sandbox / 注入策略挡住的那个 frame 才会整块留在需人工",
    matches: () => false, // 注入失败在运行时逐 frame 如实上报，不在这里做环境级预判
    guidance: "某个 frame 的字段整块没填上时看侧边栏的 frame 提示，那通常是站点禁止注入，不是链路坏了",
  },
  {
    code: "UNKNOWN_CUSTOM_SELECT",
    description: "认不出选项结构的自定义下拉强制 Manual Only，绝不乱点",
    matches: (env) => env.customSelectCount > 0,
    guidance: "检测到自定义下拉组件——请人工选择；系统只点文本精确/同极性命中的那个选项",
  },
  {
    code: "COMPLEX_DATE_PICKER",
    description: "日期组件走「点站点自己的日历格子 + 等价日期回显」，命不中才按字段判需人工",
    matches: () => false,
    guidance: "日期字段没填上是该站点的日历结构未被命中，不等于日期类整体不支持",
  },
];

/** Dry Run 结果（spec 三十章）：只展示准备写入的字段映射，不写 DOM */
export interface DryRunEntry {
  fieldLabel: string;
  canonicalFieldId: string;
  sourceType: string;
  /** 只展示 masked 值摘要，不保存完整内容 */
  valuePreview: string;
  risk: string;
  wouldWrite: boolean;
  manualReason?: string;
}

export interface DryRunReport {
  platformFamily: string;
  hostname: string;
  generatedAt: string;
  entries: DryRunEntry[];
  highRiskManual: number;
  wouldWriteCount: number;
}
