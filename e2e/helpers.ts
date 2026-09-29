import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import type { Profile } from "../../src/types/profile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_BASE = "http://127.0.0.1:4198";

/**
 * 找一台本机已有的 Chromium 来跑扩展测试。
 *
 * Playwright 默认要求它自己那一个 revision 的浏览器（chromium-XXXX），
 * 机器上只有别的 revision 时整套 E2E 直接起不来。这里按
 * `AFA_CHROME`、ms-playwright 目录下最新的 chromium revision 里的 chrome.exe
 * 的顺序取现成的二进制，不额外下载任何东西。
 */
function resolveChromeExecutable(): string | undefined {
  const fromEnv = process.env.AFA_CHROME;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map((name) => path.join(root, name, "chrome-win64", "chrome.exe"))
    .filter((p) => fs.existsSync(p));
  return candidates[0];
}

/** 启动 Chromium Persistent Context 并加载 dist/ 扩展（真实 MV3 环境，不 mock） */
export async function launchWithExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const dist = path.resolve(__dirname, "../dist");
  const executablePath = resolveChromeExecutable();
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    // channel: "chromium" 只在没有现成二进制时用（它要求 Playwright 自己那版浏览器）
    ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
    ],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    // 轮询式等待：serviceWorkers() 与 waitForEvent 交替，避免事件注册窗口错过
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        sw = await Promise.race([
          context.waitForEvent("serviceworker", { timeout: 2000 }),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), 2100)),
        ]);
      } catch {
        // 超时继续下一轮轮询
      }
      const found = context.serviceWorkers()[0];
      if (found) {
        sw = found;
        break;
      }
    }
  }
  if (!sw) throw new Error("MV3 service worker 未启动（扩展加载失败）");
  const extensionId = new URL(sw.url()).host;
  return { context, extensionId };
}

/** Side Panel 页面以独立 tab 打开（chrome-extension:// 页面拥有完整扩展 API） */
export async function openSidePanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.getByRole("button", { name: /开始识别|重新识别/ }).waitFor();
  return page;
}

/**
 * E2E Profile fixture：
 * - 基础资料（facts）唯一可断言
 * - 三个方向的 variant 各含独特标记文本
 * - achievements 420 字（配合 application-form.html 的 maxlength=300 字段，Scenario F）
 */
export const PROFILE_FIXTURE: Profile = {
  basic: {
    name: "张三",
    englishName: "",
    gender: "男",
    birthDate: "",
    age: "22",
    phone: "13800001234",
    email: "zhangsan@test.com",
    wechat: "",
    qq: "",
    city: "杭州",
    portfolio: "https://portfolio.example.com",
  },
  education: [
    {
      school: "示例科技大学",
      college: "测试学院",
      major: "测试专业",
      degree: "本科",
      educationLevel: "本科",
      startDate: "2023.09",
      endDate: "2027.06",
      gpa: "",
      rank: "",
    },
  ],
  internships: [
    {
      company: "示例科技有限公司",
      department: "测试部门",
      position: "AI 应用实习生",
      startDate: "2026.06",
      endDate: "2026.09",
      descriptionShort: "实习短描述（默认）",
      descriptionMedium: "实习中描述（默认）",
      descriptionLong: "实习长描述（默认）：负责测试业务流程的AI自动化落地。",
      responsibilities: "负责测试业务流程自动化",
      workContent: "测试规则梳理与工具开发",
      achievements: "支撑5个业务项目",
      summary: "积累AI落地经验",
      variants: {
        agent: "实习Agent视角：测试业务流程的Agent工作流改造。",
        aiApplication: "实习AI应用视角：业务流程自动化落地。",
        aiProduct: "实习AI产品视角：测试产品的需求分析与流程设计。",
        aiOperation: "",
        aiSolution: "",
        aigcMarketing: "",
      },
    },
  ],
  projects: [
    {
      name: "示例流程自动化系统",
      role: "方案设计与开发",
      startDate: "2026.06",
      endDate: "2026.09",
      descriptionShort: "项目短描述（默认）",
      descriptionMedium: "项目中描述（默认）",
      descriptionLong: "项目长描述（默认）：从人工流程到Agent调度的完整演进。",
      keywords: ["AI应用", "Agent"],
      background: "项目背景（默认）",
      responsibilities: "Agent方案设计",
      workContent: "封装Tool与RAG知识库",
      achievements: `关键成果：${"成果细节持续沉淀。".repeat(40)}`, // 420+ 字，超 maxlength=300
      summary: "项目总结（默认）",
      variants: {
        agent: "Agent视角的项目描述（E2E标记-AGENT）：本项目面向Agent工作流场景，强调Tool封装与RAG调度能力。",
        aiApplication: "AI应用视角的项目描述（E2E标记-AIAPP）：本项目面向AI应用落地场景。",
        aiProduct: "AI产品视角的项目描述（E2E标记-AIPRODUCT）：本项目面向AI产品场景，强调需求分析、用户价值与产品迭代。",
        aiOperation: "",
        aiSolution: "",
        aigcMarketing: "AIGC视角的项目描述（E2E标记-AIGC）：本项目面向内容创意场景，强调AIGC内容生产能力。",
      },
    },
  ],
  campus: [],
  skills: {
    technical: ["Python", "Prompt设计"],
    tools: ["Claude Code"],
    languages: ["英语CET-6"],
    certificates: ["CET-6"],
    awards: [],
  },
  jobPreferences: {
    expectedCity: ["杭州"],
    expectedPosition: ["AI应用"],
    expectedSalary: "",
    availableDate: "2027年毕业后",
    employmentType: "校招全职",
    expectedIndustry: "人工智能",
  },
  content: {
    selfIntroduction: { short: "", medium: "", long: "" },
    selfEvaluation: { short: "", medium: "", long: "自我评价长文（默认）" },
    personalAdvantages: { short: "", medium: "", long: "个人优势长文（默认）：连接业务与AI应用。" },
    careerPlan: { short: "", medium: "", long: "" },
    hobbies: { short: "", medium: "", long: "" },
  },
  sensitive: {
    politicalStatus: "",
    maritalStatus: "",
    idNumber: "110101199001011234", // 敏感：确认填写流程绝不写入
    emergencyContact: "",
  },
};

