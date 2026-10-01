import { useState } from "react";
import type { CandidateField } from "../../types/field";
import { confidenceLevel, fieldFullLabel } from "../../core";

/**
 * 填写结果回执（Safety Flow Reconciliation 的「说清楚结果」那一半）。
 *
 * 改造前这里只有一行「填写完成 —— 成功 N，失败 N，跳过 N」。
 * 但用户真正要核对的是**哪几项被红线拦下了、为什么**：
 * 「承诺/声明」类不代填、语境门禁排除的登录框、选项对不上的单选题——
 * 这些是扩展**故意没做**的事，不写出来就会被当成「软件漏填了」。
 *
 * 本组件不产生任何新判定：状态、风险、原因全部来自 CandidateField
 * （由 runScanPipeline / deriveStatus / buildFillPlan 决定），这里只分组与转述。
 */

export interface FillReceiptProps {
  candidates: CandidateField[];
  onLocate: (reference: string) => void;
  onUnignore?: (reference: string) => void;
}

function labelOf(c: CandidateField): string {
  return c.raw.context.labelText || c.raw.context.placeholder || c.raw.context.name || "(未命名字段)";
}

function Row(p: { c: CandidateField; note?: string; action?: React.ReactNode }) {
  return (
    <li className="receipt-row">
      <span className="receipt-field">{labelOf(p.c)}</span>
      <span className="receipt-target">{fieldFullLabel(p.c.match.fieldId)}</span>
      {p.note && <span className="receipt-note">{p.note}</span>}
      {p.action}
    </li>
  );
}

export function FillReceipt(props: FillReceiptProps) {
  const [open, setOpen] = useState(true);
  const c = props.candidates;

  const filled = c.filter((x) => x.status === "filled");
  const failed = c.filter((x) => x.status === "failed");
  const blocked = c.filter(
    (x) => x.risk === "MANUAL_ONLY" || x.status === "manual" || x.status === "unsupported",
  );
  const excluded = c.filter((x) => x.status === "excluded");
  const ignored = c.filter((x) => x.status === "ignored");
  const noContent = c.filter((x) => x.status === "empty");
  const unmatched = c.filter((x) => x.status === "unknown");
  /** 已经写进去但把握不足的：这是回执里最该被看到的一格，不能混在「已填写」里 */
  const reviewAfterFill = filled.filter((x) => confidenceLevel(x.match.confidence) !== "HIGH" || x.risk === "REVIEW");

  const sections: { key: string; title: string; hint: string; list: React.ReactNode[]; tone: string }[] = [];

  if (filled.length) {
    sections.push({
      key: "filled",
      tone: "ok",
      title: `已填写 ${filled.length} 项`,
      hint: "请逐项核对；扩展永远不会点击提交。",
      list: filled.map((x) => (
        <Row
          key={x.raw.reference}
          c={x}
          note={x.fillDetail ?? undefined}
          action={
            <button type="button" className="link-btn" onClick={() => props.onLocate(x.raw.reference)}>
              定位
            </button>
          }
        />
      )),
    });
  }
  if (reviewAfterFill.length) {
    sections.push({
      key: "review",
      tone: "review",
      title: `其中 ${reviewAfterFill.length} 项请重点核对`,
      hint: "识别把握不到「高」这一档，或内容属于主观表达——写进去了，但值得再看一眼。",
      list: reviewAfterFill.map((x) => (
        <Row
          key={x.raw.reference}
          c={x}
          note={
            confidenceLevel(x.match.confidence) !== "HIGH"
              ? `把握：${{ HIGH: "高", MEDIUM: "中", LOW: "低" }[confidenceLevel(x.match.confidence)]}`
              : x.riskReason
          }
        />
      )),
    });
  }
  if (blocked.length) {
    sections.push({
      key: "blocked",
      tone: "manual",
      title: `被红线拦下，需你本人处理 ${blocked.length} 项`,
      hint: "承诺、声明、签名、是否调剂、授权这类不是「资料」而是「保证」；扩展不代你做保证。",
      list: blocked.map((x) => <Row key={x.raw.reference} c={x} note={x.riskReason} />),
    });
  }
  if (failed.length) {
    sections.push({
      key: "failed",
      tone: "manual",
      title: `没填进去 ${failed.length} 项`,
      hint: "页面控件没收下这个值。原因逐条列出，可改后重写或人工补。",
      list: failed.map((x) => <Row key={x.raw.reference} c={x} note={x.fillDetail ?? "写入未成功"} />),
    });
  }
  if (noContent.length) {
    sections.push({
      key: "empty",
      tone: "muted",
      title: `资料库里没有内容 ${noContent.length} 项`,
      hint: "识别到了这一栏，但你的资料里没有对应内容；去「资料」页补上，下次识别就能填。",
      list: noContent.map((x) => <Row key={x.raw.reference} c={x} />),
    });
  }
  if (unmatched.length) {
    sections.push({
      key: "unknown",
      tone: "muted",
      title: `没认出是什么字段 ${unmatched.length} 项`,
      hint: "宁可不填也不猜：这些留给你在网页上手填。",
      list: unmatched.map((x) => <Row key={x.raw.reference} c={x} note={x.riskReason} />),
    });
  }
  if (excluded.length) {
    sections.push({
      key: "excluded",
      tone: "muted",
      title: `不属于申请表、已排除 ${excluded.length} 项`,
      hint: "登录框、搜索框、导航区里的输入框长得像申请字段，但不是。",
      list: excluded.map((x) => <Row key={x.raw.reference} c={x} note={x.riskReason} />),
    });
  }
  if (ignored.length) {
    sections.push({
      key: "ignored",
      tone: "muted",
      title: `你忽略 ${ignored.length} 项`,
      hint: "点错了可以撤销，不必重新识别整页。",
      list: ignored.map((x) => (
        <Row
          key={x.raw.reference}
          c={x}
          action={
            props.onUnignore && (
              <button type="button" className="link-btn" onClick={() => props.onUnignore?.(x.raw.reference)}>
                撤销忽略
              </button>
            )
          }
        />
      )),
    });
  }

  if (sections.length === 0) {
    return (
      <section className="receipt" data-empty="1">
        <p className="hint">这次没有任何字段进入填写计划，网页内容未被修改。</p>
      </section>
    );
  }

  const total = filled.length + failed.length + blocked.length + noContent.length + unmatched.length;
  return (
    <section className="receipt" data-filled={filled.length} data-blocked={blocked.length}>
      <button type="button" className="receipt-head" onClick={() => setOpen((v) => !v)}>
        <span className={`fold-caret ${open ? "open" : ""}`}>▸</span>
        {/* 「填写完成 ——」这个开头是既有契约（e2e/delivery-flow、safety-flow、compat 矩阵都按它等结果），
            回执改造只往后面加信息，不改前缀。 */}
        <span className="receipt-title">填写完成 —— 已填 {filled.length}</span>
        <span className="receipt-sum">
          拦下 {blocked.length} · 未填成 {failed.length} · 共 {total}
        </span>
      </button>
      {open && (
        <div className="receipt-body">
          {sections.map((s) => (
            <div key={s.key} className={`receipt-sec tone-${s.tone}`}>
              <h4 className="receipt-sec-title">{s.title}</h4>
              <p className="receipt-hint">{s.hint}</p>
              <ul className="receipt-list">{s.list}</ul>
            </div>
          ))}
          <p className="receipt-foot">
            最终提交请你在网页上<strong>自己点击</strong>。这个扩展永远不会点击提交。
          </p>
        </div>
      )}
    </section>
  );
}
