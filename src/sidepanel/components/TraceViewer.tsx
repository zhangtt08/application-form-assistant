import { useEffect, useState } from "react";
import { loadTrace, type TraceEvent, type TraceRecord } from "../../utils/trace";

export interface TraceViewerProps {
  devMode: boolean;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Dev Trace Viewer（spec Stage 2.5 第十九章）：
 * 开发模式默认折叠，展开显示当前/最近一次 ApplicationTrace 事件流。
 * 生产模式不渲染（由 App 的 devMode 控制）。
 */
export function TraceViewer({ devMode }: TraceViewerProps) {
  const [record, setRecord] = useState<TraceRecord | null>(null);

  useEffect(() => {
    if (!devMode) return;
    let alive = true;
    const refresh = () => {
      void loadTrace().then((t) => {
        // eslint-disable-next-line no-console
        console.debug("[AFA][TraceViewer] loadTrace ->", t?.traceId, t?.events.length);
        if (alive) setRecord(t);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 1500); // 轻量轮询（trace 事件低频）
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [devMode]);

  if (!devMode) return null;

  const events: TraceEvent[] = record?.events ?? [];

  return (
    <details className="trace-viewer">
      <summary>
        Debug Trace{record ? `（${record.traceId}，${events.length} 条）` : "（暂无）"}
      </summary>
      {events.length === 0 ? (
        <p className="muted small">还没有执行轨迹：捕获岗位或扫描页面后生成。</p>
      ) : (
        <ul className="trace-list">
          {events.map((e, i) => (
            <li key={i} className={`trace-item trace-${e.status}`}>
              <span className="trace-time">{fmtTime(e.timestamp)}</span>
              <span className="trace-stage">{e.stage}</span>
              <span className="trace-msg">
                {e.message}
                {e.metadata ? ` · ${Object.entries(e.metadata).map(([k, v]) => `${k}=${String(v)}`).join(" ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
