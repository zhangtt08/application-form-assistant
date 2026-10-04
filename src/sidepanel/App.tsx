import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CandidateField } from "../types/field";
import { Header } from "./components/Header";
import { FieldList } from "./components/FieldList";
import { FillReceipt } from "./components/FillReceipt";
import { FillConfirmDialog } from "./components/FillConfirmDialog";
import { ProfileEditor } from "./components/ProfileEditor";
import { JobCard } from "./components/JobCard";
import { TabBar, type MainTab } from "./components/TabBar";
import { Stepper, type Step } from "./components/Stepper";
import { useProfile } from "./hooks/useProfile";
/**
 * 判断逻辑一律从 `src/core` 这一门面取——它与 agent/tools.mjs 加载的是同一批源文件。
 * （过去这里逐个 pointing 到 pipeline / rules / profile 的相对路径，
 *   想在扩展外面复用同一套判断就只能再抄一份，两份迟早给出两个结论。）
 */
import {
  assessRisk,
  buildFillPlan,
  describeRule,
  deriveStatus,
  fieldFullLabel,
  hostFromUrl,
  isCanonicalFieldId,
  matchField,
  resolveValue,
  rulesForHost,
  runScanPipeline,
  summarizeFillOutcome,
  type FillSummary,
  type RiskAssessment,
  type SiteMemory,
} from "../core";
import {
  routeJob,
  effectiveProfileType,
  calculateProfileCoverage,
  type ProfileSelection,
} from "../profile/profileRouter";
import { assembleProfile, loadStore, selectLibraryForDirection } from "../profile/libraryStore";
import { profileHasContent } from "../profile/profileStore";
import {
  getActiveJob,
  getJobHistory,
  rememberJob,
  setActiveJob,
  clearActiveJob,
  subscribeJobChanges,
  setProfileOverride,
  getProfileOverride,
} from "../job/jobStore";
import { RuleBasedJobParser, makeManualJobContext } from "../job/jobParser";
import type { JobContext } from "../job/schema";
import { profileTypeLabel, type ProfileType } from "../job/profileTypes";
import type {
  ScanPageResult,
  EnsureContentScriptResult,
  FillFieldsResult,
  UndoResult,
} from "../types/message";
import { LogEvent, logger } from "../utils/logger";
import { startTrace, getTraceId, trace } from "../utils/trace";
import { TraceViewer } from "./components/TraceViewer";
import { JobInbox } from "./components/JobInbox";
import { ProviderSettingsForm } from "./components/ProviderSettingsForm";
import { JobWorkspace } from "./components/JobWorkspace";
import {
  upsertJobFromContext,
  appendEvent,
  migrateStorage,
  getLatestOpenSession,
  createSession as createSessionV2,
  updateSession as updateSessionV2,
  setActiveJobId as setWsActiveJob,
  setJobStatus as setWsJobStatus,
} from "../workspace/index";
import { generateAnswer } from "../answering/answerGenerator";
import { selectAnswerFacts, careerFactsFrom, companyFactsFrom } from "../answering/answerStrategy";
import { buildFactContext, extractJobRequirements } from "../generation/promptBuilder";
import { ANSWER_PROMPT_VERSION } from "../answering/promptBuilder";
import {
  createSession,
  getLatestSessionForJob,
  saveAnswerToSession,
  answerCacheKey,
  getCachedAnswer,
  putCachedAnswer,
} from "../answering/answerStore";
import { validateAnswer } from "../answering/answerValidator";
import { loadApplyPrefs, saveApplyPrefs, DEFAULT_PREFS, type ApplyPrefs } from "./prefs";
import {
  addSiteRule,
  emptySiteMemory,
  loadSiteMemory,
  removeSiteRule,
  subscribeSiteMemoryChanges,
} from "../site/siteMemory";
import { formatBytes, readStorageUsage, type StorageUsage } from "../utils/storageUsage";

/**
 * 侧边栏主壳。
 *
 * 交互模型：
 *   ① 投递页只有一个主动作「开始识别」；
 *   ② 识别 = 连接页面 → 识别岗位与方向 → 识别表单字段 → 匹配资料；
 *   ③ 已匹配且可写入的字段直接进入 ConfirmedFillPlan 并填写，无法匹配或不支持的字段留给人工；
 *   ④ 写入统一经过 Field Writer → Write Verification，Undo 仅用于恢复；
 *   ⑤ 资料导入独立成「资料」页，Dev / Trace 收进「设置」页。
 */

type Phase = "idle" | "recognizing" | "ready" | "filling" | "done";

interface StepDef {
  key: string;
  label: string;
}

const RECOGNIZE_STEPS: StepDef[] = [
  { key: "page", label: "连接当前页面" },
  { key: "job", label: "识别岗位与填写方向" },
  { key: "scan", label: "识别需要填写的字段" },
  { key: "match", label: "匹配你的资料" },
];

const jobParser = new RuleBasedJobParser();

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function isSafeFillable(c: CandidateField): boolean {
  return (c.status === "ready" || c.status === "need-confirm") && !!c.value && c.risk !== "MANUAL_ONLY";
}

/** 可自动填写的候选：有内容且不是敏感 MANUAL_ONLY；不再要求用户逐项确认风险/置信度。 */
function isConfirmable(c: CandidateField): boolean {
  return (
    (c.status === "ready" || c.status === "need-confirm") && !!c.value && c.risk !== "MANUAL_ONLY"
  );
}

function isConfirmedFillable(c: CandidateField): boolean {
  return c.confirmed === true && isConfirmable(c);
}

