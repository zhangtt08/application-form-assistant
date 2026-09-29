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
    code: "SAME_ORIGIN_IFRAME_CROSS_FRAME_FILL",
    description: "same-origin iframe 内字段暂不支持跨 frame 自动填写（需 allFrames 聚合注入）",
    matches: (env) => env.sameOriginIframeCount > 0,
    guidance: "iframe 区域字段需人工填写；已在兼容层记录为已知限制",
  },
  {
    code: "CROSS_ORIGIN_IFRAME",
    description: "cross-origin iframe 受浏览器安全限制，不支持也不应绕过",
    matches: (env) => env.crossOriginIframeCount > 0,
    guidance: "该区域需要人工填写（浏览器安全边界）",
  },
  {
    code: "UNKNOWN_CUSTOM_SELECT",
    description: "未知自定义下拉组件强制 Manual Only，不自动点击",
    matches: (env) => env.customSelectCount > 0,
    guidance: "检测到自定义下拉组件——请人工选择；系统不会误点击",
  },
  {
    code: "COMPLEX_DATE_PICKER",
    description: "复杂 DatePicker 组件第一阶段 Manual Only",
    matches: () => false, // 由字段级 date 检测触发
    guidance: "日期组件请人工选择",
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
