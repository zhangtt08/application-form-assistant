"""UI 冒烟验证 —— 用真实 Chromium 把构建产物跑一遍。

为什么需要它：
    单测只覆盖纯逻辑（匹配 / 解析 / 校验），盖不到「侧边栏能不能渲染、
    按钮点了有没有反应、识别→投递这条链路能不能跑完」。这个脚本补这一层。

做法：
    1. 起一个本地静态服务指向 dist/（ES module 在 file:// 下会被 CORS 拦掉）；
    2. 注入 chrome API 桩（storage / tabs / runtime），喂一份示例资料；
    3. mock 掉 content script 的 SCAN_TARGET / CAPTURE_TARGET / FILL_TARGET 响应；
    4. 依次走「开始识别 → 投递 → 确认填写 → 资料导入 → 设置」，逐步截图。

用法（改完代码先构建，再跑）：
    node node_modules/vite/bin/vite.js build --mode sidepanel   # 以及 content / background
    python smoke/smoke.py

    # 本机只有完整版 chromium、没装 headless shell 时：
    AFA_CHROME="<.../chromium-XXXX/chrome-win64/chrome.exe>" python smoke/smoke.py

退出码非 0 表示页面上出现了未捕获异常或 console.error。
"""
from __future__ import annotations

import functools
import json
import os
import pathlib
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SHOTS = pathlib.Path(__file__).resolve().parent / "shots"
PORT = 8899

# Windows 控制台默认 GBK，页面文案里的 ✓/⚠ 一类字符会直接把 print 打断
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROFILE = {
    "basic": {
        "name": "张小明", "englishName": "Xiaoming Zhang", "gender": "男",
        "birthDate": "2003.05", "age": "23", "phone": "15300001122",
        "email": "test.resume@example.com", "wechat": "test_resume_01", "qq": "100000001",
        "city": "杭州", "portfolio": "https://example.com/portfolio",
    },
    "education": [{
        "school": "示例科技大学", "college": "测试学院", "major": "测试专业",
        "degree": "本科", "educationLevel": "本科", "startDate": "2021.09",
        "endDate": "2025.06", "gpa": "3.7/4.0", "rank": "8/120",
    }],
    "internships": [{
        "company": "某某科技有限公司", "department": "产品部", "position": "产品实习生",
        "startDate": "2024.06", "endDate": "2024.09",
        "descriptionShort": "负责 AI 产品需求调研与竞品分析，输出 PRD 文档 8 份。",
        "descriptionMedium": "负责 AI 产品的需求调研与竞品分析；输出 PRD 文档 8 份，推动 3 个功能上线。",
        "descriptionLong": "负责 AI 产品的需求调研与竞品分析；输出 PRD 文档 8 份，推动 3 个功能上线；主导设计智能问答功能原型。",
        "responsibilities": "负责需求调研与竞品分析\n主导智能问答功能原型设计",
        "workContent": "输出 PRD 文档 8 份\n推动 3 个功能上线",
        "achievements": "上线后日均使用 1200 次",
        "summary": "完整走完一次从调研到上线的产品流程。",
        "variants": {
            "agent": "", "aiApplication": "",
            "aiProduct": "在某某科技产品部实习期间，负责 AI 产品需求调研与竞品分析，输出 PRD 文档 8 份；主导智能问答功能原型设计，上线后日均使用 1200 次。",
            "aiOperation": "", "aiSolution": "", "aigcMarketing": "",
        },
    }],
    "campus": [{
        "organization": "学生会", "department": "组织部", "position": "干事",
        "startDate": "2022.09", "endDate": "2023.06",
        "descriptionShort": "组织校园活动 5 场。",
        "descriptionMedium": "组织校园活动 5 场，累计参与 800 人次。",
        "descriptionLong": "组织校园活动 5 场，累计参与 800 人次；负责场地与物料统筹。",
        "responsibilities": "组织校园活动", "workContent": "场地与物料统筹",
        "achievements": "累计参与 800 人次", "summary": "",
        "variants": {"agent": "", "aiApplication": "", "aiProduct": "", "aiOperation": "", "aiSolution": "", "aigcMarketing": ""},
    }],
    "projects": [{
        "name": "智能问答助手", "role": "项目负责人", "startDate": "2023.10", "endDate": "2024.01",
        "descriptionShort": "基于 RAG 搭建校园知识问答链路，回答准确率提升至 85%。",
        "descriptionMedium": "基于 RAG 搭建校园知识问答链路；回答准确率提升至 85%。",
        "descriptionLong": "面向校园场景的问答系统；基于 RAG 搭建检索链路；回答准确率提升至 85%。",
        "keywords": ["RAG", "AI"],
        "background": "面向校园场景的知识问答",
        "responsibilities": "负责检索链路搭建", "workContent": "搭建 RAG 检索链路",
        "achievements": "回答准确率提升至 85%", "summary": "",
        "variants": {"agent": "", "aiApplication": "", "aiProduct": "", "aiOperation": "", "aiSolution": "", "aigcMarketing": ""},
    }],
    "skills": {
        "technical": ["Python", "SQL"], "tools": ["Figma", "Axure"],
        "languages": ["英语 CET-6"], "certificates": [], "awards": ["校一等奖学金"],
    },
    "jobPreferences": {
        "expectedCity": ["杭州", "上海"], "expectedPosition": ["AI 产品经理", "AI 产品运营"],
        "expectedSalary": "面议", "availableDate": "随时到岗",
        "employmentType": "实习", "expectedIndustry": "互联网 / AI",
    },
    "content": {
        "selfIntroduction": {"short": "计算机专业应届生。", "medium": "计算机专业应届生，做过 AI 产品实习。", "long": "计算机专业应届生，做过 AI 产品实习，熟悉需求调研与原型设计。"},
        "selfEvaluation": {"short": "做事细致。", "medium": "做事细致，交付前会自己先跑一遍。", "long": "做事细致，交付前会自己先跑一遍；习惯把问题定位到根因再动手。"},
        "personalAdvantages": {"short": "产品 sense 与技术理解兼备。", "medium": "产品 sense 与技术理解兼备，能和开发直接对齐。", "long": "产品 sense 与技术理解兼备，能和开发直接对齐方案细节。"},
        "careerPlan": {"short": "", "medium": "", "long": ""},
        "hobbies": {"short": "长跑", "medium": "长跑、摄影", "long": "长跑、摄影"},
    },
    "careerPreferences": {"targetDirections": ["AI 产品"], "preferredWorkTypes": ["实习"], "developmentGoals": ["成为 AI 产品经理"]},
    "sensitive": {"politicalStatus": "共青团员", "maritalStatus": "未婚", "idNumber": "330106200305011234", "emergencyContact": "13800000000"},
}

