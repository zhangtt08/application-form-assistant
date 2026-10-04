import type {
  RuntimeMessage,
  ScanPageResult,
  FillFieldsResult,
  UndoResult,
  LocateFieldResult,
  CaptureJobResult,
  PingResult,
} from "../types/message";
import { scanPageSettled } from "./scanner";
import { fillFields, locateField, undoFill } from "./filler";
import { extractRawJobPage } from "./jobCapture";
import { installRouteObserver, markWriterActive, isWriterActive, detectEnvironment as detectEnvironmentSnapshot } from "../compatibility/environmentDetector";
import { logger } from "../utils/logger";
import {
  UNTRUSTED_SENDER,
  checkFrameCommandSender,
  describeRejection,
  type GuardDecision,
  type SenderLike,
} from "../utils/messageGuard";

/**
 * Content Script（IIFE，防重入）。
 * 职责：扫描（只读）→ 返回可序列化字段；执行 Side Panel 下发的写入；定位与 Undo。
 * 写入与扫描都是异步的（等框架回显 / 等 SPA 把字段渲染出来），
 * 因此每个 case 都 `return true` 保活消息端口，由 Promise resolve 时 sendResponse。
 * 无任何自动触发：所有动作都由 Side Panel 的用户操作驱动。
 *
 * 来源校验（`utils/messageGuard` 判据 1 + 3）：这一侧是真往 DOM 写的那一侧，
 * 所以只认「本扩展自己的页面」或「本 frame 自己的地址」发来的指令；
 * 其它地址（典型是另一个 tab 的页面上下文）来的 FILL_FIELDS 一律不执行。
 * 它和 `plan.confirmed` 那道 Writer 门禁是两条独立的闸：来源不对 → 不执行；
 * 计划没确认 → 不执行。任何一条破口都不足以触发写入。
 */

declare global {
  interface Window {
    __AFA_INJECTED__?: boolean;
  }
}

/** MutationObserver：页面结构变化 → 提醒重新扫描（只提醒，绝不自动填写） */
function setupMutationObserver(): void {
  let timer: number | undefined;
  let lastNotify = 0;

  const observer = new MutationObserver((mutations) => {
    // Loop Guard：我们自己写入后框架重渲染出来的节点（校验提示、下拉选项等）
    // 不算「页面结构变了」，否则每填一次就弹一次重新识别提醒。
    if (isWriterActive()) return;

    // 只关心表单控件的增删（文本变化不提醒，避免输入时频繁触发）
    const relevant = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (n) =>
          n instanceof HTMLElement &&
          (n.tagName === "INPUT" ||
            n.tagName === "SELECT" ||
            n.tagName === "TEXTAREA" ||
            n.querySelector("input, select, textarea") !== null),
      ),
    );
    if (!relevant) return;

    const now = Date.now();
    if (now - lastNotify < 3000) return; // 节流
    lastNotify = now;

    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (isWriterActive()) return; // 冷却期内的挂起通知同样丢弃
      chrome.runtime
        .sendMessage({ type: "PAGE_MUTATED", url: location.href })
        .catch(() => {
          /* side panel 未打开时正常失败 */
        });
    }, 1500);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** 本 content script 负责执行的指令类型 */
const EXECUTABLE_TYPES = new Set<string>([
  "PING",
  "SCAN_PAGE",
  "FILL_FIELDS",
  "UNDO_FILL",
  "LOCATE_FIELD",
  "CAPTURE_JOB",
]);

/**
 * 来源被拒时的回包：与各 result 类型对齐，界面上表现为「这一步失败」而不是永远等下去；
 * 不带 sender 细节（那是本地日志的事，不是给用户看的）。
 */
function rejectionFor(msg: RuntimeMessage): unknown {
  switch (msg.type) {
    case "PING":
      return { ok: false } satisfies PingResult;
    case "SCAN_PAGE":
      return { ok: false, fields: [], error: UNTRUSTED_SENDER } satisfies ScanPageResult;
    case "FILL_FIELDS":
      return { ok: false, outcomes: [], originals: [], error: UNTRUSTED_SENDER } satisfies FillFieldsResult;
    case "UNDO_FILL":
      return { ok: false, restored: 0, failed: 0, error: UNTRUSTED_SENDER } satisfies UndoResult;
    case "LOCATE_FIELD":
      return { ok: false, found: false, error: UNTRUSTED_SENDER } satisfies LocateFieldResult;
    case "CAPTURE_JOB":
      return { ok: false, error: UNTRUSTED_SENDER } satisfies CaptureJobResult;
    default:
      return { ok: false, error: "unknown-message" };
  }
}

function logRejection(type: string, decision: GuardDecision, sender: SenderLike | undefined): void {
  if (decision.ok) return;
  logger.warn(describeRejection(type, decision, sender?.url ?? sender?.origin ?? sender?.tab?.url));
}

function init(): void {
  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender: SenderLike, sendResponse) => {
    if (!msg) return false;

    // 未知类型：和以前一样不处理、不回包（让别的监听者去接）
    if (!EXECUTABLE_TYPES.has(msg.type)) return false;

    const decision = checkFrameCommandSender(sender, chrome.runtime.id, document.URL);
    if (!decision.ok) {
      logRejection(msg.type, decision, sender);
      sendResponse(rejectionFor(msg));
      return false;
    }

    switch (msg.type) {
      case "PING": {
        sendResponse({ ok: true });
        return false;
      }

      case "SCAN_PAGE": {
        scanPageSettled()
          .then((fields) => sendResponse({ ok: true, fields, environment: detectEnvironmentSnapshot() }))
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      case "FILL_FIELDS": {
        try {
          // Loop Guard：写入期间页面会因为我们的输入而重渲染，那不算「页面结构变了」
          markWriterActive(120_000);
        } catch {
          /* 观察器异常不影响写入 */
        }
        fillFields(msg.plan)
          .then(({ outcomes, originals }) => {
            markWriterActive(2000);
            sendResponse({ ok: true, outcomes, originals });
          })
          .catch((err) => {
            markWriterActive(2000);
            sendResponse({ ok: false, outcomes: [], originals: [], error: String(err) });
          });
        return true;
      }

      case "UNDO_FILL": {
        undoFill(msg.originals)
          .then(({ restored, failed }) => sendResponse({ ok: true, restored, failed }))
          .catch((err) => sendResponse({ ok: false, restored: 0, failed: 0, error: String(err) }));
        return true;
      }

      case "LOCATE_FIELD": {
        try {
          const found = locateField(msg.reference);
          sendResponse({ ok: true, found });
        } catch (err) {
          sendResponse({ ok: false, found: false, error: String(err) });
        }
        return false;
      }

      case "CAPTURE_JOB": {
        try {
          sendResponse({ ok: true, raw: extractRawJobPage() });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        return false;
      }

      default:
        return false;
    }
  });

  setupMutationObserver();
  // Stage 5.5：SPA 路由监听（pushState/replaceState/popstate）→ 通知 Side Panel 页面已切换
  installRouteObserver(() => {
    chrome.runtime
      .sendMessage({ type: "PAGE_MUTATED", url: location.href })
      .catch(() => {
        /* side panel 未打开时正常失败 */
      });
  });
  // eslint-disable-next-line no-console
  console.debug("[AFA] content script ready");
}

if (!window.__AFA_INJECTED__) {
  window.__AFA_INJECTED__ = true;
  init();
}
