/**
 * Real Write Pilot — 姚记（zhaopin.yaoji.cn，自建 ATS）
 *
 * 模式：REAL_WRITE_NO_SUBMIT —— 真实 DOM 写入 + 逐字段验证 + 撤销恢复，绝不提交。
 *
 * 安全红线（real-validation-results/pilot-log.md 头部）：
 * - 永不点击 提交 / 立即投递 / 确认申请 / 发送申请（safeClick 硬守卫，命中即 throw）
 * - 「投递简历」是展开申请表单的入口，按批次规格 §八 显式放行，不等于提交
 * - 高风险字段（radio）保持 MANUAL ONLY，不为其实现自动化
 * - 语义映射门禁：Preview 中任一 label→fieldId 映射不符预期 → 立即退出，禁止 Fill
 * - False Fill ≥ 1 → 立即停止（exit 2）
 * - Scan 只读：以「扫描前 vs 扫描后」两次真实 DOM 快照逐控件比对来证明，不靠单点抽查
 *
 * 值不外流：期望值只在页面内比对，跨进程只回传 len / shape / exact / digits-equal 布尔，
 * 因此报告与截图之外不存在任何值正文（含合成值），见 §十五 / §二十九。
 *
 * 运行：node scripts/yaoji-real-write.mjs [jobUrl]
 * 产物：real-validation-results/sessions/<date>-yaoji-real-write-synthetic-data.json
 *      real-validation-results/sessions/<date>-yaoji-real-write-synthetic-demo.png（公开页，无填写值）
 *      real-validation-results/private/<date>-yaoji-real-write-filled.png（含填写值，gitignored，不入库）
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const url = process.argv[2] ?? "https://zhaopin.yaoji.cn/job/065bf5c4-c421-490e-9b9e-e337d9d6f75f";
const OUT_DIR = path.resolve(__dirname, "../real-validation-results/sessions");
const PRIVATE_DIR = path.resolve(__dirname, "../real-validation-results/private");
const RUN_TAG = `${new Date().toISOString().slice(0, 10)}-yaoji-real-write-synthetic`;

/** §五 统一合成 Pilot Profile（禁止任何真实个人值）。age 未在 §五 列出，沿用合成集 22 */
const TEST_PROFILE = {
  name: "张小明",
  age: "22",
  city: "测试市",
  phone: "15300001122",
  email: "test.resume@example.com",
  wechat: "test_resume_01",
  qq: "100000001",
  portfolio: "https://example.com/portfolio",
  school: "示例科技大学",
  college: "测试学院",
  major: "测试专业",
  eduEnd: "2027.06",
  company: "示例科技有限公司",
  department: "测试部门",
  position: "AI 应用实习生",
  internStart: "2026.06",
  internEnd: "2026.09",
  workContent:
    "负责测试业务流程自动化工具的需求整理、规则配置与验证，用于验证表单识别、内容映射和批量填写流程。",
};

/** §十一 语义映射门禁：Preview 卡片必须出现的 label→canonicalFieldId 对应（不符即停止，禁止 Fill） */
const EXPECTED_MAPPING = [
  { labelPattern: /请输入姓名/, fieldId: "basic.name", risk: "SAFE" },
  { labelPattern: /请输入年龄/, fieldId: "basic.age", risk: "SAFE" },
  { labelPattern: /请输入当前所在城市/, fieldId: "basic.city", risk: "SAFE" },
  { labelPattern: /请输入手机号码/, fieldId: "basic.phone", risk: "SAFE" },
  { labelPattern: /请输入电子邮箱/, fieldId: "basic.email", risk: "SAFE" },
  { labelPattern: /请输入毕业院校/, fieldId: "education.school", risk: "SAFE" },
  // issue-003 修复后：毕业年份是 input[type=number]（默认 step=1），收不下 2027.06，
  // 被约束门禁降为 manual → FieldCard 把 manual 徽章渲染成 MANUAL_ONLY（FieldCard.tsx:210）
  { labelPattern: /如 2022/, fieldId: "education.endDate", risk: "MANUAL_ONLY" },
  { labelPattern: /请输入专业/, fieldId: "education.major", risk: "SAFE" },
  { labelPattern: /请输入公司名称/, fieldId: "internship.company", risk: "SAFE" },
  { labelPattern: /如 2022-01/, fieldId: "internship.startDate", risk: "SAFE" },
  { labelPattern: /如 2024-06/, fieldId: "internship.endDate", risk: "SAFE" },
];

