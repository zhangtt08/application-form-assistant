/**
 * 交付验收 Pilot —— 在真实招聘站点上跑一遍目标链路：
 *   打开岗位页 → 识别岗位 → 进入网申表单 → 识别字段 → 按岗位一键填入资料库内容
 *
 * 安全边界：
 *  - 只用合成身份/合成履历（docs/TEST_DATA_POLICY.md）
 *  - 绝不点击提交类按钮；结束立刻撤销
 *  - 结果只落结构化事实（长度 / 命中 / status），不落用户可见正文
 *
 * 用法：
 *   node scripts/delivery-pilot.mjs <岗位页URL> [--apply "投递简历"] [--out 文件名]
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const out = (...args) => {
  // Windows 控制台默认 GBK，中文/符号会 UnicodeEncodeError；统一走 stdout 字符串
  process.stdout.write(args.join(" ") + "\n");
};

const argv = process.argv.slice(2);
const jobUrl = argv.find((a) => /^https?:\/\//.test(a));
if (!jobUrl) {
  out("用法: node scripts/delivery-pilot.mjs <岗位页URL> [--apply \"投递简历\"]");
  process.exit(2);
}
const applyLabel = (() => {
  const i = argv.indexOf("--apply");
  return i >= 0 ? argv[i + 1] : null;
})();
const nameSlug = (jobUrl.match(/[a-z0-9]+/gi) ?? []).slice(-2).join("-").toLowerCase();
const OUT_FILE = path.join(ROOT, "real-validation-results", "sessions", `delivery-pilot-${nameSlug || "run"}.json`);

/** 合成身份：绝不使用任何真实个人信息 */
const SYNTH = {
  name: "_syn_赵合一",
  surname: "赵",
  givenname: "合一",
  englishName: "Syn Test",
  gender: "男",
  birthDate: "2002.03",
  age: "23",
  phone: "13900007788",
  email: "syn.test@example.invalid",
  wechat: "syn_wechat",
  qq: "123456789",
  city: "上海",
  address: "上海市示例区测试路 100 号",
  nativePlace: "江苏苏州",
  hukou: "上海市示例区",
  politicalStatus: "共青团员",
  maritalStatus: "未婚",
  portfolio: "https://syn.example.invalid",
  height: "175cm",
};

const profile = {
  basic: {
    ...SYNTH,
    idNumber: "",
    hukouType: "城镇",
    weight: "65kg",
    workYears: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  },
  education: [
    {
      school: "示例理工大学",
      college: "信息学院",
      major: "软件工程",
      degree: "本科",
      degreeType: "学士",
      educationLevel: "全日制",
      direction: "人工智能",
      startDate: "2022.09",
      endDate: "2026.06",
      gpa: "3.7",
      rank: "前10%",
    },
  ],
  internships: [
    {
      company: "示例科技有限公司",
      department: "增长部",
      position: "AI 应用实习生",
      startDate: "2025.06",
      endDate: "2025.09",
      descriptionShort: "负责测试流程自动化。",
      descriptionMedium: "在中示例科技增长部负责测试业务流程的 AI 自动化落地，覆盖 5 条业务线。",
      descriptionLong: "长期：负责测试业务流程 AI 自动化落地，主导工具选型与知识库建设。",
      responsibilities: "负责测试业务流程自动化",
      workContent: "测试规则梳理与工具开发",
      achievements: "支撑 5 个业务项目上线",
      summary: "积累 AI 落地经验",
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    },
  ],
  campus: [
    {
      organization: "校学生会",
      department: "技术部",
      position: "技术部部长",
      startDate: "2023.09",
      endDate: "2024.06",
      descriptionShort: "组织校园技术活动。",
      descriptionMedium: "组织 3 场校园技术分享，参与人数 400+。",
      descriptionLong: "长期负责校园技术活动的策划与执行。",
      responsibilities: "活动策划与执行",
      workContent: "技术分享组织",
      achievements: "参与人数 400+",
      summary: "组织能力提升",
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    },
  ],
  projects: [
    {
      name: "示例流程自动化系统",
      role: "方案设计与开发",
      startDate: "2025.07",
      endDate: "2025.12",
      descriptionShort: "从人工流程到 Agent 调度的演进。",
      descriptionMedium: "示例流程自动化系统：封装 Tool 与 RAG 知识库，支撑业务流程自动调度。",
      descriptionLong: "完整演进：需求分析、Tool 封装、RAG 调度、灰度上线。",
      keywords: ["AI", "Agent"],
      background: "人工流程重复度高",
      responsibilities: "方案设计",
      workContent: "封装 Tool 与 RAG",
      achievements: "上线后节省 30% 人力",
      summary: "端到端落地经验",
      variants: { agent: "", aiApplication: "", aiProduct: "", aiOperation: "", aiSolution: "", aigcMarketing: "" },
    },
  ],
  skills: {
    technical: ["Python", "SQL", "Prompt 设计"],
    tools: ["Excel", "Figma"],
    languages: ["英语CET-6"],
    certificates: ["CET-6"],
    awards: ["校级一等奖学金"],
  },
  jobPreferences: {
    expectedCity: ["上海"],
    expectedPosition: ["AI 应用工程师"],
    expectedSalary: "15k-20k",
    availableDate: "2026.07",
    employmentType: "校招全职",
    expectedIndustry: "互联网",
  },
  content: {
    selfIntroduction: { short: "", medium: "合成自我介绍：示例理工大学软件工程专业，AI 应用方向。", long: "" },
    selfEvaluation: { short: "", medium: "合成自我评价：逻辑清晰，能把业务问题拆成可执行的流程。", long: "" },
    personalAdvantages: { short: "", medium: "合成个人优势：从需求到落地的完整推进经验。", long: "" },
    careerPlan: { short: "", medium: "合成职业规划：深耕 AI 应用与业务自动化。", long: "" },
    hobbies: { short: "", medium: "合成兴趣爱好：长跑、读书。", long: "" },
  },
  sensitive: { politicalStatus: "", maritalStatus: "", idNumber: "", emergencyContact: "" },
};

