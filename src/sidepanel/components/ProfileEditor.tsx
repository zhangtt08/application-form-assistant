import { useMemo, useState } from "react";
import type { ExperienceVariants, Profile } from "../../types/profile";
import { buildExportFile } from "../../profile/profileStore";
import { defaultProfile } from "../../profile/defaultProfile";
import { generateVariant } from "../../generation/variantGenerator";
import { saveSnapshot } from "../../generation/generationStore";
import type { VariantGenerationResult } from "../../generation/types";
import type { JobContext } from "../../job/schema";
import { profileTypeLabel, type ProfileType } from "../../job/profileTypes";
import { LogEvent, logger } from "../../utils/logger";
import { trace } from "../../utils/trace";
import { VariantReviewDialog } from "./VariantReviewDialog";
import { ImportPanel } from "./ImportPanel";
import { LibraryPicker } from "./LibraryPicker";
import type { ProfileLibrary } from "../../profile/libraryStore";
import { checkProviderHealth } from "../../generation/provider";

/** 岗位方向变体标签（与 job/profileTypes PROFILE_CONFIG 对应） */
const VARIANT_LABELS: Record<keyof ExperienceVariants, string> = {
  agent: "Agent / 开发",
  aiApplication: "AI 应用",
  aiProduct: "AI 产品",
  aiOperation: "AI 运营",
  aiSolution: "AI 解决方案",
  aigcMarketing: "AIGC / 营销",
};

type ExpCollection = "internships" | "projects" | "campus";

interface ReviewState {
  result: VariantGenerationResult;
  collection: ExpCollection;
  index: number;
  targetVariant: keyof ExperienceVariants;
  existingVariant: string;
}

function VariantsInput(p: {
  variants: ExperienceVariants;
  onChange: (key: keyof ExperienceVariants, value: string) => void;
  onGenerate?: (key: keyof ExperienceVariants) => void;
  generatingKey?: keyof ExperienceVariants | null;
  generateDisabledReason?: string;
}) {
  const keys = Object.keys(VARIANT_LABELS) as (keyof ExperienceVariants)[];
  const filled = keys.filter((k) => p.variants[k].trim().length > 0).length;
  return (
    <details className="pe-variants">
      <summary>
        岗位方向表达（{filled} / {keys.length} 已填写）
      </summary>
      <p className="muted small">
        面向不同岗位方向的「这段经历怎么讲」。表单问「实习描述/项目描述」时优先使用对应方向的版本；
        事实与数字不得编造。留空的方向回退默认表达。
      </p>
      {keys.map((key) => (
        <div key={key} className="pe-variant-row">
          <TextareaInput label={VARIANT_LABELS[key]} value={p.variants[key]} onChange={(v) => p.onChange(key, v)} />
          {p.onGenerate && (
            <button
              type="button"
              className="btn-sm pe-generate-btn"
              disabled={p.generatingKey != null}
              title={p.generateDisabledReason ?? `基于当前岗位生成${VARIANT_LABELS[key]}表达（经事实验证后需人工保存）`}
              onClick={() => p.onGenerate?.(key)}
            >
              {p.generatingKey === key ? "生成中…" : "AI 生成"}
            </button>
          )}
        </div>
      ))}
    </details>
  );
}

export interface ProfileEditorProps {
  profile: Profile;
  onPersist: (p: Profile) => void;
  onBack: () => void;
  /** 当前岗位上下文（Stage 3 生成用） */
  activeJob?: JobContext | null;
  effectiveType?: ProfileType;
  /** 资料库（多库管理） */
  libraries: ProfileLibrary[];
  activeLibraryId: string;
  onSwitchLibrary: (id: string) => void;
  onCreateLibrary: (input: { name: string; directions: ProfileType[]; copyCurrent: boolean }) => void;
  onUpdateLibrary: (id: string, patch: { name?: string; directions?: ProfileType[] }) => void;
  onDeleteLibrary: (id: string) => void;
  /** 当前资料库的名称，用于分组标题 */
  libraryName: string;
}

