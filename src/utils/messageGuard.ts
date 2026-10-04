/**
 * 消息来源校验（message sender guard）—— 扩展三个消息入口共用的**唯一一份**判据。
 *
 * 背景：`chrome.runtime.onMessage` 的 listener 拿到的 `sender` 是浏览器填的元数据，
 * 而 `background` / `content` 以前都写成 `(msg, _sender, ...)` 直接丢掉它。
 * 于是「谁能触发填写」这件事完全由消息的 `type` 决定：任何能发出
 * `FILL_FIELDS` / `FILL_TARGET` 这条消息的上下文，都能驱动扩展往页面里写用户的资料。
 * 本项目没有声明 `externally_connectable`，所以网页与其它扩展**理论上**进不来；
 * 但这条前提由 Chrome 的实现保证，不由本仓库保证 —— 边界不能靠假设。
 * 这里把它变成代码：来源不合法就拒，并且只回一句脱敏日志。
 *
 * 三处入口各自的判据（都能落到手上真实可观测的信息，不写做不到的事）：
 *  1. `checkExtensionCommandSender` —— Background 收 Side Panel 的指令、Content 收 Background 的指令：
 *     `sender.id` 必须等于 `chrome.runtime.id`，且 `sender.url` 必须是本扩展自己的页面。
 *  2. `checkSenderTargetsSameTab` —— 「别的网页 tab 不许指挥这个 tab」：
 *     Background 侧带 tab 上下文的 sender 只准是两种：本扩展自己的页面（面板在真实
 *     Chrome 里**就占一个 tab**），或就是本次操作的那个 tab（id + url 逐字相等）。
 *     网页上下文的 sender 在判据 1 就已经被挡下了（更严，见 background 注释）。
 *  3. `checkFrameCommandSender` —— Content 侧的 tab-bound 判据：
 *     `sender.url` 要么是本扩展页面（实测 Background 发过来的是
 *     `chrome-extension://<id>/background.js`），要么就是**本 frame 自己的 URL**。
 *     其它 http(s) 来源（另一个 tab 的页面上下文）一律拒 —— 它不属于这个 tab。
 *
 * ⚠ 这三条不证明的事也说清楚：不证明 sender.url 所指页面里的人知道发生了什么
 *   （那需要用户逐次确认，已由 FillConfirmDialog 承担）；不防同扩展内的 XSS；
 *   不替代 `plan.confirmed` 那道 Writer 门禁。它是**边界校验**，不是授权。
 */

/** 只取 listener 第二参数里用到的字段，测试可以用同样形状伪造 sender */
export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
  tabId?: number;
  frameId?: number;
  tab?: { id?: number; url?: string } | null;
}

export type GuardReason = "sender_missing" | "sender_id" | "sender_url" | "sender_tab_mismatch";

export type GuardDecision = { ok: true } | { ok: false; reason: GuardReason; detail: string };

const PASS: GuardDecision = { ok: true };

/** 回给调用方的统一错误码（界面按「操作失败」呈现，不带任何来源细节） */
export const UNTRUSTED_SENDER = "untrusted-sender";

/** 本扩展自己的页面 URL 前缀 */
export function extensionUrlPrefix(runtimeId: string): string {
  return `chrome-extension://${runtimeId}/`;
}

/**
 * 是否为「本扩展自己的页面」地址。
 * `match_origin_as_fallback` 注入的 frame 里 sender.url 可能为空串，
 * 空串不是本扩展页面 —— 按不放行处理（fail closed），由调用方的日志解释。
 */
export function isOwnExtensionUrl(url: string | undefined, runtimeId: string): boolean {
  if (typeof url !== "string" || !url) return false;
  return url.startsWith(extensionUrlPrefix(runtimeId));
}

/**
 * 脱敏用的 sender 地址：只保留协议与主机名，路径/查询串（常带 token 与职位 id）一律丢掉。
 * 解析不出来时只回协议或 `<none>`，绝不把原文抄进日志。
 */
