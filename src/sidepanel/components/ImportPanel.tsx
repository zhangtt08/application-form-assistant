import { useMemo, useState } from "react";
import type { Profile } from "../../types/profile";
import type { ProfileLibrary } from "../../profile/libraryStore";
import type { ProfileType } from "../../job/profileTypes";
import { importProfileJson, importResumeText, profileHasContent, type ImportTarget } from "../../profile/profileStore";
import { parseResumeText } from "../../profile/resumeTextParser";
import { DirectionChips } from "./LibraryPicker";

/**
 * 资料导入面板。
 *
 * 交互设计（解决「导入按钮看不懂」）：
 * - 两种方式用分段控件切换，不再堆在一个折叠块里；
 * - 纯文本走「粘贴 → 解析预览 → 确认导入」三步，解析结果先给用户看，
 *   而不是粘完直接覆盖；
 * - 预览页可选落点：**覆盖当前资料库** / **只填空白项** / **新建一个资料库**；
 * - 解析失败时明确说失败原因，并保证现有资料未被改动。
 */

const SAMPLE = `张小明
手机：138xxxxxxxx　邮箱：your@email.com
所在城市：杭州

教育背景
2021.09-2025.06  某某大学  计算机学院  计算机科学与技术  本科
主修课程：数据结构、机器学习

实习经历
2024.06-2024.09  某某科技有限公司  产品部  产品实习生
· 负责需求调研与竞品分析
· 输出 PRD 文档，推动功能上线

项目经历
2023.10-2024.01  智能问答助手
角色：项目负责人
· 基于 RAG 搭建检索链路

校园经历
2022.09-2023.06  学生会  组织部  干事
· 组织校园活动

技能与证书
技术技能：Python、SQL
工具：Figma、Axure
语言能力：英语 CET-6

自我评价
简单写两三句就好。`;

export interface ImportPanelProps {
  /** 当前已保存的资料：用于「只填空白项」与覆盖前提示 */
  current: Profile;
  libraries: ProfileLibrary[];
  activeLibraryId: string;
  onImported: (profile: Profile) => void;
}

type Mode = "text" | "json";
type TargetKind = "active" | "new";

interface Preview {
  profile: Profile;
  notes: string[];
}

function line(parts: (string | undefined)[]): string {
  return parts.filter((x) => x && x.trim()).join(" · ");
}

/** 落点选择器（纯文本预览与 JSON 导入共用） */
function TargetPicker(p: {
  libraries: ProfileLibrary[];
  activeLibraryId: string;
  targetKind: TargetKind;
  onKind: (k: TargetKind) => void;
  newName: string;
  onName: (v: string) => void;
  newDirections: ProfileType[];
  onDirections: (v: ProfileType[]) => void;
  namePrefix: string;
}) {
  const activeLibrary = p.libraries.find((l) => l.id === p.activeLibraryId);
  return (
    <>
      <div className="choice-group">
        <div className="choice-title">导入到哪个资料库</div>
        <label className={p.targetKind === "active" ? "choice active" : "choice"}>
          <input
            type="radio"
            name={p.namePrefix}
            checked={p.targetKind === "active"}
            onChange={() => p.onKind("active")}
          />
          <span>
            <strong>当前资料库：{activeLibrary?.name ?? "默认资料库"}</strong>
            <em>只影响这个库，其他库不动</em>
          </span>
        </label>
        <label className={p.targetKind === "new" ? "choice active" : "choice"}>
          <input
            type="radio"
            name={p.namePrefix}
            checked={p.targetKind === "new"}
            onChange={() => p.onKind("new")}
          />
          <span>
            <strong>新建一个资料库</strong>
            <em>这份简历单独成一个库，之后按岗位方向自动选用</em>
          </span>
        </label>
      </div>
      {p.targetKind === "new" && (
        <div className="libbar-form">
          <label className="pe-row">
            <span className="pe-k">名称</span>
            <input
              value={p.newName}
              placeholder="例如：AI 产品（校招）"
              onChange={(e) => p.onName(e.target.value)}
            />
          </label>
          <div className="libbar-form-label">适用方向（可多选；不选=通用兜底）</div>
          <DirectionChips value={p.newDirections} onChange={p.onDirections} />
        </div>
      )}
    </>
  );
}

