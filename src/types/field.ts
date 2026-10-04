/** 网页上识别出的字段种类 */
export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "email"
  | "tel"
  | "number"
  | "date"
  | "custom-select"
  | "contenteditable"
  | "unsupported";

/**
 * 由近及远的祖先结构信号（Application Context Gate 的唯一依据，issue-004）。
 * 只保留有限、去重、长度受控的结构信息，绝不保存整页正文。
 */
export interface ContextAncestorSignal {
  /** 1 = 父节点，递增；最多 5 层 */
  depth: number;
  tag: string;
  role: string;
  /** 命中的通用语义 class/id 片段（login/auth/search/dialog/modal/nav/header/footer/form/apply/resume…） */
  hints: string[];
  /** 命中的语境词（`zone:term` 形式，≤12 条）——只存命中的信号词，不存容器正文 */
  hits: string[];
}

/** 网页控件所处的语境（issue-004：登录手机号长得像 basic.phone，但它不是申请字段） */
export type ApplicationZone =
  | "application"
  | "authentication"
  | "navigation"
  | "search"
  | "global"
  | "unknown";

/**
 * Application Context Gate 判定结果。
 * 必须可解释：Dev / Trace 要能回答「这个控件为什么被排除」（§四）。
 */
export interface ApplicationContextResult {
  eligible: boolean;
  zone: ApplicationZone;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  /** 命中的正/负信号累计分（纯确定性，无随机） */
  score: number;
}

/** Content Script 扫描出的字段上下文（全部可序列化，不含 DOM 引用） */
export interface RawFieldContext {  labelText: string;
  /** radio/checkbox 组的组标题（「性别」「语言能力」这类）；选项文本走 options，不占 labelText */
  groupLabel?: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  id: string;
  title: string;
  fieldsetLabel: string;
  sectionTitle: string;
  prevSiblingText: string;
  /** 近距离父节点聚合文字（已截断），用于 Level 3 上下文判断 */
  parentText: string;
  autocomplete: string;
  inputType: string;
  maxLength: number | null;
  /**
   * number 控件的步长（HTML 语义：以 0 为基准，属性缺省即 1；站点写 `step="any"` 记为 null = 不设限）。
   * 用于判断「值语义正确但控件收不下」——issue-003：整数年份框收到 2027.06 会被页面判 stepMismatch。
   */
  step?: number | null;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  currentValue: string;
  /** 由近及远的祖先结构信号（≤5 层）；缺失 = 老数据或未采集，语境判定按 unknown 保守处理 */
  ancestorSignals?: ContextAncestorSignal[];
  /** 同近邻容器内其他控件的 label/placeholder（≤10 条，每条 ≤24 字）——「典型申请字段共现」信号 */
  siblingLabels?: string[];
}

/** 扫描出的单个字段。reference 是稳定指纹，用于重扫描对齐与回写定位 */
export interface RawField {
  reference: string;
  kind: FieldKind;
  context: RawFieldContext;
  /** select 的 option 文本 / radio-checkbox 组的选项文本 */
  options: string[];
  /**
   * 控件所在 frame（chrome webNavigation frameId；0 = 主框架）。
   * 跨域 iframe 承载的表单只能由该 frame 里的 content script 读写，
   * 扫描时打标、写入时按 frame 分发——这是「识别得到却填不进去」的一类真实根因。
   */
  frameId?: number;
}

export type RiskLevel = "SAFE" | "REVIEW" | "MANUAL_ONLY";

export type MatchSource = "exact" | "alias" | "context" | "type-hint" | "none";

export interface MatchResult {
  /** Canonical Field ID，无法识别时为 "unknown" */
  fieldId: string;
  confidence: number;
  matchedBy: MatchSource;
  evidence: string[];
  /** 次优候选（用于冲突检测：与最优分差过小时整体降级为 UNKNOWN） */
  runnerUpFieldId?: string;
  runnerUpConfidence?: number;
}

export type ValueVariant = "plain" | "short" | "medium" | "long";

/**
 * 内容来源类型（spec Stage 2 第七章）：
 * - fact：基础资料（basic/education/skills 等客观字段）
 * - variant：当前岗位方向的经历变体表达
 * - default：经历默认表达（无方向或变体未配置时的回退）
 * - manual：用户在 Preview 中手动修改（仅影响本次填写，不回写 Profile）
 * - empty：未找到可用内容
 */