export function redactSenderUrl(url: string | undefined): string {
  if (typeof url !== "string" || !url) return "<none>";
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}` : u.protocol;
  } catch {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
    return scheme ? `${scheme}:` : "<none>";
  }
}

function missing(): GuardDecision {
  return { ok: false, reason: "sender_missing", detail: "消息没有 sender 元数据（非扩展上下文）" };
}

function badId(): GuardDecision {
  return { ok: false, reason: "sender_id", detail: "sender.id 与本扩展 id 不一致" };
}

/**
 * 判据 1：指令必须来自本扩展自己的页面（面板 → Background，Background → Content）。
 */
export function checkExtensionCommandSender(sender: SenderLike | undefined, runtimeId: string): GuardDecision {
  if (!sender || typeof sender !== "object") return missing();
  if (!runtimeId || sender.id !== runtimeId) return badId();
  if (!isOwnExtensionUrl(sender.url, runtimeId)) {
    return {
      ok: false,
      reason: "sender_url",
      detail: `sender.url 不是本扩展页面：${redactSenderUrl(sender.url)}`,
    };
  }
  return PASS;
}

/**
 * 判据 2：tab-bound 命令（要往某个 tab 里读写的那类）的来源 tab 归属校验。
 *
 * 真实 Chrome 里（delivery-flow E2E 实测的 sender 形状，别按想象写）：
 * Side Panel 自己也算一个 tab —— 面板发来的消息带着
 * `sender.tab = { id: <面板的 tab id>, url: "chrome-extension://<id>/sidepanel.html" }`。
 * 所以「带 tab 就不许指挥别的 tab」不能写成「带 tab 就必须等于目标 tab」，
 * 那样会把扩展自己的 UI 挡在门外（第一版就是这么把 E2E 五条全打红的）。
 *
 * 三条放行、其余全拒：
 *  - 没有 tab 上下文（service worker 直发）；
 *  - tab 是**本扩展自己的页面**（面板 / 扩展页签 —— 它代表 UI，不代表某个网页的授权）；
 *  - tab 就是本次操作的那个 tab（id 与 url 都逐字相等：网页自己请求处理自己这一页）。
 * 被拒的那一类正是真正危险的那一类：**另一个网页 tab 的上下文**来指挥这个 tab 的填写。
 */
export function checkSenderTargetsSameTab(
  sender: SenderLike | undefined,
  target: { tabId: number; url?: string },
  runtimeId: string,
): GuardDecision {
  if (!sender || typeof sender !== "object") return missing();
  const tabId = sender.tab?.id ?? sender.tabId;
  if (tabId == null) return PASS; // worker：没有 tab 上下文，谈不上跨 tab
  const senderTabUrl = sender.tab?.url;
  // 扩展自己的页面（面板开成页签时也带 tab）：不是网页上下文，放行
  if (isOwnExtensionUrl(senderTabUrl, runtimeId)) return PASS;
  if (tabId !== target.tabId) {
    return {
      ok: false,
      reason: "sender_tab_mismatch",
      detail: `sender 在 tab ${tabId}（${redactSenderUrl(senderTabUrl)}），本次操作目标是 tab ${target.tabId}`,
    };
  }
  if (target.url && senderTabUrl !== target.url) {
    return {
      ok: false,
      reason: "sender_tab_mismatch",
      detail: `sender 所在页面（${redactSenderUrl(senderTabUrl)}）与要操作的 tab（${redactSenderUrl(target.url)}）不是同一个地址`,
    };
  }
  return PASS;
}

/**
 * 判据 3：Content（真正往 DOM 写的那一侧）收到的指令必须属于**本 frame**。
 * 允许两种来源：
 *  - 本扩展自己的页面（Background / Side Panel —— 本项目的正常通路）；
 *  - sender.url 逐字等于本 frame 自己的地址（Background 按 frame 寻址打过来的那条）。
 * 拒绝：任何其它 http(s) 地址 —— 那不在这个 tab/frame 里，写进去就是越界。
 * （不复用判据 1：那条要求「必须是自己页面的地址」，会把第二种合法通路挡死。）
 */
export function checkFrameCommandSender(
  sender: SenderLike | undefined,
  runtimeId: string,
  ownFrameUrl: string,
): GuardDecision {
  if (!sender || typeof sender !== "object") return missing();
  if (!runtimeId || sender.id !== runtimeId) return badId();
  if (isOwnExtensionUrl(sender.url, runtimeId)) return PASS;
  if (typeof sender.url === "string" && sender.url === ownFrameUrl) return PASS;
  return {
    ok: false,
    reason: "sender_url",
    detail: `sender.url（${redactSenderUrl(sender.url)}）不属于本 frame（${redactSenderUrl(ownFrameUrl)}）`,
  };
}

/**
 * 广播类消息（Content / Background → 运行时里所有人，例如 PAGE_MUTATED）的来源校验。
 * Side Panel 用得上：它只该认自己扩展内部的提醒，别被别的上下文牵着改 UI 状态。
 */
export function checkRuntimeBroadcasterSender(sender: SenderLike | undefined, runtimeId: string): GuardDecision {
  if (!sender || typeof sender !== "object") return missing();
  if (!runtimeId || sender.id !== runtimeId) return badId();
  return PASS;
}

/**
 * 统一的拒收日志（脱敏）：只写消息类型、原因码与脱敏后的 sender 主机。
 * 绝不写 msg（可能含资料值）、plan.fields、reference 列表或完整 URL。
 * `decision.detail` 里的地址已经过 `redactSenderUrl`，所以这里可以直接带上。
 */
export function describeRejection(
  type: string,
  decision: Exclude<GuardDecision, { ok: true }>,
  senderUrl?: string,
): string {
  return `未通过来源校验的消息，已拒绝：type=${type} reason=${decision.reason} sender=${redactSenderUrl(senderUrl)}（${decision.detail}）`;
}
