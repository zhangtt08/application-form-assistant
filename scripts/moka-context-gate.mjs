/**
 * Real Regression Batch #4 真机验证 —— Moka 未登录页语境门禁（issue-004）
 *
 * 模式：RECON_ONLY / NO_LOGIN。本脚本**不登录、不输入、不勾选、不点击任何提交类元素**。
 * 它只做一件事：在真实 Moka 的「手机号 + 验证码」登录面板上跑一次 Scan，
 * 证明登录手机号与导航职位搜索框已被语境门禁排除，且页面 DOM 一个字节都没变。
 *
 * 运行：node scripts/moka-context-gate.mjs [jobUrl]
 * 产物：real-validation-results/sessions/<date>-moka-context-gate-data.json
 */
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../dist");
const url = process.argv[2] ?? "https://app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4-1328-4bb4-b341-2ad4783529ce";
const OUT_DIR = path.resolve(__dirname, "../real-validation-results/sessions");
const RUN_TAG = `${new Date().toISOString().slice(0, 10)}-moka-context-gate`;

/** §四 合成资料：只用于验证「有内容可填时也不会被填进登录框」 */
const TEST_PROFILE = {
  name: "张小明", age: "22", city: "测试市", phone: "15300001122", email: "test.resume@example.com",
  wechat: "test_resume_01", qq: "100000001", portfolio: "https://example.com/portfolio",
  school: "示例科技大学", college: "测试学院", major: "测试专业", eduEnd: "2027.06",
  company: "示例科技有限公司", department: "测试部门", position: "AI 应用实习生",
  internStart: "2026.06", internEnd: "2026.09",
};

const log = (...a) => console.log("[MOKA-GATE]", ...a);
function die(msg) {
  console.error("[MOKA-GATE][STOP]", msg);
  process.exit(1);
}
/** §二十六 绝对禁止的点击目标：登录、验证码、协议、提交类一律不碰 */
const FORBIDDEN = /(登录|验证码|校验码|获取|注册|同意|隐私政策|提交|投递|申请并|下一步|submit)/i;
async function safeClick(locator, what) {
  const text = `${what} ${((await locator.textContent().catch(() => "")) ?? "").trim()}`;
  if (FORBIDDEN.test(text)) die(`§二十六 守卫：拒绝点击「${text}」`);
  await locator.click({ force: true });
}

const context = await chromium.launchPersistentContext("", {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
    "--no-first-run", "--no-default-browser-check", "--lang=zh-CN", "--disable-blink-features=AutomationControlled",
  ],
});
let sw = context.serviceWorkers()[0];
for (let i = 0; i < 15 && !sw; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  sw = context.serviceWorkers()[0];
}
if (!sw) die("扩展 service worker 未启动");
const extId = new URL(sw.url()).host;

const sp = await context.newPage();
await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
await sp.getByRole("button", { name: /开始识别/ }).waitFor({ timeout: 15000 });

