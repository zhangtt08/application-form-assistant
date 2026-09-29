// Stage 6.6 CSS 追加（避免 bash heredoc 转义问题）
import fs from "node:fs";

const css = `
/* ================================================================
   Stage 6.6 — UI Redesign：清爽浅色 · 轻卡片 · 层级留白
   ================================================================ */

:root {
  --bg: #f5f7fb;
  --card: #ffffff;
  --border: #e8edf3;
  --text: #1e293b;
  --text-2: #64748b;
  --primary: #3b82f6;
  --primary-soft: #eff6ff;
  --radius-card: 14px;
  --radius-btn: 10px;
}

body, .app {
  background: var(--bg);
  color: var(--text);
}

.header {
  background: transparent;
  border-bottom: 1px solid var(--border);
  padding: 14px 16px 12px;
}
.header-title { font-size: 16px; font-weight: 700; color: var(--text); }
.header-sub { font-size: 12px; color: var(--text-2); margin-top: 2px; }

.home-card, .pack-card, .editor-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.home-card:hover, .pack-card:hover { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.07); }

.home-cards { padding: 12px 14px 0; gap: 10px; }
.home-card { padding: 12px 14px; }
.home-k { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.home-v { display: block; font-size: 15px; }
.home-meta { margin-top: 4px; }
.home-card .btn-sm { margin-top: 8px; }

.cta-row { padding: 14px; }
.cta-row .primary {
  width: 100%; padding: 12px 0; font-size: 15px; font-weight: 600;
  background: var(--primary); border-radius: 12px;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.28);
}
.cta-row .primary:disabled { opacity: 0.6; box-shadow: none; }
.cta-hint { text-align: center; margin-top: 8px; }

.pill {
  display: inline-block; font-size: 11px; line-height: 1;
  padding: 4px 8px; border-radius: 999px; margin-right: 6px;
}
.pill-blue { background: var(--primary-soft); color: var(--primary); }
.pill-gray { background: #f1f5f9; color: var(--text-2); }

.bottom-nav {
  display: flex; border-top: 1px solid var(--border);
  background: var(--card);
}
.bn-item {
  flex: 1; padding: 8px 0 9px; background: none; border: none;
  color: var(--text-2); font-size: 11px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.bn-item.active { color: var(--primary); font-weight: 600; }
.bn-icon { width: 20px; height: 20px; }

.page-head { padding: 4px 2px 2px; }
.page-head h2 { font-size: 17px; margin: 0 0 4px; }
.pack-library { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 20px; }
.pack-card { padding: 14px; cursor: pointer; }
.pack-card.pack-active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary) inset, 0 1px 2px rgba(15, 23, 42, 0.04); }
.pack-card-head { display: flex; justify-content: space-between; align-items: center; }
.pack-name { font-weight: 650; font-size: 15px; }
.pack-desc { margin: 4px 0 6px; }
.pack-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pack-actions { display: flex; gap: 8px; margin-top: 10px; align-items: center; flex-wrap: wrap; }
.confirm-row { display: inline-flex; gap: 6px; }

.btn-sm {
  border-radius: var(--radius-btn); padding: 5px 12px; font-size: 12px;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
}
.btn-sm:hover { border-color: #cbd5e1; background: #f8fafc; }
.btn-sm.danger { color: #dc2626; border-color: #fecaca; }
.btn-outline {
  width: 100%; padding: 10px 0; border-radius: var(--radius-btn);
  border: 1px dashed #cbd5e1; background: transparent; color: var(--text-2);
  font-size: 13px; cursor: pointer;
}
.btn-outline:hover { border-color: var(--primary); color: var(--primary); }

.pack-editor { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 80px; }
.editor-head h2 { font-size: 17px; margin: 8px 0 4px; }
.editor-card { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.editor-card h4 { margin: 0; font-size: 14px; color: var(--text); }
.field-row { display: flex; flex-direction: column; gap: 6px; }
.field-row > span { font-size: 12px; color: var(--text-2); }
.editor-card input, .editor-card textarea, .editor-card select {
  width: 100%; border: 1px solid var(--border); border-radius: 10px;
  padding: 9px 10px; font-size: 13px; background: #fbfcfe; color: var(--text);
}
.editor-card input:focus, .editor-card textarea:focus, .editor-card select:focus {
  outline: none; border-color: var(--primary); background: #fff;
}
.check-row { flex-direction: row; align-items: center; gap: 8px; }
.check-row > span { font-size: 13px; color: var(--text); }

.tag-input {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  border: 1px solid var(--border); border-radius: 10px; padding: 6px 8px;
  background: #fbfcfe; min-height: 38px;
}
.tag-pill {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--primary-soft); color: var(--primary);
  font-size: 12px; padding: 3px 8px; border-radius: 999px;
}
.tag-remove { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0 2px; font-size: 13px; }
.tag-entry { flex: 1; min-width: 120px; border: none !important; background: transparent !important; padding: 4px 2px !important; }
.tag-entry:focus { outline: none; }

.exp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.exp-item {
  display: flex; justify-content: space-between; align-items: center;
  border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
}
.exp-item.checked { border-color: var(--primary); background: var(--primary-soft); }
.exp-item label { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; }
.exp-label { font-size: 13px; }
.exp-sort { display: flex; gap: 4px; }
.exp-sort .btn-sm { padding: 2px 8px; }

.editor-footer {
  position: sticky; bottom: 0; padding: 12px 0 4px;
  background: linear-gradient(to top, var(--bg) 70%, transparent);
}
.editor-footer .primary {
  width: 100%; padding: 11px 0; font-weight: 600;
  background: var(--primary); border-radius: 12px;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.28);
}
.editor-footer .primary:disabled { opacity: 0.5; }
.saved-flash { animation: fadein 0.2s ease; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

.advanced-toggle { background: none; border: none; color: var(--text-2); font-size: 13px; cursor: pointer; text-align: left; padding: 0; }

.empty-block { text-align: center; padding: 16px; border: 1px dashed #cbd5e1; border-radius: 10px; }
.empty-block p { margin: 4px 0; }

.stats { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-card); margin: 0 14px 10px; padding: 12px 14px; }
.stats-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.stats-badges .badge { border-radius: 999px; padding: 4px 10px; font-size: 12px; }

.batch-actions { display: flex; gap: 8px; padding: 0 14px 10px; flex-wrap: wrap; }
.batch-actions .btn-sm { border-radius: var(--radius-btn); }

.empty-hint { padding: 16px 0; }

.footer {
  position: sticky; bottom: 0; background: var(--card);
  border-top: 1px solid var(--border); box-shadow: 0 -2px 8px rgba(15, 23, 42, 0.05);
  padding: 10px 14px; display: flex; gap: 10px; justify-content: flex-end;
}
.footer .primary { background: var(--primary); border-radius: var(--radius-btn); padding: 9px 18px; font-weight: 600; }

.banner { border-radius: 12px; margin: 8px 14px; }
`;

fs.appendFileSync("src/sidepanel/sidepanel.css", css);
console.log("CSS appended");
