import { useState } from "react";
import { PROFILE_CONFIG, PROFILE_TYPES, type ProfileType } from "../../job/profileTypes";
import type { ProfileLibrary } from "../../profile/libraryStore";

/**
 * 资料库切换器。
 *
 * 两个形态：
 * - 完整（资料页）：切库 + 新建 / 编辑（名称 + 适用方向）/ 复制 / 删除；
 * - 紧凑（投递页岗位条展开区）：只切库，管理动作引导去「资料」页。
 *
 * 「适用方向」可多选、也可一个都不选 —— 不选表示**通用兜底库**，
 * 识别出的方向没有任何专用库时才用它。
 */

export interface LibraryPickerProps {
  libraries: ProfileLibrary[];
  activeId: string;
  /** 切换前的拦截（有未保存修改时问一句）；返回 false 取消切换 */
  onBeforeSwitch?: (id: string) => boolean;
  onSwitch: (id: string) => void;
  onCreate?: (input: { name: string; directions: ProfileType[]; copyCurrent: boolean }) => void;
  onUpdate?: (id: string, patch: { name?: string; directions?: ProfileType[] }) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

function directionLabel(library: ProfileLibrary): string {
  if (library.directions.length === 0) return "通用（任何方向都能用）";
  return library.directions.map((t) => PROFILE_CONFIG[t].label).join(" · ");
}

/** 方向多选 chips（导入面板也复用） */
export function DirectionChips({
  value,
  onChange,
}: {
  value: ProfileType[];
  onChange: (next: ProfileType[]) => void;
}) {
  const toggle = (t: ProfileType) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="chip-row">
      {PROFILE_TYPES.filter((t) => t !== "general").map((t) => (
        <button
          key={t}
          type="button"
          title={PROFILE_CONFIG[t].description}
          className={`chip chip-select ${value.includes(t) ? "active" : ""}`}
          onClick={() => toggle(t)}
        >
          {PROFILE_CONFIG[t].label}
        </button>
      ))}
      <button
        type="button"
        className={`chip chip-select ${value.length === 0 ? "active" : ""}`}
        onClick={() => onChange([])}
      >
        通用兜底（不限方向）
      </button>
    </div>
  );
}

export function LibraryPicker(props: LibraryPickerProps) {
  const { libraries, activeId, compact } = props;
  const [form, setForm] = useState<null | { mode: "create" | "edit"; id?: string; name: string; directions: ProfileType[]; copyCurrent: boolean }>(
    null,
  );

  const active = libraries.find((l) => l.id === activeId);

  const switchTo = (id: string) => {
    if (id === activeId) return;
    if (props.onBeforeSwitch && !props.onBeforeSwitch(id)) return;
    props.onSwitch(id);
  };

  const submit = () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return;
    if (form.mode === "create") {
      props.onCreate?.({ name, directions: form.directions, copyCurrent: form.copyCurrent });
    } else if (form.id) {
      props.onUpdate?.(form.id, { name, directions: form.directions });
    }
    setForm(null);
  };

  return (
    <section className={compact ? "libbar compact" : "libbar"}>
      {!compact && (
        <div className="libbar-head">
          <span className="libbar-title">资料库</span>
          <span className="muted small">共 {libraries.length} 个 · 识别后会按岗位方向自动选</span>
        </div>
      )}

      <div className="chip-row">
        {libraries.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`chip chip-select ${l.id === activeId ? "active" : ""}`}
            title={directionLabel(l)}
            onClick={() => switchTo(l.id)}
          >
            {l.name}
          </button>
        ))}
        {props.onCreate && !compact && (
          <button
            type="button"
            className="chip chip-add"
            onClick={() => setForm({ mode: "create", name: "", directions: [], copyCurrent: true })}
          >
            + 新建
          </button>
        )}
      </div>

      {active && (
        <p className="libbar-meta">
          覆盖方向：{directionLabel(active)}
          {active.note ? ` · ${active.note}` : ""}
        </p>
      )}

      {!compact && active && (
        <div className="libbar-actions">
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              setForm({ mode: "edit", id: active.id, name: active.name, directions: [...active.directions], copyCurrent: false })
            }
          >
            编辑名称与方向
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              props.onCreate?.({
                name: `${active.name} 副本`,
                directions: [...active.directions],
                copyCurrent: true,
              })
            }
          >
            复制这个库
          </button>
          <button
            type="button"
            className="btn-sm danger"
            disabled={libraries.length <= 1}
            title={libraries.length <= 1 ? "至少要保留一个资料库" : undefined}
            onClick={() => {
              if (window.confirm(`删除资料库「${active.name}」？其中的经历与技能会一起删除，不可恢复。`)) {
                props.onDelete?.(active.id);
              }
            }}
          >
            删除
          </button>
          {/* disabled + 原生 title 太隐蔽：用户只会以为「删除坏了」。单库时把原因写在明面上。 */}
          {libraries.length <= 1 && (
            <p className="muted small" data-delete-hint>
              只剩这一个资料库，不能删除；要清理内容请用「重置为空」，或先「新建」一个库。
            </p>
          )}
        </div>
      )}

      {form && (
        <div className="libbar-form">
          <div className="libbar-form-title">
            {form.mode === "create" ? "新建资料库" : "编辑资料库"}
          </div>
          <label className="pe-row">
            <span className="pe-k">名称</span>
            <input
              value={form.name}
              placeholder="例如：AI 产品（校招）"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div className="libbar-form-label">适用方向（可多选；不选=通用兜底）</div>
          <DirectionChips value={form.directions} onChange={(next) => setForm({ ...form, directions: next })} />
          {form.mode === "create" && (
            <label className="switch">
              <input
                type="checkbox"
                checked={form.copyCurrent}
                onChange={(e) => setForm({ ...form, copyCurrent: e.target.checked })}
              />
              <span>复制当前资料库的内容作为起点</span>
            </label>
          )}
          <p className="muted small">
            公共信息（姓名 / 联系方式 / 教育背景）所有资料库共用，不随库变化。
          </p>
          <div className="libbar-form-actions">
            <button type="button" className="btn-sm" onClick={() => setForm(null)}>
              取消
            </button>
            <button type="button" className="primary" onClick={submit} disabled={!form.name.trim()}>
              {form.mode === "create" ? "创建" : "保存"}
            </button>
          </div>
        </div>
      )}

      {compact && (
        <p className="muted small">
          识别时会按岗位方向自动切到对应资料库；库太多管不过来时，到「资料」页可以新建 / 复制 / 删除。
        </p>
      )}
    </section>
  );
}