export default function App() {
  const {
    profile,
    persist,
    loadProblem,
    libraries,
    activeLibrary,
    activeLibraryId,
    switchLibrary,
    createLibrary,
    updateLibrary,
    deleteLibrary,
  } = useProfile();

  const [tab, setTab] = useState<MainTab>("apply");
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ApplyPrefs>(DEFAULT_PREFS);
  /** 站点记忆：人在某个招聘站上做过的字段归属判断 / 「这一站别填」，本机保存 */
  const [siteMemory, setSiteMemory] = useState<SiteMemory>(emptySiteMemory());
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<CandidateField[]>([]);
  const [fillSummary, setFillSummary] = useState<FillSummary | null>(null);
  const [originals, setOriginals] = useState<
    { reference: string; kind: string; previousValue: string; frameId?: number; undoTag?: string }[]
  >([]);
  const [showConfirm, setShowConfirm] = useState(false);
  /** 无自动填写项时，字段清单默认收起；自动填写完成后保持展开，便于核对结果。 */
  const [previewRevealed, setPreviewRevealed] = useState(false);
  /** 仍通过确认框填写的补充字段（兼容手动预览流程）。 */
  const [confirmTargets, setConfirmTargets] = useState<CandidateField[]>([]);
  const [mutated, setMutated] = useState(false);
  /** 本轮识别后是否执行过撤销：决定副标题说「已撤销」还是「这个页面没有可填字段」 */
  const [undone, setUndone] = useState(false);
  const [resumeInfo, setResumeInfo] = useState<{ sessionId: string; detectedFields: number } | null>(null);
  const [showSubmitPrompt, setShowSubmitPrompt] = useState(false);
  const [inboxRefresh, setInboxRefresh] = useState(0);

  const [activeJob, setActiveJobState] = useState<JobContext | null>(null);
  const [jobHistory, setJobHistory] = useState<JobContext[]>([]);
  const [routing, setRouting] = useState<ProfileSelection | null>(null);
  const [profileOverride, setOverrideState] = useState<ProfileType | null>(null);

  const sessionRef = useRef<string | null>(null);
  const sessionV2IdRef = useRef<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  /* ---------------- 基础数据 ---------------- */

  const refreshJobs = useCallback(async () => {
    setActiveJobState(await getActiveJob());
    setJobHistory(await getJobHistory());
    setOverrideState(await getProfileOverride());
  }, []);

  useEffect(() => {
    void refreshJobs();
    return subscribeJobChanges(() => {
      void refreshJobs();
    });
  }, [refreshJobs]);

  useEffect(() => {
    void loadApplyPrefs().then(setPrefs);
  }, []);

  // 站点记忆：开面板读一次，之后跟着 storage.onChanged 走（设置页删了，投递页要立刻失效）
  useEffect(() => {
    void loadSiteMemory().then(setSiteMemory);
    return subscribeSiteMemoryChanges(setSiteMemory);
  }, []);

  // 存储用量只在打开设置页时读（不常驻轮询，它要整份读盘）
  useEffect(() => {
    if (tab !== "settings") return;
    void readStorageUsage().then(setStorageUsage);
  }, [tab]);

  const updatePrefs = useCallback((patch: Partial<ApplyPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void saveApplyPrefs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    void migrateStorage().then((m) => {
      if (m) void trace("STORAGE_MIGRATION", "success", "afa.jobs.v1 → v2");
    });
  }, [initialized]);

  useEffect(() => {
    const listener = (msg: { type?: string }) => {
      if (msg?.type === "PAGE_MUTATED") setMutated(true);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const effectiveType: ProfileType = useMemo(
    () =>
      effectiveProfileType(
        routing ?? ({ primaryProfile: activeJob?.jobType ?? "general" } as ProfileSelection),
        profileOverride,
      ),
    [routing, profileOverride, activeJob],
  );

  const coverage = useMemo(
    () => (profile ? calculateProfileCoverage(profile, effectiveType) : null),
    [profile, effectiveType],
  );

  /** 资料还是空的：识别能认出字段，但一项都填不出来——先把用户引到导入，而不是让他对着空结果猜原因 */
  const needsProfile = useMemo(() => (profile ? !profileHasContent(profile) : false), [profile]);

  /* ---------------- 统计 ---------------- */

  /** 当前页面属于哪个招聘站（站点记忆的键）；读不到 URL 就没有站点设定可用 */
  const siteHost = useMemo(() => hostFromUrl(url), [url]);

  const reviewTargets = useMemo(
    () =>
      candidates.filter(
        (c) =>
          (c.status === "need-confirm" || c.status === "low-confidence") &&
          !!c.value &&
          c.risk !== "MANUAL_ONLY",
      ),
    [candidates],
  );
  const filledList = useMemo(() => candidates.filter((c) => c.status === "filled"), [candidates]);
  const failedList = useMemo(() => candidates.filter((c) => c.status === "failed"), [candidates]);
  const manualList = useMemo(
    () => candidates.filter((c) => c.status === "manual" || c.status === "unsupported"),
    [candidates],
  );
  /** 把握不足：资料有内容，但识别证据不够，扩展没有写它 —— 等的是人点一次头，不是等资料。
   *  它和 AI 回答一起算在 `reviewTargets`（待你确认）里，界面上不再是「静默填了 62%」。 */
  const noContentList = useMemo(
    () => candidates.filter((c) => c.status === "empty" || c.status === "unknown"),
    [candidates],
  );
  const confirmable = useMemo(() => candidates.filter(isConfirmedFillable), [candidates]);
  /** 可直接填写：识别成功、有内容、非 MANUAL_ONLY。 */
  const safeCount = useMemo(() => candidates.filter(isSafeFillable).length, [candidates]);

  /**
   * 主按钮要写入的字段：
   * 已经逐项勾选过的优先；一个都没勾过时，把「待你确认」那一批整体纳入
   * —— 点主按钮 → 确认框列出将写什么 → 确认才写。写前门禁始终存在。
   */
  const pendingToFill = useMemo(
    () => (confirmable.length > 0 ? confirmable : candidates.filter(isSafeFillable)),
    [confirmable, candidates],
  );

  /* ---------------- Stage 4：开放题回答 ---------------- */

  const setGenErrorBanner = useCallback((e: Error & { code?: string }) => {
    setError(`${e.code ?? "ANSWER_GENERATION_FAILED"}: ${e.message}`);
  }, []);

  const handleGenerateAnswer = useCallback(
    async (reference: string) => {
      if (!profile || !activeJob) return;
      const candidate = candidates.find((c) => c.raw.reference === reference);
      const open = candidate?.openAnswer;
      if (!candidate || !open) return;

      const intent = open.intent;
      const question = open.question;
      const requirements = extractJobRequirements(activeJob);
      const length = open.lengthConstraint ?? {
        maxLength: candidate.raw.context.maxLength,
        targetCharacters: candidate.raw.context.maxLength ?? 300,
      };

      let personalFacts: import("../generation/types").Fact[] = [];
      const allCollections = [
        ...profile.internships.map((e, i) => ({ e, id: `internships-${i}`, label: e.company || "实习经历" })),
        ...profile.projects.map((e, i) => ({ e, id: `projects-${i}`, label: e.name || "项目经历" })),
        ...profile.campus.map((e, i) => ({ e, id: `campus-${i}`, label: "校园经历" })),
      ];
      if (intent === "representative_project") {
        const firstId = routing?.recommendedExperienceIds[0];
        const idx = firstId ? Number(firstId.split("-")[1] ?? 0) : 0;
        const collection = firstId?.split("-")[0] ?? "internships";
        const target = allCollections.find((x) => x.id === `${collection}-${idx}`) ?? allCollections[0];
        if (target) personalFacts = buildFactContext(target.id, target.label, target.e).facts;
      } else {
        const merged = allCollections.flatMap(({ e, id, label }) => buildFactContext(id, label, e).facts);
        personalFacts = selectAnswerFacts(intent, requirements, merged);
      }
      const companyFacts = companyFactsFrom(activeJob);
      const careerFacts = careerFactsFrom(profile.careerPreferences);

      await trace("ANSWER_FACT_SELECT", "success", `${intent} facts=${personalFacts.length}`, {
        intent,
        factCount: personalFacts.length,
      });

      const cacheKey = answerCacheKey(
        activeJob.id,
        question,
        personalFacts.map((f) => f.id),
        ANSWER_PROMPT_VERSION,
      );
      const cached = await getCachedAnswer(cacheKey);

      let structured;
      let validation;
      try {
        if (cached) {
          structured = {
            answer: cached.answer,
            usedPersonalFactIds: [],
            usedCompanyFactIds: [],
            addressedRequirements: [],
            unsupportedRequirements: [],
            status: cached.status === "insufficient_context" ? ("insufficient_context" as const) : ("generated" as const),
            missingContext: [],
          };
          validation = validateAnswer(structured.answer, personalFacts, companyFacts, careerFacts, length);
        } else {
          const result = await generateAnswer({
            question,
            intent,
            jobRequirements: requirements,
            personalFacts,
            companyFacts,
            careerFacts,
            length,
          });
          structured = result.structured;
          validation = result.validation;
          if (structured.status === "generated" && structured.answer) {
            await putCachedAnswer(cacheKey, structured.answer, structured.status);
          }
        }
      } catch (err) {
        setGenErrorBanner(err as Error & { code?: string });
        return;
      }

      await trace(
        "ANSWER_GENERATE",
        structured.status === "generated" ? "success" : "info",
        `${intent} status=${structured.status}`,
        { intent, factCount: personalFacts.length },
      );

      setCandidates((prev) =>
        prev.map((c) => {
          if (c.raw.reference !== reference || !c.openAnswer) return c;
          if (structured.status === "insufficient_context") {
            return {
              ...c,
              openAnswer: {
                ...c.openAnswer,
                status: "insufficient_context",
                missingContext: structured.missingContext,
              },
            };
          }
          const blocked = validation.overall === "fail";
          return {
            ...c,
            status: blocked ? "unknown" : "need-confirm",
            editedValue: blocked ? undefined : structured.answer,
            openAnswer: {
              ...c.openAnswer,
              status: "generated",
              answer: structured.answer,
              validation,
              usedPersonalFactIds: structured.usedPersonalFactIds,
              usedCompanyFactIds: structured.usedCompanyFactIds,
            },
            value: blocked
              ? undefined
              : {
                  fieldId: "open.question",
                  value: structured.answer,
                  variant: "plain",
                  editable: true,
                  sourceType: "ai_grounded",
                },
          };
        }),
      );

      if (sessionRef.current && validation.overall !== "fail" && structured.status === "generated") {
        await saveAnswerToSession(sessionRef.current, {
          question,
          intent,
          answer: structured.answer,
          validationStatus: validation.overall,
          usedFactIds: structured.usedPersonalFactIds,
          maxLength: length.maxLength,
          manualEdited: false,
          createdAt: new Date().toISOString(),
        });
        await trace("ANSWER_SAVE_TO_SESSION", "success", intent, { intent });
      }
    },
    [profile, activeJob, candidates, routing],
  );

  const handleRevalidateAnswer = useCallback(
    async (reference: string) => {
      if (!profile || !activeJob) return;
      const candidate = candidates.find((c) => c.raw.reference === reference);
      const open = candidate?.openAnswer;
      if (!candidate || !open) return;
      const draft = candidate.editedValue ?? "";
      const requirements = extractJobRequirements(activeJob);
      const companyFacts = companyFactsFrom(activeJob);
      const careerFacts = careerFactsFrom(profile.careerPreferences);
      const allFacts = [...profile.internships, ...profile.projects, ...profile.campus].flatMap((e, i) =>
        buildFactContext(`exp-${i}`, "经历", e).facts,
      );
      const personalFacts = selectAnswerFacts(open.intent, requirements, allFacts);
      const length = open.lengthConstraint ?? {
        maxLength: candidate.raw.context.maxLength,
        targetCharacters: candidate.raw.context.maxLength ?? 300,
      };
      const validation = validateAnswer(draft, personalFacts, companyFacts, careerFacts, length);
      const blocked = validation.overall === "fail";
      setCandidates((prev) =>
        prev.map((c) =>
          c.raw.reference === reference && c.openAnswer
            ? {
                ...c,
                status: blocked ? "unknown" : "need-confirm",
                openAnswer: { ...c.openAnswer, status: "generated", validation },
              }
            : c,
        ),
      );
      if (!blocked && sessionRef.current) {
        await saveAnswerToSession(sessionRef.current, {
          question: open.question,
          intent: open.intent,
          answer: draft,
          validationStatus: validation.overall,
          usedFactIds: open.usedPersonalFactIds ?? [],
          maxLength: length.maxLength,
          manualEdited: true,
          createdAt: new Date().toISOString(),
        });
      }
    },
    [profile, activeJob, candidates],
  );

  /* ---------------- 岗位方向 ---------------- */

  const handleOverrideProfile = useCallback(
    async (type: ProfileType | null) => {
      await setProfileOverride(type);
      logger.event(LogEvent.PREVIEW_OVERRIDE, type ? `manual_override=${type}` : "manual_override=cleared");
      if (!profile) return;

      // 方向变了 → 资料库跟着走；清除 override 时回到路由出来的方向
      const direction = type ?? routing?.primaryProfile ?? "general";
      const storeNow = await loadStore();
      const chosen = selectLibraryForDirection(storeNow, direction);
      if (chosen.id !== storeNow.activeLibraryId) await switchLibrary(chosen.id);
      const profNow = assembleProfile(storeNow.shared, chosen.content);

      setCandidates((prev) =>
        prev.map((c) => {
          const idValid = isCanonicalFieldId(c.match.fieldId);
          if (!idValid) return c;
          const fresh = resolveValue(c.match.fieldId, profNow, {
            entryIndex: c.entryIndex,
            maxLength: c.raw.context.maxLength,
            profileType: direction,
          });
          const riskLike = { risk: c.risk, reason: c.riskReason } as RiskAssessment;
          const derived = deriveStatus(c.raw, c.match, riskLike, idValid, fresh);
          return {
            ...c,
            value: fresh ?? undefined,
            status: derived.status,
            riskReason: derived.riskReason ?? c.riskReason,
            editedValue: undefined,
            // 内容来源变了 → 之前的确认作废，必须重看一遍
            confirmed: false,
          };
        }),
      );
    },
    [profile, routing, switchLibrary],
  );

  const handleManualSelect = useCallback(
    async (type: ProfileType) => {
      await rememberJob(makeManualJobContext(type));
      // 手动指定方向时也把资料库切到对应库
      const storeNow = await loadStore();
      const chosen = selectLibraryForDirection(storeNow, type);
      if (chosen.id !== storeNow.activeLibraryId) await switchLibrary(chosen.id);
    },
    [switchLibrary],
  );

  const handleSelectJob = useCallback(async (jobId: string) => {
    await setActiveJob(jobId);
  }, []);

  const handleClearJob = useCallback(async () => {
    await clearActiveJob();
  }, []);

  /* ---------------- 写入层 ---------------- */

  /**
   * 唯一正式写入口（writeConfirmedPlan 语义）：
   * 先经 buildFillPlan 生成 ConfirmedFillPlan（confirmed 过滤 + MANUAL_ONLY 拦截），
   * 再把整个 plan 发给 content 侧 Writer——content 侧还有第二道运行时门禁。
   * Safety 不变量：本函数只允许被「用户点击确认填写」之后的流程调用；
   * Scan / handleRecognize 绝不允许调用（见 docs/SAFETY_FLOW_AUDIT.md）。
   */
  const writeFields = useCallback(
    async (targets: CandidateField[], effType: ProfileType, jobId: string | null) => {
      const plan = buildFillPlan(targets, jobId, effType);
      // 运行时门禁：plan 必须经过用户确认且非空（正常路径由 buildFillPlan 保证）
      if (plan.confirmed !== true || plan.fields.length === 0) {
        throw new Error("写入被拒绝：没有已填写的字段");
      }
      await trace("FILL_PLAN_CREATE", "success", `approved=${plan.fields.length}`, {
        approved: plan.fields.length,
      });
      // 经 Background 按 frame 分发：目标标签页与 frame 都由 Background 统一解析
      // （面板自己也可能占一个 tab，这里若拿 active tab 会指错页面）
      const res = (await chrome.runtime.sendMessage({
        type: "FILL_TARGET",
        plan: { confirmed: plan.confirmed, fields: plan.fields },
      })) as FillFieldsResult;
      if (!res?.ok) throw new Error(res?.error || "写入请求失败");
      return { plan, outcomes: res.outcomes, originals: res.originals };
    },
    [],
  );

  /**
   * 执行已经匹配到资料的字段。
   * 当前产品策略：REVIEW / 中低置信度不再要求逐项确认；能稳定定位且有内容的字段直接写入。
   * MANUAL_ONLY、unknown、空内容和不支持控件仍由 buildFillPlan / Writer 拦截。
   */
  const applyFill = useCallback(
    async (targets: CandidateField[], sourceCandidates: CandidateField[]) => {
      setPreviewRevealed(true);
      setPhase("filling");
      setError("");
      setNotice("");
      try {
        if (targets.length === 0) throw new Error("没有可填写的字段");
        const confirmedTargets = targets.map((c) => ({ ...c, confirmed: true }));
        const { plan, outcomes: fillOutcomes, originals: newOriginals } = await writeFields(
          confirmedTargets,
          effectiveType,
          activeJob?.id ?? null,
        );
        if (plan.fields.length === 0) throw new Error("没有可填写的字段");
        const outcomeMap = new Map(fillOutcomes.map((o) => [`${o.frameId ?? 0}|${o.reference}`, o]));
        setCandidates((prev) =>
          prev.map((c) => {
            const outcome = outcomeMap.get(`${c.raw.frameId ?? 0}|${c.raw.reference}`);
            if (!outcome) return c;
            return { ...c, status: outcome.status === "filled" ? "filled" : "failed", confirmed: false, fillDetail: outcome.detail };
          }),
        );
        const summary = summarizeFillOutcome(plan, fillOutcomes, sourceCandidates);
        setFillSummary(summary);
        setOriginals((prev) => [...prev, ...newOriginals]);
        setPhase("done");
        setShowSubmitPrompt(true);
        if (sessionV2IdRef.current) {
          void updateSessionV2(sessionV2IdRef.current, {
            status: "filled",
            fillPlanSummary: `${summary.filled}/${summary.filled + summary.failed} 字段`,
          });
          if (activeJob) {
            void appendEvent({
              jobId: activeJob.id,
              type: "FORM_FILLED",
              timestamp: new Date().toISOString(),
              metadata: {},
            });
          }
        }
        const failedRefs = fillOutcomes.filter((o) => o.status === "failed");
        await trace(
          "FIELD_WRITE",
          failedRefs.length > 0 ? "failed" : "success",
          `success=${summary.filled} failed=${summary.failed}`,
          { success: summary.filled, failed: summary.failed },
        );
        logger.event(LogEvent.FILL_SUCCESS, `填写完成 成功${summary.filled} 失败${summary.failed}`);
        return true;
      } catch (err) {
        setError(`填写失败：${err instanceof Error ? err.message : String(err)}`);
        setPhase("ready");
        return false;
      }
    },
    [activeJob, effectiveType, writeFields],
  );

  /* ---------------- 主流程：识别 ---------------- */

  const markStep = useCallback((key: string, state: Step["state"], detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, state, detail: detail ?? s.detail } : s)));
  }, []);

  /** 尝试把当前页当 JD 页捕获；抓不到就返回 null（不报错、不写脏数据） */
  const tryCaptureJob = useCallback(async (): Promise<JobContext | null> => {
    try {
      const res = (await chrome.runtime.sendMessage({ type: "CAPTURE_TARGET" })) as {
        ok: boolean;
        raw?: unknown;
        error?: string;
      };
      if (!res?.ok || !res.raw) return null;
      const job = await jobParser.parse(res.raw as Parameters<RuleBasedJobParser["parse"]>[0]);
      // 岗位名就是这个记录的身份证：抓不到岗位名的页面（点「投递」后展开的申请子页、列表页、
      // 登录面板）不许新建或覆盖岗位，否则真机 Lever 上「Spotify · Android Engineer - Experience」
      // 会被 `/apply` 页的一次再识别改成「未识别岗位」（jd 里带职位描述，长度守卫拦不住）。
      if (job.position === "未识别岗位") return null;
      // Safety Flow 补充守卫：表单页可能解析出「校招申请表」这类伪岗位（jd 超长但无 JD 正文标记）。
      // 真实 JD 页必有岗位职责/任职要求类标记——没有标记的一律不捕获（防止 autoCaptureJob 覆盖真岗位）。
      if (!/(岗位职责|任职要求|职位描述|工作职责|工作内容|responsibilities|requirements|job description)/i.test(job.jd)) {
        return null;
      }
      await rememberJob(job);
      const upsert = await upsertJobFromContext(job);
      await appendEvent({
        jobId: upsert.record.id,
        type: upsert.reused ? "JOB_UPDATED" : "JOB_CAPTURED",
        timestamp: new Date().toISOString(),
        metadata: { company: upsert.record.company ?? "", position: upsert.record.position ?? "" },
      });
      setInboxRefresh((n) => n + 1);
      await trace("JOB_CAPTURE", "success", `${job.company || "?"} ${job.position} → ${job.jobType}`, {
        jobType: job.jobType,
        jdLength: job.jd.length,
      });
      return job;
    } catch {
      return null;
    }
  }, []);

  const handleRecognize = useCallback(async () => {
    if (!profile) return;
    setPhase("recognizing");
    setError("");
    setNotice("");
    setFillSummary(null);
    setMutated(false);
    setUndone(false);
    setShowSubmitPrompt(false);
    setSteps(RECOGNIZE_STEPS.map((s) => ({ ...s, state: "pending" as const })));
    if (!getTraceId()) startTrace();

    try {
      /* ① 页面 */
      markStep("page", "running");
      const ensure = (await chrome.runtime.sendMessage({
        type: "ENSURE_CONTENT_SCRIPT",
      })) as EnsureContentScriptResult;
      if (!ensure?.ok) {
        markStep("page", "failed");
        setError(
          ensure?.error === "unsupported-url"
            ? "当前页面不是网页（http / https），无法识别表单。请打开招聘网站的表单页后重试。"
            : `无法连接页面：${ensure?.detail || ensure?.error || "未知错误"}`,
        );
        setPhase("idle");
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("找不到活动标签页");
      setUrl(ensure.url ?? "");
      // 站点记忆按**这一次实际连上的那个 host**取规则：不能用上一次的 url state
      // （同一面板里从 A 站切到 B 站时它是旧的，套错站的规则就是把上家公司的判断
      //  塞进这一家的表单 —— 那正是「填错」而不是「没填」）
      const hostNow = hostFromUrl(ensure.url);
      const rulesNow = rulesForHost(siteMemory, hostNow);
      markStep("page", "done", hostOf(ensure.url) ?? "已连接");

      /* ② 岗位与方向 */
      markStep("job", "running");
      let job = activeJob;
      if (prefs.autoCaptureJob) {
        const captured = await tryCaptureJob();
        if (captured) job = captured;
      }
      let effectiveNow: ProfileType = "general";
      let routingNow: ProfileSelection | null = null;
      if (job) {
        routingNow = routeJob(job, profile);
        effectiveNow = effectiveProfileType(routingNow, profileOverride);
      } else {
        markStep("job", "skipped", "没读到岗位，用通用版本");
      }

      /* ②.5 按方向选资料库：方向 → 库，顺便把「当前资料库」切过去 */
      const storeNow = await loadStore();
      const chosenLib = selectLibraryForDirection(storeNow, effectiveNow);
      if (chosenLib.id !== storeNow.activeLibraryId) {
        await switchLibrary(chosenLib.id);
        await trace("LIBRARY_SWITCH", "success", `direction=${effectiveNow} → ${chosenLib.name}`, {
          direction: effectiveNow,
        });
      }
      const profNow = assembleProfile(storeNow.shared, chosenLib.content);

      if (job) {
        // 用选定库的经历重新算一次推荐（recommendedExperienceIds 取决于库内配了哪些方向变体）
        routingNow = routeJob(job, profNow);
        setRouting(routingNow);
        await trace("PROFILE_ROUTE", "success", `${routingNow.primaryProfile} effective=${effectiveNow}`, {
          routed: routingNow.primaryProfile,
          effective: effectiveNow,
          confidence: routingNow.routingConfidence,
          override: profileOverride ?? "none",
        });
      } else {
        setRouting(null);
      }
      markStep(
        "job",
        "done",
        `${profileTypeLabel(effectiveNow)} · 资料库「${chosenLib.name}」`,
      );

      /* ③ 表单字段 */
      markStep("scan", "running");
      const res = (await chrome.runtime.sendMessage({ type: "SCAN_TARGET" })) as ScanPageResult;
      if (!res?.ok || !res.fields) {
        markStep("scan", "failed");
        setError(`识别失败：${res?.error ?? "未知错误"}`);
        setPhase("idle");
        return;
      }
      logger.event(LogEvent.SCAN_START, `识别到 ${res.fields.length} 个字段`);
      markStep("scan", "done", `${res.fields.length} 个字段`);

      /* Session（Stage 5）：创建/复用 + Resume 提示 */
      if (job) {
        const open = await getLatestOpenSession(job.id);
        if (open) {
          sessionV2IdRef.current = open.sessionId;
          setResumeInfo({ sessionId: open.sessionId, detectedFields: open.detectedFields });
          await updateSessionV2(open.sessionId, { status: "scanned", detectedFields: res.fields.length });
        } else {
          const created = await createSessionV2({
            jobId: job.id,
            jobContextId: job.id,
            effectiveProfileType: effectiveNow,
            sourceUrl: job.sourceUrl,
            traceId: getTraceId(),
          });
          sessionV2IdRef.current = created.sessionId;
          setResumeInfo(null);
          await updateSessionV2(created.sessionId, { detectedFields: res.fields.length });
          await appendEvent({
            jobId: job.id,
            sessionId: created.sessionId,
            type: "SESSION_CREATED",
            timestamp: new Date().toISOString(),
            metadata: {},
          });
        }
      }

      let restoredSessionAnswers: import("../answering/types").AnswerSnapshot[] = [];
      if (job) {
        const existing = await getLatestSessionForJob(job.id);
        if (existing) {
          sessionRef.current = existing.sessionId;
          restoredSessionAnswers = existing.answers;
        } else {
          const created = await createSession(job.id, effectiveNow);
          sessionRef.current = created.sessionId;
        }
      }

      /* ④ 匹配资料 */
      markStep("match", "running");
      const scanned = runScanPipeline(res.fields, profNow, { profileType: effectiveNow, siteRules: rulesNow }).map((c) => {
        if (!c.openAnswer || !job) return c;
        const hit = restoredSessionAnswers.find((a) => a.question === c.openAnswer!.question && a.answer);
        if (!hit) return c;
        const companyFacts = companyFactsFrom(job);
        const careerFacts = careerFactsFrom(profNow.careerPreferences);
        const allFacts = [...profNow.internships, ...profNow.projects, ...profNow.campus].flatMap((e, i) =>
          buildFactContext(`exp-${i}`, "经历", e).facts,
        );
        const validation = validateAnswer(
          hit.answer,
          allFacts,
          companyFacts,
          careerFacts,
          c.openAnswer.lengthConstraint ?? {
            maxLength: c.raw.context.maxLength,
            targetCharacters: c.raw.context.maxLength ?? 300,
          },
        );
        const blocked = validation.overall === "fail";
        return {
          ...c,
          status: blocked ? ("unknown" as const) : ("need-confirm" as const),
          editedValue: blocked ? undefined : hit.answer,
          value: blocked
            ? undefined
            : {
                fieldId: "open.question",
                value: hit.answer,
                variant: "plain" as const,
                editable: true,
                sourceType: "ai_grounded" as const,
              },
          openAnswer: { ...c.openAnswer, status: "generated" as const, answer: hit.answer, validation },
        };
      });

      // 用户已选择自动填写所有有内容的匹配字段；MANUAL_ONLY / unknown 仍不进入计划，
      // 低置信（low-confidence）现在也不静默填 —— 等人在卡片上点一次「确认要填这一项」。
      const withConfirm = scanned.map((c) => (isSafeFillable(c) ? { ...c, confirmed: true } : c));
      setCandidates(withConfirm);
      const autoTargets = withConfirm.filter(isSafeFillable);
      const awaitingNow = withConfirm.filter((c) => c.status === "low-confidence").length;
      const siteSkipped = withConfirm.filter((c) => !!c.siteRule).length;
      markStep(
        "match",
        "done",
        `已识别 ${res.fields.length} 个字段，其中 ${autoTargets.length} 项可直接填写` +
          (awaitingNow ? `，${awaitingNow} 项要你核对` : ""),
      );
      await trace("PREVIEW_READY", "success", `${res.fields.length} fields profileType=${effectiveNow}`, {
        profileType: effectiveNow,
      });

      if (autoTargets.length > 0 && prefs.autoFill) {
        await applyFill(autoTargets, withConfirm);
        if (awaitingNow > 0) {
          setNotice(
            `另有 ${awaitingNow} 项识别把握不足，扩展没有替你填 —— 在清单里核对后点「核对过了，确认要填这一项」。`,
          );
        }
      } else if (autoTargets.length > 0) {
        // 用户关掉了自动填写：先把清单摊开，勾选后由「确认并填写」写入
        setPreviewRevealed(true);
        setNotice(
          `已识别 ${res.fields.length} 个字段，其中 ${autoTargets.length} 项可填写。勾选后点「确认并填写」。` +
            (awaitingNow ? ` 另有 ${awaitingNow} 项把握不足，需要你核对。` : ""),
        );
        setPhase("ready");
      } else {
        setPreviewRevealed(awaitingNow > 0 || siteSkipped > 0);
        setNotice(
          res.fields.length === 0
            ? "这个页面没有需要填写的表单字段。岗位已经记录，进入网申页后再点「开始识别」。"
            : awaitingNow > 0
              ? `已识别 ${res.fields.length} 个字段，${awaitingNow} 项把握不足需要你核对后再填 —— 其余没有匹配到资料的可填写项，扩展不猜。`
              : `已识别 ${res.fields.length} 个字段，暂无匹配到资料的可填写项。`,
        );
        setPhase("ready");
      }
    } catch (err) {
      setError(`识别失败：${err instanceof Error ? err.message : String(err)}（请刷新页面后重试）`);
      setPhase("idle");
    }
  }, [activeJob, applyFill, markStep, prefs.autoCaptureJob, prefs.autoFill, profile, profileOverride, siteMemory, switchLibrary, tryCaptureJob]);

  /* ---------------- 主流程：填写剩余已确认项 ---------------- */

  const handleFillConfirmed = useCallback(async () => {
    setShowConfirm(false);
    await applyFill(confirmTargets, candidates);
  }, [applyFill, candidates, confirmTargets]);

  const handleUndo = useCallback(async () => {
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "UNDO_TARGET",
        originals,
      })) as UndoResult;
      if (res?.ok) {
        setCandidates((prev) =>
          prev.map((c) =>
            c.status === "filled" || c.status === "failed"
              ? { ...c, status: "ready", confirmed: false }
              : c,
          ),
        );
        setFillSummary(null);
        setOriginals([]);
        setUndone(true);
        setNotice(
          res.failed > 0
            ? `已撤销本次填写，恢复 ${res.restored} 个字段；${res.failed} 个字段页面没有交还控制权，请在网页上手动清空。`
            : `已撤销本次填写，恢复 ${res.restored} 个字段。`,
        );
        logger.event(LogEvent.UNDO_SUCCESS, `撤销完成 恢复${res.restored} 失败${res.failed}`);
      }
    } catch (err) {
      setError(`撤销失败：${String(err)}`);
    }
  }, [originals]);

  const handleMarkSubmitted = useCallback(async () => {
    if (!activeJob) return;
    await setWsJobStatus(activeJob.id, "submitted");
    await appendEvent({
      jobId: activeJob.id,
      type: "JOB_SUBMITTED",
      timestamp: new Date().toISOString(),
      metadata: { sourceUrl: activeJob.sourceUrl },
    });
    if (sessionV2IdRef.current) await updateSessionV2(sessionV2IdRef.current, { status: "completed" });
    setShowSubmitPrompt(false);
    setInboxRefresh((n) => n + 1);
    setNotice("已标记为已投递。");
  }, [activeJob]);

  const handleStartNewSession = useCallback(async () => {
    if (!activeJob || !effectiveType) return;
    const created = await createSessionV2({
      jobId: activeJob.id,
      jobContextId: activeJob.id,
      effectiveProfileType: effectiveType,
      sourceUrl: activeJob.sourceUrl,
      traceId: getTraceId(),
    });
    sessionV2IdRef.current = created.sessionId;
    setResumeInfo(null);
  }, [activeJob, effectiveType]);

  const handleContinueSession = useCallback(async () => {
    if (resumeInfo) {
      sessionV2IdRef.current = resumeInfo.sessionId;
      await updateSessionV2(resumeInfo.sessionId, { status: "reviewing" });
      await appendEvent({
        jobId: activeJob?.id ?? "",
        sessionId: resumeInfo.sessionId,
        type: "SESSION_RESUMED",
        timestamp: new Date().toISOString(),
        metadata: {},
      });
      setResumeInfo(null);
    }
  }, [resumeInfo, activeJob]);

  /* ---------------- 字段级操作 ---------------- */

  const toggleConfirm = (reference: string) =>
    setCandidates((prev) =>
      prev.map((c) => (c.raw.reference === reference ? { ...c, confirmed: !c.confirmed } : c)),
    );

  const confirmAllConfirmable = () =>
    setCandidates((prev) => prev.map((c) => (isConfirmable(c) ? { ...c, confirmed: true } : c)));

  const editValue = (reference: string, value: string) =>
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.raw.reference !== reference) return c;
        const base = {
          ...c,
          // 已经填过的字段被用户改了值 → 回到「待填写」，让它重新进入填写计划；
          // 否则用户改完发现没有任何入口把新值写进页面。
          status: c.status === "filled" ? ("need-confirm" as const) : c.status,
        };
        if (c.openAnswer && c.openAnswer.status === "generated") {
          return { ...base, editedValue: value, openAnswer: { ...c.openAnswer, status: "edited" as const } };
        }
        return { ...base, editedValue: value };
      }),
    );

  const changeVariant = (reference: string, variant: "short" | "medium" | "long") =>
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.raw.reference !== reference || !c.value || !profile) return c;
        const fresh = resolveValue(c.match.fieldId, profile, {
          maxLength: c.raw.context.maxLength,
          entryIndex: c.entryIndex ?? c.value.entryIndex,
          variantOverride: variant,
          profileType: effectiveType,
        });
        return fresh ? { ...c, value: fresh, editedValue: undefined } : c;
      }),
    );

  const ignore = (reference: string) =>
    setCandidates((prev) =>
      prev.map((c) =>
        c.raw.reference === reference ? { ...c, preIgnoreStatus: c.status, status: "ignored", confirmed: false } : c,
      ),
    );

  /** 撤销跳过：回到跳过前的状态。点错一下不该逼用户重扫整页。 */
  const unignore = (reference: string) =>
    setCandidates((prev) =>
      prev.map((c) =>
        c.raw.reference === reference && c.status === "ignored"
          ? { ...c, status: c.preIgnoreStatus ?? "unknown", preIgnoreStatus: undefined }
          : c,
      ),
    );

  /**
   * 重新判定一个字段（人工改挂 / 撤销站点设定之后用）。
   * 走的是和扫描完全一样的口径：assessRisk → resolveValue → deriveStatus，
   * 所以人工改挂之后仍然可能被红线或控件格式拦下 —— 不会出现
   * 「界面上说是 SAFE，写进去却绕过了门禁」。多条目序号（第几段经历）保留，
   * 否则改一栏会把「实习经历 2」的内容填成「实习经历 1」。
   */
  const rejudgeCandidate = useCallback(
    (c: CandidateField, fieldId: string): CandidateField => {
      if (!profile) return c;
      const match: CandidateField["match"] = { ...c.match, fieldId };
      const risk = assessRisk(fieldId, {
        labelText: c.raw.context.labelText,
        ariaLabel: c.raw.context.ariaLabel,
        placeholder: c.raw.context.placeholder,
        title: c.raw.context.title,
        fieldsetLabel: c.raw.context.fieldsetLabel,
        sectionTitle: c.raw.context.sectionTitle,
      });
      const value =
        risk.risk === "MANUAL_ONLY"
          ? undefined
          : resolveValue(fieldId, profile, {
              entryIndex: c.entryIndex ?? c.value?.entryIndex,
              maxLength: c.raw.context.maxLength,
              profileType: effectiveType,
            });
      const derived = deriveStatus(c.raw, match, risk, isCanonicalFieldId(fieldId), value);
      return {
        ...c,
        match,
        risk: risk.risk,
        riskReason: derived.riskReason ?? risk.reason,
        value: value ?? undefined,
        status: derived.status,
        editedValue: undefined,
        confirmed: false,
      };
    },
    [effectiveType, profile],
  );

  /**
   * 把这一项改挂到次选资料字段上（低置信字段的人工纠正出路），
   * 并在知道 host 时把它**沉淀成站点设定** —— 同一家招聘站下次不用再改一遍。
   * 记忆只含 host + 站点自己给控件写的文字 + canonical 字段 id，不含任何资料值（见 siteMemory.ts）。
   */
  const switchMatchedField = (reference: string, fieldId: string) => {
    if (!profile || !isCanonicalFieldId(fieldId)) return;
    const target = candidates.find((c) => c.raw.reference === reference);
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.raw.reference !== reference) return c;
        const next = rejudgeCandidate(c, fieldId);
        return { ...next, siteRule: siteHost ? { ruleId: `pending_${reference}`, host: siteHost, kind: "map" as const } : undefined };
      }),
    );
    if (siteHost && target) {
      void addSiteRule({ host: siteHost, ctx: target.raw.context, kind: "map", fieldId }).then(async ({ rule }) => {
        const fresh = await loadSiteMemory();
        setSiteMemory(fresh);
        if (rule) {
          // 把占位 ruleId 换成真实那条，撤销按钮才找得到它
          setCandidates((prev) =>
            prev.map((c) =>
              c.raw.reference === reference && c.siteRule?.kind === "map"
                ? { ...c, siteRule: { ...c.siteRule, ruleId: rule.id, host: rule.host, overriddenFieldId: matchField(c.raw).fieldId } }
                : c,
            ),
          );
          setNotice(`已记住：${rule.host} 上的「${rule.siteLabel || rule.matchKey}」按${fieldFullLabel(fieldId)}填。可在「设置 → 站点设定」里撤销。`);
        } else {
          setNotice("这一栏的归属已经改了，但这一站没能记住（网页没给出可识别的栏名）。下次仍需在清单里确认。");
        }
      });
    }
  };

  /**
   * 低置信字段的人工放行。这里只翻「要不要填」的决定，
   * 写入仍然经过 buildFillPlan（confirmed + 非 MANUAL_ONLY + 语境合格）—— 放行不等于绕行。
   */
  const confirmLowConfidence = (reference: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.raw.reference === reference && c.status === "low-confidence"
          ? { ...c, status: "need-confirm", confirmed: true }
          : c,
      ),
    );
    setPreviewRevealed(true);
  };

  /** 「这一站以后都别填这一项」：写进站点记忆，并把当前这张卡立刻切成跳过 */
  const blockOnSite = async (reference: string) => {
    const target = candidates.find((c) => c.raw.reference === reference);
    if (!target || !siteHost) return;
    const { memory, rule } = await addSiteRule({ host: siteHost, ctx: target.raw.context, kind: "block" });
    setSiteMemory(memory);
    if (!rule) {
      setNotice("这一栏没能在这一站上被唯一识别（网页没给出可记的栏名），所以只跳过了本次。");
      ignore(reference);
      return;
    }
    setCandidates((prev) =>
      prev.map((c) =>
        c.raw.reference === reference
          ? {
              ...c,
              preIgnoreStatus: c.status,
              status: "ignored",
              confirmed: false,
              value: undefined,
              riskReason: `按你在 ${rule.host} 的设定，这一栏以后都不自动填`,
              siteRule: { ruleId: rule.id, host: rule.host, kind: "block" },
            }
          : c,
      ),
    );
    setNotice(`已记住：${rule.host} 上的「${rule.siteLabel || rule.matchKey}」以后都不自动填。可在「设置 → 站点设定」里撤销。`);
  };

  /** 撤销一条站点设定，并把受影响的那几张卡重新判定回自动识别的结果 */
  const undoSiteRule = async (ruleId: string) => {
    const removed = siteMemory.rules.find((r) => r.id === ruleId);
    const next = await removeSiteRule(ruleId);
    setSiteMemory(next);
    if (!removed) return;
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.siteRule?.ruleId !== ruleId) return c;
        const cleared: CandidateField = { ...c, siteRule: undefined };
        const autoId = matchField(c.raw).fieldId;
        const rejudged = rejudgeCandidate(cleared, autoId);
        return { ...rejudged, siteRule: undefined, preIgnoreStatus: undefined };
      }),
    );
    setNotice(`已取消这条站点设定。${removed.kind === "map" ? "这一栏回到自动识别的结果。" : "这一栏下次识别可以正常填写。"}`);
  };

  const locate = async (reference: string) => {
    const target = candidates.find((c) => c.raw.reference === reference);
    try {
      await chrome.runtime.sendMessage({
        type: "LOCATE_TARGET",
        reference,
        frameId: target?.raw.frameId ?? 0,
      });
    } catch {
      // 页面刷新过 / content script 不在：不弹窗打断，提示条里说清楚就好
      setNotice("页面已经变了，无法定位到那个字段。请点「重新识别」再试一次。");
    }
  };

  /* ---------------- 渲染 ---------------- */

  if (!profile) {
    return (
      <div className="app">
        <Header subtitle="正在加载资料…" />
        <main className="main">
          <p className="muted">加载资料中…</p>
        </main>
      </div>
    );
  }

  const anyPending = reviewTargets.length;
  /** 招聘官网的职位详情页常是这个形态：岗位读到了，但表单在「投递」之后（往往还要登录） */
  const noFormHint = activeJob
    ? "这个页面没有网申表单字段（岗位已记录，进入投递页再识别）"
    : "这个页面没有网申表单字段，也没抓到岗位名——在岗位页面识别一次，或直接进投递页再识别";
  /** 识别完成后副标题只说「下一步做什么」，不重复下面的汇总数字 */
  const doneHint =
    anyPending > 0
      ? `还有 ${anyPending} 项需要你确认`
      : filledList.length > 0
        ? fillSummary && fillSummary.manualBlocked > 0
          ? `已填好 ${filledList.length} 项，另有 ${fillSummary.manualBlocked} 项按安全规则留给你本人填写；请核对后自行点击提交`
          : `已填好 ${filledList.length} 项，请核对后自行点击提交`
        : undone
          ? "网页上的内容已撤销，可重新识别"
          : candidates.length === 0
            ? noFormHint
            : "这个页面没有可以自动填写的字段，网页内容未被修改";
  const subtitle =
    tab === "apply"
      ? phase === "idle"
        ? "打开网申页面，点一下「开始识别」"
        : phase === "recognizing"
          ? "识别中…"
          : phase === "done"
            ? doneHint
            : candidates.length === 0
              ? noFormHint
              : `待确认 ${reviewTargets.length} · 已填写 ${filledList.length}`
      : tab === "jobs"
        ? "已捕获的岗位与投递记录"
        : tab === "profile"
          ? "导入和维护你的背景资料"
          : "模型与高级选项";

  const applyView = (
    <main className="main">
      {loadProblem && <div className="banner banner-error">{loadProblem}</div>}
      {error && (
        <div className="banner banner-error">
          {error.split("\n").map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {notice && <div className="banner banner-ok">{notice}</div>}
      {mutated && (
        <div className="banner banner-review">
          页面结构变了，建议重新识别一次。
          <button type="button" className="btn-sm" onClick={() => void handleRecognize()}>
            重新识别
          </button>
        </div>
      )}
      {resumeInfo && (
        <div className="banner banner-review">
          这个岗位有一份没走完的申请（上次识别到 {resumeInfo.detectedFields} 个字段）。
          <button type="button" className="btn-sm" onClick={() => void handleContinueSession()}>
            继续上次
          </button>
          <button type="button" className="btn-sm" onClick={() => void handleStartNewSession()}>
            重新开始
          </button>
        </div>
      )}
      {showSubmitPrompt && filledList.length > 0 && (
        /* 撤销之后 filledList 清空：这条「表单已填写，请自行提交」必须跟着消失，
           否则页面上会同时出现「已撤销本次填写」和「表单已填写」两句互相矛盾的话。 */
        <div className="banner banner-ok">
          表单已填写。请核对后在网站上<strong>自己点击提交</strong>。
          <button type="button" className="btn-sm" onClick={() => void handleMarkSubmitted()}>
            我已完成投递
          </button>
        </div>
      )}

      {phase === "idle" && (
        <section className="hero">
          <h2 className="hero-title">开始识别</h2>
          <p className="hero-desc">
            自动读取当前页面的岗位信息，识别需要填写的字段并匹配你的资料；
            能对应到资料的字段会在识别完成后直接填写，无法匹配或不支持的字段留给人工处理。
          </p>
          {needsProfile && (
            <div className="hero-cta">
              <div className="hero-cta-title">还没有可以填写的资料</div>
              <p className="hero-cta-desc">
                识别能读出这个页面要填什么，但要把内容填进去得先有你的简历。
                粘贴简历文本即可，<strong>完全离线解析，不联网、不上传</strong>。
              </p>
              <button type="button" className="primary" onClick={() => setTab("profile")}>
                导入我的简历
              </button>
            </div>
          )}
          <button
            type="button"
            className={needsProfile ? "hero-btn ghost" : "hero-btn"}
            onClick={() => void handleRecognize()}
            disabled={!profile}
          >
            开始识别
          </button>
          <div className="hero-foot">
            <span className="muted small">扫描不会修改网页内容 · 扩展永远不会点击提交</span>
          </div>
        </section>
      )}

      {phase !== "idle" && (
        <>
          <JobCard
            activeJob={activeJob}
            routing={routing}
            effectiveType={effectiveType}
            profileOverride={profileOverride}
            history={jobHistory}
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onSwitchLibrary={(id) => void switchLibrary(id)}
            onSelect={(id) => void handleSelectJob(id)}
            onClear={() => void handleClearJob()}
            onOverrideProfile={(t) => void handleOverrideProfile(t)}
            onManualSelect={(t) => void handleManualSelect(t)}
          />

          {coverage && coverage.totalExperiences > 0 && effectiveType !== "general" && (
            <p className="hint">
              {profileTypeLabel(effectiveType)}专属表达：{coverage.completedVariants} / {coverage.totalExperiences} 条经历已配置
              {coverage.completedVariants < coverage.totalExperiences ? "（未配置的会退回默认表达）" : ""}
              {coverage.completedVariants < coverage.totalExperiences && (
                <button type="button" className="link-btn" onClick={() => setTab("profile")}>
                  去补写
                </button>
              )}
            </p>
          )}

          <Stepper steps={steps} collapsed={phase === "done" || phase === "ready"} />

          {(phase === "ready" || phase === "filling" || phase === "done") && (
            <>
              <section className="summary">
                <div className="summary-grid">
                  <div className="summary-cell">
                    <div className="summary-num num-ok">
                      {phase === "done" ? filledList.length : safeCount}
                    </div>
                    <div className="summary-label">{phase === "done" ? "已填写" : "可直接填写"}</div>
                  </div>
                  <div className="summary-cell">
                    <div className="summary-num num-review">{anyPending}</div>
                    <div className="summary-label">待你确认</div>
                  </div>
                  <div className="summary-cell">
                    <div className="summary-num num-manual">{manualList.length + noContentList.length}</div>
                    <div className="summary-label">需人工处理</div>
                  </div>
                  {failedList.length > 0 && (
                    <div className="summary-cell">
                      <div className="summary-num num-manual">{failedList.length}</div>
                      <div className="summary-label">填写失败</div>
                    </div>
                  )}
                </div>

                <div className="summary-actions">
                  {/* 重识别 / 撤销是「出问题时才用」的次要动作：降成文字链，让主操作只有一个 */}
                  <button type="button" className="link-btn" onClick={() => void handleRecognize()} disabled={phase === "filling"}>
                    重新识别
                  </button>
                  {originals.length > 0 && (
                    <button type="button" className="link-btn" onClick={() => void handleUndo()}>
                      撤销本次填写
                    </button>
                  )}
                  <span className="spacer" />
                  {phase === "ready" && !previewRevealed && candidates.length > 0 ? (
                    /* 没有自动匹配字段时，仍可打开预览查看识别结果 */
                    <button type="button" className="primary" onClick={() => setPreviewRevealed(true)}>
                      查看填写预览
                    </button>
                  ) : (
                    <>
                      {(() => {
                        /* 批量确认只覆盖「证据够」的那批：低置信项必须一项一点头，
                           不然这个按钮就把本轮刚装的「低置信不静默填」又绕回去了。 */
                        const bulk = candidates.filter((c) => isConfirmable(c) && !c.confirmed).length;
                        if (bulk === 0) return null;
                        return (
                          <button type="button" className="btn-sm" onClick={confirmAllConfirmable}>
                            全部确认可直接填的（{bulk}）
                          </button>
                        );
                      })()}
                      {(phase === "done" || candidates.length === 0) && pendingToFill.length === 0 ? (
                        /* 填完之后的主操作必须是「下一步」，不是一个灰掉的「没有可填写的项」 */
                        <button type="button" className="primary" onClick={() => setTab("jobs")}>
                          投递下一个岗位
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary"
                          disabled={pendingToFill.length === 0 || phase === "filling"}
                          onClick={() => {
                            setConfirmTargets(pendingToFill);
                            setShowConfirm(true);
                          }}
                        >
                          {confirmable.length > 0
                            ? `填写确认的 ${confirmable.length} 项`
                            : pendingToFill.length > 0
                              ? `确认并填写 ${pendingToFill.length} 项`
                              : "没有可填写的项"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>

              {prefs.showDev && url && (
                <div className="url-line">
                  当前页面：<a href={url} target="_blank" rel="noreferrer">{url}</a>
                </div>
              )}

              {(() => {
                /* 空状态的出路：识别到了字段但资料库里没有内容时，光说「暂无可填项」等于把问题丢回给用户。
                   这里列出**具体缺哪几栏**并给一个跳转 —— 缺的是客观资料，补一次以后每次投递都能用。 */
                const missing = candidates.filter((c) => c.status === "empty" && isCanonicalFieldId(c.match.fieldId));
                if (missing.length === 0) return null;
                const names = Array.from(new Set(missing.map((c) => fieldFullLabel(c.match.fieldId))));
                return (
                  <div className="banner banner-review" data-missing-count={missing.length}>
                    这个页面有 {missing.length} 栏你资料库里还没有内容：{names.slice(0, 6).join("、")}
                    {names.length > 6 ? ` 等 ${names.length} 项` : ""}。
                    <button type="button" className="btn-sm" onClick={() => setTab("profile")}>
                      去补这几项
                    </button>
                  </div>
                );
              })()}

              {previewRevealed && (
                <FieldList
                candidates={candidates}
                devMode={prefs.showDev}
                onToggleConfirm={toggleConfirm}
                onEditValue={editValue}
                onVariantChange={changeVariant}
                onIgnore={ignore}
                onUnignore={unignore}
                onSwitchField={switchMatchedField}
                onConfirmLowConfidence={confirmLowConfidence}
                onBlockOnSite={(r) => void blockOnSite(r)}
                onUndoSiteRule={(id) => void undoSiteRule(id)}
                siteHost={siteHost ?? undefined}
                onLocate={(r) => void locate(r)}
                onGenerateAnswer={(r) => void handleGenerateAnswer(r)}
                onRevalidateAnswer={(r) => void handleRevalidateAnswer(r)}
                />
              )}

              {phase === "done" && (
                <FillReceipt
                  candidates={candidates}
                  onLocate={(r) => void locate(r)}
                  onUnignore={unignore}
                  onConfirmLowConfidence={confirmLowConfidence}
                  onUndoSiteRule={(id) => void undoSiteRule(id)}
                />
              )}
            </>
          )}
        </>
      )}
    </main>
  );

  const jobsView = detailJobId ? (
    <JobWorkspace
      jobId={detailJobId}
      onBack={() => setDetailJobId(null)}
      onStartApplication={async (jobId) => {
        await setWsActiveJob(jobId);
        await refreshJobs();
        setDetailJobId(null);
        setTab("apply");
      }}
      onChanged={() => setInboxRefresh((n) => n + 1)}
    />
  ) : (
    <JobInbox
      refreshKey={inboxRefresh}
      onOpenJob={(jobId) => {
        setDetailJobId(jobId);
      }}
    />
  );

  const profileView = (
    <ProfileEditor
      // 换库时重挂载，避免把上一个库的草稿写进新库
      key={activeLibraryId}
      profile={profile}
      onPersist={persist}
      onBack={() => setTab("apply")}
      activeJob={activeJob}
      effectiveType={effectiveType}
      libraries={libraries}
      activeLibraryId={activeLibraryId}
      onSwitchLibrary={(id) => void switchLibrary(id)}
      onCreateLibrary={(input) => void createLibrary(input)}
      onUpdateLibrary={(id, patch) => void updateLibrary(id, patch)}
      onDeleteLibrary={(id) => void deleteLibrary(id)}
      libraryName={activeLibrary?.name ?? "默认资料库"}
    />
  );

  const settingsView = (
    <main className="main">
      <section className="card">
        <h3 className="card-title">填写行为</h3>
        <p className="hint">
          识别完成后，资料库里已有内容、而且识别证据足够的字段会直接写入页面，<strong>不需要逐项确认</strong>；
          把握不足（低置信）的那几项<strong>不会静默填写</strong>，会在清单里列出依据等你点头；
          资料库里没有的字段保持空着由你补。承诺 / 声明 / 签名 / 是否调剂这类保证性控件不会代填，
          插件也永远不点提交。误填时可用「撤销本次填写」恢复。
        </p>
        <label className="switch">
          <input
            type="checkbox"
            checked={prefs.autoFill}
            onChange={(e) => updatePrefs({ autoFill: e.target.checked })}
          />
          <span>识别完成后直接填写（推荐）</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={prefs.autoCaptureJob}
            onChange={(e) => updatePrefs({ autoCaptureJob: e.target.checked })}
          />
          <span>识别时自动读取当前页面的岗位 JD</span>
        </label>
      </section>

      <section className="card">
        <h3 className="card-title">站点设定（{siteMemory.rules.length} 条）</h3>
        <p className="hint">
          你在某个招聘站上点过的「这一栏其实是……」和「这一站以后都别填这一项」会记在这里，下次识别直接生效。
          这里只存<strong>站点自己写的栏名</strong>和你的判断，不存你的资料内容，也不存任何登录凭据；
          换一台浏览器或清掉本机数据就会重新开始。
        </p>
        {siteMemory.rules.length === 0 ? (
          <p className="muted small">还没有站点设定。在识别清单里点「这一站以后都别填」或「改用这一项」就会新增一条。</p>
        ) : (
          <ul className="site-rule-list">
            {siteMemory.rules.map((r) => (
              <li key={r.id} className="site-rule-row" data-kind={r.kind}>
                <span className="site-rule-text">{describeRule(r, fieldFullLabel)}</span>
                <button type="button" className="link-btn" onClick={() => void undoSiteRule(r.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">本机存储</h3>
        {!storageUsage || !storageUsage.available ? (
          <p className="muted small">读不到存储用量（这里显示的是真实读数，不拿 0 冒充「没占用」）。</p>
        ) : (
          <>
            <p className="hint" data-storage-ratio={storageUsage.ratio.toFixed(3)}>
              已用 {formatBytes(storageUsage.totalBytes)} / {formatBytes(storageUsage.quotaBytes)}（
              {(storageUsage.ratio * 100).toFixed(1)}%）。全部只存在这台浏览器的本地，扩展不上传任何东西。
              {storageUsage.warn && (
                <strong className="meta-warn"> 空间接近上限：保存可能失败，请清理岗位记录或在「资料」页导出后留底。</strong>
              )}
            </p>
            <ul className="storage-list">
              {storageUsage.keys.slice(0, 6).map((k) => (
                <li key={k.key}>
                  <span className="storage-key">{k.key}</span>
                  <span className="storage-bytes">{formatBytes(k.bytes)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">AI 模型（生成岗位方向表达与开放题回答）</h3>
        <p className="muted small">
          默认「离线（不联网）」：开放题的回答由你资料库里的条目拼装。
          选 DeepSeek 或 OpenAI 兼容并填入 Base URL + Key 之后才会调用模型；Key 只存这台机器。
        </p>
        <ProviderSettingsForm />
      </section>

      <section className="card">
        <h3 className="card-title">开发者</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={prefs.showDev}
            onChange={(e) => updatePrefs({ showDev: e.target.checked })}
          />
          <span>显示执行轨迹与字段调试信息</span>
        </label>
        <TraceViewer devMode={prefs.showDev} />
      </section>
    </main>
  );

  return (
    <div className="app">
      <Header subtitle={subtitle} />
      {tab === "apply" && applyView}
      {tab === "jobs" && jobsView}
      {tab === "profile" && profileView}
      {tab === "settings" && settingsView}
      <TabBar tab={tab} onChange={setTab} badge={anyPending} />

      {showConfirm && (
        <FillConfirmDialog
          candidates={[
            ...confirmTargets.map((c) => ({ ...c, confirmed: true })),
            ...candidates.filter((c) => c.status === "manual"),
          ]}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => void handleFillConfirmed()}
        />
      )}
    </div>
  );
}
