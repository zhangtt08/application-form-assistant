import type { CandidateField } from "../../types/field";

export interface FillConfirmDialogProps {
  candidates: CandidateField[];
  onCancel: () => void;
  onConfirm: () => void;
}

function fieldLabel(c: CandidateField): string {
  return (
    c.raw.context.labelText ||
    c.raw.context.placeholder ||
    c.raw.context.name ||
    c.raw.context.id ||
    c.match.fieldId ||
    "(未命名字段)"
  );
}

/** 长文本只给前 48 个字符：确认框是用来核对「写的是不是这条」，不是用来读完整文章 */
function preview(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

/**
 * 填写前最终确认框（Phase 10）。
 * 逐项列出「将写入什么」——只有汇总数字的确认框等于没有确认，
 * 用户看不出串位/写错字段就点了下去（真实 Pilot 的停止条件是「值串位」）。
 */
export function FillConfirmDialog({ candidates, onCancel, onConfirm }: FillConfirmDialogProps) {
  const toFill = candidates.filter(
    (c) => c.confirmed && (c.status === "ready" || c.status === "need-confirm") && c.value,
  );
  const safeCount = toFill.filter((c) => c.risk === "SAFE").length;
  const reviewCount = toFill.filter((c) => c.risk === "REVIEW").length;
  const manualList = candidates.filter((c) => c.risk === "MANUAL_ONLY" || c.status === "manual");
  const lowConfCount = candidates.filter(
    (c) => c.status === "low-confidence" || c.status === "unknown" || c.status === "unsupported",
  ).length;

  return (
    <div className="dialog-mask" role="dialog" aria-modal="true" aria-label="填写前确认">
      <div className="dialog">
        <h3>填写前确认</h3>
        <p className="dialog-line">
          即将把下面 <b>{toFill.length}</b> 项写进网页（{safeCount} 项低风险 · {reviewCount} 项你已核对过）：
        </p>
        {toFill.length === 0 ? (
          <p className="confirm-none">没有已确认的字段，取消后先勾选要填写的项。</p>
        ) : (
          <ul className="confirm-list">
            {toFill.map((c) => (
              <li key={c.raw.reference} className="confirm-item">
                <span className="confirm-item-label">{fieldLabel(c)}</span>
                <span className="confirm-item-value" title={c.editedValue ?? c.value?.value ?? ""}>
                  {preview(c.editedValue ?? c.value?.value ?? "")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="dialog-line">不会写入：</p>
        <ul className="dialog-list">
          <li className="text-manual">
            {manualList.length} 项需人工处理
            {manualList.length > 0 ? `（${manualList.slice(0, 3).map(fieldLabel).join("、")}${manualList.length > 3 ? " 等" : ""}）` : ""}
          </li>
          <li className="text-muted">{lowConfCount} 项无法确定或不支持的控件</li>
        </ul>
        <p className="dialog-note">
          扩展只写入上面这些字段，<b>绝不会点击提交</b>。提交前请自行检查页面。
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={onConfirm} disabled={toFill.length === 0}>
            确认填写
          </button>
        </div>
      </div>
    </div>
  );
}
