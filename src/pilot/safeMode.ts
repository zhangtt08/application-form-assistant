import type { DryRunEntry, DryRunReport } from "./types";
import type { CandidateField } from "../types/field";

/**
 * Stage 6：Safe Validation Mode + Dry Run（spec 二十九~三十章）。
 * Safe Mode：HIGH/Unknown/Unsupported 强制 Manual——Pilot 默认开启。
 * Dry Run：只展示「从哪里取、准备填到哪里、长度多少、风险多高」——
 * 绝不展示任何正文内容（即使截断），防止截图/Debug 泄露 PII。
 */

/** sourceType → 来源标签（无正文） */
function sourceLabel(candidate: CandidateField): string {
  const v = candidate.value;
  if (!v) return "无内容";
  switch (v.sourceType) {
    case "fact":
      return "基础资料";
    case "variant":
      return `岗位方向版本（${v.variant === "short" ? "短" : v.variant === "long" ? "长" : "中"}）`;
    case "ai_grounded":
      return "AI Grounded Answer";
    case "default":
      return "默认表达";
    case "manual":
      return "手动修改";
    default:
      return String(v.sourceType);
  }
}

/** Safe Validation Mode（spec 二十九章）：HIGH/Unknown 强制 Manual，Pilot 默认开启 */
export function applySafeMode(candidates: CandidateField[]): CandidateField[] {
  return candidates.map((c) => {
    if (c.risk === "MANUAL_ONLY" && c.status !== "unknown") {
      return { ...c, status: "manual" as const, value: undefined, editedValue: undefined };
    }
    return c;
  });
}

/** Dry Run：从 candidates 生成写入计划报告（不写 DOM，不展示值正文） */
export function buildDryRunReport(
  candidates: CandidateField[],
  meta: { platformFamily: string; hostname: string },
): DryRunReport {
  const entries: DryRunEntry[] = candidates.map((c) => {
    const display = c.editedValue ?? c.value?.value ?? "";
    const wouldWrite = (c.status === "need-confirm" || c.status === "ready") && Boolean(display);
    const manualReason =
      c.risk === "MANUAL_ONLY"
        ? "高风险字段（MANUAL ONLY）"
        : c.status === "unknown"
          ? "字段类型未识别"
          : c.status === "empty"
            ? "Profile 无对应内容"
            : undefined;
    // 隐私：只记录长度，正文零展示；高风险字段一律「隐藏内容」
    const length = display.length;
    const summary = c.risk === "MANUAL_ONLY" || manualReason ? "隐藏内容" : `${length} chars`;
    return {
      fieldLabel: c.raw.context.labelText || c.raw.context.name || "(未命名字段)",
      canonicalFieldId: c.match.fieldId,
      sourceType: sourceLabel(c),
      valuePreview: display ? summary : "(空)",
      risk: c.risk,
      wouldWrite,
      manualReason,
    };
  });
  return {
    platformFamily: meta.platformFamily,
    hostname: meta.hostname,
    generatedAt: new Date().toISOString(),
    entries,
    highRiskManual: entries.filter((e) => e.risk === "MANUAL_ONLY" || e.manualReason).length,
    wouldWriteCount: entries.filter((e) => e.wouldWrite).length,
  };
}

/** Dry Run 渲染文本（Preview 区显示）：`字段 → canonical | 来源｜N chars｜风险` */
export function renderDryRun(report: DryRunReport): string {
  const lines = [
    `[Dry Run] ${report.platformFamily} · ${report.hostname}`,
    `将写入 ${report.wouldWriteCount} 个字段，人工处理 ${report.highRiskManual} 个：`,
    ...report.entries.map(
      (e) =>
        `${e.wouldWrite ? "✓" : "·"} ${e.fieldLabel} → ${e.canonicalFieldId} ｜${e.sourceType}｜${e.valuePreview}${e.risk === "MANUAL_ONLY" ? "｜MANUAL ONLY" : ""}${e.manualReason ? `｜${e.manualReason}` : ""}`,
    ),
  ];
  return lines.join("\n");
}