JOB_RAW = {
    "url": "https://jobs.example.com/job/ai-pm-12345",
    "pageTitle": "AI产品经理（实习）- 某某科技招聘",
    "metaTitle": "AI产品经理（实习）- 某某科技招聘",
    "metaCompany": "某某科技",
    "h1Texts": ["AI产品经理（实习）"],
    "bodyText": (
        "岗位职责\n"
        "1. 负责 AI 产品的需求分析与竞品分析，输出 PRD；\n"
        "2. 参与功能设计与原型设计，跟进迭代上线；\n"
        "3. 基于数据分析评估功能效果。\n"
        "任职要求\n"
        "1. 熟悉产品经理工作流程，有用户研究经验；\n"
        "2. 对大模型与 AI 应用有基本理解；\n"
        "3. 工作地点：杭州。\n"
    ),
}


def field(ref: str, label: str, name: str, kind: str = "text", max_len: int | None = None,
          section: str = "", options: list[str] | None = None) -> dict:
    """构造一个 content script 会返回的 RawField。"""
    return {
        "reference": ref,
        "kind": kind,
        "context": {
            "labelText": label, "placeholder": "", "ariaLabel": "", "name": name, "id": name,
            "title": "", "fieldsetLabel": "", "sectionTitle": section, "prevSiblingText": "",
            "parentText": "", "autocomplete": "", "inputType": kind,
            "maxLength": max_len, "required": False, "disabled": False, "readOnly": False,
            "currentValue": "",
        },
        "options": options or [],
    }


# 资料库：公共信息 + 每个库自己的内容切片
_LIB_CONTENT_KEYS = ["internships", "campus", "projects", "skills", "jobPreferences", "careerPreferences", "content"]
NOW = "2026-09-23T21:00:00.000Z"


def make_store() -> dict:
    """两个库：一个通用兜底、一个专供 AI 产品 —— 用于验证「按方向自动切库」。

    故意不写 afa.profile.v1，走 v2 主路径（迁移路径由单测覆盖）。
    """
    shared = {k: PROFILE[k] for k in ("basic", "education", "sensitive")}
    content = {k: PROFILE[k] for k in _LIB_CONTENT_KEYS if k in PROFILE}
    return {
        "schemaVersion": 2,
        "shared": shared,
        "libraries": [
            {
                "id": "lib_general",
                "name": "通用资料库",
                "directions": [],
                "note": "",
                "content": content,
                "createdAt": NOW,
                "updatedAt": NOW,
            },
            {
                "id": "lib_ai_product",
                "name": "AI 产品（校招）",
                "directions": ["aiProduct"],
                "note": "",
                "content": content,
                "createdAt": NOW,
                "updatedAt": NOW,
            },
        ],
        "activeLibraryId": "lib_general",
    }


