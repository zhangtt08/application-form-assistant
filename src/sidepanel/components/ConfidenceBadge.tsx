import { confidenceLevel } from "../../matching/matcher";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidenceLevel(confidence);
  const cls = level === "HIGH" ? "badge badge-conf-high" : level === "MEDIUM" ? "badge badge-conf-medium" : "badge badge-conf-low";
  return (
    <span className={cls} title={`置信度 ${Math.round(confidence * 100)}%`}>
      {Math.round(confidence * 100)}%
    </span>
  );
}
