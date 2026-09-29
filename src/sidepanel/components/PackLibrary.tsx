import { useEffect, useState } from "react";
import { listPacks, createPack, updatePack, deletePack, setActivePack, copyPack } from "../../profile/pack/packStore";
import { profileTypeLabel } from "../../job/profileTypes";
import type { ProfilePack } from "../../profile/pack/types";
import type { ProfileType } from "../../job/profileTypes";
import { TagInput } from "./TagInput";

const VARIANT_OPTIONS: ProfileType[] = ["agent", "aiProduct", "aiOperation", "aiSolution", "aigcMarketing", "general"];

/**
 * Stage 6.6：资料库中心（列表卡片化）+ 分区卡片式编辑页 + TagInput 匹配规则 + 经历排序 + 固定字段扩容。
 */

export function PackLibrary(p: {
  activePackId: string;
  onUsePack: (packId: string) => void;
  onManageMasterProfile: () => void;
}) {
  const [packs, setPacks] = useState<ProfilePack[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = () => void listPacks().then(setPacks);
  useEffect(reload, []);

  const use = async (packId: string) => {
    await setActivePack(packId);
    p.onUsePack(packId);
    reload();
  };

  const remove = async (packId: string) => {
    const r = await deletePack(packId);
    setConfirmDeleteId(null);
    if (r.ok) p.onUsePack(r.fallbackTo ?? p.activePackId);
    reload();
  };

  if (editingId !== null) {
    return (
      <PackEditor
        packId={editingId === "new" ? null : editingId}
        onDone={() => {
          setEditingId(null);
          reload();
        }}
      />
    );
  }

  return (
    <main className="main pack-library">
      <div className="page-head">
        <h2>资料库</h2>
        <p className="muted small">选择或管理不同岗位方向使用的资料库</p>
      </div>

      {packs.map((pack) => (
        <div
          key={pack.id}
          className={`pack-card ${pack.id === p.activePackId ? "pack-active" : ""}`}
          onClick={() => setEditingId(pack.id)}
          role="button"
        >
          <div className="pack-card-head">
            <span className="pack-name">
              {pack.isDefault && <span className="pill pill-gray">默认</span>}
              {pack.name}
            </span>
            {pack.id === p.activePackId && <span className="pill pill-blue">使用中</span>}
          </div>
          <div className="muted small pack-desc">{pack.description || "暂无简介"}</div>
          <div className="pack-tags">
            <span className="pill pill-gray">{profileTypeLabel(pack.variantType)}</span>
            <span className="pill pill-gray">{pack.selectedExperienceIds.length > 0 ? `${pack.selectedExperienceIds.length} 段经历` : "全部经历"}</span>
          </div>
          <div className="pack-actions" onClick={(e) => e.stopPropagation()}>
            {pack.id === p.activePackId ? (
              <span className="muted small">当前使用</span>
            ) : (
              <button className="btn-sm" onClick={() => void use(pack.id)}>使用</button>
            )}
            <button className="btn-sm" onClick={() => setEditingId(pack.id)}>编辑</button>
            <button className="btn-sm" onClick={() => void copyPack(pack.id).then(reload)}>复制</button>
            {!pack.isDefault && (
              confirmDeleteId === pack.id ? (
                <span className="confirm-row">
                  <button className="btn-sm danger" onClick={() => void remove(pack.id)}>确认删除</button>
                  <button className="btn-sm" onClick={() => setConfirmDeleteId(null)}>取消</button>
                </span>
              ) : (
                <button className="btn-sm" onClick={() => setConfirmDeleteId(pack.id)}>删除</button>
              )
            )}
          </div>
        </div>
      ))}

      <button className="btn-outline" onClick={() => setEditingId("new")}>＋ 新建资料库</button>
      <button className="btn-outline" onClick={p.onManageMasterProfile}>管理基础资料</button>
      <p className="muted small">资料库 = 使用配置（经历选择/顺序/表达版本/固定字段）；基础事实始终来自 Master Profile。</p>
    </main>
  );
}

/** 分区卡片式编辑页（spec 第五章：5 个分组卡片 + 底部固定保存） */
export function PackEditor(p: { packId: string | null; onDone: () => void }) {
  const [packs, setPacks] = useState<ProfilePack[]>([]);
  const existing = p.packId ? packs.find((x) => x.id === p.packId) : null;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [variantType, setVariantType] = useState<ProfileType>(existing?.variantType ?? "general");
  const [jobTitles, setJobTitles] = useState<string[]>(existing?.matchRules.jobTitles ?? []);
  const [keywords, setKeywords] = useState<string[]>(existing?.matchRules.keywords ?? []);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(existing?.matchRules.excludeKeywords ?? []);
  const [selectedIds, setSelectedIds] = useState<string[]>(existing?.selectedExperienceIds ?? []);
  const [selfIntroduction, setSelfIntroduction] = useState(existing?.fieldContents.selfIntroduction ?? "");
  const [strengths, setStrengths] = useState(existing?.fieldContents.strengths ?? "");
  const [skills, setSkills] = useState(existing?.fieldContents.skills ?? "");
  const [portfolio, setPortfolio] = useState(existing?.fieldContents.portfolio ?? "");
  const [extraNote, setExtraNote] = useState(existing?.fieldContents.extraNote ?? "");
  const [commonSupplement, setCommonSupplement] = useState(existing?.fieldContents.commonSupplement ?? "");
  const [answerTone, setAnswerTone] = useState(existing?.preferences?.answerTone ?? "balanced");
  const [allowAIAssist, setAllowAIAssist] = useState(existing?.preferences?.allowAIAssist ?? true);
  const [notes, setNotes] = useState(existing?.preferences?.notes ?? "");
  const [masterExperience, setMasterExperience] = useState<{ id: string; label: string; meta: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    void listPacks().then(setPacks);
    void chrome.storage.local.get("afa.profile.v1").then((res) => {
      const profile = res["afa.profile.v1"] as
        | { internships?: { company?: string }[]; projects?: { name?: string; keywords?: string[] }[]; campus?: unknown[] }
        | undefined;
      const out: { id: string; label: string; meta: string }[] = [];
      (profile?.internships ?? []).forEach((e, i) => out.push({ id: `internships-${i}`, label: e.company || `实习 #${i + 1}`, meta: "实习" }));
      (profile?.projects ?? []).forEach((e, i) => out.push({ id: `projects-${i}`, label: e.name || `项目 #${i + 1}`, meta: ["项目", ...(e.keywords ?? []).slice(0, 2)].join(" · ") }));
      (profile?.campus ?? []).forEach((_, i) => out.push({ id: `campus-${i}`, label: `校园经历 #${i + 1}`, meta: "校园" }));
      setMasterExperience(out);
    });
  }, []);

  const touch = () => setDirty(true);

  const toggleExperience = (id: string) => {
    touch();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const move = (id: string, dir: -1 | 1) => {
    touch();
    setSelectedIds((prev) => {
      const idx = prev.indexOf(id);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  };

  const save = async () => {
    const payload = {
      name: name || "未命名资料库",
      description,
      variantType,
      matchRules: { jobTitles, keywords, excludeKeywords },
      selectedExperienceIds: selectedIds,
      experienceOrder: selectedIds,
      fieldContents: {
        ...(selfIntroduction ? { selfIntroduction } : {}),
        ...(strengths ? { strengths } : {}),
        ...(skills ? { skills } : {}),
        ...(portfolio ? { portfolio } : {}),
        ...(extraNote ? { extraNote } : {}),
        ...(commonSupplement ? { commonSupplement } : {}),
      },
      preferences: { answerTone, allowAIAssist, notes },
    };
    if (existing) await updatePack(existing.id, payload);
    else await createPack(payload);
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  };

  const goBack = () => {
    if (dirty && !window.confirm("有未保存的更改，确定离开？")) return;
    p.onDone();
  };

  return (
    <main className="main pack-editor">
      <div className="editor-head">
        <button className="btn-sm" onClick={goBack}>← 返回资料库</button>
        <h2>{existing ? "编辑资料库" : "新建资料库"}</h2>
        <p className="muted small">配置该资料库的匹配规则、经历顺序和固定内容</p>
        {savedFlash && <span className="pill pill-blue saved-flash">已保存</span>}
        {dirty && !savedFlash && <span className="pill pill-gray">有未保存更改</span>}
      </div>

      <section className="editor-card">
        <h4>基础信息</h4>
        <label className="field-row">
          <span>资料库名称</span>
          <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="如：AI 产品" />
        </label>
        <label className="field-row">
          <span>简介</span>
          <textarea rows={2} value={description} onChange={(e) => { setDescription(e.target.value); touch(); }} placeholder="一句话说明这个资料库的适用场景" />
        </label>
      </section>

      <section className="editor-card">
        <h4>岗位匹配规则</h4>
        <div className="field-row">
          <span>适用岗位标题</span>
          <TagInput value={jobTitles} onChange={(v) => { setJobTitles(v); touch(); }} placeholder="如：AI产品经理，回车添加" />
        </div>
        <div className="field-row">
          <span>匹配关键词</span>
          <TagInput value={keywords} onChange={(v) => { setKeywords(v); touch(); }} placeholder="如：需求分析、PRD" />
        </div>
        <div className="field-row">
          <span>排除关键词</span>
          <TagInput value={excludeKeywords} onChange={(v) => { setExcludeKeywords(v); touch(); }} placeholder="如：算法研究" />
        </div>
      </section>

      <section className="editor-card">
        <h4>表达与经历配置</h4>
        <label className="field-row">
          <span>表达版本</span>
          <select value={variantType} onChange={(e) => { setVariantType(e.target.value as ProfileType); touch(); }}>
            {VARIANT_OPTIONS.map((v) => (
              <option key={v} value={v}>{profileTypeLabel(v)}</option>
            ))}
          </select>
        </label>
        <p className="muted small">用于决定项目/实习经历默认调用哪一套表达版本。</p>

        <div className="field-row">
          <span>经历选择与顺序</span>
          <p className="muted small">填写多段经历字段时，将按以下顺序使用已选经历。</p>
        </div>
        {masterExperience.length === 0 ? (
          <div className="empty-block">
            <p>暂无可用经历</p>
            <p className="muted small">请先前往「管理基础资料」补充项目或实习经历</p>
            <button className="btn-sm" onClick={goBack}>返回资料库</button>
          </div>
        ) : (
          <ul className="exp-list">
            {masterExperience.map((e) => {
              const checked = selectedIds.includes(e.id);
              return (
                <li key={e.id} className={checked ? "exp-item checked" : "exp-item"}>
                  <label>
                    <input type="checkbox" checked={checked} onChange={() => toggleExperience(e.id)} />
                    <span className="exp-label">{e.label}</span>
                    <span className="muted small exp-meta">{e.meta}</span>
                  </label>
                  {checked && (
                    <span className="exp-sort">
                      <button className="btn-sm" onClick={() => move(e.id, -1)} aria-label="上移">↑</button>
                      <button className="btn-sm" onClick={() => move(e.id, 1)} aria-label="下移">↓</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="editor-card">
        <h4>固定字段内容</h4>
        <p className="muted small">留空则回退 Master Profile；以下内容优先用于该资料库场景。</p>
        <label className="field-row">
          <span>自我介绍</span>
          <textarea rows={3} value={selfIntroduction} onChange={(e) => { setSelfIntroduction(e.target.value); touch(); }} />
        </label>
        <label className="field-row">
          <span>个人优势</span>
          <textarea rows={3} value={strengths} onChange={(e) => { setStrengths(e.target.value); touch(); }} />
        </label>
        <label className="field-row">
          <span>技能概述</span>
          <textarea rows={2} value={skills} onChange={(e) => { setSkills(e.target.value); touch(); }} />
        </label>
        <label className="field-row">
          <span>作品集链接</span>
          <input value={portfolio} onChange={(e) => { setPortfolio(e.target.value); touch(); }} placeholder="https://…" />
        </label>
        <label className="field-row">
          <span>常用补充说明</span>
          <textarea rows={2} value={extraNote} onChange={(e) => { setExtraNote(e.target.value); touch(); }} />
        </label>
        <label className="field-row">
          <span>常用开放题基础回答</span>
          <textarea rows={3} value={commonSupplement} onChange={(e) => { setCommonSupplement(e.target.value); touch(); }} />
        </label>
      </section>

      <section className="editor-card">
        <button className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "▾" : "▸"} 高级设置
        </button>
        {showAdvanced && (
          <>
            <label className="field-row">
              <span>默认回答长度偏好</span>
              <select value={answerTone} onChange={(e) => { setAnswerTone(e.target.value as "concise" | "balanced" | "detailed"); touch(); }}>
                <option value="concise">简短</option>
                <option value="balanced">标准</option>
                <option value="detailed">详细</option>
              </select>
            </label>
            <label className="field-row check-row">
              <input type="checkbox" checked={allowAIAssist} onChange={(e) => { setAllowAIAssist(e.target.checked); touch(); }} />
              <span>允许 AI 辅助（预留）</span>
            </label>
            <label className="field-row">
              <span>备注</span>
              <textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} />
            </label>
          </>
        )}
      </section>

      <div className="editor-footer">
        <button className="primary" onClick={() => void save()} disabled={!name.trim()}>
          保存资料库
        </button>
      </div>
    </main>
  );
}