FIELDS = [
    field("f-name", "姓名", "name"),
    field("f-phone", "手机号", "mobile"),
    field("f-email", "邮箱", "email"),
    field("f-school", "毕业院校", "school"),
    field("f-major", "专业", "major"),
    field("f-degree", "最高学历", "degree"),
    field("f-company", "实习公司", "company", section="实习经历"),
    field("f-position", "实习岗位", "position", section="实习经历"),
    field("f-desc", "实习工作描述", "intern_desc", kind="textarea", max_len=200, section="实习经历"),
    field("f-proj", "项目名称", "project_name", section="项目经历"),
    field("f-skill", "专业技能", "skills", kind="textarea"),
    field("f-intro", "自我介绍", "intro", kind="textarea", max_len=150),
    field("f-eval", "自我评价", "self_eval", kind="textarea", max_len=300),
    field("f-why", "为什么申请这个岗位？", "why", kind="textarea", max_len=300),
    field("f-idnum", "身份证号", "id_card"),
    field("f-political", "政治面貌", "political"),
    field("f-unknown", "请填写你最喜欢的一本书", "mystery"),
]

STUB = """(() => {
  const store = __STORE__;
  const changed = [];

  function handleTabMessage(msg) {
    // Side Panel 现在走按 frame 路由的 *_TARGET 消息（Background 再分发给具体 frame），
    // 桩件把它映射回原来的处理分支 —— 否则每个请求都落到 unmocked，识别永远出不来结果。
    const ALIAS = {
      SCAN_TARGET: 'SCAN_PAGE', FILL_TARGET: 'FILL_FIELDS', UNDO_TARGET: 'UNDO_FILL',
      LOCATE_TARGET: 'LOCATE_FIELD', CAPTURE_TARGET: 'CAPTURE_JOB',
    };
    const type = ALIAS[msg && msg.type] || (msg && msg.type);
    switch (type) {
      case 'PING': return { ok: true };
      case 'CAPTURE_JOB': return { ok: true, raw: __JOB__ };
      case 'SCAN_PAGE': return { ok: true, fields: __FIELDS__ };
      case 'FILL_FIELDS': {
        // 真实载荷是 { type, plan: { confirmed, fields } }（buildFillPlan 的输出）；
        // 曾经写成 msg.items —— 于是永远回 0 条 outcome，「已填写」恒为 0 也没人发现。
        const items = ((msg.plan || {}).fields || []);
        if ((msg.plan || {}).confirmed !== true) {
          return { ok: false, outcomes: [], originals: [], error: 'plan not confirmed' };
        }
        return {
          ok: true,
          outcomes: items.map((i) => ({ reference: i.reference, status: 'filled' })),
          originals: items.map((i) => ({ reference: i.reference, kind: i.kind, previousValue: '' })),
        };
      }
      case 'UNDO_FILL': return { ok: true, restored: (msg.originals || []).length, failed: 0 };
      case 'LOCATE_FIELD': return { ok: true, found: true };
      default: return { ok: false, error: 'unmocked:' + (msg && msg.type) };
    }
  }

  window.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...store };
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) { const o = {}; for (const k of keys) o[k] = store[k]; return o; }
          const o = {}; for (const k of Object.keys(keys)) o[k] = store[k] !== undefined ? store[k] : keys[k]; return o;
        },
        set: async (obj) => {
          const ch = {};
          for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          for (const fn of changed.slice()) fn(ch, 'local');
        },
        remove: async (k) => { if (typeof k === 'string') delete store[k]; },
      },
      onChanged: {
        addListener: (fn) => changed.push(fn),
        removeListener: (fn) => { const i = changed.indexOf(fn); if (i >= 0) changed.splice(i, 1); },
      },
    },
    runtime: {
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async (msg) => {
        if (msg && msg.type === 'ENSURE_CONTENT_SCRIPT') {
          return { ok: true, url: 'https://jobs.example.com/job/ai-pm-12345' };
        }
        // 面板现在通过 runtime.sendMessage 找 Background 路由器（Background 再按 frame 分发），
        // 桩件必须接在这个入口上 —— 以前 mock 挂在 tabs.sendMessage 上，于是每个请求都只拿到 { ok: true }，
        // 页面显示「识别失败：未知错误」而没人发现冒烟测试其实没在测识别。
        return handleTabMessage(msg);
      },
      getURL: (p) => p,
      lastError: undefined,
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://jobs.example.com/job/ai-pm-12345', active: true, currentWindow: true }],
      sendMessage: async (_tabId, msg) => handleTabMessage(msg),
    },
    sidePanel: { setPanelBehavior: async () => {} },
    scripting: { executeScript: async () => [] },
  };
})();
"""


