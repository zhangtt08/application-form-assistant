/**
 * Stage 5.5：Page Environment Detector + RouteObserver + FormObserver（spec 第二~五章、三十三~三十四章）。
 * 只用于兼容性处理与 Debug，不上传任何页面数据。
 */

export interface PageEnvironment {
  spa: boolean;
  frameworkHints: string[];
  sameOriginIframeCount: number;
  crossOriginIframeCount: number;
  shadowRootCount: number;
  closedShadowRootCount: number;
  customSelectCount: number;
  controlledInputSuspicion: boolean;
}

export function detectEnvironment(doc: Document = document): PageEnvironment {
  const iframes = Array.from(doc.querySelectorAll("iframe"));
  let sameOrigin = 0;
  let crossOrigin = 0;
  for (const f of iframes) {
    try {
      const d = f.contentDocument;
      if (d) sameOrigin += 1;
      else crossOrigin += 1;
    } catch {
      crossOrigin += 1;
    }
  }
  let shadowRootCount = 0;
  let closedShadowRootCount = 0;
  const walk = (root: Document | ShadowRoot | Element) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) {
        shadowRootCount += 1;
        walk(el.shadowRoot);
      } else if ((el as HTMLElement).attachShadow && el.tagName.includes("-")) {
        // closed shadow root 无法访问——仅当元素自定义且无 open root 时疑似
        closedShadowRootCount += 0; // 无法可靠探测 closed，保持 0（fail-safe：不做假设）
      }
    }
  };
  walk(doc);

  const customSelectCount = doc.querySelectorAll(
    '[role="listbox"], .select2, .select2-container, [class*="dropdown"][class*="select"]',
  ).length;

  const frameworkHints: string[] = [];
  const w = window as unknown as Record<string, unknown>;
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ || doc.querySelector("[data-reactroot], [data-reactid]")) frameworkHints.push("react");
  if (w.__VUE__ || w.__VUE_DEVTOOLS_GLOBAL_HOOK__ || doc.querySelector("[data-v-app], [data-v-]")) frameworkHints.push("vue");

  return {
    spa: typeof doc.defaultView?.history?.pushState === "function",
    frameworkHints,
    sameOriginIframeCount: sameOrigin,
    crossOriginIframeCount: crossOrigin,
    shadowRootCount,
    closedShadowRootCount,
    customSelectCount,
    controlledInputSuspicion: frameworkHints.length > 0,
  };
}

// ---------- RouteObserver（spec 第四章） ----------

export interface RouteObserverHandle {
  disconnect(): void;
}

/** SPA 路由监听：pushState/replaceState/popstate → debounce 回调；不要求用户手动刷新扩展 */
export function installRouteObserver(onRouteChange: (url: string) => void, debounceMs = 600): RouteObserverHandle {
  const w = window as unknown as {
    history: History;
    pushState: History["pushState"];
    replaceState: History["replaceState"];
  };
  let timer: number | undefined;
  const fire = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onRouteChange(location.href), debounceMs);
  };
  const origPush = w.history.pushState.bind(w.history);
  const origReplace = w.history.replaceState.bind(w.history);
  w.history.pushState = function patchedPush(...args: Parameters<History["pushState"]>) {
    const r = origPush(...args);
    fire();
    return r;
  } as History["pushState"];
  w.history.replaceState = function patchedReplace(...args: Parameters<History["replaceState"]>) {
    const r = origReplace(...args);
    fire();
    return r;
  } as History["replaceState"];
  window.addEventListener("popstate", fire);
  return {
    disconnect() {
      w.history.pushState = origPush;
      w.history.replaceState = origReplace;
      window.removeEventListener("popstate", fire);
      window.clearTimeout(timer);
    },
  };
}

// ---------- FormObserver（spec 第五/三十三/三十四章） ----------

export interface FormObserverHandle {
  disconnect(): void;
}

let writerActiveUntil = 0;

/** Loop Guard（spec 三十四）：写入期间/冷却期内忽略自身引发的 DOM mutation */
export function markWriterActive(cooldownMs = 1500): void {
  writerActiveUntil = Date.now() + cooldownMs;
}

export function isWriterActive(): boolean {
  return Date.now() < writerActiveUntil;
}

/**
 * 动态表单监听：childList/attributes 变化 → debounce → 回调（partial rescan 决策）。
 * 禁止每次 mutation 立刻全扫描；写入冷却期内完全忽略，避免 rescan 死循环。
 */
export function installFormObserver(
  onFormChanged: (mutations: MutationRecord[]) => void,
  options?: { debounceMs?: number; root?: Element },
): FormObserverHandle {
  const debounceMs = options?.debounceMs ?? 800;
  let timer: number | undefined;
  let pending: MutationRecord[] = [];
  const observer = new MutationObserver((mutations) => {
    if (isWriterActive()) return; // loop guard
    pending = pending.concat(mutations);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (isWriterActive()) return; // debounce 期间进入写入 → 丢弃
      const batch = pending;
      pending = [];
      onFormChanged(batch);
    }, debounceMs);
  });
  observer.observe(options?.root ?? document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "disabled"],
  });
  return {
    disconnect() {
      observer.disconnect();
      window.clearTimeout(timer);
    },
  };
}