/** §十二 canonicalFieldId → 期望合成值 → 站点真实 label 语义归属（语义匹配 label，不匹配值） */const EXPECTED_WRITE = [
  { fieldId: "basic.name", value: TEST_PROFILE.name, semantic: /姓名/ },
  { fieldId: "basic.age", value: TEST_PROFILE.age, semantic: /年龄/ },
  { fieldId: "basic.city", value: TEST_PROFILE.city, semantic: /城市/ },
  { fieldId: "basic.phone", value: TEST_PROFILE.phone, semantic: /手机/ },
  { fieldId: "basic.email", value: TEST_PROFILE.email, semantic: /邮箱/ },
  { fieldId: "education.school", value: TEST_PROFILE.school, semantic: /(院校|学校)/ },
  { fieldId: "education.major", value: TEST_PROFILE.major, semantic: /专业/ },
  { fieldId: "internship.company", value: TEST_PROFILE.company, semantic: /公司/ },
  { fieldId: "internship.startDate", value: TEST_PROFILE.internStart, semantic: /入职/ },
  { fieldId: "internship.endDate", value: TEST_PROFILE.internEnd, semantic: /离职/ },
];

/**
 * issue-003 约束门禁的反向断言：这些字段有内容、语义也认得对，但目标控件收不下这个值，
 * 必须留在「需人工处理」桶里、一个字节都不写。写进去了 = 门禁失效（P0）。
 */
const EXPECTED_NOT_WRITTEN = [
  { fieldId: "education.endDate", semantic: /毕业(年份|时间)/, reason: "number 控件 stepMismatch 门禁" },
];

const log = (...a) => console.log("[PILOT]", ...a);
function sha(s) {
  return createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
}
function die(msg) {
  console.error("[PILOT][STOP]", msg);
  process.exit(1);
}

/** §二十七 提交守卫：任何点击前校验可点文本，命中提交类即 throw，绝不放行 */
const SUBMIT_LIKE = /(提交|立即投递|确认申请|确认投递|发送申请|^Submit$)/i;
async function safeClick(locator, what, { allowApply = false } = {}) {
  const text = (((await locator.textContent().catch(() => "")) ?? "") + " " + what).trim();
  if (SUBMIT_LIKE.test(text)) die(`§二十七 守卫：拒绝点击提交类按钮「${text}」`);
  if (!allowApply && /投递简历/.test(text)) die("§二十七 守卫：非预期入口点击");
  await locator.click({ force: true });
  return text;
}

/**
 * 读真实表单 DOM。页面内完成与期望值的比对，只回传非敏感结构：
 * len / shape（数字→n、字母→a、汉字→c、其余保留分隔符）/ exact / 数字内容是否相同（格式归一）
 */
async function readFormControls(page) {
  return page.evaluate(
    ({ expected }) => {
      const shapeOf = (s) =>
        s.replace(/[\dA-Za-z一-鿿]/g, (ch) => (/\d/.test(ch) ? "n" : /[A-Za-z]/.test(ch) ? "a" : "c"));
      const labelOf = (el) =>
        el.closest("label")?.textContent?.trim() ||
        el.labels?.[0]?.textContent?.trim() ||
        el.closest("fieldset, .field, .form-item, .el-form-item, div")?.querySelector("label")?.textContent?.trim() ||
        el.placeholder ||
        el.id ||
        el.name ||
        "(未命名)";
      const nodes = Array.from(document.querySelectorAll("input, textarea, select"));
      const rows = nodes.map((el, idx) => {
        const type = el.type || el.tagName.toLowerCase();
        const value = typeof el.value === "string" ? el.value : "";
        const digits = value.replace(/\D/g, "");
        const v = el.validity;
        return {
          idx,
          type,
          label: labelOf(el).replace(/\s+/g, " ").slice(0, 40),
          ph: (el.placeholder || "").slice(0, 24),
          len: value.length,
          shape: shapeOf(value).slice(0, 40),
          checked: Boolean(el.checked),
          selected: type === "select-one" ? el.selectedIndex > 0 : null,
          // 站点自身的约束校验结论——判断写入格式是否被页面接受（只回传布尔，不回传值）
          valid: v ? v.valid : null,
          stepMismatch: v ? v.stepMismatch : null,
          badInput: v ? v.badInput : null,
          tooLong: v ? v.tooLong : null,
          patternMismatch: v ? v.patternMismatch : null,
          exact: expected.map((e) => value !== "" && value === e.value),
          digitsSame: expected.map((e) => value !== "" && digits !== "" && digits === e.digits),
        };
      });
      const extra = {
        radio: Array.from(document.querySelectorAll('input[type="radio"]')).length,
        radioGroups: new Set(Array.from(document.querySelectorAll('input[type="radio"]')).map((r) => r.name || "(unnamed)")).size,
        checkbox: Array.from(document.querySelectorAll('input[type="checkbox"]')).length,
        file: Array.from(document.querySelectorAll('input[type="file"]')).length,
        contenteditable: Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]')).length,
        form: document.querySelectorAll("form").length,
      };
      return { rows, extra };
    },
    { expected: EXPECTED_WRITE.map((e) => ({ value: e.value, digits: e.value.replace(/\D/g, "") })) },
  );
}