def build_stub(empty_profile: bool = False) -> str:
    js = STUB
    store: dict = {} if empty_profile else {"afa.profiles.v2": make_store()}
    js = js.replace("__STORE__", json.dumps(store, ensure_ascii=False))
    js = js.replace("__JOB__", json.dumps(JOB_RAW, ensure_ascii=False))
    js = js.replace("__FIELDS__", json.dumps(FIELDS, ensure_ascii=False))
    return js


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102 - 静音
        pass


def serve() -> ThreadingHTTPServer:
    handler = functools.partial(QuietHandler, directory=str(DIST))
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> int:
    if not (DIST / "sidepanel.html").is_file():
        print("dist/ 里没有 sidepanel.html，先跑构建：")
        print("  node node_modules/vite/bin/vite.js build --mode sidepanel")
        print("  node node_modules/vite/bin/vite.js build --mode content")
        print("  node node_modules/vite/bin/vite.js build --mode background")
        return 2

    from playwright.sync_api import sync_playwright

    # 本机只装了完整版 chromium、没装 headless shell 时，用 AFA_CHROME 指过去，
    # 免得为了跑一次冒烟再下载一份浏览器。
    launch_kwargs = {}
    if exe := os.environ.get("AFA_CHROME"):
        launch_kwargs["executable_path"] = exe

    SHOTS.mkdir(exist_ok=True)
    serve()
    problems: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        ctx = browser.new_context(viewport={"width": 420, "height": 900}, device_scale_factor=2)
        ctx.add_init_script(build_stub())
        page = ctx.new_page()
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        page.on("console", lambda m: problems.append(f"console.error: {m.text}") if m.type == "error" else None)

        def shot(name: str, full: bool = True) -> None:
            page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)

        page.goto(f"http://127.0.0.1:{PORT}/sidepanel.html")
        page.wait_for_selector(".hero-btn", timeout=15000)
        shot("01-idle")

        # 识别 → 投递（Scan 只读：这一步之后页面还没被写，字段清单也还是收起的）
        page.get_by_role("button", name="开始识别").click()
        try:
            page.wait_for_selector(".summary", timeout=15000)
        except Exception:  # noqa: BLE001
            # 失败要能诊断：只甩 traceback 看不到面板到底停在哪一步
            print("PANEL TEXT >>>", page.inner_text("body")[:1500])
            raise
        shot("02-apply")
        print("SUMMARY >>>", " | ".join(x.strip() for x in page.inner_text(".summary").split("\n") if x.strip()))
        print("BANNER >>>", page.locator(".banner").all_inner_texts())
        print("STEPPER >>>", " / ".join(x.strip() for x in page.inner_text(".stepper").split("\n") if x.strip()))
        print("JOBBAR-SUB >>>", page.inner_text(".jobbar-sub").replace("\n", " "))
        # 当前设计：识别完成后字段明细就地渲染（按状态分桶折叠）；
        # 只有「没有可自动填写的项」时才需要点「查看填写预览」。
        if page.locator(".field-list").count() == 0:
            page.get_by_role("button", name="查看填写预览").click()
        page.wait_for_selector(".field-list", timeout=10000)
        page.wait_for_timeout(300)
        page.wait_for_timeout(300)
        print("FOLDS >>>", page.locator(".fold-head").all_inner_texts())
        print("CARDS >>>", page.locator(".field-card").count())
        shot("03-fields")

        page.get_by_role("button", name="按板块").click()
        page.wait_for_timeout(300)
        shot("04-by-section")
        page.get_by_role("button", name="按状态").click()
        page.wait_for_timeout(200)

        # 岗位条展开
        page.get_by_role("button", name="调整").click()
        page.wait_for_timeout(300)
        shot("05-jobbar")
        print("JOBBAR >>>", page.inner_text(".jobbar").replace("\n", " | "))
        print("JOBBAR LIB CHIPS >>>", page.locator(".jobbar .libbar .chip").all_inner_texts())
        print("JOBBAR ACTIVE LIB >>>", page.locator(".jobbar .libbar .chip.active").inner_text())
        page.get_by_role("button", name="收起").click()

        # 当前契约：识别完成后直接写入，不再有「确认填写」弹窗。
        # 冒烟因此改测这条链上真实存在的两个动作：撤销、重新识别。
        page.wait_for_selector(".banner-ok:has-text('填写完成')", timeout=15000)
        print("AUTOFILL BANNER >>>", page.inner_text(".banner-ok").replace(chr(10), " | "))
        shot("06-filled", full=False)
        primary = page.locator(".summary-actions button.primary")
        print("PRIMARY BTN >>>", primary.inner_text())
        page.get_by_role("button", name="撤销本次填写").click()
        page.wait_for_selector(".banner", timeout=15000)
        page.wait_for_timeout(400)
        print("UNDO BANNER >>>", page.locator(".banner").all_inner_texts())
        shot("07-undone", full=False)
        page.wait_for_timeout(400)
        shot("07-done")
        print("AFTER FILL >>>", " | ".join(x.strip() for x in page.inner_text(".summary").split("\n") if x.strip()))

        # 资料页：资料库切换器 + 纯文本导入
        page.get_by_role("button", name="资料").click()
        # 已有资料时「导入简历」默认收起（用户进这页是来改字段的）；先看它是否摊开
        page.locator(".import-fold").first.evaluate("el => { el.open = true }")
        page.wait_for_selector(".import-panel", timeout=10000)
        page.wait_for_timeout(300)
        print("PROFILE LIB CHIPS >>>", page.locator(".libbar .chip").all_inner_texts())
        print("PROFILE ACTIVE LIB >>>", page.locator(".libbar .chip.active").inner_text())
        print("PROFILE LIB META >>>", page.inner_text(".libbar-meta"))
        print("PROFILE GROUPS >>>", page.locator(".pe-group").all_inner_texts())
        shot("08-profile")
        page.get_by_role("button", name="填入示例格式").click()
        page.get_by_role("button", name="解析预览").click()
        page.wait_for_selector(".preview-head", timeout=10000)
        page.wait_for_timeout(300)
        shot("09-import-preview")
        print("PREVIEW >>>", page.inner_text(".preview-head"))
        print("NOTES >>>", page.inner_text(".preview-list").replace("\n", " / "))

        # 设置 / 岗位
        page.get_by_role("button", name="设置").click()
        page.wait_for_selector(".card", timeout=10000)
        page.wait_for_timeout(300)
        shot("10-settings")

        # AI Provider：切到 DeepSeek，确认地址与模型自动带出
        page.locator(".provider-settings summary").click()
        page.wait_for_selector(".provider-settings select", timeout=10000)
        page.locator(".provider-settings select").select_option("deepseek")
        page.wait_for_timeout(300)
        inputs = page.locator(".provider-settings input")
        print("DEEPSEEK BASEURL >>>", inputs.nth(0).input_value())
        print("DEEPSEEK MODEL >>>", inputs.nth(1).input_value())
        page.locator(".provider-settings").scroll_into_view_if_needed()
        shot("11-provider-deepseek", full=False)

        page.get_by_role("button", name="岗位").click()
        page.wait_for_timeout(600)
        shot("12-jobs")

        # 首次使用（资料库为空）：应当先被引导去导入简历，而不是对着填不出东西的「开始识别」发呆
        octx = browser.new_context(viewport={"width": 420, "height": 900}, device_scale_factor=2)
        octx.add_init_script(build_stub(empty_profile=True))
        opage = octx.new_page()
        opage.on("pageerror", lambda e: problems.append(f"pageerror(onboarding): {e}"))
        opage.goto(f"http://127.0.0.1:{PORT}/sidepanel.html")
        opage.wait_for_selector(".hero-cta", timeout=15000)
        opage.screenshot(path=str(SHOTS / "13-onboarding-empty.png"), full_page=True)
        print("ONBOARDING >>>", opage.inner_text(".hero-cta").replace("\n", " | "))
        if opage.locator(".hero-btn.ghost").count() != 1:
            problems.append("空资料状态下「开始识别」没有降级为次要按钮")
        opage.get_by_role("button", name="导入我的简历").click()
        try:
            opage.locator(".import-fold").first.evaluate("el => { el.open = true }")
        except Exception:  # noqa: BLE001
            pass  # 空资料时面板本来就是摊开的
        opage.wait_for_selector(".import-panel", timeout=10000)
        octx.close()

        browser.close()

    print("\n=== PROBLEMS ===")
    if problems:
        for x in dict.fromkeys(problems):
            print(" ", x)
    else:
        print("  (none)")
    print(f"\n截图目录：{SHOTS}")
    return 1 if any(x.startswith("pageerror") for x in problems) else 0


if __name__ == "__main__":
    sys.exit(main())
