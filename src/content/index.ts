import type { RuntimeMessage } from "../types/message";
import { scanPageSettled } from "./scanner";
import { fillFields, locateField, undoFill } from "./filler";
import { extractRawJobPage } from "./jobCapture";
import { installRouteObserver, markWriterActive, isWriterActive, detectEnvironment as detectEnvironmentSnapshot } from "../compatibility/environmentDetector";

/**
 * Content Script（IIFE，防重入）。
 * 职责：扫描（只读）→ 返回可序列化字段；执行 Side Panel 下发的写入；定位与 Undo。
 * 写入与扫描都是异步的（等框架回显 / 等 SPA 把字段渲染出来），
 * 因此每个 case 都 `return true` 保活消息端口，由 Promise resolve 时 sendResponse。
 * 无任何自动触发：所有动作都由 Side Panel 的用户操作驱动。
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

function init(): void {
  chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
    if (!msg) return false;

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