export function ImportPanel({ current, libraries, activeLibraryId, onImported }: ImportPanelProps) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mergeMode, setMergeMode] = useState<"replace" | "merge">("replace");
  const [targetKind, setTargetKind] = useState<TargetKind>("active");
  const [newName, setNewName] = useState("");
  const [newDirections, setNewDirections] = useState<ProfileType[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  /** 部分导入的提示：数据写进去了一部分，但有些块没吃进去 —— 必须显式说出来，不能只报成功 */
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState(false);

  const hasExisting = useMemo(() => profileHasContent(current), [current]);

  const reset = () => {
    setPreview(null);
    setError("");
    setDone("");
    setWarn("");
  };

  const resetTarget = () => {
    setTargetKind("active");
    setNewName("");
    setNewDirections([]);
  };

  const buildTarget = (): ImportTarget | undefined =>
    targetKind === "new" ? { kind: "new", name: newName.trim(), directions: newDirections } : { kind: "active" };

  const handleParse = () => {
    reset();
    const result = parseResumeText(text);
    if (!result.ok) {
      setError(result.errors.join("\n"));
      return;
    }
    setPreview({ profile: result.profile, notes: result.notes });
  };

  const handleConfirmText = async () => {
    if (!preview) return;
    if (targetKind === "new" && !newName.trim()) {
      setError("请先给新资料库起个名字");
      return;
    }
    setBusy(true);
    setError("");
    const usedMerge = hasExisting && targetKind === "active" && mergeMode === "merge";
    const result = await importResumeText(text, {
      mode: usedMerge ? "merge" : "replace",
      current,
      target: buildTarget(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.errors.join("\n"));
      return;
    }
    setPreview(null);
    setText("");
    resetTarget();
    setDone(
      `已导入「${result.libraryName}」：${result.notes.join("、") || "资料已更新"}${usedMerge ? "（仅补充了空白项）" : ""}`,
    );
    onImported(result.profile);
  };

  const handleImportJson = async () => {
    reset();
    if (targetKind === "new" && !newName.trim()) {
      setError("请先给新资料库起个名字");
      return;
    }
    setBusy(true);
    const result = await importProfileJson(jsonText, { target: buildTarget() });
    setBusy(false);
    if (!result.ok) {
      setError(result.errors.join("\n"));
      return;
    }
    setJsonText("");
    const name = result.libraryName;
    resetTarget();
    setDone(`JSON 导入成功，已写入「${name}」。`);
    setWarn((result.warnings ?? []).join("\n"));
    onImported(result.profile);
  };

  const s = preview ? preview.profile : null;

  return (
    <section className="import-panel">
      <div className="segmented">
        <button
          type="button"
          className={mode === "text" ? "seg-item active" : "seg-item"}
          onClick={() => {
            setMode("text");
            reset();
          }}
        >
          粘贴简历文本
        </button>
        <button
          type="button"
          className={mode === "json" ? "seg-item active" : "seg-item"}
          onClick={() => {
            setMode("json");
            reset();
          }}
        >
          导入 JSON
        </button>
      </div>

      {error && (
        <div className="banner banner-error">
          {error.split("\n").map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {done && <div className="banner banner-ok">{done}</div>}
      {warn && (
        <div className="banner banner-warn" data-import-warn>
          {warn.split("\n").map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}

      {mode === "text" && !preview && (
        <>
          <p className="hint">
            把简历文字直接粘进来即可。<strong>完全离线解析</strong>，不联网、不上传；
            保留「教育背景 / 实习经历 / 项目经历 / 技能与证书」这类小标题，识别最准。
          </p>
          <textarea
            className="import-textarea"
            rows={10}
            value={text}
            placeholder="在此粘贴简历纯文本…"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="import-actions">
            <button type="button" className="btn-sm" onClick={() => setText(SAMPLE)}>
              填入示例格式
            </button>
            <button type="button" className="btn-sm" onClick={() => setText("")} disabled={!text}>
              清空
            </button>
            <span className="spacer" />
            <button type="button" className="primary" onClick={handleParse} disabled={!text.trim()}>
              解析预览
            </button>
          </div>
        </>
      )}

      {mode === "text" && preview && s && (
        <>
          <div className="preview-head">
            识别到 <strong>{preview.notes.length}</strong> 类信息
          </div>
          <ul className="preview-list">
            {preview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>

          <div className="preview-detail">
            {s.education.filter((e) => e.school).length > 0 && (
              <div className="preview-row">
                <span className="preview-k">教育</span>
                <span className="preview-v">
                  {s.education
                    .filter((e) => e.school)
                    .map((e) => line([e.school, e.major, e.degree]))
                    .join("；")}
                </span>
              </div>
            )}
            {s.internships.filter((e) => e.company || e.position).length > 0 && (
              <div className="preview-row">
                <span className="preview-k">实习/工作</span>
                <span className="preview-v">
                  {s.internships
                    .filter((e) => e.company || e.position)
                    .map((e) => line([e.company, e.position]))
                    .join("；")}
                </span>
              </div>
            )}
            {s.projects.filter((e) => e.name).length > 0 && (
              <div className="preview-row">
                <span className="preview-k">项目</span>
                <span className="preview-v">{s.projects.filter((e) => e.name).map((e) => e.name).join("；")}</span>
              </div>
            )}
            {s.campus.filter((e) => e.organization).length > 0 && (
              <div className="preview-row">
                <span className="preview-k">校园</span>
                <span className="preview-v">
                  {s.campus
                    .filter((e) => e.organization)
                    .map((e) => line([e.organization, e.position]))
                    .join("；")}
                </span>
              </div>
            )}
          </div>

          <TargetPicker
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            targetKind={targetKind}
            onKind={setTargetKind}
            newName={newName}
            onName={setNewName}
            newDirections={newDirections}
            onDirections={setNewDirections}
            namePrefix="import-target-text"
          />

          {hasExisting && targetKind === "active" && (
            <div className="choice-group">
              <div className="choice-title">怎么处理这个库里的现有内容</div>
              <label className={mergeMode === "replace" ? "choice active" : "choice"}>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mergeMode === "replace"}
                  onChange={() => setMergeMode("replace")}
                />
                <span>
                  <strong>替换全部内容</strong>
                  <em>用这次解析结果覆盖这个库</em>
                </span>
              </label>
              <label className={mergeMode === "merge" ? "choice active" : "choice"}>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mergeMode === "merge"}
                  onChange={() => setMergeMode("merge")}
                />
                <span>
                  <strong>只填空白项</strong>
                  <em>这个库里已填过的内容原样保留</em>
                </span>
              </label>
            </div>
          )}

          <p className="hint">
            姓名 / 手机 / 邮箱 / 教育背景属于<strong>公共信息</strong>，所有资料库共用 —— 这次导入会同步更新它们。
          </p>

          <div className="import-actions">
            <button type="button" className="btn-sm" onClick={reset}>
              ← 返回修改
            </button>
            <span className="spacer" />
            <button type="button" className="primary" onClick={() => void handleConfirmText()} disabled={busy}>
              {busy ? "导入中…" : "确认导入"}
            </button>
          </div>
        </>
      )}

      {mode === "json" && (
        <>
          <p className="hint">
            粘贴此前「导出 JSON」得到的内容，或符合格式的简历母版 JSON。校验失败时不会覆盖现有资料。
          </p>
          <textarea
            className="import-textarea"
            rows={8}
            value={jsonText}
            placeholder='{"kind": "application-form-assistant/profile", ...}'
            onChange={(e) => setJsonText(e.target.value)}
          />
          <TargetPicker
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            targetKind={targetKind}
            onKind={setTargetKind}
            newName={newName}
            onName={setNewName}
            newDirections={newDirections}
            onDirections={setNewDirections}
            namePrefix="import-target-json"
          />
          <div className="import-actions">
            <span className="spacer" />
            <button
              type="button"
              className="primary"
              onClick={() => void handleImportJson()}
              disabled={!jsonText.trim() || busy}
            >
              {busy ? "导入中…" : "校验并导入"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
