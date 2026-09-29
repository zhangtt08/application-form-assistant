import { useState } from "react";
import type { VariantGenerationResult, ValidationReport } from "../../generation/types";
import { revalidateDraft } from "../../generation/variantGenerator";

export interface VariantReviewDialogProps {
  result: VariantGenerationResult;
  existingVariant: string;
  targetLabel: string;
  onSave: (draft: string) => void;
  onCancel: () => void;
}

/**
 * Generation Review UI（spec 第十七~二十章）：
 * 展示生成结果、事实验证状态、当前版本 vs 生成版本；
 * 编辑即失效验证，必须重新验证通过后才能保存；fail 状态禁止保存。
 */
export function VariantReviewDialog(props: VariantReviewDialogProps) {
  const { result } = props;
  const [draft, setDraft] = useState(result.draft);
  const [validation, setValidation] = useState<ValidationReport>(result.validation);
  const [dirty, setDirty] = useState(false);

  const revalidate = () => {
    setValidation(revalidateDraft(draft, result.selectedFacts));
    setDirty(false);
  };

  const statusInfo = {
    pass: { text: "✓ 所有表达均有事实支持", cls: "val-pass" },
    review: { text: "⚠ 部分表达存在不确定支持，需处理", cls: "val-review" },
    fail: { text: "✗ 存在事实中不存在的表达，禁止保存", cls: "val-fail" },
  }[validation.status];

  // 使用事实：验证通过 claim 的支持事实（去重）
  const usedFactTexts = result.selectedFacts.filter((f) =>
    validation.claims.some((c) => c.status === "supported" && c.supportingFactIds.includes(f.id)),
  );
  // 未覆盖的 JD 要求：hardSkills 中未被 draft 提及的
  const uncovered = result.requirements.hardSkills.filter(
    (s) => !draft.toLowerCase().includes(s.toLowerCase()),
  );

  const canSave = validation.status === "pass" && !dirty;

  return (
    <div className="dialog-mask">
      <div className="dialog dialog-wide">
        <h3>生成结果 Review — {props.targetLabel}</h3>

        <div className={`val-status ${statusInfo.cls}`}>
          <span className={`val-badge ${statusInfo.cls}`}>{statusInfo.text}</span>
          {dirty && <span className="val-dirty">内容已修改，验证已失效，请重新验证</span>}
        </div>

        <div className="diff-block">
          <div className="diff-col">
            <div className="diff-title">当前版本</div>
            <div className="diff-body muted">{props.existingVariant || "（未填写）"}</div>
          </div>
          <div className="diff-col">
            <div className="diff-title">生成版本（可编辑）</div>
            <textarea
              className="diff-textarea"
              value={draft}
              rows={6}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
            />
          </div>
        </div>

        <div className="review-grid">
          <div className="review-col">
            <div className="review-title">使用事实（验证支持）</div>
            <ul className="review-list">
              {usedFactTexts.length === 0 && <li className="muted small">（无）</li>}
              {usedFactTexts.map((f) => (
                <li key={f.id}>✓ {f.text}</li>
              ))}
            </ul>
          </div>
          <div className="review-col">
            <div className="review-title">验证明细</div>
            <ul className="review-list small">
              {validation.claims.map((c, i) => (
                <li key={i} className={c.status === "unsupported" ? "claim-unsupported" : ""}>
                  {c.status === "supported" ? "✓" : c.status === "uncertain" ? "⚠" : "✗"} [{c.kind}] {c.claim.slice(0, 40)}
                  {c.reason ? ` — ${c.reason}` : ""}
                </li>
              ))}
            </ul>
          </div>
          <div className="review-col">
            <div className="review-title">未覆盖的 JD 要求（不编造）</div>
            <ul className="review-list small">
              {uncovered.length === 0 && <li className="muted small">（全部覆盖）</li>}
              {uncovered.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="dialog-actions">
          <button onClick={props.onCancel}>取消</button>
          {dirty && (
            <button className="btn-sm" onClick={revalidate}>
              重新验证
            </button>
          )}
          <button
            className="primary"
            disabled={!canSave}
            title={canSave ? "" : "验证未通过或内容已修改未重验，禁止保存"}
            onClick={() => props.onSave(draft)}
          >
            保存为 {props.targetLabel} Variant
          </button>
        </div>
      </div>
    </div>
  );
}