/** 单次快照里的「有值控件」清单——人工语义核对（§十一/§二十五）的原始依据 */
function describeFilled(snapshot, stage) {
  return snapshot.rows
    .filter((r) => r.len > 0 && !["radio", "checkbox", "hidden", "submit", "button", "file"].includes(r.type))
    .map((r) => ({
      stage,
      idx: r.idx,
      label: r.label,
      placeholder: r.ph,
      len: r.len,
      shape: r.shape,
      siteValidity: { valid: r.valid, stepMismatch: r.stepMismatch, badInput: r.badInput, tooLong: r.tooLong, patternMismatch: r.patternMismatch },
      matchedFieldIds: EXPECTED_WRITE.filter((_, i) => r.exact[i]).map((e) => e.fieldId),
      digitsOnlyFieldIds: EXPECTED_WRITE.filter((_, i) => r.digitsSame[i] && !r.exact[i]).map((e) => e.fieldId),
    }));
}

function shapeName(value) {
  return value.replace(/[\dA-Za-z一-鿿]/g, (ch) => (/\d/.test(ch) ? "n" : /[A-Za-z]/.test(ch) ? "a" : "c"));
}

/** §二十 Write Status 统一分类 + §十二 exactValue / semanticEquivalent 分离 */
function auditWrites(snapshot, stage) {
  const filled = snapshot.rows.filter((r) => r.len > 0 && !["radio", "checkbox", "hidden", "submit", "button", "file"].includes(r.type));
  return EXPECTED_WRITE.map((exp, i) => {
    const exactRows = filled.filter((r) => r.exact[i]);
    const semanticRow = filled.find((r) => exp.semantic.test(r.label));
    const digitsOnlyRow = filled.find((r) => r.digitsSame[i] && !r.exact[i] && exp.semantic.test(r.label));
    const hit = exactRows.find((r) => exp.semantic.test(r.label)) ?? null;
    const misplaced = exactRows.length > 0 && !hit ? exactRows[0] : null;
    const formatNormalizedRow = hit ? null : digitsOnlyRow ?? null;
    const target = hit ?? misplaced ?? formatNormalizedRow ?? null;
    let writeStatus;
    if (hit) writeStatus = "success";
    else if (misplaced) writeStatus = "misplaced";
    else if (formatNormalizedRow) writeStatus = "mismatch";
    else if (semanticRow) writeStatus = "mismatch";
    else writeStatus = "notWritten";
    return {
      stage,
      fieldId: exp.fieldId,
      domLabel: target?.label ?? "",
      requestedLength: exp.value.length,
      actualLength: target?.len ?? 0,
      requestedShape: shapeName(exp.value),
      actualShape: target?.shape ?? "",
      exactValueMatch: Boolean(hit),
      semanticEquivalent: Boolean(hit) || Boolean(formatNormalizedRow),
      formatNormalized: Boolean(formatNormalizedRow),
      duplicateWrite: exactRows.length > 1,
      writeStatus,
      semanticCorrect: Boolean(hit) || Boolean(formatNormalizedRow),
    };
  });
}

/* ---------------- PHASE 0: 启动扩展 + 合成资料 ---------------- */
const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--lang=zh-CN",
    "--disable-blink-features=AutomationControlled",
  ],
});
let sw = context.serviceWorkers()[0];
if (!sw) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    sw = await Promise.race([
      context.waitForEvent("serviceworker", { timeout: 2000 }),
      new Promise((r) => setTimeout(() => r(undefined), 2100)),
    ]);
    if (sw) break;
  }
}
if (!sw) die("扩展 service worker 未启动");
const extensionId = new URL(sw.url()).host;

const sp = await context.newPage();
await sp.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await sp.getByRole("button", { name: /开始识别/ }).waitFor({ timeout: 15000 });