// 种合成资料 + 打开 Dev（只为读出排除原因，属既有能力，未新增 Trace）
await sp.evaluate(({ p, prefs }) => chrome.storage.local.set({ "afa.profile.v1": p, "afa.apply.prefs.v1": prefs }), {
  p: {
    basic: { name: TEST_PROFILE.name, englishName: "", gender: "男", birthDate: "", age: TEST_PROFILE.age, phone: TEST_PROFILE.phone, email: TEST_PROFILE.email, wechat: TEST_PROFILE.wechat, qq: TEST_PROFILE.qq, city: TEST_PROFILE.city, portfolio: TEST_PROFILE.portfolio },
    education: [{ school: TEST_PROFILE.school, college: TEST_PROFILE.college, major: TEST_PROFILE.major, degree: "本科", educationLevel: "本科", startDate: "2023.09", endDate: TEST_PROFILE.eduEnd, gpa: "", rank: "" }],
    internships: [{ company: TEST_PROFILE.company, department: TEST_PROFILE.department, position: TEST_PROFILE.position, startDate: TEST_PROFILE.internStart, endDate: TEST_PROFILE.internEnd, descriptionShort: "", descriptionMedium: "", descriptionLong: "", responsibilities: "", workContent: "", achievements: "", summary: "", variants: {} }],
    projects: [], campus: [],
    skills: { technical: [], tools: [], languages: [], certificates: [], awards: [] },
    jobPreferences: { expectedCity: [], expectedPosition: [], expectedSalary: "", availableDate: "", employmentType: "", expectedIndustry: "" },
    content: { selfIntroduction: { short: "", medium: "", long: "" }, selfEvaluation: { short: "", medium: "", long: "" }, personalAdvantages: { short: "", medium: "", long: "" }, careerPlan: { short: "", medium: "", long: "" }, hobbies: { short: "", medium: "", long: "" } },
    sensitive: { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" },
  },
  prefs: { autoCaptureJob: true, showDev: true },
});
await sp.reload();
await sp.getByRole("button", { name: /开始识别/ }).waitFor({ timeout: 15000 });

const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
await page.bringToFront();

// 打开登录面板（点的是职位详情页的「申请职位」入口，不是提交）
const applyEntry = page.getByText("申请职位", { exact: false }).first();
if ((await applyEntry.count()) === 0) die("未找到「申请职位」入口，页面结构可能已变");
await applyEntry.click({ force: true });
await page.waitForTimeout(4000);

/** 读全部可写控件状态（只回传长度/形状/布尔，绝不回传值正文） */
const readControls = () =>
  page.evaluate(() => {
    const shapeOf = (s) => s.replace(/[\dA-Za-z一-鿿]/g, (ch) => (/\d/.test(ch) ? "n" : /[A-Za-z]/.test(ch) ? "a" : "c"));
    return Array.from(document.querySelectorAll("input, textarea, select, [contenteditable=true]")).map((el, idx) => {
      const value = typeof el.value === "string" ? el.value : el.textContent ?? "";
      return {
        idx,
        type: el.type || el.tagName.toLowerCase(),
        ph: (el.placeholder || "").slice(0, 24),
        len: value.length,
        shape: shapeOf(value).slice(0, 30),
        checked: Boolean(el.checked),
      };
    });
  });

const beforeScan = await readControls();
log(`面板已展开，控件数=${beforeScan.length}，非空=${beforeScan.filter((r) => r.len > 0).length}`);

await safeClick(sp.getByRole("button", { name: /开始识别|重新识别/ }).last(), "开始识别");
await sp.waitForTimeout(6000);

const afterScan = await readControls();
const scanDiff = afterScan.filter((r, i) => {
  const b = beforeScan[i];
  return b && (r.len !== b.len || r.shape !== b.shape || r.checked !== b.checked);
});

// 候选清单：可填卡片 + 被排除统计
const previewCta = sp.getByRole("button", { name: "查看填写预览" });
const hasPreview = (await previewCta.count()) > 0;
if (hasPreview) await safeClick(previewCta, "查看填写预览");
await sp.waitForTimeout(2000);
const fillableCards = await sp.locator(".field-card").evaluateAll((els) =>
  els.map((el) => ({
    label: el.querySelector(".field-label")?.textContent?.trim().slice(0, 26) ?? "",
    fieldId: el.querySelector("[data-field-id]")?.getAttribute("data-field-id") ?? "",
    risk: el.querySelector("[data-risk]")?.getAttribute("data-risk") ?? "",
    status: el.querySelector("[data-status]")?.getAttribute("data-status") ?? "",
  })),
).catch(() => []);
const excludedNote = ((await sp.locator(".fold-note").textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
const excludedCount = Number(excludedNote.match(/已忽略\s*(\d+)/)?.[1] ?? 0);

// showDev 打开时，被排除的控件也会渲染成卡片（带排除原因）——必须按 data-status 区分，
// 否则会把「已排除」误读成「仍在候选里」。
const excludedCards = fillableCards.filter((c) => c.status === "excluded");
const applicationCandidates = fillableCards.filter((c) => c.status !== "excluded");
const excludedNoteCount = excludedCount || excludedCards.length;

log(`申请候选=${applicationCandidates.length}（应为 0）；语境排除=${excludedNoteCount}；扫描后 DOM diff=${scanDiff.length}`);
for (const c of applicationCandidates) log(`  意外候选: ${c.label} | ${c.fieldId} | ${c.risk} | ${c.status}`);
for (const c of excludedCards) log(`  已排除: ${c.label} | ${c.fieldId} | ${c.risk}`);

const loginPhoneWritten = afterScan.some((r, i) => r.len > 0 && (beforeScan[i]?.len ?? 0) === 0);
if (scanDiff.length > 0) die("§八/§二十二 P0：Scan 改动了真实 DOM");
if (loginPhoneWritten) die("issue-004 P0：登录面板控件被写入");
if (applicationCandidates.length > 0) die("issue-004 未生效：登录页仍产出可填候选");
if (excludedNoteCount === 0) die("语境排除数为 0 —— 门禁根本没在这两个控件上生效，不能算通过");

const report = {
  capturedAt: new Date().toISOString(),
  runTag: RUN_TAG,
  platformFamily: "Moka",
  mode: "RECON_ONLY_NO_LOGIN",
  url,
  job: "载具策划 - 3C（望月）-2027届校招",
  company: "广州诗悦网络科技有限公司",
  loginPanelOpened: true,
  data: "SYNTHETIC_PROFILE（含手机号，用于证明「有内容可填也不写进登录框」）",
  controls: beforeScan.length,
  scanMutatedDom: scanDiff.length > 0,
  scanDiff: scanDiff.length,
  detectedApplicationFields: applicationCandidates.length,
  excludedByContextGate: excludedNoteCount,
  confirmedFillPlanApproved: applicationCandidates.filter((c) => c.status === "ready" || c.status === "need-confirm").length,
  previewCtaPresent: hasPreview,
  excludedNote,
  excludedCardDetails: excludedCards.map((c) => ({ label: c.label, fieldId: c.fieldId, risk: c.risk })),
  applicationCandidates,
  forbiddenClicksAttempted: ["登录", "获取验证码", "协议 checkbox", "提交/投递"],
  submitted: false,
  loginAttempted: false,
  notes: [
    "本验证不需要登录态：只证明未登录页的安全过滤（§二十七）",
    "ConfirmedFillPlan 的 0 由「无任何可填候选」推导 —— buildFillPlan 只从候选里取 ready/need-confirm",
    "全程未输入任何值、未勾选协议、未点击登录或验证码按钮",
  ],
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, `${RUN_TAG}-data.json`), JSON.stringify(report, null, 2));
console.log("=== MOKA CONTEXT GATE ===");
console.log(JSON.stringify({ ...report, applicationCandidates: undefined, excludedCardDetails: undefined }, null, 2));
await context.close();
process.exit(0);
