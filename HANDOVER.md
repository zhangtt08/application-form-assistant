# 交接文档 — application-form-assistant

> 面向接手的 agent。快照 2026-09-27 ｜ HEAD `e9b1329`（无 remote，历史只在本机）
> 当前验证态（本会话实测，非引用）：Unit **532/532**（24 文件）· typecheck 零输出 · build 三入口 ·
> E2E **76/76** · Compat **28/28** · **False Fill 0** · smoke.py exit 0 无 console error ·
> privacy:scan **0 ERROR / 0 WARN**。
> 这份文档取代旧的 `HANDOVER.md` + `HANDOVER-SAFETY-FLOW.md`（后者随本批删除，内容已并入；
> 两文件都在 git 历史里，`git show d042026:HANDOVER-SAFETY-FLOW.md` 可查）。

---

## 1. 产品红线与长期不变量（任何改动不得违反）

```
资料库 / Profile
   ↓ Scan（只读：DetectedFields → Resolve → Candidates）              ← Scan Never Writes DOM
   ↓ 按岗位方向选资料库 + 取值（Matcher → Risk → Resolver → deriveStatus）
   ↓ ConfirmedFillPlan（buildFillPlan：可填状态 + 有内容 + 非承诺类）
   ↓ Field Writer（fillFields 唯一写入口；content 侧第二/第三道运行时门禁）
   ↓ Write Verification（每次尝试都必须 dispatch input/change 并等异步回显）
   ↓ 结果逐字段回显（成功 / 失败原因 / 需人工），Undo 供恢复
   ↓ 用户自己在网站上点击提交
```

- **产品口径（2026-09-29 起）：识别完成后直接填写，不做逐项人工确认。**
  「确认」这一步只保留给设置里的开关（`识别后直接填写` 关掉时走先看清单的节奏，
  以及改过值之后重新写入时的一次点击）。
- **永不自动提交、永不自动点「下一步 / 同意协议」**。全仓不存在对目标页面的 submit 类点击；
  写入层唯一的点击是「下拉弹层里文本匹配上的那个选项节点」。
- **不代用户做保证**：承诺 / 声明 / 电子签名 / 已阅读并同意协议 / 是否接受调剂
  → `MANUAL_ONLY`，永不写入（这些不是「资料」，是保证）。
- **客观个人信息现在按资料库填写**（政治面貌 / 婚姻状况 / 身份证号 / 籍贯 / 户口 / 紧急联系人 /
  身高体重 / 联系方式…）。库里没有 → 留空，绝不编值。
- **宁缺勿错**的三类硬门禁：
  1. 内容超过字段 `maxlength` → 不写（不截断、不硬塞超长值）；
  2. 单选/多选组：资料里的答案在站点给的选项里对不上 → 不写（真机防错填）；
  3. 数字控件收不下且按语义（年/月）也取不出合法数字 → 不写。
- **Scan 阶段对页面零写入**。守护：`e2e/scan-does-not-write.spec.ts` + `e2e/safety-flow.spec.ts`
  + `tests/safetyContract.test.ts`。写入阶段会给元素打 `data-afa-undo` 标记（撤销回查用），
  那属于 Fill，不属于 Scan。
- 真实 Pilot 中 **False Fill ≥ 1 或值串位 → 立即停止**，按 `real-validation-results/pilot-log.md` 头部流程处理。

## 2. 30 秒上手

```bash
cd C:/Users/Administrator/Desktop/application-form-assistant
N="/c/Program Files/nodejs/node.exe"
S="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/npm/bin/npm-cli.js"
"$N" "$S" run typecheck && "$N" "$S" test && "$N" "$S" run build   # 三连
"$N" node_modules/playwright/cli.js test                          # E2E + compat，见 §6
"$N" "$S" run privacy:scan                                         # 提交前必跑，ERROR 必须为 0

# 真实站点跑一遍交付链路（识别岗位 → 进表单 → 识别字段 → 一键填入 → 撤销）
"$N" scripts/delivery-pilot.mjs "https://zhaopin.yaoji.cn/job/<id>" --apply "投递简历"
#   → real-validation-results/sessions/delivery-pilot-*.json（只记标签/长度/判定，不记填写值）
```

