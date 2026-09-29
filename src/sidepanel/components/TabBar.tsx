export type MainTab = "apply" | "jobs" | "profile" | "settings";

const TABS: { key: MainTab; label: string; hint: string }[] = [
  { key: "apply", label: "投递", hint: "识别并填写当前网申页面" },
  { key: "jobs", label: "岗位", hint: "已捕获的岗位与投递记录" },
  { key: "profile", label: "资料", hint: "导入与维护你的背景资料" },
  { key: "settings", label: "设置", hint: "模型与高级选项" },
];

/** 底部一级导航：整个侧边栏只有这四个入口 */
export function TabBar({
  tab,
  onChange,
  badge,
}: {
  tab: MainTab;
  onChange: (t: MainTab) => void;
  /** 投递页的待处理数量（有值时在「投递」上显示小圆点） */
  badge?: number;
}) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          title={t.hint}
          className={`tabbar-item ${tab === t.key ? "active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.key === "apply" && badge != null && badge > 0 && <span className="tabbar-dot">{badge}</span>}
        </button>
      ))}
    </nav>
  );
}