function TextInput(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="pe-row">
      <span className="pe-k">{p.label}</span>
      <input value={p.value} onChange={(e) => p.onChange(e.target.value)} />
    </label>
  );
}

/** 「是否…」偏好：未设置 = 资料库里还没记录，识别到该题时不会替你猜 */
function ChoiceInput(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="pe-row">
      <span className="pe-k">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value)}>
        <option value="">未设置</option>
        <option value="是">是</option>
        <option value="否">否</option>
      </select>
    </label>
  );
}

function TextareaInput(p: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="pe-row">
      <span className="pe-k">{p.label}</span>
      <textarea rows={p.rows ?? 3} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
    </label>
  );
}

function ArrayInput(p: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="pe-row">
      <span className="pe-k">{p.label}</span>
      <input
        value={p.items.join(", ")}
        placeholder="多项用逗号分隔"
        onChange={(e) =>
          p.onChange(
            e.target.value
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

export function ProfileEditor({
  profile,
  onPersist,
  onBack,
  activeJob,
  effectiveType,
  libraries,
  activeLibraryId,
  onSwitchLibrary,
  onCreateLibrary,
  onUpdateLibrary,
  onDeleteLibrary,
  libraryName,
}: ProfileEditorProps) {
  const [draft, setDraft] = useState<Profile>(profile);
  // Stage 3：生成流程状态
  const [generatingKey, setGeneratingKey] = useState<keyof ExperienceVariants | null>(null);
  const [genError, setGenError] = useState("");
  const [review, setReview] = useState<ReviewState | null>(null);

  const set = (fn: (p: Profile) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };

  /** 有未保存的修改时，切库 / 离开先问一句，避免白填 */
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(profile), [draft, profile]);
  /** 资料库里是否已经有内容（决定「导入简历」面板默认摊开还是收起） */
  const hasAnyContent =
    Boolean(draft.basic.name?.trim()) ||
    draft.education.length + draft.internships.length + draft.campus.length + draft.projects.length > 0;
  const guardDirty = (): boolean =>
    !dirty || window.confirm("还有未保存的修改，继续操作会丢掉它们。要先保存吗？（点「取消」回去保存）");

  const handleBack = () => {
    if (guardDirty()) onBack();
  };

  const handleSave = () => {
    onPersist(draft);
  };

  const hasJob = Boolean(activeJob);

  /** 生成指定经历 + 指定方向的变体（全流程：fact select → LLM → claim → validate） */
  const generateDisabledReason = hasJob ? undefined : "未关联岗位：请先在顶部捕获岗位或手动选择方向";
  const handleGenerate = async (
    collection: ExpCollection,
    index: number,
    variantKey: keyof ExperienceVariants,
  ) => {
    if (!activeJob || !effectiveType) return;
    // Provider 不可用时禁止进入生成（spec Stage 3.5 第五章）
    const health = await checkProviderHealth();
    if (health.health !== "available") {
      setGenError(`PROVIDER_UNAVAILABLE: Provider 不可用（${health.health}${health.detail ? `：${health.detail}` : ""}）`);
      await trace("VARIANT_GENERATE_FAILED", "failed", `provider_health=${health.health}`, {
        errorCode: "PROVIDER_UNAVAILABLE",
      });
      return;
    }
    const entry = draft[collection][index]!;
    const experienceId = `${collection}-${index}`;
    setGeneratingKey(variantKey);
    setGenError("");
    try {
      const result = await generateVariant({
        jobContext: activeJob,
        effectiveProfileType: effectiveType,
        experienceId,
        experienceLabel:
          "company" in entry ? entry.company || "实习经历" : "name" in entry ? entry.name || "项目经历" : "校园经历",
        experience: entry,
        targetVariant: variantKey,
        existingVariant: entry.variants[variantKey],
      });
      await trace("VARIANT_GENERATE", "success", `${experienceId} → ${variantKey}`, {
        experienceId,
        profileType: result.profileType,
        validationStatus: result.validation.status,
        usedFacts: result.usedFactIds.length,
      });
      setReview({
        result,
        collection,
        index,
        targetVariant: variantKey,
        existingVariant: entry.variants[variantKey],
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      setGenError(`${e.code ?? "PROVIDER_UNAVAILABLE"}: ${e.message}`);
      await trace("VARIANT_GENERATE_FAILED", "failed", e.code ?? String(e.message), {
        experienceId,
        errorCode: e.code ?? "PROVIDER_UNAVAILABLE",
      });
    } finally {
      setGeneratingKey(null);
    }
  };

  /** 保存（仅 validation pass 后按钮可用）：写入 variant + snapshot + trace */
  const handleSaveVariant = (finalDraft: string) => {
    if (!review) return;
    const { collection, index, targetVariant, result } = review;
    const next = structuredClone(draft);
    (next[collection][index]!.variants as unknown as Record<string, string>)[targetVariant] = finalDraft;
    setDraft(next);
    void saveSnapshot({
      generationId: result.generationId,
      jobContextId: result.jobContextId,
      experienceId: result.experienceId,
      profileType: result.profileType,
      originalDraft: result.draft,
      finalDraft,
      validationStatus: result.validation.status,
      saved: true,
      createdAt: new Date().toISOString(),
    });
    logger.event(LogEvent.PROFILE_SAVED, `variant saved: ${result.experienceId} → ${targetVariant}`);
    void trace("VARIANT_SAVE", "success", `${result.experienceId} → ${targetVariant}`, {
      experienceId: result.experienceId,
      targetVariant,
    });
    onPersist(next);
    setReview(null);
  };

  const handleExport = () => {
    const json = JSON.stringify(buildExportFile(draft), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "afa-profile.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pe">
      <div className="pe-toolbar">
        <button type="button" onClick={handleBack}>
          ← 返回投递
        </button>
        <div className="spacer" />
        {/* 导出 / 重置是低频动作：折进「更多」，顶栏只剩「返回」和「保存」两个决定 */}
        <details className="soft-fold pe-more">
          <summary>更多</summary>
          <button type="button" onClick={handleExport}>
            导出 JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("重置会清空当前编辑中的所有资料，确定？")) setDraft(structuredClone(defaultProfile));
            }}
          >
            重置为空
          </button>
        </details>
        <button type="button" className="primary" onClick={handleSave} disabled={!dirty} title={dirty ? "" : "没有需要保存的改动"}>
          保存
        </button>
      </div>

      <p className="hint">
        下面的资料会被填进网申表单。<strong>承诺、已阅读并同意、电子签名、服从调剂、背景调查与签证授权，以及推荐人这类别人的信息，扩展永不代填。</strong>
      </p>

      <LibraryPicker
        libraries={libraries}
        activeId={activeLibraryId}
        onBeforeSwitch={() => guardDirty()}
        onSwitch={onSwitchLibrary}
        onCreate={onCreateLibrary}
        onUpdate={onUpdateLibrary}
        onDelete={onDeleteLibrary}
      />

      {/* 已经有资料的人进这一页是为了改字段，不是再导入一次简历：
          导入面板默认收起，空资料时才摊开（新手第一眼就该看到它）。 */}
      <details className="import-fold" open={!hasAnyContent}>
        <summary>
          {hasAnyContent ? "再导入一份简历（粘贴文本 / 导入 JSON）" : "导入你的简历（粘贴文本 / 导入 JSON）"}
        </summary>
        <ImportPanel
          current={draft}
          libraries={libraries}
          activeLibraryId={activeLibraryId}
          onImported={(p) => {
            setDraft(p);
            onPersist(p);
          }}
        />
      </details>

      <div className="pe-group">公共信息 · 所有资料库共用，改一次全库生效</div>

      <details open>
        <summary>基础信息</summary>
        <TextInput label="姓名" value={draft.basic.name} onChange={(v) => set((p) => (p.basic.name = v))} />
        <TextInput label="英文名" value={draft.basic.englishName} onChange={(v) => set((p) => (p.basic.englishName = v))} />
        <p className="hint">英文招聘网站（Greenhouse / Lever / Workday 这类）会把姓名拆成 First name 和 Last name 两个框。只填「姓名」它们都对不上，这两栏各填一次就都能自动填。</p>
        <TextInput label="姓氏" value={draft.basic.surname ?? ""} onChange={(v) => set((p) => (p.basic.surname = v))} />
        <TextInput label="名字" value={draft.basic.givenName ?? ""} onChange={(v) => set((p) => (p.basic.givenName = v))} />
        <TextInput label="领英" value={draft.basic.linkedin ?? ""} onChange={(v) => set((p) => (p.basic.linkedin = v))} />
        <TextInput label="GitHub" value={draft.basic.github ?? ""} onChange={(v) => set((p) => (p.basic.github = v))} />
        <TextInput label="性别" value={draft.basic.gender} onChange={(v) => set((p) => (p.basic.gender = v))} />
        <TextInput label="出生日期" value={draft.basic.birthDate} onChange={(v) => set((p) => (p.basic.birthDate = v))} />
        <TextInput label="年龄" value={draft.basic.age} onChange={(v) => set((p) => (p.basic.age = v))} />
        <TextInput label="手机号" value={draft.basic.phone} onChange={(v) => set((p) => (p.basic.phone = v))} />
        <TextInput label="邮箱" value={draft.basic.email} onChange={(v) => set((p) => (p.basic.email = v))} />
        <TextInput label="微信" value={draft.basic.wechat} onChange={(v) => set((p) => (p.basic.wechat = v))} />
        <TextInput label="QQ号" value={draft.basic.qq} onChange={(v) => set((p) => (p.basic.qq = v))} />
        <TextInput label="所在城市" value={draft.basic.city} onChange={(v) => set((p) => (p.basic.city = v))} />
        <TextInput label="通讯地址" value={draft.basic.address ?? ""} onChange={(v) => set((p) => (p.basic.address = v))} />
        <TextInput label="身份证号" value={draft.basic.idNumber ?? ""} onChange={(v) => set((p) => (p.basic.idNumber = v))} />
        <TextInput label="籍贯" value={draft.basic.nativePlace ?? ""} onChange={(v) => set((p) => (p.basic.nativePlace = v))} />
        <TextInput label="户口所在地" value={draft.basic.hukou ?? ""} onChange={(v) => set((p) => (p.basic.hukou = v))} />
        <TextInput label="户口性质" value={draft.basic.hukouType ?? ""} onChange={(v) => set((p) => (p.basic.hukouType = v))} />
        <TextInput label="政治面貌" value={draft.basic.politicalStatus ?? ""} onChange={(v) => set((p) => (p.basic.politicalStatus = v))} />
        <TextInput label="婚姻状况" value={draft.basic.maritalStatus ?? ""} onChange={(v) => set((p) => (p.basic.maritalStatus = v))} />
        <TextInput label="身高(cm)" value={draft.basic.height ?? ""} onChange={(v) => set((p) => (p.basic.height = v))} />
        <TextInput label="体重(kg)" value={draft.basic.weight ?? ""} onChange={(v) => set((p) => (p.basic.weight = v))} />
        <TextInput label="工作年限" value={draft.basic.workYears ?? ""} onChange={(v) => set((p) => (p.basic.workYears = v))} />
        <TextInput label="紧急联系人" value={draft.basic.emergencyContactName ?? ""} onChange={(v) => set((p) => (p.basic.emergencyContactName = v))} />
        <TextInput label="紧急联系电话" value={draft.basic.emergencyContactPhone ?? ""} onChange={(v) => set((p) => (p.basic.emergencyContactPhone = v))} />
        <TextInput label="主页/作品集" value={draft.basic.portfolio} onChange={(v) => set((p) => (p.basic.portfolio = v))} />
      </details>

      <details>
        <summary>教育经历（{draft.education.length}）</summary>
        {draft.education.map((edu, i) => (
          <div className="pe-entry" key={i}>
            <div className="pe-entry-head">
              第 {i + 1} 条
              <button className="btn-sm" onClick={() => set((p) => p.education.splice(i, 1))}>
                删除
              </button>
            </div>
            <TextInput label="学校" value={edu.school} onChange={(v) => set((p) => (p.education[i]!.school = v))} />
            <TextInput label="学院" value={edu.college} onChange={(v) => set((p) => (p.education[i]!.college = v))} />
            <TextInput label="专业" value={edu.major} onChange={(v) => set((p) => (p.education[i]!.major = v))} />
            <TextInput label="学历" value={edu.degree} onChange={(v) => set((p) => (p.education[i]!.degree = v))} />
            <TextInput label="学位" value={edu.degreeType ?? ''} onChange={(v) => set((p) => (p.education[i]!.degreeType = v))} />
            <TextInput label="研究方向" value={edu.direction ?? ''} onChange={(v) => set((p) => (p.education[i]!.direction = v))} />
            <TextInput label="GPA" value={edu.gpa} onChange={(v) => set((p) => (p.education[i]!.gpa = v))} />
            <TextInput label="专业排名" value={edu.rank} onChange={(v) => set((p) => (p.education[i]!.rank = v))} />
            <TextInput label="入学时间" value={edu.startDate} onChange={(v) => set((p) => (p.education[i]!.startDate = v))} />
            <TextInput label="毕业时间" value={edu.endDate} onChange={(v) => set((p) => (p.education[i]!.endDate = v))} />
          </div>
        ))}
        <button
          className="btn-sm"
          onClick={() =>
            set((p) =>
              p.education.push({
                school: "", college: "", major: "", degree: "", educationLevel: "", startDate: "", endDate: "", gpa: "", rank: "",
              }),
            )
          }
        >
          + 新增教育经历
        </button>
      </details>

      <details>
        <summary className="text-manual">证件与其他身份信息（公共 · 各库共用）</summary>
        <div className="banner banner-review">
          这几项是资料库里就有的客观信息：网站问到就按这里的内容填写，没填就留空。
          真正永不代填的是<strong>承诺 / 已阅读并同意 / 电子签名 / 服从调剂 / 背景调查与签证授权</strong>
          这类「替你做保证」的控件，以及推荐人等<strong>别人的信息</strong>。
        </div>
        <TextInput label="政治面貌" value={draft.sensitive.politicalStatus} onChange={(v) => set((p) => (p.sensitive.politicalStatus = v))} />
        <TextInput label="婚姻状况" value={draft.sensitive.maritalStatus} onChange={(v) => set((p) => (p.sensitive.maritalStatus = v))} />
        <TextInput label="身份证号" value={draft.sensitive.idNumber} onChange={(v) => set((p) => (p.sensitive.idNumber = v))} />
        <TextInput label="紧急联系人" value={draft.sensitive.emergencyContact} onChange={(v) => set((p) => (p.sensitive.emergencyContact = v))} />
      </details>

      <div className="pe-group">本资料库内容 · 「{libraryName}」专有，其他库不受影响</div>

      <details>
        <summary>实习经历（{draft.internships.length}）</summary>
        {draft.internships.map((it, i) => (
          <div className="pe-entry" key={i}>
            <div className="pe-entry-head">
              第 {i + 1} 条
              <button className="btn-sm" onClick={() => set((p) => p.internships.splice(i, 1))}>
                删除
              </button>
            </div>
            <TextInput label="公司" value={it.company} onChange={(v) => set((p) => (p.internships[i]!.company = v))} />
            <TextInput label="部门" value={it.department} onChange={(v) => set((p) => (p.internships[i]!.department = v))} />
            <TextInput label="岗位" value={it.position} onChange={(v) => set((p) => (p.internships[i]!.position = v))} />
            <TextInput label="开始" value={it.startDate} onChange={(v) => set((p) => (p.internships[i]!.startDate = v))} />
            <TextInput label="结束" value={it.endDate} onChange={(v) => set((p) => (p.internships[i]!.endDate = v))} />
            <TextareaInput label="工作职责" value={it.responsibilities} onChange={(v) => set((p) => (p.internships[i]!.responsibilities = v))} />
            <TextareaInput label="工作内容" value={it.workContent} onChange={(v) => set((p) => (p.internships[i]!.workContent = v))} />
            <TextareaInput label="工作业绩" value={it.achievements} onChange={(v) => set((p) => (p.internships[i]!.achievements = v))} />
            <TextareaInput label="总结/收获" value={it.summary} onChange={(v) => set((p) => (p.internships[i]!.summary = v))} />
            <TextareaInput label="描述" value={it.description} onChange={(v) => set((p) => (p.internships[i]!.description = v))} />
            <VariantsInput
              variants={it.variants}
              onChange={(k, v) => set((p) => { p.internships[i]!.variants[k] = v; })}
              onGenerate={(k) => void handleGenerate("internships", i, k)}
              generatingKey={generatingKey}
              generateDisabledReason={generateDisabledReason}
            />
          </div>
        ))}
        <button
          className="btn-sm"
          onClick={() =>
            set((p) =>
              p.internships.push({
                company: "", department: "", position: "", startDate: "", endDate: "",
                description: "",
                responsibilities: "", workContent: "", achievements: "", summary: "",
                variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
              }),
            )
          }
        >
          + 新增实习
        </button>
      </details>

      <details>
        <summary>校园经历（{draft.campus.length}）</summary>
        {draft.campus.length === 0 && (
          <p className="muted small">学生会/社团/学生工作等经历，对应网申表单的「校园经历」板块。</p>
        )}
        {draft.campus.map((cp, i) => (
          <div className="pe-entry" key={i}>
            <div className="pe-entry-head">
              第 {i + 1} 条
              <button className="btn-sm" onClick={() => set((p) => p.campus.splice(i, 1))}>
                删除
              </button>
            </div>
            <TextInput label="组织" value={cp.organization} onChange={(v) => set((p) => (p.campus[i]!.organization = v))} />
            <TextInput label="部门" value={cp.department} onChange={(v) => set((p) => (p.campus[i]!.department = v))} />
            <TextInput label="职务" value={cp.position} onChange={(v) => set((p) => (p.campus[i]!.position = v))} />
            <TextInput label="开始" value={cp.startDate} onChange={(v) => set((p) => (p.campus[i]!.startDate = v))} />
            <TextInput label="结束" value={cp.endDate} onChange={(v) => set((p) => (p.campus[i]!.endDate = v))} />
            <TextareaInput label="工作职责" value={cp.responsibilities} onChange={(v) => set((p) => (p.campus[i]!.responsibilities = v))} />
            <TextareaInput label="工作内容" value={cp.workContent} onChange={(v) => set((p) => (p.campus[i]!.workContent = v))} />
            <TextareaInput label="工作业绩" value={cp.achievements} onChange={(v) => set((p) => (p.campus[i]!.achievements = v))} />
            <TextareaInput label="总结/收获" value={cp.summary} onChange={(v) => set((p) => (p.campus[i]!.summary = v))} />
            <TextareaInput label="描述" value={cp.description} onChange={(v) => set((p) => (p.campus[i]!.description = v))} />
            <VariantsInput
              variants={cp.variants}
              onChange={(k, v) => set((p) => { p.campus[i]!.variants[k] = v; })}
              onGenerate={(k) => void handleGenerate("campus", i, k)}
              generatingKey={generatingKey}
              generateDisabledReason={generateDisabledReason}
            />
          </div>
        ))}
        <button
          className="btn-sm"
          onClick={() =>
            set((p) =>
              p.campus.push({
                organization: "", department: "", position: "", startDate: "", endDate: "",
                description: "",
                responsibilities: "", workContent: "", achievements: "", summary: "",
                variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
              }),
            )
          }
        >
          + 新增校园经历
        </button>
      </details>

      <details>
        <summary>项目经历（{draft.projects.length}）</summary>
        {draft.projects.map((pj, i) => (
          <div className="pe-entry" key={i}>
            <div className="pe-entry-head">
              第 {i + 1} 条
              <button className="btn-sm" onClick={() => set((p) => p.projects.splice(i, 1))}>
                删除
              </button>
            </div>
            <TextInput label="项目名称" value={pj.name} onChange={(v) => set((p) => (p.projects[i]!.name = v))} />
            <TextInput label="角色" value={pj.role} onChange={(v) => set((p) => (p.projects[i]!.role = v))} />
            <TextInput label="开始" value={pj.startDate} onChange={(v) => set((p) => (p.projects[i]!.startDate = v))} />
            <TextInput label="结束" value={pj.endDate} onChange={(v) => set((p) => (p.projects[i]!.endDate = v))} />
            <ArrayInput label="关键词" items={pj.keywords} onChange={(v) => set((p) => (p.projects[i]!.keywords = v))} />
            <TextareaInput label="项目背景" value={pj.background} onChange={(v) => set((p) => (p.projects[i]!.background = v))} />
            <TextareaInput label="项目职责" value={pj.responsibilities} onChange={(v) => set((p) => (p.projects[i]!.responsibilities = v))} />
            <TextareaInput label="项目内容" value={pj.workContent} onChange={(v) => set((p) => (p.projects[i]!.workContent = v))} />
            <TextareaInput label="项目成果" value={pj.achievements} onChange={(v) => set((p) => (p.projects[i]!.achievements = v))} />
            <TextareaInput label="项目概述/总结" value={pj.summary} onChange={(v) => set((p) => (p.projects[i]!.summary = v))} />
            <TextareaInput label="描述" value={pj.description} onChange={(v) => set((p) => (p.projects[i]!.description = v))} />
            <VariantsInput
              variants={pj.variants}
              onChange={(k, v) => set((p) => { p.projects[i]!.variants[k] = v; })}
              onGenerate={(k) => void handleGenerate("projects", i, k)}
              generatingKey={generatingKey}
              generateDisabledReason={generateDisabledReason}
            />
          </div>
        ))}
        <button
          className="btn-sm"
          onClick={() =>
            set((p) =>
              p.projects.push({
                name: "", role: "", startDate: "", endDate: "",
                description: "", keywords: [],
                background: "", responsibilities: "", workContent: "", achievements: "", summary: "",
                variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
              }),
            )
          }
        >
          + 新增项目
        </button>
      </details>

      <details>
        <summary>技能</summary>
        <ArrayInput label="技术技能" items={draft.skills.technical} onChange={(v) => set((p) => (p.skills.technical = v))} />
        <ArrayInput label="工具" items={draft.skills.tools} onChange={(v) => set((p) => (p.skills.tools = v))} />
        <ArrayInput label="语言能力" items={draft.skills.languages} onChange={(v) => set((p) => (p.skills.languages = v))} />
        <ArrayInput label="证书" items={draft.skills.certificates} onChange={(v) => set((p) => (p.skills.certificates = v))} />
        <ArrayInput label="获奖情况" items={draft.skills.awards} onChange={(v) => set((p) => (p.skills.awards = v))} />
      </details>

      <details>
        <summary>求职偏好</summary>
        <ArrayInput label="期望城市" items={draft.jobPreferences.expectedCity} onChange={(v) => set((p) => (p.jobPreferences.expectedCity = v))} />
        <ArrayInput label="期望岗位" items={draft.jobPreferences.expectedPosition} onChange={(v) => set((p) => (p.jobPreferences.expectedPosition = v))} />
        <TextInput label="期望行业" value={draft.jobPreferences.expectedIndustry} onChange={(v) => set((p) => (p.jobPreferences.expectedIndustry = v))} />
        <TextInput label="期望薪资" value={draft.jobPreferences.expectedSalary} onChange={(v) => set((p) => (p.jobPreferences.expectedSalary = v))} />
        <TextInput label="到岗时间" value={draft.jobPreferences.availableDate} onChange={(v) => set((p) => (p.jobPreferences.availableDate = v))} />
        <TextInput label="就业类型" value={draft.jobPreferences.employmentType} onChange={(v) => set((p) => (p.jobPreferences.employmentType = v))} />
        <p className="hint">下面这些「是否…」问题在网申里以单选题出现。你在资料库答一次，之后所有网站都按这个答案自动勾选；选「未设置」时扩展不会替你猜。</p>
        <ChoiceInput label="是否接受线下面试" value={draft.jobPreferences.acceptOfflineInterview ?? ""} onChange={(v) => set((p) => (p.jobPreferences.acceptOfflineInterview = v))} />
        <ChoiceInput label="是否接受线上面试" value={draft.jobPreferences.acceptOnlineInterview ?? ""} onChange={(v) => set((p) => (p.jobPreferences.acceptOnlineInterview = v))} />
        <ChoiceInput label="是否接受出差" value={draft.jobPreferences.acceptBusinessTrip ?? ""} onChange={(v) => set((p) => (p.jobPreferences.acceptBusinessTrip = v))} />
        <ChoiceInput label="是否接受异地/外派" value={draft.jobPreferences.acceptRelocation ?? ""} onChange={(v) => set((p) => (p.jobPreferences.acceptRelocation = v))} />
        <ChoiceInput label="是否接受加班" value={draft.jobPreferences.acceptOvertime ?? ""} onChange={(v) => set((p) => (p.jobPreferences.acceptOvertime = v))} />
      </details>

      <details>
        <summary>常用文本</summary>
        <p className="muted small">表单上的自我介绍、自我评价等开放栏会按这里的内容填写。</p>
        {(["selfIntroduction", "selfEvaluation", "personalAdvantages", "careerPlan", "hobbies"] as const).map((key) => (
          <div className="pe-entry" key={key}>
            <div className="pe-entry-head">
              {{
                selfIntroduction: "自我介绍",
                selfEvaluation: "自我评价",
                personalAdvantages: "个人优势",
                careerPlan: "职业规划",
                hobbies: "兴趣爱好",
              }[key]}
            </div>
            <TextareaInput label="内容" value={draft.content[key]} onChange={(v) => set((p) => (p.content[key] = v))} rows={4} />
          </div>
        ))}
      </details>

      <details>
        <summary>职业方向（开放题「职业规划」的事实来源）</summary>
        <p className="muted small">仅在此显式填写；为空时「职业规划」类开放题会提示补充而不是编造。</p>
        <ArrayInput label="目标方向" items={draft.careerPreferences?.targetDirections ?? []} onChange={(v) => set((p) => { p.careerPreferences = { ...(p.careerPreferences ?? { preferredWorkTypes: [], developmentGoals: [] }), targetDirections: v }; })} />
        <ArrayInput label="偏好工作类型" items={draft.careerPreferences?.preferredWorkTypes ?? []} onChange={(v) => set((p) => { p.careerPreferences = { ...(p.careerPreferences ?? { targetDirections: [], developmentGoals: [] }), preferredWorkTypes: v }; })} />
        <ArrayInput label="发展目标" items={draft.careerPreferences?.developmentGoals ?? []} onChange={(v) => set((p) => { p.careerPreferences = { ...(p.careerPreferences ?? { targetDirections: [], preferredWorkTypes: [] }), developmentGoals: v }; })} />
      </details>

      {genError && <div className="banner banner-error">{genError}</div>}

      {review && (
        <VariantReviewDialog
          result={review.result}
          existingVariant={review.existingVariant}
          targetLabel={profileTypeLabel(review.targetVariant as ProfileType)}
          onSave={handleSaveVariant}
          onCancel={() => setReview(null)}
        />
      )}
    </div>
  );
}
