export type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export interface Step {
  key: string;
  label: string;
  state: StepState;
  /** 右侧补充说明（如命中的方向、字段数量） */
  detail?: string;
}

const MARK: Record<StepState, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✕",
  skipped: "–",
};

/** 识别进度：一步一行，当前步高亮；不做无意义的转圈动画，只给确定的状态 */
export function Stepper({ steps, collapsed = false }: { steps: Step[]; collapsed?: boolean }) {
  const list = (
    <ol className="stepper">
      {steps.map((s) => (
        <li key={s.key} className={`step step-${s.state}`}>
          <span className="step-mark">{MARK[s.state]}</span>
          <span className="step-label">{s.label}</span>
          {s.detail && <span className="step-detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );

  if (!collapsed) return list;

  /**
   * 识别跑完之后，四行进度条对用户已经没有决策价值——它把真正要看的「填了几项 / 哪几项要你处理」
   * 挤到第二屏。收成一行，出问题时（有失败步）自动展开，用户不需要点开就能看见。
   */
  const failed = steps.filter((s) => s.state === "failed");
  const lastDetail = [...steps].reverse().find((s) => s.detail)?.detail ?? "";
  const summary = failed.length
    ? `识别有 ${failed.length} 步没走通`
    : `识别完成 · ${steps.filter((s) => s.state === "done").length} / ${steps.length} 步`;

  return (
    <details className="soft-fold stepper-fold" open={failed.length > 0}>
      <summary>
        {summary}
        <span className="muted small"> {lastDetail}</span>
      </summary>
      {list}
    </details>
  );
}
