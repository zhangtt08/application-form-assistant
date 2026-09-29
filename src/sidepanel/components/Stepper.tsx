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
export function Stepper({ steps }: { steps: Step[] }) {
  return (
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
}