/** 预置 Profile（测试数据准备，不 mock 扩展运行环境） */
export async function setupProfile(sidePanel: Page): Promise<void> {
  await sidePanel.evaluate((profile) => {
    return chrome.storage.local.set({ "afa.profile.v1": profile });
  }, PROFILE_FIXTURE);
}

/**
 * 测试中途改资料：legacy 镜像（afa.profile.v1）与 v2 store（afa.profiles.v2）双写。
 *
 * 应用首次加载后 v2 store 已存在，loadStore 只认 v2 —— 只改 v1 会被静默忽略
 * （AA4「串位」/ Scenario H「badge 不变」的根因）。写法与 libraryStore 的
 * shared/content 拆分对齐：basic/education/sensitive → shared，其余 → active 库 content。
 */
export async function seedProfileDeep(sidePanel: Page, profile: typeof PROFILE_FIXTURE): Promise<void> {
  await sidePanel.evaluate((p) => {
    const shared = { basic: p.basic, education: p.education, sensitive: p.sensitive };
    const content = {
      internships: p.internships,
      campus: p.campus,
      projects: p.projects,
      skills: p.skills,
      jobPreferences: p.jobPreferences,
      ...(p.careerPreferences ? { careerPreferences: p.careerPreferences } : {}),
      content: p.content,
    };
    return chrome.storage.local.get("afa.profiles.v2").then((res) => {
      const store = res["afa.profiles.v2"] as
        | { shared: unknown; libraries: { id: string; content: unknown }[]; activeLibraryId: string }
        | undefined;
      const writes: Record<string, unknown> = { "afa.profile.v1": p };
      if (store && Array.isArray(store.libraries) && store.libraries.length > 0) {
        store.shared = shared;
        for (const lib of store.libraries) {
          if (lib.id === store.activeLibraryId) lib.content = content;
        }
        writes["afa.profiles.v2"] = store;
      }
      return chrome.storage.local.set(writes);
    });
  }, profile);
}

/** 清空岗位/trace（保留 profile 由 setupProfile 重设） */
export async function resetJobStorage(sidePanel: Page): Promise<void> {
  await sidePanel.evaluate(() => {
    return chrome.storage.local.remove(["afa.jobs.v1", "afa.trace.v1"]);
  });
}

export async function readStorage(page: Page, key: string): Promise<unknown> {
  return page.evaluate((k) => chrome.storage.local.get(k), key);
}

/**
 * Safety Flow：扫描后字段清单默认收起（Scan 不写 DOM）。
 * 点击「查看填写预览」展开逐字段 Review；没有可填字段时 CTA 不出现，静默跳过。
 */
export async function revealPreview(sidePanel: Page): Promise<void> {
  await sidePanel
    .getByRole("button", { name: "查看填写预览" })
    .click({ timeout: 8000 })
    .catch(() => {});
}

/**
 * 关掉「识别后直接填写」，回到「先看清单 → 勾选 → 确认并填写」的节奏。
 * 交付默认是自动填写；只有需要逐项检查的用例才切到这个模式。
 */
export async function setAutoFill(sidePanel: Page, autoFill: boolean): Promise<void> {
  await sidePanel.evaluate((value) => {
    return chrome.storage.local.get("afa.apply.prefs.v1").then((res) => {
      const prefs = (res["afa.apply.prefs.v1"] as Record<string, unknown> | undefined) ?? {};
      return chrome.storage.local.set({ "afa.apply.prefs.v1": { ...prefs, autoFill: value } });
    });
  }, autoFill);
  await sidePanel.reload();
  await sidePanel.getByRole("button", { name: /开始识别|重新识别/ }).waitFor({ timeout: 20000 });
}

/**
 * 等到「填写完成」出现。
 * 自动填写模式下识别动作本身就完成了写入；只有仍停留在待填写状态时才走确认对话框。
 */
export async function ensureFilled(sidePanel: Page, timeout = 60_000): Promise<void> {
  const fillBtn = sidePanel.getByRole("button", { name: /填写确认的|确认并填写/ }).first();
  const banner = sidePanel.getByText(/填写完成 ——/);
  const enabled = await fillBtn.isEnabled().catch(() => false);
  if (enabled) {
    await fillBtn.click({ timeout: 8000 }).catch(() => {});
    await sidePanel.locator(".dialog .primary", { hasText: "确认填写" }).click({ timeout: 8000 }).catch(() => {});
  }
  await banner.waitFor({ timeout });
}