// 种合成资料（legacy 镜像；全新持久化上下文里没有 v2，首启自动迁移——与 e2e setupProfile 同路径）
await sp.evaluate((p) => chrome.storage.local.set({ "afa.profile.v1": p }), {
  basic: {
    name: TEST_PROFILE.name,
    englishName: "",
    gender: "男",
    birthDate: "",
    age: TEST_PROFILE.age,
    phone: TEST_PROFILE.phone,
    email: TEST_PROFILE.email,
    wechat: TEST_PROFILE.wechat,
    qq: TEST_PROFILE.qq,
    city: TEST_PROFILE.city,
    portfolio: TEST_PROFILE.portfolio,
  },
  education: [
    {
      school: TEST_PROFILE.school,
      college: TEST_PROFILE.college,
      major: TEST_PROFILE.major,
      degree: "本科",
      educationLevel: "本科",
      startDate: "2023.09",
      endDate: TEST_PROFILE.eduEnd,
      gpa: "",
      rank: "",
    },
  ],
  internships: [
    {
      company: TEST_PROFILE.company,
      department: TEST_PROFILE.department,
      position: TEST_PROFILE.position,
      startDate: TEST_PROFILE.internStart,
      endDate: TEST_PROFILE.internEnd,
      descriptionShort: "",
      descriptionMedium: TEST_PROFILE.workContent,
      descriptionLong: "",
      responsibilities: "",
      workContent: TEST_PROFILE.workContent,
      achievements: "",
      summary: "",
      variants: {},
    },
  ],
  projects: [],
  campus: [],
  skills: { technical: [], tools: [], languages: [], certificates: [], awards: [] },
  jobPreferences: {
    expectedCity: [TEST_PROFILE.city],
    expectedPosition: [TEST_PROFILE.position],
    expectedSalary: "",
    availableDate: "",
    employmentType: "",
    expectedIndustry: "",
  },
  content: {
    selfIntroduction: { short: "", medium: "", long: "" },
    selfEvaluation: { short: "", medium: "", long: "" },
    personalAdvantages: { short: "", medium: "", long: "" },
    careerPlan: { short: "", medium: "", long: "" },
    hobbies: { short: "", medium: "", long: "" },
  },
  sensitive: { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" },
});
await sp.reload();
await sp.getByRole("button", { name: /开始识别/ }).waitFor({ timeout: 15000 });

// 真实站点是 SPA：PAGE_MUTATED 横幅（含「重新识别」）会与主按钮同匹配 → .last() 命中主操作
const recognizeBtn = sp.getByRole("button", { name: /开始识别|重新识别/ }).last();

/* ---------------- PHASE 1: Capture ---------------- */
const jobPage = await context.newPage();
const navigations = [];
jobPage.on("framenavigated", (f) => {
  if (f === jobPage.mainFrame()) navigations.push(f.url());
});
await jobPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await jobPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await jobPage.waitForTimeout(3000);
await jobPage.bringToFront();
await safeClick(recognizeBtn, "开始识别");
await sp.locator(".jobbar:not(.jobbar-empty)").waitFor({ timeout: 30000 });
const captured = (await sp.locator(".jobbar-title").textContent()) ?? "";
log("CAPTURE:", captured.replace(/\s+/g, " ").slice(0, 80));

/* ---------------- PHASE 2: 展开真实表单 ---------------- */
const applyLoc = jobPage.getByText("投递简历", { exact: false }).first();
const applyText = ((await applyLoc.textContent()) ?? "").trim();
if (!/投递简历/.test(applyText)) die(`入口按钮文本非预期：「${applyText}」`);
await applyLoc.click({ force: true }); // §八 表单入口，安全守卫已在 §二十七 覆盖终态提交
await jobPage.waitForTimeout(4000);

/* ---------------- PHASE 3: 扫描前基线 → Scan → 扫描后比对（§九 只读证明） ---------------- */
const preScan = await readFormControls(jobPage);
await jobPage.bringToFront();
await safeClick(recognizeBtn, "重新识别");
const cta = sp.getByRole("button", { name: "查看填写预览" });
await cta.waitFor({ timeout: 20000 });
const postScan = await readFormControls(jobPage);

const nonEmptyBefore = preScan.rows.filter((r) => r.len > 0 && !["radio", "checkbox", "hidden", "submit", "button", "file"].includes(r.type));
const nonEmptyAfter = postScan.rows.filter((r) => r.len > 0 && !["radio", "checkbox", "hidden", "submit", "button", "file"].includes(r.type));
const scanDiff = postScan.rows
  .map((r, i) => ({ r, b: preScan.rows[i] }))
  .filter(({ r, b }) => b && (r.len !== b.len || r.shape !== b.shape || r.checked !== b.checked || r.selected !== b.selected));
const scanMutatedDom = scanDiff.length > 0;
log(
  `SCAN-READ-ONLY: controls=${postScan.rows.length} nonEmptyBefore=${nonEmptyBefore.length} nonEmptyAfter=${nonEmptyAfter.length} diff=${scanDiff.length} scanMutatedDom=${scanMutatedDom}`,
);
if (scanMutatedDom) die("§九 P0：Scan 改变了真实 DOM —— 扫描必须绝对只读，停止 Pilot");
if (nonEmptyAfter.length > 0) {
  log("注意：扫描后已存在非空控件（站点预填），逐条记录 preExistingValue：", JSON.stringify(nonEmptyAfter.map((r) => ({ idx: r.idx, label: r.label, len: r.len, shape: r.shape }))));
}

/* ---------------- PHASE 4: Preview + 语义映射门禁 ---------------- */
await safeClick(cta, "查看填写预览");
await sp.locator(".field-card").first().waitFor({ timeout: 20000 });

/** 读 Preview 卡片：label / fieldId / risk / source / status / 勾选态（不记录值正文，只记录长度与形状） */
const cards = await sp.locator(".field-card").evaluateAll((els) =>
  els.map((el) => {
    const q = (sel) => el.querySelector(sel)?.textContent?.trim() ?? "";
    const valueEl = el.querySelector("input.field-value");
    const valueText = valueEl ? valueEl.value : q(".field-value");
    const cb = el.querySelector(".confirm-check input[type=checkbox]");
    const isEmpty = valueText === "—" || valueText.includes("未找到可用内容");
    return {
      label: q(".field-label"),
      // 稳定钩子：文案（中文）会变，data-* 不会——审计脚本一律读 data-*
      fieldId: el.querySelector("[data-field-id]")?.getAttribute("data-field-id") ?? "",
      risk: el.querySelector("[data-risk]")?.getAttribute("data-risk") ?? "",
      source: el.querySelector(".source-badge")?.textContent?.trim() ?? "",
      status: el.querySelector("[data-status]")?.getAttribute("data-status") ?? "",
      valueLen: isEmpty ? 0 : valueText.length,
      valueShape: isEmpty ? "" : valueText.replace(/\d/g, "n").replace(/[A-Za-z]/g, "a").replace(/[一-鿿]/g, "c").slice(0, 40),
      hasCheckbox: Boolean(cb),
      confirmChecked: cb ? Boolean(cb.checked) : null,
      manualNote: q(".manual-note"),
    };
  }),
);
log(`DETECTED: ${cards.length} cards`);
for (const c of cards) log(`  card: ${c.label.slice(0, 24)} | ${c.fieldId} | ${c.risk} | src=${c.source} | len=${c.valueLen} | checked=${c.confirmChecked}`);

const mappingAudit = EXPECTED_MAPPING.map((exp) => {
  const hit = cards.find((c) => exp.labelPattern.test(c.label) && c.fieldId === exp.fieldId);
  const riskOk = hit && (hit.risk === exp.risk || hit.risk === "SAFE");
  return { ...exp, labelHit: hit?.label ?? "", found: Boolean(hit), riskOk: Boolean(riskOk), actualRisk: hit?.risk ?? "" };
});
const mappingOk = mappingAudit.every((m) => m.found && m.riskOk);
if (!mappingOk) {
  log("MAPPING-AUDIT:", JSON.stringify(mappingAudit, null, 2));
  die("§十一 语义映射门禁未通过——禁止 Fill");
}
const manualOnlyCards = cards.filter((c) => c.risk === "MANUAL_ONLY");
const radioCard = manualOnlyCards.find((c) => c.fieldId === "unknown");
const gateCard = manualOnlyCards.find((c) => c.fieldId === "education.endDate");
const openCard = cards.find((c) => c.risk === "REVIEW");
log(`MAPPING-AUDIT: ${mappingAudit.length}/${mappingAudit.length} OK；radio(MANUAL ONLY)=${radioCard ? radioCard.label.slice(0, 16) : "无"}；开放题(REVIEW)=${openCard ? openCard.label.slice(0, 16) : "无"}`);
await jobPage.screenshot({ path: path.join(OUT_DIR, `${RUN_TAG}-demo.png`), fullPage: true });

/* ---------------- PHASE 5: §十六 ConfirmedFillPlan 校验 → 确认 → Writer ---------------- */
// §十四 选项 A：不点「全部确认」——开放题(REVIEW)因无内容本就不进计划，保持未写入并单独统计
// 计划口径以扩展自身的 ConfirmedFillPlan 规则为准（App.tsx isConfirmable）：
//   有内容 && risk !== MANUAL_ONLY && status ∈ {ready, need-confirm}；「确认并填写」会 force-confirm 这批
const planRows = cards.map((c) => ({
  fieldId: c.fieldId,
  risk: c.risk,
  status: c.status,
  valueLen: c.valueLen,
  uiChecked: c.confirmChecked === true,
  inPlan: c.valueLen > 0 && c.risk !== "MANUAL_ONLY" && (c.status === "ready" || c.status === "need-confirm"),
}));
const approved = planRows.filter((r) => r.inPlan);
const excluded = planRows.filter((r) => !r.inPlan);
const approvedFieldIds = new Set(approved.map((r) => r.fieldId));
// 合法排除只有三种：MANUAL_ONLY 风险、无内容、被约束门禁降为 manual/unsupported（issue-003）。
// 除此之外，有内容的 SAFE 字段被排除 = 计划漏字段，必须停。
const illegalExclusions = excluded.filter(
  (r) => r.risk !== "MANUAL_ONLY" && r.valueLen > 0 && r.status !== "manual" && r.status !== "unsupported",
);
if (illegalExclusions.length) die(`§十六 计划门禁：有内容的 SAFE 字段被无端排除 ${JSON.stringify(illegalExclusions)}`);
log(`PLAN: candidates=${cards.length} approved=${approved.length} excluded=${excluded.length}`);
log("  excluded:", JSON.stringify(excluded.map((r) => ({ id: r.fieldId, risk: r.risk, len: r.valueLen }))));
log("  UI 勾选态（点击前）:", JSON.stringify(cards.map((c) => c.confirmChecked)));

const writeBtn = sp.getByRole("button", { name: /填写确认的|确认并填写/ });
await safeClick(writeBtn, "确认并填写");
await sp.locator(".dialog .primary", { hasText: "确认填写" }).click(); // 用户显式确认，唯一写入口
await sp.getByText(/填写完成 ——/).waitFor({ timeout: 30000 });
const summaryText = (await sp.locator(".banner.banner-ok", { hasText: "填写完成" }).textContent()) ?? "";
log("FILL-SUMMARY:", summaryText.replace(/\s+/g, " ").slice(0, 90));

/* ---------------- PHASE 6: T1 立即验证 → 稳定 → T2 最终验证（§十九 / §二十三） ---------------- */
const t1Snap = await readFormControls(jobPage);
const t1 = auditWrites(t1Snap, "T1-immediate");
await jobPage.waitForTimeout(2000); // 至少一个 UI tick / mutation cycle
const t2Snap = await readFormControls(jobPage);
const t2 = auditWrites(t2Snap, "T2-stable");

const merged = t2.map((f) => {
  const prev = t1.find((x) => x.fieldId === f.fieldId);
  const reverted = prev?.exactValueMatch === true && f.exactValueMatch === false && f.actualLength === 0;
  return {
    ...f,
    immediateVerified: Boolean(prev?.exactValueMatch),
    finalStableVerified: f.exactValueMatch,
    reverted,
    writeStatus: reverted ? "reverted" : f.writeStatus,
    recoveryUsed: false,
    recoverySuccess: false,
  };
});

const t1Filled = describeFilled(t1Snap, "T1-immediate");
const t2Filled = describeFilled(t2Snap, "T2-stable");

// 未被计划写入却出现值的控件 = 邻居被覆盖 / 重复写（§二十五）
// 精确落点用页面内比对结果（r.exact[i]）判定，不按 label 反查，避免同名 label 误判
const writtenIdx = new Set();
for (const r of t2Snap.rows) if (r.exact.some(Boolean) || r.digitsSame.some(Boolean)) writtenIdx.add(r.idx);
const ignorableTypes = ["radio", "checkbox", "hidden", "submit", "button", "file"];
const unexplained = t2Snap.rows.filter(
  (r) => r.len > 0 && !writtenIdx.has(r.idx) && !ignorableTypes.includes(r.type),
);
const neighborOverwrite = unexplained.filter((r) => (preScan.rows[r.idx]?.len ?? 0) === 0);
const duplicateWriteControls = t2Snap.rows.filter(
  (r) => r.exact.filter(Boolean).length > 1 || r.digitsSame.filter((d, i) => d && !r.exact[i]).length > 1,
);

// 计划外字段（不在 EXPECTED_WRITE 里）是否被写 = 越权写入
const manualRadios = t2Snap.rows.filter((r) => r.type === "radio" && r.checked);
const openTextareas = t2Snap.rows.filter((r) => r.type === "textarea");

const writeAudit = merged.map((m) => {
  const exp = EXPECTED_WRITE.find((e) => e.fieldId === m.fieldId);
  return { ...m, requestedValueHash: sha(exp?.value ?? "") };
});
const falseFills = writeAudit.filter((w) => w.writeStatus === "misplaced");
const successes = writeAudit.filter((w) => w.writeStatus === "success");
const mismatches = writeAudit.filter((w) => w.writeStatus === "mismatch");
const revertedWrites = writeAudit.filter((w) => w.writeStatus === "reverted");

// §十六 事后门禁：真实 DOM 里出现的每个值，都必须属于 ConfirmedFillPlan 的批准集（越权写入 = P0）
const writtenFieldIds = new Set();
for (const f of t2Filled) for (const id of [...f.matchedFieldIds, ...f.digitsOnlyFieldIds]) writtenFieldIds.add(id);
const outsidePlan = [...writtenFieldIds].filter((id) => !approvedFieldIds.has(id));
if (outsidePlan.length) die(`§十六 P0：计划外字段被写入 ${outsidePlan.join(",")}`);

log("FILLED-CONTROLS（真实 DOM 逐控件，人工语义核对依据）:");
for (const f of t2Filled)
  log(`  #${f.idx} ${f.label} | ph=${f.placeholder} | len=${f.len}/${f.shape} | exact=[${f.matchedFieldIds}] digitsOnly=[${f.digitsOnlyFieldIds}] siteValid=${f.siteValidity.valid} stepMismatch=${f.siteValidity.stepMismatch}`);
log(`T1 有值控件数=${t1Filled.length} T2 有值控件数=${t2Filled.length}`);
log(`UNEXPLAINED（值不属于任何计划字段）: ${JSON.stringify(unexplained.map((r) => ({ idx: r.idx, label: r.label, len: r.len, shape: r.shape })))}`);
log("WRITE-AUDIT(T2 stable):");
for (const w of writeAudit)
  log(`  ${w.fieldId} | req=${w.requestedLength}/${w.requestedShape} act=${w.actualLength}/${w.actualShape} exact=${w.exactValueMatch} semEq=${w.semanticEquivalent} fmtNorm=${w.formatNormalized} T1=${w.immediateVerified} status=${w.writeStatus} @${w.domLabel}`);
log(`RADIO: ${manualRadios.length}/${t2Snap.extra.radio} checked（§十三 必须 0）`);
log(`TEXTAREA: ${JSON.stringify(openTextareas.map((t) => ({ label: t.label.slice(0, 20), len: t.len })))}`);
log(`NEIGHBOR-OVERWRITE: ${neighborOverwrite.length}`);

if (manualRadios.length > 0) die("§十三 P0：radio 被写入（MANUAL ONLY 红线）");
// issue-003 反向断言：被约束门禁拦下的字段绝不能出现在真实 DOM 里
const gateViolations = [];
for (const g of EXPECTED_NOT_WRITTEN) {
  const hit = t2Filled.find((f) => g.semantic.test(f.label));
  if (hit) gateViolations.push({ fieldId: g.fieldId, idx: hit.idx, label: hit.label, len: hit.len });
}
if (gateViolations.length) die(`issue-003 P0：约束门禁失效，被拦字段仍被写入 ${JSON.stringify(gateViolations)}`);
log(`issue-003 门禁：${EXPECTED_NOT_WRITTEN.map((g) => g.fieldId).join(",")} 未写入 ✓（卡片状态=${gateCard ? "manual→MANUAL_ONLY 徽章" : "未出现"}）`);
if (falseFills.length > 0) {
  console.error("[PILOT][STOP] §二十二 False Fill >= 1 → P0，停止 Pilot，禁止进入下一平台");
  console.error(JSON.stringify(falseFills, null, 2));
  writeFileSync(path.join(OUT_DIR, `${RUN_TAG}-P0-false-fill.json`), JSON.stringify({ writeAudit, cards, mappingAudit }, null, 2));
  await context.close();
  process.exit(2);
}
if (navigations.length > 1) {
  const submittedish = navigations.filter((u) => /success|submitted|complete/i.test(u));
  if (submittedish.length) die(`§二十七 P0：出现疑似提交后跳转 ${submittedish.join(" ")}`);
}
const submitLikeVisible = await jobPage.getByText(/投递成功|提交成功|申请已发送/).count();
if (submitLikeVisible > 0) die("§二十七 P0：页面出现提交成功文案");

/* ---------------- PHASE 7: 含值截图（private，不入库） ---------------- */
mkdirSync(PRIVATE_DIR, { recursive: true });
await jobPage.screenshot({ path: path.join(PRIVATE_DIR, `${RUN_TAG}-filled.png`), fullPage: true });

/* ---------------- PHASE 8: 撤销恢复（绝不提交） ---------------- */
const undoBtn = sp.getByRole("button", { name: "撤销本次填写" });
let undoRestored = false;
let undoUsed = false;
if ((await undoBtn.count()) > 0) {
  undoUsed = true;
  await jobPage.bringToFront();
  await safeClick(undoBtn, "撤销本次填写");
  await sp.getByText(/已撤销本次填写/).waitFor({ timeout: 10000 });
  const afterUndo = await readFormControls(jobPage);
  undoRestored = afterUndo.rows.every((r) => ["radio", "checkbox", "hidden", "submit", "button", "file"].includes(r.type) || r.len === 0);
}
log(`UNDO: used=${undoUsed} restored=${undoRestored}`);
if (!undoRestored) {
  await jobPage.reload({ waitUntil: "domcontentloaded" });
  log("UNDO fallback: 页面已刷新丢弃填写内容");
}

/* ---------------- PHASE 9: 落盘指标（§三十一） ---------------- */
const semanticFields = cards.filter((c) => c.fieldId && c.fieldId !== "unknown").length;
const unsupportedCards = cards.filter((c) => !c.fieldId || c.fieldId === "unknown");
/** 真实语义控件总数（人工核对基准）：可输入控件 + radio 组 + contenteditable */
const ignorableAtScan = ["radio", "checkbox", "hidden", "submit", "button", "file"];
const textLikeControls = postScan.rows.filter((r) => !ignorableAtScan.includes(r.type)).length;
const actualSemanticControls = textLikeControls + postScan.extra.radioGroups + postScan.extra.contenteditable;
const report = {
  capturedAt: new Date().toISOString(),
  runTag: RUN_TAG,
  platformFamily: "Custom ATS / Yaoji",
  mode: "REAL_WRITE_NO_SUBMIT",
  dataSource: "SYNTHETIC_PROFILE",
  url,
  capturedJobbar: captured.replace(/\s+/g, " ").trim(),
  scanReadOnly: {
    scanMutatedDom,
    scanDiff: scanDiff.length,
    controlsAtScan: postScan.rows.length,
    nonEmptyBeforeScan: nonEmptyBefore.length,
    preExistingValueFields: nonEmptyAfter.map((r) => ({ idx: r.idx, label: r.label, len: r.len, shape: r.shape })),
  },
  stats: {
    totalControls: postScan.rows.length,
    totalControlsBreakdown: postScan.extra,
    semanticFields,
    semanticGroundTruthControls: actualSemanticControls,
    detectedFields: cards.length,
    detectionRecall: Number((cards.length / Math.max(actualSemanticControls, 1)).toFixed(3)),
    approvedFields: approved.length,
    excludedFields: excluded.length,
    writtenFields: writeAudit.filter((w) => w.actualLength > 0).length,
    immediateVerifiedWrites: writeAudit.filter((w) => w.immediateVerified).length,
    finalStableVerifiedWrites: writeAudit.filter((w) => w.finalStableVerified).length,
    writeSuccessRate: Number((successes.length / Math.max(approved.length, 1)).toFixed(3)),
    semanticCorrectFields: writeAudit.filter((w) => w.semanticCorrect).length,
    semanticCorrectnessRate: Number(
      (writeAudit.filter((w) => w.semanticCorrect).length /
        Math.max(writeAudit.filter((w) => w.actualLength > 0).length, 1)).toFixed(3),
    ),
    manualFields: manualOnlyCards.length,
    unsupportedFields: unsupportedCards.length,
    /** 按设计不支持自动写入的控件（文件上传等）：扫描器主动忽略，不算漏检 */
    unsupportedByDesignControls: postScan.extra.file,
    rejectedBySiteValidation: t2Filled.filter((f) => f.siteValidity.valid === false).map((f) => ({ idx: f.idx, label: f.label, ...f.siteValidity })),
    undetectedControls: Math.max(actualSemanticControls - cards.length, 0),
    manualFallbackRate: Number(((manualOnlyCards.length) / Math.max(cards.length, 1)).toFixed(3)),
    constraintGatedFields: gateCard ? ["education.endDate"] : [],
    recoveryAttempts: 0,
    recoverySuccesses: 0,
    falseFillCount: falseFills.length,
    mismatchWrites: mismatches.length,
    revertedWrites: revertedWrites.length,
    neighborOverwrites: neighborOverwrite.length,
    duplicateWrites: writeAudit.filter((w) => w.duplicateWrite).length,
    openQuestionWritten: openTextareas.some((t) => t.len > (preScan.rows[t.idx]?.len ?? 0)),
    radioDetected: t2Snap.extra.radio > 0,
    radioWritten: manualRadios.length > 0,
    manualReason: radioCard ? "unsupported_control" : "n/a",
    undoUsed,
    undoRestored,
    submitClicked: false,
    navigationsObserved: navigations.length,
  },
  internEnd: (() => {
    const f = writeAudit.find((w) => w.fieldId === "internship.endDate");
    return { requested: f?.requestedLength, requestedShape: f?.requestedShape, actual: f?.actualLength, actualShape: f?.actualShape, sameValue: f?.exactValueMatch, semanticEquivalent: f?.semanticEquivalent, formatNormalized: f?.formatNormalized };
  })(),
  mappingAudit: mappingAudit.map((m) => ({ fieldId: m.fieldId, labelHit: m.labelHit.slice(0, 24), found: m.found, riskOk: m.riskOk })),
  previewCards: cards.map((c) => ({ label: c.label.slice(0, 24), fieldId: c.fieldId, risk: c.risk, source: c.source, status: c.status, valueLen: c.valueLen, valueShape: c.valueShape, confirmChecked: c.confirmChecked })),
  writeAudit,
  filledControls: { T1immediate: t1Filled, T2stable: t2Filled },
  planRows,
  duplicateWriteControls: duplicateWriteControls.map((r) => ({ idx: r.idx, label: r.label, len: r.len })),
  filledControls: { T1immediate: t1Filled, T2stable: t2Filled },
  planRows,
  radioState: { radioCount: t2Snap.extra.radio, checkedCount: manualRadios.length },
  openQuestionState: openTextareas.map((t) => ({ label: t.label.slice(0, 24), len: t.len })),
  notes: [
    "§十四 选项 A：开放题（工作内容 REVIEW）本轮不写入，单独统计 openQuestionWritten",
    "§十三：radio 保持 MANUAL ONLY，未被触碰",
    "值正文全程不外流：跨进程只回传 len/shape/exact 布尔，报告落 requestedValueHash 而非正文（§十五/§二十九）",
    "含填写值截图落 real-validation-results/private/（gitignored），入库仅 demo 截图（§三十）",
  ],
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, `${RUN_TAG}-data.json`), JSON.stringify(report, null, 2));

console.log("=== PILOT RESULT ===");
console.log(JSON.stringify(report.stats, null, 2));
console.log("=== internEnd (§十二) ===");
console.log(JSON.stringify(report.internEnd, null, 2));
await context.close();
process.exit(falseFills.length > 0 || revertedWrites.length > 0 ? 2 : 0);
