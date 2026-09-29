# Issue #004 — 登录面板与导航控件被当成可申请表单字段（手机号 → basic.phone）

Issue ID: ISSUE-004
Platform Family: Moka（`app.mokahr.com/campus_apply/shiyuehr/72055`）
页面类型: 职位详情页 + 点「申请职位」后原地弹出的**手机验证码登录面板**
问题字段: 登录用手机号输入框、导航栏职位搜索框（两个）
Severity: **P1**
Stage: SCAN / MATCH / RISK（缺"控件语境"判定）
Platform: Moka 校招租户
Status: **real_site_verified**（Real Regression Batch #4，2026-09-27）
进度：reproduced → fixture_created → fixed → regression_passed → **real_site_verified**

## 修复记录（Batch #4 · 2026-09-27）

新增通用 **Application Context Gate**，插在字段分类与候选构建之间：
`DOM Control → Field Classification → Context Eligibility → Candidate → ConfirmedFillPlan`。

| 层 | 改动 |
|---|---|
| `src/context/applicationContext.ts`（新） | 纯函数 `classifyApplicationContext(ctx)` → `{ eligible, zone, confidence, reasons, score }`；确定性正负评分，**不返回裸 boolean**（§四） |
| `src/content/contextExtractor.ts` | 只读采集 `ancestorSignals`（≤6 层，每层只存命中的语境词，不存正文）与 `siblingLabels`（同容器其他控件 label，≤10 条）；`body/html` 永不读全文 |
| `src/pipeline/scanPipeline.ts` | 门禁前置短路（在多条目轮转计数**之前**，否则登录手机号会挤掉真实经历序号）；`deriveStatus` 同步设防；unknown 且零信号 → 不给 `ready` |
| `src/pipeline/fillPlan.ts` | 第二道防线：`applicationContext.eligible === false` 不进计划 |
| `src/content/filler.ts` | 第三道防线：计划里出现 `contextEligible === false` → 整份拒绝写入 |
| `src/sidepanel/components/FieldList.tsx` | 排除项不进任何填写桶、不显示「请人工填写」（§二十），只以一行「已忽略 N 个网页控件」呈现；Dev 模式可展开看原因 |

**为什么是 `excluded` 而不是 `manual`**：`manual` 的语义是「这题需要你来填」，
把登录框放进那个桶等于告诉用户这是个申请字段。`excluded` 是「这根本不是申请表字段」。

### 中途被真机打回的一次（重要）

第一版实现**单测与 e2e 全绿，真实 Moka 却没拦住**：
`scripts/moka-context-gate.mjs` 首跑报 `意外候选: 请输入手机号 | basic.phone | SAFE | need-confirm`。
真机诊断（逐层 dump 祖先链）发现两个设计错误：

1. 认证文案在真实 DOM 的**第 4–6 层**（`.sd-Modal-content`：`+86获取验证码登录首次登录会自动创建新账号…`），
   而采集只到 3 层读全文 → 完全看不见；
2. 更糟：`modal / dialog / drawer / panel` 被我列进了**正向**申请信号，等于给登录弹层加分。

修正：采集深度放到 6 层（`body/html` 仍永不读全文）、认证信号按层衰减 `-6 / -4 / -2`、
弹层类 class 改为**语境中立**（§八：dialog 本身不是问题，要看里面写的是「投递简历」还是「验证码」）。
改完真机复跑：`detectedApplicationFields = 0`，`excludedByContextGate = 2`，`scanDiff = 0`。

## 修复后真机结果（未登录，不输入、不勾选、不点登录）

```text
controls = 7（登录面板展开后的真实页面）
detectedApplicationFields = 0
excludedByContextGate     = 2   ← 登录手机号(authentication) + 导航职位搜索框(search/navigation)
confirmedFillPlanApproved = 0
scanMutatedDom            = false（逐控件 diff = 0）
loginAttempted / submitted = false / false
```

验证码框本身由**既有的关键词忽略层**（`IGNORE_KEYWORDS` 含「验证码」）先拦掉，
不计入语境门禁功劳——分层防御，不重复计数。


## Expected

在**没有申请表单**的页面上（登录面板 / 导航栏），扩展不应把任何控件识别成可申请资料字段，
更不应给出 `risk=SAFE` 的可自动填写候选。登录手机号、验证码、站内搜索框属于认证与导航语境，
写入它们不是"填错字段"，而是**把用户的个人信息推进一个身份验证流程**。

## Actual

游客态打开「申请职位」→ 页面出现手机 + 验证码登录面板。此时点「开始识别」，
在**已种入合成资料**的条件下（`scripts` 级探针取证，未点击任何填写按钮、页面零写入）：