/** 所有可能被填进去的值（用于把页面上的非空值归类） */
const KNOWN_VALUES = [];
(function collect(v) {
  if (typeof v === "string") {
    if (v.trim().length > 0) KNOWN_VALUES.push(v.trim());
    return;
  }
  if (Array.isArray(v)) return v.forEach(collect);
  if (v && typeof v === "object") return Object.values(v).forEach(collect);
})(profile);
const NORM = (s) => (s ?? "").replace(/\s+/g, "").toLowerCase();
const KNOWN_NORM = [...new Set(KNOWN_VALUES.map(NORM))];

async function launch() {
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    executablePath: findChrome(),
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  let sw = context.serviceWorkers()[0];
  for (let i = 0; i < 15 && !sw; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    sw = context.serviceWorkers()[0];
  }
  if (!sw) throw new Error("扩展 service worker 未启动");
  const extensionId = new URL(sw.url()).host;
  return { context, extensionId };
}

function findChrome() {
  if (process.env.AFA_CHROME && fs.existsSync(process.env.AFA_CHROME)) return process.env.AFA_CHROME;
  const root = path.join(process.env.USERPROFILE ?? "", "AppData", "Local", "ms-playwright");
  const dirs = fs
    .readdirSync(root)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const p = path.join(root, d, "chrome-win64", "chrome.exe");
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function seedProfile(sidePanel) {
  await sidePanel.evaluate((p) => {
    return new Promise((resolve) => {
      chrome.storage.local.get(["afa.profiles.v2"], (res) => {
        const existing = res["afa.profiles.v2"];
        const store =
          existing && Array.isArray(existing.libraries) && existing.libraries.length
            ? {
                ...existing,
                shared: { basic: p.basic, education: p.education, sensitive: p.sensitive },
                libraries: existing.libraries.map((l) =>
                  l.id === existing.activeLibraryId
                    ? { ...l, content: { internships: p.internships, campus: p.campus, projects: p.projects, skills: p.skills, jobPreferences: p.jobPreferences, content: p.content } }
                    : l,
                ),
              }
            : null;
        const writes = { "afa.profile.v1": p };
        if (store) writes["afa.profiles.v2"] = store;
        chrome.storage.local.set(writes, resolve);
      });
    });
  }, p_profile());
}
const p_profile = () => profile;

/** 抓页面（含所有 frame）里所有表单控件的当前值 */
async function snapshotControls(page) {
  const frames = page.frames();
  const rows = [];
  for (const frame of frames) {
    const list = await frame
      .evaluate(() => {
        const sel =
          'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [contenteditable="true"]';
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const s = getComputedStyle(el);
          return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity || "1") > 0;
        };
        const labelOf = (el) => {
          const forId = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (forId) return (forId.textContent || "").trim().slice(0, 40);
          const wrap = el.closest("label");
          if (wrap) return (wrap.textContent || "").trim().slice(0, 40);
          const prev = el.previousElementSibling;
          if (prev && (prev.textContent || "").trim()) return (prev.textContent || "").trim().slice(0, 40);
          return el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "";
        };
        return Array.from(document.querySelectorAll(sel))
          .filter(isVisible)
          .map((el) => {
            const tag = el.tagName.toLowerCase();
            const type = el.type || "";
            let value = "";
            let checked = null;
            if (type === "radio" || type === "checkbox") {
              checked = !!el.checked;
              value = checked ? (labelOf(el) || el.value || "") : "";
            } else if (el.isContentEditable) {
              value = (el.textContent || "").trim();
            } else if (tag === "select") {
              value = el.selectedOptions?.[0]?.textContent?.trim() || el.value || "";
            } else {
              value = (el.value || "").trim();
            }
            return {
              tag,
              type,
              label: labelOf(el),
              name: el.name || "",
              placeholder: el.getAttribute("placeholder") || "",
              readonly: !!el.readOnly,
              valueLen: value.length,
              valueNorm: value.replace(/\s+/g, "").toLowerCase(),
              checked,
            };
          });
      })
      .catch(() => []);
    for (const row of list) {
      rows.push({ ...row, frame: frame === page.mainFrame() ? "main" : "sub" });
    }
  }
  return rows;
}

