// Stage 6.6: BottomNav icons
import fs from "node:fs";
let s = fs.readFileSync("src/sidepanel/App.tsx", "utf8");
const start = s.indexOf("function BottomNav");
const end = s.indexOf("export default function App");
if (start < 0 || end < 0) { console.error("bounds not found"); process.exit(1); }
const icons = { scan: "M4 7h16M4 12h16M4 17h10", jobs: "M12 3l8 5-8 5-8-5 8-5zM4 13l8 5 8-5", packs: "M5 5h14v14H5zM5 9h14M9 9v10", settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2" };
const next = [  "function BottomNav(p: { active: Tab; onNavigate: (t: Tab) => void }) {",  "  const icons: Record<Tab, string> = {",  "    scan: "" + icons.scan + "",",  "    jobs: "" + icons.jobs + "",",  "    packs: "" + icons.packs + "",",  "    settings: "" + icons.settings + "",",  "  };",  "  const items: { key: Tab; label: string }[] = [",  "    { key: "scan", label: "填写" },",  "    { key: "jobs", label: "岗位" },",  "    { key: "packs", label: "资料库" },",  "    { key: "settings", label: "设置" },",  "  ];",  "  return (",  "    <nav className="bottom-nav">",  "      {items.map((it) => (",  "        <button key={it.key} className={p.active === it.key ? "bn-item active" : "bn-item"} onClick={() => p.onNavigate(it.key)}>",  "          <svg viewBox="0 0 24 24" className="bn-icon" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons[it.key]} /></svg>",  "          <span>{it.label}</span>",  "        </button>",  "      ))}",  "    </nav>",  "  );",  "}",
  "",
].join("
");
s = s.slice(0, start) + next + s.slice(end);
fs.writeFileSync("src/sidepanel/App.tsx", s);
console.log("nav icons OK");