```json
[
  { "label": "输入职位关键字", "fieldId": "internship.position", "risk": "SAFE",
    "status": "need-confirm", "valueLen": 8,  "uiChecked": false },
  { "label": "请输入手机号",   "fieldId": "basic.phone",         "risk": "SAFE",
    "status": "need-confirm", "valueLen": 11, "uiChecked": false }
]
WOULD_ENTER_ConfirmedFillPlan = ["internship.position@输入职位关键字", "basic.phone@请输入手机号"]
```

两条都满足 `buildFillPlan` 的入计划条件（`confirmed` + `status ∈ {ready, need-confirm}` + 有内容 + 非 MANUAL_ONLY），
即：**用户点「确认并填写」就会把手机号写进登录框**。（`uiChecked:false` 不代表安全——
`App.tsx` 的 `confirmTargets` 会在点击时 force-confirm `need-confirm` 项，见同期记录的 P2 表征问题。）

## 为什么现在才暴露

姚记页面（上一批）DOM 里只有申请表单本身，没有导航搜索框、也没有登录面板，
所以"按 label/placeholder 文本匹配"这条路径从没被要求区分"表单控件"与"页面装饰/认证控件"。
Moka 一个页面就同时给了三类干扰源。

## 根因（修复前的原始定位）

1. **匹配只看文本**：`请输入手机号` → `basic.phone`、`输入职位关键字` → `internship.position`，
   从字段语义上甚至是"对的"——错的是**语境**。`RawFieldContext` 目前不带任何
   "我是否在 `<form>` 内 / 是否在认证对话框内 / 是否是站内搜索"的信号。
2. **`<form>` 缺失不是可用信号**：姚记详情页实测 `document.querySelectorAll("form").length === 0`
   （见 `2026-09-27-yaoji-real-write-synthetic-data.json` 的 `totalControlsBreakdown.form`），
   而它的表单恰恰是唯一可填的。所以"必须在 form 内"既不能单独成立，也不能作为唯一门禁。
   （Moka 详情页的同一项本轮未采，不作为论据。）
3. **重复的导航搜索框**：同一页存在 `op-search-input-*` 与 `navbar-search-input-*` 两个搜索框，
   都可见、都参与匹配 → 一旦写入就是重复落点（§二十二 的 duplicate write 风险面）。
4. **认证语境无黑名单**：`ignoreRules.ts` 现有忽略规则按 input type / 关键词，
   不含"登录/验证码/手机号登录面板"这类容器信号。

## 当初的建议 vs 实际落地（Batch #4）

| 当初设想 | 实际做法 | 为什么不同 |
|---|---|---|
| 加 `inForm` / `insideAuthContainer` / `isSiteSearch` 三个布尔 | 采 `ancestorSignals`（≤6 层的 tag/role/hints/命中词）+ `siblingLabels`，由分类器综合评分 | 三个布尔是"结论先行"，遇到没预料到的站点结构就没辙；§十 也明确要求不要 `if login => false else true` |
| 认证/导航控件降为 `MANUAL_ONLY` | 降为 **`excluded`**（新状态），不进候选清单 | §十九/§二十：`manual` 的文案是「请人工填写」，会把登录框伪装成一个待填申请字段 |
| 断言 `WOULD_ENTER_ConfirmedFillPlan` 为空 | 三层断言：卡片清单不含它 / 计划不含它 / Writer 见 `contextEligible:false` 整份拒绝 | 单点断言挡不住上游绕过 |

## 复现步骤

1. 全新持久化上下文（游客，无 cookie）打开
   `app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4-1328-4bb4-b341-2ad4783529ce`
2. 点「申请职位」→ 出现手机 + 验证码登录面板（URL 不变，原地弹层）
3. 侧边栏「开始识别」→「查看填写预览」
4. **修复前**观察到的候选：`basic.phone`（登录手机号）与 `internship.position`（导航搜索框），均 SAFE
   **修复后**：两者均被语境门禁排除，可填候选 = 0（`scripts/moka-context-gate.mjs` 断言并落盘）

## 取证位置

- 修复前：`real-validation-results/sessions/2026-09-27-moka-real-write-synthetic.md` §4/§5/§6
  （探针为一次性脚本，已删除；该文件内嵌其原始 JSON 输出）
- 修复后真机：`real-validation-results/sessions/2026-09-27-moka-context-gate.md`
  + `2026-09-27-moka-context-gate-data.json`，由**保留**的 `scripts/moka-context-gate.mjs` 生成
- 回归：`fixtures/real-regressions/issue-004-moka-login-context.html`（unit，12 例）、
  `tests/e2e/fixtures/compatibility/application-context.html`（浏览器：CTX-A/B/C + AA14）