function classify(rows) {
  const filled = [];
  const unexplained = [];
  const empty = [];
  for (const r of rows) {
    if (!r.valueNorm) {
      empty.push(r);
      continue;
    }
    const hit =
      KNOWN_NORM.includes(r.valueNorm) ||
      KNOWN_NORM.some((k) => k.length >= 2 && (r.valueNorm.includes(k) || k.includes(r.valueNorm)));
    if (hit) filled.push(r);
    else unexplained.push(r);
  }
  return { filled, unexplained, empty };
}

(async () => {
  const report = {
    url: jobUrl,
    at: new Date().toISOString(),
    syntheticOnly: true,
    submittedClicked: false,
    steps: [],
  };
  const { context, extensionId } = await launch();
  report.extensionId = extensionId;

  const sidePanel = await context.newPage();
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).last().waitFor({ timeout: 30000 });
  await seedProfile(sidePanel);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).last().waitFor({ timeout: 30000 });
  report.steps.push("sidepanel_ready");

  const page = await context.newPage();
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  report.pageTitle = await page.title();
  report.steps.push("job_page_loaded");

  // ① 先在 JD 页识别一次：捕获岗位 + 方向（用户流程里的「识别岗位」）
  // 注意：扩展操作的是「当前活动标签页」，Side Panel 自己那个 tab 抢前台会让扫描目标变成面板页；
  // 每次点识别前都把目标页面放回前台。
  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).last().click();
  await sidePanel.waitForTimeout(3000);
  report.jobBarAfterJdRecognize = (await sidePanel.locator(".jobbar-title").textContent().catch(() => ""))?.trim() ?? "";
  report.steps.push("recognized_jd_page");

  // ② 进入网申表单
  await page.bringToFront();
  if (applyLabel) {
    const btn = page.getByText(applyLabel, { exact: false }).first();
    if (await btn.count()) {
      await btn.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(4000);
      report.steps.push(`clicked_apply("${applyLabel}")`);
    } else {
      report.steps.push(`apply_not_found("${applyLabel}")`);
    }
  }

  await page.bringToFront();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).last().click();
  const done = await sidePanel
    .getByText(/填写完成 ——/)
    .waitFor({ timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  report.steps.push(done ? "fill_done" : "fill_timeout");

  report.jobBar = (await sidePanel.locator(".jobbar-title").textContent().catch(() => ""))?.trim() ?? "";
  report.summaryCells = await sidePanel.locator(".summary-num").allTextContents().catch(() => []);
  report.errorBanner = (await sidePanel.locator(".banner-error").first().textContent().catch(() => ""))?.trim() ?? "";

  const cards = await sidePanel.locator(".field-card").count().catch(() => 0);
  report.fieldCards = cards;
  report.cardStatuses = await sidePanel.evaluate(() =>
    Array.from(document.querySelectorAll(".field-card")).map((el) => ({
      status: el.getAttribute("data-status") || "",
      fieldId: el.getAttribute("data-field-id") || "",
      label: (el.querySelector(".field-label")?.textContent || "").trim().slice(0, 30),
      // 失败原因（Write Verification 的判定），用来定位「识别到了却没写进去」
      reason: Array.from(el.querySelectorAll(".hint"))
        .map((n) => (n.textContent || "").trim())
        .join(" / ")
        .slice(0, 140),
    })),
  ).catch(() => []);

  // 「投递简历」常常是新开一个标签页：DOM 取证必须对着当前活动页做
  const livePages = context.pages().filter((p) => !p.isClosed() && /^https?:/.test(p.url()));
  const formPage = livePages[livePages.length - 1] ?? page;
  report.formUrl = formPage.url();
  await formPage.bringToFront();
  const rows = await snapshotControls(formPage);
  const { filled, unexplained, empty } = classify(rows);
  report.controls = { total: rows.length, filled: filled.length, unexplained: unexplained.length, empty: empty.length };
  report.filledSample = filled.slice(0, 40).map((r) => ({ label: r.label, len: r.valueLen, frame: r.frame, type: r.type }));
  report.unexplainedSample = unexplained.slice(0, 40).map((r) => ({ label: r.label, len: r.valueLen, frame: r.frame, type: r.type }));
  // 站点公开信息（字段名 / 控件类型 / 所在 frame），不含任何填写值
  report.emptySample = empty.slice(0, 40).map((r) => ({ label: r.label, frame: r.frame, type: r.type, readonly: r.readonly }));
  report.frameKinds = { main: rows.filter((r) => r.frame === "main").length, sub: rows.filter((r) => r.frame === "sub").length };
  report.pageFrames = page.frames().map((f) => f.url().slice(0, 90));

  report.undoMarkers = await formPage
    .evaluate(() => document.querySelectorAll("[data-afa-undo]").length)
    .catch(() => -1);

  // 撤销
  await sidePanel.bringToFront();
  const undoBtn = sidePanel.getByRole("button", { name: /撤销本次填写/ });
  if (await undoBtn.count()) {
    await undoBtn.click();
    const undone = await sidePanel
      .getByText(/已撤销本次填写/)
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    report.steps.push(undone ? "undo_done" : "undo_timeout");
    report.undoNotice =
      (await sidePanel.getByText(/已撤销本次填写/).first().textContent().catch(() => ""))?.trim() ?? "";
    await page.bringToFront();
    const afterRows = await snapshotControls(formPage);
    const after = classify(afterRows);
    report.afterUndo = { filled: after.filled.length, unexplained: after.unexplained.length, empty: after.empty.length };
    report.afterUndoSample = after.filled.slice(0, 8).map((r) => ({ label: r.label, len: r.valueLen, frame: r.frame }));
  }

  report.submitStillThere = await page.locator("button, input[type=submit]").count().catch(() => -1);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");

  out("== Delivery Pilot ==");
  out("页面:", report.pageTitle);
  out("岗位:", report.jobBar);
  out("步骤:", report.steps.join(" → "));
  out("识别卡片:", report.fieldCards, "汇总:", JSON.stringify(report.summaryCells));
  out("控件: total=", report.controls.total, "filled=", report.controls.filled, "unexplained=", report.controls.unexplained, "empty=", report.controls.empty);
  if (report.errorBanner) out("错误:", report.errorBanner);
  out("已写入样例:", JSON.stringify(report.filledSample.slice(0, 12)));
  out("未解释(可能是站点预填):", JSON.stringify(report.unexplainedSample.slice(0, 12)));
  out("撤销后:", JSON.stringify(report.afterUndo ?? {}));
  out("报告:", OUT_FILE);

  await context.close();
})().catch((err) => {
  out("PILOT FAILED:", err && err.message ? err.message : String(err));
  process.exit(1);
});
