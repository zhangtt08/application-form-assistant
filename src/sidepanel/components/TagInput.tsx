import { useState } from "react";

/** Stage 6.6：Tag 输入组件（Enter 添加 / Backspace 删除 / 点击 × 移除） */
export function TagInput(p: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (v && !p.value.includes(v)) p.onChange([...p.value, v]);
    setDraft("");
  };

  return (
    <div className="tag-input">
      {p.value.map((tag) => (
        <span key={tag} className="tag-pill">
          {tag}
          <button className="tag-remove" onClick={() => p.onChange(p.value.filter((t) => t !== tag))} aria-label={`删除 ${tag}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-entry"
        value={draft}
        placeholder={p.value.length === 0 ? p.placeholder ?? "输入后回车添加" : "回车添加"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && p.value.length > 0) {
            p.onChange(p.value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