**必须用上面那个系统 node 路径跑测试。** PATH 上的 node/npm 是 WorkBuddy 托管版，带文件代理 shim，
会间歇性 EPERM 并**静默丢弃 vitest 测试文件收集**——症状是测试文件数漂移。数量漂移 = 已中招，
别把「少跑了」当成「过了」。

**本仓库当前没有 `.git`**（跨机拷贝后丢失）。所有历史叙述（旧 HEAD、tag）都只是文档记载；
改动前请先自行备份 `src/`（本仓库无版本控制可回滚）。

装扩展：Edge → `edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → 选 `dist/`。改完代码要
重新 build 并在扩展页点刷新，否则跑的是旧产物。

## 3. 项目是什么 / 架构地图

ATS 简历自动投填浏览器扩展（Manifest V3，TS strict + Vite 三入口 + React 18 sidepanel + zod v4）。

| 模块 | 职责 |
|---|---|
| `content/` | 页面侧：`scanner.ts` 只读扫描（含 open shadowRoot + 稳定窗口等待）、`filler.ts` 唯一写入口、`eventDispatcher.ts` 各控件写入策略（异步等回显）、`domUtils.ts` realm-safe 判定/可见性/label 推断/指纹与反查/`waitFor`、`contextExtractor.ts` 上下文采集（含 radio/checkbox 组标题） |
| `background/` | MV3 service worker：打开面板、**按 frame 注入与转发**（`SCAN_TARGET / FILL_TARGET / UNDO_TARGET / LOCATE_TARGET / CAPTURE_TARGET`）、SPA 路由变化转发。目标标签页会跳过非 http(s) 页面（面板自己占 tab 时不会指错页面） |
| `job/` | `jobParser.ts`（RawJobPage→JobContext + 分类）、`companyExtraction.ts`、`positionExtraction.ts`、`schema.ts`、`jobStore.ts`（`afa.jobs.v1`，投递页顶部关联岗位） |
| `profile/` | 资料库：`schema/store/libraryStore`（多库 + shared/content 拆分）、`importMapper.ts`、`resumeTextParser.ts`（离线纯文本解析）、`profileResolver/router`（取值与方向路由；多条目越界留空不重复填） |
| `matching/` `rules/` | 表单字段 → canonical 字段匹配（含 `autocomplete` 标准语义信号）；别名、风险规则、忽略规则 |
| `pipeline/` | `scanPipeline.ts`（Scan→Match→状态分级 + 数字/选项格式门禁）、`fillPlan.ts`（ConfirmedFillPlan + 结果汇总，携带 frameId） |
| `answering/` `generation/` | 开放题：分类 → prompt → 生成 → **answerValidator 事实追溯守卫**；Provider（OpenAI 兼容 / mock） |
| `compatibility/` | `writeVerifier.ts`（写策略 + 异步验证 + 一次重试，**已接线**）、`environmentDetector`、`recoveryManager`/`siteAdapter`/`importRestore`/`workspaceIntegrity`（**仍未接线，见 §5**） |
| `workspace/` | 岗位库 / Session / Event 仓储（`afa.jobs.v2` 系），删除/清空会同步清掉 v1 的关联（幽灵岗位修复） |
| `sidepanel/` | React UI；样式**只有** `styles/base.css` 一份；`.field-card` 带 `data-status` / `data-field-id` |

## 4. 测试契约：改什么会牵连什么

- **类名与 data 属性是契约**：`.field-card / .field-value / .field-meta / .val-badge / .source-badge /
  .confirm-check / .value-input / .dialog .primary / .summary-actions`，以及 `.field-card[data-status]`、
  `.field-card[data-field-id]`（被 `e2e/delivery-flow.spec.ts`、`compat` 系列和 `scripts/*-pilot.mjs` 依赖）。
  改 DOM 结构要同步改脚本。
- **填写节奏的契约**：交付默认是「识别即填写」。
  - 断言「写完了」统一用 `helpers.ts:ensureFilled(sidePanel)`（按钮还可用就走确认框，否则等完成横幅）；
  - 需要「先看清单再勾选」的节奏（忽略某字段、逐项检查）用 `helpers.ts:setAutoFill(sidePanel, false)`；
  - 不要在新用例里直接 `getByRole('button',{name:/确认并填写/}).click()`——自动填写后没有待确认项，
    按钮不渲染，会白等 15~30s。
- **文案不是契约**：面向用户的文案一律中文，枚举值走 `data-*`
  （`[data-risk]` / `[data-status]` / `[data-field-id]` / `[data-val]`）。
  Pilot 脚本与 e2e 只读属性，所以**改文案不会再牵连测试**。
- **首屏引导不能吃掉「开始识别」按钮**：`helpers.ts:openSidePanel()` 是**先开面板、后 seed 资料**，
  它等 `/开始识别|重新识别/`。Profile 为空时投递页会出导入引导卡，但「开始识别」必须始终存在。
- **真实站点的识别按钮匹配要用 `.last()`**：SPA 自己会改 DOM → 顶部出现「页面结构变了 → 重新识别」横幅，
  与主操作同名，strict mode 会判歧义（`scripts/delivery-pilot.mjs` 已这么写）。
- **测试中途改 Profile 必须 v1+v2 双写**：首启后 `afa.profiles.v2` 已存在，`loadStore` 只认 v2，
  只改 legacy `afa.profile.v1` 会被静默忽略。e2e 用 `helpers.ts:seedProfileDeep()`。
- 新增调 `scanPage` 的 unit 测试要在 `beforeAll` mock `getBoundingClientRect`（jsdom 无布局引擎），
  参考 `tests/filler.test.ts`。写入层现在全是 async，用例必须 `await`。
- 禁止 skip/only/注释掉失败场景；删测试要给理由。
- **判断 Playwright 结果不要用管道**：`playwright test | tail` 的退出码是 `tail` 的，永远 0。
  重定向到文件看真实 exit code，或读 `test-results/.last-run.json`。

## 5. 已知坏着 / 未修（下一位 agent 最该看的部分）

按「会不会在真实站点上咬人」排序。

1. **撤销在部分站点被页面拒还**（真机实测：姚记 14 个字段写入成功后撤销 `恢复 0 / 未恢复 14`）。
   我们按写入同样的路径把值改回去并派发 input/change，站点自己又把值填了回来（草稿回填 /
   受控组件重写）。面板现在如实提示「N 个字段页面没有交还控制权，请在网页上手动清空」，
   不再假装撤销成功。离线 fixture 的撤销 E2E 全绿，所以这是**站点侧对抗**，不是链路坏在手里；
   要做到真机可依赖，得在撤销后逐字段验证不通过时再补一轮「清空 + 校验」或改用 native 值描述符重写。
2. **下拉「点不开」的站点仍会失败**：写入层已经会 点触发器(pointer/mouse/click 全序列) → 等弹层 →
   敲进搜索框再等 → 点 `elementFromPoint` 命中的节点 → 找子树里的静态选项，全部失败才判失败。
   但只认**可信任手势**才渲染选项的下拉（真机见过 Greenhouse 类 `select__input`）依旧填不上，
   报「弹层选项未出现或无匹配项」。content script 无法伪造 trusted 事件，这是浏览器边界；
   再往上只能走 CDP `Input.dispatchMouseEvent`，那需要 debug 权限，不属于当前形态。
3. **同页并发下拉的串扰**：两个自定义下拉同时处于打开态时，`popupOptions` 是全 document 查询，
   可能命中另一个弹层的同名选项（有文本精确匹配 + 回显验证兜底，错填风险低但未彻底隔离）。
4. **死代码**（产品代码零引用，只有 unit 或历史脚本用）：`compatibility/{recoveryManager,
   siteAdapter,importRestore,workspaceIntegrity}.ts`、`installFormObserver`、`src/pilot/**`、
   `sidepanel/components/{PackLibrary,TagInput}.tsx`、`scripts/{append-css,update-*,fix-ux9,
   debug-aa11}.mjs`（一次性源码改写脚本，**别再跑**）。删不删由用户定。
5. **`summarizeFillOutcome` 的口径**：`manualBlocked` 统计所有 `manual` 候选，`skipped` 用减法推导。
   不是错，但读数字时容易误读。
6. **日期格式仍是"按字段语义适配"而非全量**：`input[type=number]` 的年份/月份框会从 `2026.06` 取
   `2026`/`6`；文本日期框按 `YYYY.MM` 原样写入，站点若要求 `YYYY-MM-DD` 由写入层的等价日期比较放过，
   但提交前仍需人工核对格式（真机见过站点直接接受 `2026.06`）。
7. **closed shadowRoot 扫不到**（浏览器不允许），`scanPage` 只处理 open root。

## 6. 环境陷阱（本机）

1. 见 §2 的系统 node 问题（最重要）。
2. **`%LOCALAPPDATA%\ms-playwright` 会在会话外被清空**（本会话实测发生过一次，导致 E2E/smoke
   突然起不了浏览器；不是本会话删的，AppData 下没做过任何删除）。恢复：
   `node node_modules/playwright/cli.js install chromium`（装回 chromium-1243 + headless shell）。
   **下一轮 Pilot 前先确认浏览器还在。**
3. **python 版 Playwright 与 node 版不是同一份浏览器**。`smoke/smoke.py` 默认找
   `chromium_headless_shell-1228`，本机只有完整版 chromium。用环境变量指过去：
   ```bash
   AFA_CHROME="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" \
     python smoke/smoke.py
   ```
   smoke.py 会打真实渲染截图到 `smoke/shots/`（gitignored），**改 UI 后要用它做视觉验证**，
   不要只看 typecheck 绿就收工。
4. 批量删 `test-results/`（>50 项）会被安全删除 shim 拦（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）
   导致 e2e 启动即崩。用 PowerShell：`Remove-Item -Recurse -Force test-results`。
5. e2e 的 webServer 占 4198（`reuseExistingServer: true`），并行调试时别起第二个。
6. 全量 e2e 一轮约 3.5 分钟（workers:1，全绿时）；有失败时每个用例各烧 15–20s 超时会明显变慢。
   定位问题按文件分跑，最后再全量。
7. 多行文本替换一律用 Edit 工具，别用 bash/python heredoc + 反引用——`\1` 会把换行吃掉，
   本仓库踩过一次把函数压成一行的语法事故。
8. Windows 控制台默认 GBK，脚本 print 中文/`✓` 会 `UnicodeEncodeError`。smoke.py 已
   `sys.stdout.reconfigure(encoding="utf-8")`；新脚本照做。

## 7. 隐私规则（硬约束）

完整政策：`docs/TEST_DATA_POLICY.md`；本目录产物规则：`real-validation-results/README.md`；
历史状态：`docs/GIT_PRIVACY_HISTORY_AUDIT.md`。要点：

- 测试 / smoke / fixture **只用合成身份 + 合成履历**，判据是「可能是真实个人标识就不能留」，
  不是「看起来像不像假的」。多条目 fixture 的公司/项目名**必须彼此不同**，否则串位检查失去判别力。
- **含填写值的 Pilot 截图不入库**，放 `real-validation-results/private/`（已 gitignore）。
  写入正确性由结构化记录（长度 / `sameValue` / hash / status）证明，不由截图证明。
- 公开招聘信息（姚记科技、广州诗悦、公开岗位名、JD 正文、ATS URL）**保留**——那是 Job Capture
  回归原料。区分「招聘方公开信息」与「用户自己的履历」。
- `npm run privacy:scan`：ERROR 必须为 0 才能 commit。扫描器**不打印命中原文**（防二次泄露），
  banned 字面量在扫描器里按片段拼接（否则扫描器自己就是含脏值的文件）。
- **Git 历史里仍有前脱敏数据**（合成身份字段脏在 `d042026`~`9ac913d`；教育·雇佣履历与那张
  filled-form 截图的 blob 脏在 `d042026`~`f5fd15b`）。两轮都**没有**重写历史。
  仓库公开 / 分发 bundle 之前必须先 history scrub（需用户单独批准）；
  tag `pilot-v1-baseline` 保持指向 `d042026`，**不要 retag**。
  在 scrub 之前**不要生成 bundle**（会把脏历史整份复制到仓库外）。

## 8. 下一步（按优先级）

1. **姚记 Real Write Pilot #1**（合成 profile、真实 DOM 写入验证、**不点 Submit**）。
   流程与停止条件严格按 `real-validation-results/pilot-log.md` 头部；脚本 `scripts/yaoji-real-write.mjs`。
   上一轮结果：11/11 写入逐字段 verified、False Fill 0、radio 0/2 未触碰、撤销恢复成功
   （`real-validation-results/sessions/2026-09-25-yaoji-real-write.md`）。
   注意 §5.6：这一轮往离职时间框写的会是具体月份。
2. **修 §5.1 的双仓储**：`clearAllApplicationData` / `deleteJobCascade` 一并清 `afa.jobs.v1`，
   或把 active job 收敛到 v2 单一来源。
3. **Moka 登录态二轮**（登录后申请表可达 → Scan 全链路）。2026-09-27 现状：Capture 无回归、
   未登录页的语境安全过滤已真机验证（issue-004 已修），但**真实申请表单仍在手机号 + 短信验证码登录之后**，
   游客不可达，所以 Moka 仍是 `Real Write Pending Login`，不是 Real Write Verified。
   **未来若用户明确授权登录态 Pilot，安全原则（本批只记录，不实施）**：
   - 优先使用**用户本机已有的持久化浏览器 Profile**，**不要**导出 `storageState` 进仓库；
   - 认证数据（cookie / token / storageState / 账号）一律不得进入 Git、Pilot Evidence、logs、截图；
   - Evidence 仍只落长度 / shape / 布尔 / hash，值正文不落盘；含填写值的截图只进 `real-validation-results/private/`。
   Moka 相关优化到此为止，不做无目标打磨。
4. **新平台 Pilot**：多步骤表单 + 自定义 Select + DatePicker + Multi-entry 的重平台（Boss 直聘 / 牛客等）。
5. 远期：LLM 解析器（`JobParser` 接口已留位）、多简历切换体验打磨。

## 9. 版本管理与迁移

git 已建。历史（新→旧）：`e9b1329` privacy phase 2 · `f5fd15b` privacy 文档整改 ·
`f085ea2` privacy phase 1 · `9ac913d` 前端设计/可用性 + 写入链路 4 个真实缺陷 ·
`c719f34` 姚记 real-write pilot · `d042026` baseline（tag `pilot-v1-baseline`）。无 remote。

`.gitignore` 排除：`node_modules/ dist/ coverage/ .vite/ playwright-report/ e2e-report/
test-results/ smoke/shots/ real-validation-results/private/ _transfer-backup/ *.log
*.timestamp-*.mjs .env*`。

新机器：`npm install` → 按 §2 跑三连 → `npx playwright install chromium` → build → 加载 `dist/`。
验收：单测全绿（系统 node）+ 姚记站 Capture 显示「姚记科技 · 游戏测试工程师-27届秋招」+
`e2e/scan-does-not-write.spec.ts` 通过。

**跨机拷贝历史事故**：2026-09-24 晚曾产生 182 个 `*-<12位hex>.ts` 双胞胎文件并造成两机分叉。
再见这种文件名即传输残留；备份件留在 gitignored 的 `_transfer-backup/`。

## 10. 资料索引

- `README.md` — 生成评测体系（Validator / 评测集 / Prompt Regression）
- `docs/SAFETY_FLOW_AUDIT.md` — 安全流程根因审计。注意它是 2026-09-25 的历史记录：里面
  「本项目无 git 仓库（HANDOVER §7）」当时属实、现已不成立，且旧 HANDOVER 的章节号与本文不再对应
  （迁移清单在本文是 §9）。
- `docs/TEST_INVENTORY.md` — 测试分层清单
- `docs/TEST_DATA_POLICY.md` · `docs/GIT_PRIVACY_HISTORY_AUDIT.md` · `real-validation-results/README.md`
- `real-validation-results/` — pilot-log（流程 + 停止条件）、sessions/、issues/
- `fixtures/real-regressions/` — 结构回归 HTML 样本
- `compatibility-results/report.md`、`e2e-report/` — 可重生成的测试产物（已 gitignore 的是后者）