export type ContentSourceType = "fact" | "variant" | "default" | "manual" | "empty" | "ai_grounded";

export interface ResolvedValue {
  fieldId: string;
  value: string;
  variant: ValueVariant;
  /** REVIEW 字段：允许用户在预览中编辑本次填写内容（不回写 Profile） */
  editable: boolean;
  /** 多条 Profile 条目时（教育/实习/项目），标注取的是第几条（0-based） */
  entryIndex?: number;
  entryCount?: number;
  /** 内容来源（可解释性：Preview 用它显示来源 Badge） */
  sourceType?: ContentSourceType;
  /** 来源路径（variant 时如 internship.variants.aiProduct） */
  sourcePath?: string;
  /** 方向变体缺失 → 回退默认表达时为 true */
  fallbackUsed?: boolean;
  /** 生效岗位方向（变体选择依据） */
  profileType?: string;
}

export type CandidateStatus =
  | "ready"
  | "need-confirm"
  | "manual"
  | "unknown"
  | "empty"
  | "unsupported"
  | "ignored"
  | "low-confidence"
  | "filled"
  | "failed"
  | "skipped"
  /** 语境门禁判定「这根本不是申请表字段」（登录 / 搜索 / 导航 / 全局控件）——不是「需要人工填」 */
  | "excluded";

/** Side Panel 中一个字段卡片的完整状态（扫描 → 匹配 → 风险 → 取值） */
export interface CandidateField {
  raw: RawField;
  match: MatchResult;
  risk: RiskLevel | "UNKNOWN";
  riskReason: string;
  value?: ResolvedValue;
  status: CandidateStatus;
  /** 多条目轮转分配结果（与 value 解耦，切换填写版本重解析时保留） */
  entryIndex?: number;
  /** 用户在预览中编辑过的本次填写内容（sourceType 视为 manual，原解析内容保留在 value 中） */
  editedValue?: string;
  /**
   * 点「跳过这一项」之前的状态。忽略必须是**可撤销**的，
   * 所以这里要留住原状态，否则「撤销跳过」只能靠整页重识别来恢复。
   */
  preIgnoreStatus?: CandidateStatus;
  /** Stage 4：开放问题元数据（intent/验证/回答） */
  openAnswer?: import("../answering/types").OpenAnswerMeta;
  /** 用户逐项确认标记 */
  confirmed?: boolean;
  /** 写入失败的具体原因（来自 Write Verification），卡片上直接说清楚为什么没填进去 */
  fillDetail?: string;
  /** Application Context Gate 判定（issue-004）：为什么算候选 / 为什么被排除 */
  applicationContext?: ApplicationContextResult;
  /**
   * 这一项本次是按站点记忆的哪条设定处理的（站点改版前的人工判断）。
   * 只带规则 id / 主机名 / 站点自己给的文字 —— 绝不带资料值。
   * 界面上靠它把「这是软件猜的」和「这是你上次在这一站定的」区分开，并给出撤销入口。
   */
  siteRule?: {
    ruleId: string;
    host: string;
    kind: "block" | "map";
    /** 生效前的自动识别结果（改挂类规则用它说明「原来识别成了什么」） */
    overriddenFieldId?: string;
  };
}

/** 字数约束提示（不自动截断） */
export interface LengthConstraint {
  maxLength: number;
  currentLength: number;
  exceeded: boolean;
}

/**
 * Confirmed Fill Plan（spec Stage 2 第二十章；Safety Flow Reconciliation 收紧）：
 * 只有用户点击「确认填写」后生成；Field Writer 只读取本计划，
 * 绝不自行调用 Router / Resolver / Risk Engine —— 写入层保持纯执行。
 * `confirmed` 是 Writer 的运行时门禁：非 true 一律拒绝执行（Defense in depth 第一道）。
 */
export interface ConfirmedFillPlan {
  confirmed: true;
  jobContextId: string | null;
  effectiveProfileType: string | null;
  createdAt: string;
  fields: {
    reference: string;
    fieldId: string;
    value: string;
    kind: string;
    approved: true;
    /** 语境门禁第二道防线（issue-004）：Writer 见到 false 一律拒绝，即使上游出了 bug */
    contextEligible?: boolean;
  }[];
}

export interface FillOutcome {
  reference: string;
  status: "filled" | "failed" | "skipped";
  detail?: string;
  /** 跨 frame 分发时由 Background 回填，用于把结果对回正确的字段卡 */
  frameId?: number;
}
