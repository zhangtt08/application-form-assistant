# 交接文档 — application-form-assistant

> 面向接手的 agent。快照 2026-09-30 ｜ HEAD `341e92e`（无 remote，历史只在本机；工作区有大量未提交改动 = 本会话成果）
> 当前验证态（**同一份 dist 上实测**，2026-09-30，非引用）：Unit **644/644**（38 文件）· typecheck 零输出 · build 三入口 ·
> E2E **88/88**（20.5 分钟全绿；含英文 ATS、「是否…」单选题、JD-only 页文案、岗位原页跳转用例）· Compat **30/30**（含在 88 内，报告 False Fill Count = 0）·
> smoke.py exit 0 / `PROBLEMS (none)`（420px 真实渲染截图在 `smoke/shots/`）· privacy:scan **0 ERROR / 0 WARN**。
> 真机 Real Write 平台 **3 个**：姚记（自建 ATS）15/15 卡片按资料库写入；
> Greenhouse（job-boards）9 卡片写入、Lever（jobs.lever.co）8 卡片写入，EEO / 授权题一律不动 —— 见 `real-validation-results/pilot-log.md`。
> 岗位识别另覆盖国内主流官网：**字节跳动校招 / 携程招聘官网 / 小红书校招列表页**（2026-09-30 真机）。
> 这三家的申请表单在手机号 + 验证码之后，字段文案改从**站点自己的前端产物**里抠（curl + grep），
> 固化成 `tests/realLabels.bytedance.test.ts`；由此暴露并修掉 issue-006（公司名取错段/筛选条当公司）
> 与 issue-007（限定词标签、跨经历时间栏、他人栏抢名）、issue-008（携程内推表的「候选人…」是别人）、
> issue-009（`og:title` 被当公司名 → 公司与职位两栏同时错，英文标题里的逗号被当句子标点）四条错填根因。
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
- **「是否…」单选题有资料库来源**（是否接受线下面试 / 线上面试 / 出差 / 异地外派 / 加班）。
  它们在资料页各答一次（是 / 否 / 未设置）；站点选项常写成「可以接受 / 不接受」，
  选项覆盖判定、点哪个选项、写入回读三段都用同一份同极性写法表 `src/rules/yesNoAnswers.ts`，
  所以「是」绝不会勾到「不接受」上（含「接受」两字的反义词）。未设置 → 留空，不猜。
- **别人的信息不用你的资料顶替**：标签含「推荐人 / 内推人 / 介绍人 / 证明人 / 家长 / 监护人 /
  配偶 / 亲属 / 紧急联系人 / referee」时，除专为他人设立的 canonical
  （`basic.emergencyContactName` / `basic.emergencyContactPhone`）外一律判 `unknown`。
  真机成因：「推荐人姓名」里含「姓名」，别名是**包含式**匹配，会把应聘者自己的名字写进推荐人栏。
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

# 把某个站点的「原料」落盘成离线回放用例（表单在登录后时用这个）
"$N" scripts/jd-raw-dump.mjs "https://jobs.bytedance.com/campus/position/<id>/detail" bytedance
#   → real-validation-results/sessions/2026-09-30-<name>-raw.json，喂给 tests/realdata.*.test.ts
# 站点自己的前端产物里往往写着表单全部文案，不需要账号：
#   curl -sL <JD页> | grep -oE '"[^"]{0,28}(姓名|手机|邮箱|学历|专业|紧急联系|内推)[^"]{0,28}"' | sort -u
```

**必须用上面那个系统 node 路径跑测试。** PATH 上的 node/npm 是 WorkBuddy 托管版，带文件代理 shim，
会间歇性 EPERM 并**静默丢弃 vitest 测试文件收集**——症状是测试文件数漂移。数量漂移 = 已中招，
别把「少跑了」当成「过了」。

**本仓库有 git**（`git rev-parse --is-inside-work-tree` = true，当前 HEAD `341e92e`，无 remote）。
历史里有一次隐私 scrub（§7），tag `pilot-v1-baseline` 指向 `d042026`，**不要 retag、不要重写历史**；
在 scrub 之前不要生成 bundle。改动前用 `git status` 看清工作区，未提交的改动就是本会话的成果。

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
3. **同页并发下拉的串扰**：已按「本次触发后才出现的选项优先 → 离自己触发器近的优先」排序
   （`eventDispatcher.rankPopupOptions`），两个弹层同时开着且都有同名选项时不再点错（`tests/popupIsolation.test.ts`）。
   仍属**启发式**：如果站点把两个弹层的选项都静态挂在 body 上、又不新出现节点，就只能靠距离排序；
   真机遇到新的挂法要继续补这条排序。
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
8. **国内主流平台的「字段识别 + 写入」证据只有一个站点**：字节跳动校招、小红书校招、Moka 的申请表单都在
   手机号 + 验证码登录之后，游客不可达，不能拿账号进测试（§7 禁止存凭证）。这三家本轮只验证到**岗位识别**
   （见 `real-validation-results/pilot-log.md` 2026-09-30 行），国内站点的字段识别与真机写入仍以姚记（自建 ATS）
   为准，其余靠英文 ATS 真机（Lever / Greenhouse）+ 本地 fixture 覆盖。北森 `nio.hotjob.cn` 在本网络
   `ERR_CONNECTION_CLOSED`，未采集，不能算验证过。
   2026-09-30 另外三次的诚实结果：**前程无忧**真机拿到的是阿里云 WAF「滑动验证页面」；
   **Workday**（hkex 简体站）公开深链被重定向到「搜索职务」列表，`--click` 也点不进去（职位要 XHR 搜索后才渲染）；
   **小红书**详情页路由需前端交互，只验证到列表页。这三家扩展都是「未识别到岗位」而不是编造，
   但**字段识别与写入未覆盖**，别当成已支持。
9. **「工作经历」板块按实习线填写是有意的产品口径**（不是错配）：简历导入 (`src/profile/resumeTextParser.ts` /
   `importMapper.ts`) 把简历里的「工作经历」并进 `internships[]`，资料库里不存在第二条独立的「正式工作」线，
   所以字节跳动那种「实习经历 / 工作经历」两段并存的表单里，两段都会取同一条线的值。
   真要给「正式工作」单独一档，需要先改 Profile 数据模型（多加一条线 + 导入分流 + 资料页各一栏），
   再同步改 `tests/realLabels.bytedance.test.ts` 里钉住这个口径的那条断言。

## 6. 环境陷阱（本机）

1. 见 §2 的系统 node 问题（最重要）。
2. **`node_modules` 会被整体清空**（2026-09-29 实测：跑 E2E 跑到一半 `node_modules/playwright` 整个消失，
   worker 报 `Cannot find module .../workerProcessEntry.js`，连带 36 个用例 `did not run` + 一屏 ENOENT）。
   同样地，`%LOCALAPPDATA%\ms-playwright` 也会被清空。**跑长测前先 `npm install` 一次**，
   看到 `worker process exited unexpectedly` / `ENOENT ... test-results/...` 别当成产品缺陷，先补依赖再重跑。
3. **Playwright 版本与本机浏览器 revision 不一定对得上**（要 chromium-1243，机器上只有 1228）。
   `e2e/helpers.ts:resolveChromeExecutable()` 已改成自动挑本机最新的 `ms-playwright/chromium-*/chrome-win64/chrome.exe`
   （可用 `AFA_CHROME` 覆盖），**不要再为此下载浏览器**。
4. **同一时间只跑一个 Playwright 进程。** 两次运行共用 4198 的 `reuseExistingServer`，
   先结束的那次会关掉 webServer，另一次就整片 `ERR_CONNECTION_REFUSED`（本会话踩过，40 个用例白红）。
   文件系统不稳时用 `--trace=off` 跑，少写一半 artifact 就少一半 ENOENT 机会。
5. **python 版 Playwright 与 node 版不是同一份浏览器**。`smoke/smoke.py` 默认找
   `chromium_headless_shell-1228`，本机只有完整版 chromium。用环境变量指过去：
   ```bash
   AFA_CHROME="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" \
     python smoke/smoke.py
   ```
   smoke.py 会打真实渲染截图到 `smoke/shots/`（gitignored），**改 UI 后要用它做视觉验证**，
   不要只看 typecheck 绿就收工。
6. 批量删 `test-results/`（>50 项）会被安全删除 shim 拦（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）
   导致 e2e 启动即崩。用 PowerShell：`powershell.exe -Command "Remove-Item -Recurse -Force test-results"`。
7. e2e 的 webServer 占 4198（`reuseExistingServer: true`），并行调试时别起第二个。
8. 全量 e2e 一轮约 10~20 分钟（workers:1，全绿时）；有失败时每个用例各烧 15–30s 超时会明显变慢。
   定位问题按文件分跑，最后再全量。
   **红之前先分清是不是浏览器半路死了**：2026-09-30 全量跑 Scenario H 报
   `browserContext.close: Target page, context or browser has been closed`（不是断言失败），
   单跑 `npx playwright test e2e/scenarios.spec.ts -g "Scenario H"` 32s 通过。
   看到这种「afterEach 里才炸」的红，先单跑该文件再决定要不要改代码。
   数测试数量用 `npx playwright test --list`（输出 `Total: 88 tests in 15 files`），别靠文档里的旧数字。
9. 多行文本替换一律用 Edit 工具，别用 bash/python heredoc + 反引用——`\1` 会把换行吃掉。
10. Windows 控制台默认 GBK，脚本 print 中文/`✓` 会 `UnicodeEncodeError`。新脚本要
    `process.stdout.write` 或 `sys.stdout.reconfigure(encoding="utf-8")`。
11. 注释里别写 `chromium-*/chrome-win64` 这种带 `*/` 的路径——它会把块注释提前关掉，
    整个文件语法崩（本会话踩过一次，症状是 Playwright 报 `Unexpected character`）。
12. **真机 pilot 全站 `net::ERR_PROXY_CONNECTION_FAILED`**（2026-09-30 实测）：Chromium 读 Windows
    系统代理（注册表 `127.0.0.1:7897`）连不上，而同一个代理对 `curl` 与显式 `--proxy-server` 都是通的。
    `scripts/delivery-pilot.mjs` / `scripts/jd-raw-dump.mjs` 已把 `HTTPS_PROXY` 显式传给浏览器
    （`AFA_NO_PROXY=1` 可改走直连）。这是本机环境问题，不是产品缺陷；离线 E2E 走 127.0.0.1 不受影响。

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

1. **撤销在真机被站点拒还**（§5.1）：姚记 14 个字段写入成功后撤销 `恢复 0 / 未恢复 14`。
   下一步做法：撤销后逐字段验证不通过时，再补一轮「清空 + 校验」，或在 Fill 阶段用
   `HTMLInputElement` 的值描述符 + 焦点/输入序列重放；离线 fixture 的撤销链路已全绿，
   所以这是站点侧对抗，不要误判成自己的回归。验证入口：
   `node scripts/delivery-pilot.mjs <岗位页> --apply "投递简历"` → 报告里的 `undoNotice` / `afterUndo`。
2. **是/否 语义的匹配收口**（2026-09-29 晚已闭环）：真机曾把「是否接受线下面试」匹配成
   `basic.politicalStatus`（靠容器里隔壁字段的标签撞上的）。护栏之外现在补上了正式 canonical：
   `job.accept{OfflineInterview,OnlineInterview,BusinessTrip,Relocation,Overtime}`
   （资料页「求职偏好」各答一次 是/否/未设置，`YES_NO_PREFERENCE_KEYS` 是单一来源）。
   站点选项写「可以接受 / 不接受」时按同极性精确写法命中，判定链三段共用 `src/rules/yesNoAnswers.ts`。
   剩下的活只有一种：遇到新题型的问法，往 `FIELD_ALIASES` 里补问句形态的别名（别写「加班」这种单词，
   会把「对加班的看法」这类文本框误判成单选题）。
   验证入口：`tests/yesNoPreference.test.ts` + `e2e/delivery-flow.spec.ts`（fixture 里就放了一道
   选项写成「可以接受 / 不接受」的题）。
3. **Moka 登录态二轮**（登录后申请表可达 → 全链路）。游客态下真实申请表单仍在手机号 +
   短信验证码之后（2026-09-29 复测仍是这个结论），所以 Moka 依旧是 `Real Write Pending Login`。
   用户已在自己浏览器里登录的场景，扩展是直接对当前页面工作，不需要任何凭证入库：
   **绝不要把 cookie / token / storageState / 账号写进仓库、Evidence、logs、截图**；
   Evidence 只落长度 / shape / 布尔 / hash，含填写值的截图只进 `real-validation-results/private/`。
4. **多平台 Pilot**：把 `scripts/delivery-pilot.mjs` 跑遍北森 / 大易 / 牛客 / Boss 等重平台，
   统计每站「识别到几个字段 / 填进几个 / 为什么填不进」，按报告补词表与控件策略。
   2026-09-30 进度：字节跳动 / 小红书 / 携程 已完成**岗位识别**真机验证（issue-006 由这轮暴露并修复）；
   这三家的表单都在登录后，字段文案改从**站点自己的前端产物**里取（curl 取页面 → grep 引号串 →
   `tests/realLabels.*.test.ts` 逐条断言），这条路子不需要账号、也不碰凭证。
   北森 `nio.hotjob.cn` 在本网络 `ERR_CONNECTION_CLOSED`，仍未采集。
   站点公开信息（公司名、岗位名、JD、URL）可以留，那是回归原料；用户自己的履历不可以。
5. 远期：LLM 解析器（`JobParser` 接口已留位）、多简历切换体验打磨、死代码清理（§5.4）。

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

## 10. 本轮（2026-09-29）交付化改造 —— 从「能识别但填不进」到可交付

目标口径变了：**识别岗位 → 进网申 → 识别字段 → 按岗位一键填入，不逐项人工确认**。
为了让这条链路在真机上跑通，改了这些（每条都有用例或真机记录）：

| 症状 | 根因 | 改动 | 证据 |
|---|---|---|---|
| 认得出字段却填不进 | 写入层是同步的：点完下拉/日历立刻读 `input.value`，而弹层与选中值是异步渲染的 | `eventDispatcher` / `writeVerifier` / `filler` 全链路改 async：`waitFor` 等真实回显，自定义下拉按「点触发器(pointer/mouse/click 全序列)→等弹层→敲搜索词再等→点 `elementFromPoint` 命中节点→找子树静态选项」逐级尝试，只点文本精确命中的节点 | `tests/filler.test.ts`（Ant 异步弹层、只读日历、无匹配不瞎点）、真机 `delivery-pilot` |
| 一填就把整张表搞消失 | 下拉触发器会退到 `probe.parentElement`，真机上那是分段折叠标题；且失败时 `document.body.click()` 关弹层会关掉抽屉 | `selectTriggerOf` 只允许控件自己或「小容器」（≤2 控件、不含标题）；取消 body 点击，只按 Escape；连续 3 个字段找不到就停下说清原因，不再一屏红 | 真机对照：改动前 2/15 写入、13 个「字段已消失」；改动后 14/15 |
| 少填 | 政治面貌/身份证/婚姻/籍贯/户口/身高体重/紧急联系人被一刀切 `MANUAL_ONLY`；radio/checkbox 组整组不支持；contenteditable 无 maxlength 就不填；`学历/学位` 混成一个字段；年份数字框收不下 `2026.06` 就整字段放弃 | 敏感词表收口到「承诺/声明/签名/调剂/背调/授权」；这些客观信息进 Profile（`basic.*` 扩 12 个字段 + `education.degreeType/direction`）并有输入框；checkbox 组按词条精确勾选；contenteditable 放开；数字控件按语义取年/月；旧数据 `sensitive.*` 作为回退来源 | `tests/matcher.test.ts`、`tests/scanner.test.ts`、`e2e/scenarios.spec.ts` E/F、真机 `毕业年份=2027` |
| 识别不到 | 组控件的字段名取自选项自己（男/CET-6）；`autocomplete` 这个标准语义信号没用；同名重复块的 label 完全相同；SPA 分步加载时字段还没渲染 | radio/checkbox 组用 `groupTitleFor`（legend / 行内非控件标签）；`autocomplete` 进信号表（0.94）；指纹加入 `structuralPath`；`scanPageSettled` 等 DOM 稳定再扫 | `tests/scanner.test.ts` 组标题用例、`tests/filler.test.ts` 重复块用例 |
| 填错位置 | 属性相同的多控件靠同类序号消歧，页面插一个节点就整体漂移；经历条数不足时把最后一条重复填进每一块 | 指纹加结构路径 + 消歧次序（属性→路径→序号，都定不下来就判失败）；多条目越界返回 undefined（留空）；单选/多选答案必须在站点选项里对得上，否则不写；组控件不再读 `parentText` | `tests/filler.test.ts`「前置插入控件后仍找回原元素」`tests/profile.test.ts` 越界、真机 False Fill=0 |
| 跨域 iframe 里的表单 | 注入只投主 frame，Side Panel 也只跟主 frame 说话 | manifest `content_scripts.all_frames`；Background 变成按 frame 的路由器（`SCAN_TARGET/FILL_TARGET/UNDO_TARGET/LOCATE_TARGET/CAPTURE_TARGET`，用 `webNavigation.getAllFrames` 枚举，含 `about:blank`）；`RawField.frameId` 一路带到写入计划；目标 tab 跳过非 http(s)（面板自己占 tab 时不会指错页） | `e2e/delivery-flow.spec.ts` 跨域 iframe 用例（127.0.0.1 页内嵌 localhost frame） |
| 撤销报了成功其实没恢复 | 写完值后站点重排 DOM，指纹失效 → 撤销找不到元素 | Fill 阶段给元素打 `data-afa-undo` 标记，撤销优先按标记回查；恢复走与写入相同的验证重试 | `tests/filler.test.ts` undoTag 断言；真机仍受限（见 §5.1） |
| 「是否…」单选题永远留人工 | 站点选项写成「可以接受 / 不接受」而资料答案是「是」：包含式匹配会把「不接受」当成「接受」（勾反 = 填错位置），严格式又一律判「选项对不上」→ 不写 | 新增 canonical `job.accept*` 五项 + 资料页「是 / 否 / 未设置」输入（`YES_NO_PREFERENCE_KEYS` 单一来源）；同极性写法表 `src/rules/yesNoAnswers.ts` 由**选项覆盖判定、radio/checkbox 勾哪个、原生 select 选哪个 option、自定义下拉（弹层与子树静态选项）点哪个节点、写入回读**五段共用，只在同极性内精确扩展；顺带删掉无人引用的 `MANUAL_ONLY_OPTION_TEXTS`（承诺类判定统一在 `riskRules`） | `tests/yesNoPreference.test.ts`、`e2e/delivery-flow.spec.ts`（fixture 里就放了一道写成「可以接受 / 不接受」的题） |

| 英文招聘网站整片认不到 | Greenhouse / Lever / Workday 类站点把姓名拆成 `First name` + `Last name`、城市问 `Where are you based?`、还有 `LinkedIn profile`，中文别名表一个都对不上 → 认不到 = 少填；`autocomplete="given-name"` 这个标准信号也没用 | 新增 `basic.surname / basic.givenName / basic.linkedin`（资料页各一栏，**绝不把整名自动拆开**——复姓与中英混排会拆错）+ 问句形态英文别名；`AUTOCOMPLETE_MAP` 补 `given-name / family-name`；`basic.city` 补英文现居地写法（不抢 `job.expectedCity`） | `tests/englishAtsAliases.test.ts`（6 用例，含「期望城市/所在城市 不被英文别名抢走」）、`e2e/delivery-flow.spec.ts` 英文 ATS 用例（fixture `tests/e2e/fixtures/english-ats.html`：First/Last/Email/Phone/based/LinkedIn/Portfolio 全填，authorization/sponsorship 单选题一律不碰） |

| 「是否有实习经历 / 是否有项目经验」这类是非题留人工 | 资料库没有对应字段，问句认得到却没有取值来源；早期还出现过度匹配（把裸名词「实习经历」当别名 → 命中「请描述你的实习经历」的 textarea，会把「是」塞进描述框） | 新增 `internship.hasExperience` / `project.hasExperience`：答案由**已存在的条目**单向推出（有条目 → 「是」；条目为空 → 不回答，绝不因为没录就答「否」，那是替用户编造事实）；别名只收完整问句；同时加了 `tests/aliasCoverage.test.ts` 成对性检查（每个 canonical 必须有别名、别名不得指向野 id、不得写装饰/单字词），这类漏词从此自己会报错 | `tests/derivedPresence.test.ts`、`e2e/delivery-flow.spec.ts`（fixture 里的「是否有实习经历」勾中「是」） |

| 把应聘者自己的名字填进「推荐人姓名」 | 别名是包含式匹配（信号包含别名即 0.85），而 basic.name 的词表里有「姓名」——真机站点的推荐人栏标签里正好含「姓名」 | matcher 增加他人标记守卫：标签 / placeholder / name / fieldset 里出现「推荐人·内推人·介绍人·证明人·家长·监护人·配偶·亲属·紧急联系人·referee」时，除非命中原为「他人」设立的 `basic.emergencyContact*`，一律 `unknown` | `tests/realLabels.yaoji.test.ts`（12 个标签是从站点前端产物里抠出的真实文案）、`e2e/delivery-flow.spec.ts` 的 `#f-referrer` 保持为空 |

| 真机 Greenhouse 上的三类**错填** | ① 别名用裸包含式：`city` 命中 `ethni|city|`（`id=hispanic_ethnicity` 被填成城市）、`tel` 命中 `|tel|l`（开放问答被填成手机号）；② 组合控件继承分组标题：电话控件的 `<legend>Phone</legend>` 让同组的 `Country` 下拉被填成手机号；③ EEO / 自证类问题（民族·种族·残障·兵役）没有任何守卫，纯靠词表运气 | ① 纯 ASCII 别名改为**整词**命中（`matcher.aliasIn` + 词边界正则缓存），中文仍走包含式；② 控件自己有标签、候选又只来自 fieldset/section/parent → 判 unknown，不替它猜；③ `PROTECTED_CLASS_MARKERS` 守卫：自证类一律 unknown；④ 同分冲突时让控件的 `type` / `autocomplete` 决断（「电子邮箱地址」以前会被判冲突而白丢一个字段） | `tests/aliasWordBoundary.test.ts`（含真机三例 + 电话控件组合 + 中文包含式与冲突决断）、Greenhouse 真机复跑：`Country` / `Tell us about…` / `Are you Hispanic/Latino?` 全部转 unknown，First/Last/Email/Phone/City/School/Degree/LinkedIn/Gender 正常写入 |
| smoke.py「通过」但其实没在测识别 | 桩件把 mock 挂在 `chrome.tabs.sendMessage` 上，而面板早已改走 `runtime.sendMessage → Background 按 frame 路由`；每个请求只拿到 `{ok:true}`，页面显示「识别失败：未知错误」，而脚本只等 `.summary` 超时后抛 traceback，谁也没看到它测了什么 | 桩件入口改到 `runtime.sendMessage` 并把 `*_TARGET` 映射回原分支；确认弹窗一步改成按当前契约断言「识别即写入 → 撤销 → 恢复 N 个字段」；等待失败时先打印面板文本再抛（失败必须可诊断） | `python smoke/smoke.py` → exit 0、`PROBLEMS (none)`、`AUTOFILL BANNER 成功 14`、`UNDO BANNER 已撤销本次填写，恢复 14 个字段` |

| 第三平台 Lever 上 `GitHub URL` 认不到 | 词表里没有 GitHub 这个来源（技术岗标配字段），资料库也没有这一栏 | 新增 `basic.github`（资料页 GitHub 栏 + 别名 `github / github url / 代码仓库 / 开源主页` + 导入映射 + 读盘带过），与 portfolio / linkedin 三个来源互不抢标签 | `tests/englishAtsAliases.test.ts`、`e2e/delivery-flow.spec.ts` 英文 ATS 用例的 `#github`、真机 Lever `GitHub URL → basic.github` filled |

| 结果页像 demo：14 张一样的大卡片铺 2000px、满屏 `basic.name` / `99%`、填完之后主按钮是灰的「没有可填写的项」 | 卡片只有一种形态（调试视角），没有「结论优先 / 细节按需」的分层 | 已按资料填好的客观信息压成**一行紧凑条目**（字段 · 值 · 来源），点开才看完整卡片（`.field-card.field-line`，`aria-label` 只报字段名）；canonical id 与置信度百分比收进「设置 → 开发者模式」；填完后主操作变成出路「投递下一个岗位」；副标题不再重复汇总数字，撤销后不再同时显示「表单已填写」与「已撤销」两句矛盾话 | `smoke/smoke.py` 全流程 exit 0（截图 02-apply / 07-done）、`e2e/compat/aa-core.spec.ts` AA13/AA14、`e2e/safety-flow.spec.ts` 忽略流程（展开后操作） |
| 资料页写着「敏感信息（政治面貌/婚姻/身份证/紧急联系人）永远不会被自动填写」 | 文案停留在旧口径；现在这些是**按资料库填写**的客观信息，只有承诺/同意/签名/调剂/背调/签证与他人信息不代填 | 改成如实描述；「导入简历」面板在已有资料时默认收起（进这页的人是来改字段的）；保存按钮不再显示成灰掉的「已保存」 | `smoke/smoke.py` 资料页步骤 |
| 岗位卡片整块可点但看不出来点了会怎样 | 只有状态标签，没有下一步提示 | 行尾直接写下一步（开始申请 / 继续填写 / 查看进度 / 去笔试…），`JOB_NEXT_STEP` 与状态同源 | `smoke/smoke.py` 岗位页截图 |
| 「担任职务」在「校园经历 / 学生会」板块里被填成实习职位 | 语义槽位转移表里没有 position 这一组，section 信号只能惩罚不能改派 | `SEMANTIC_SLOTS` 增加 `internship.position / campus.position / project.role` 一组，板块写着校园就落校园线 | `tests/labelCoverage.test.ts` 消歧用例 |
| 中文站高频标签覆盖面没有回归网 | 之前只有单条 matcher 用例，漏一个词表项没人知道 | 新增 `tests/labelCoverage.test.ts`：56 条真机/高频中文标签逐条断言 canonical，另断言内推码 / 推荐人 / 民族 / 已阅读并同意 / 本人承诺必须保持 unknown | 该文件本身 |
| 国内官网岗位识别把团队/筛选条当公司（真机 issue-006） | 这两个站点没有 JSON-LD、没有 header/footer 品牌节点、没有 og:site_name，公司名只剩 `document.title` 一条信号；而 title 段按原顺序入候选（`职位 - 团队 - 公司` → 团队段先胜出），筛选条词只降权不拒绝（`company_element` 0.95 减 0.45 还剩 0.5） | title 段**倒序**采集；新增 `FILTER_CITY_WORDS` + `ADMIN_DIVISION_PATTERN` 精确即拒（不看来源置信度）；parser 加事后不变量「公司名是岗位串片段 → 置空」 | `scripts/jd-raw-dump.mjs` 落盘真机原料 → `tests/realdata.cn-careersites.test.ts`（修复前 3 failed）；真机字节复跑 `字节跳动 · Android开发工程师 - 移动OS` |
| 国内主流平台的字段识别只能靠猜 | 字节跳动/小红书的**申请表单在登录后**，游客看不到一个字段；但它们的**官网前端产物（bundle）里写着全部字段文案** | 用 curl 取 JD 页 HTML 后 grep 引号串，抠出真实文案（姓名/手机号码/邮箱/学历/学历类型/专业/期望工作地点/户口所在地/婚姻状况/实习经历/教育经历/项目经历/紧急联系人姓名·电话·与自己的关系/内推码/个人证件），逐条断言 → `tests/realLabels.bytedance.test.ts` | 该文件 6 用例；跑出来三个错填形态（见下三行） |
| 「学历类型」被当成「学历」、「紧急联系人与自己的关系」被当成「紧急联系人姓名」 | 包含式别名：标签比别名长一个限定词，胜出候选不是那个字段；资料库根本没有这两栏 | matcher 新增 `QUALIFIED_SUFFIX_PATTERN`（`类型/类别/种类/关系` 结尾）守卫：只有**没被完整别名精确命中**时才拦，写法完整的「学位类型」照常识别 | `tests/realLabels.bytedance.test.ts`（学历类型 → unknown，学位类型 → `education.degreeType`） |
| 教育经历板块里的「开始时间 / 结束时间」拿到实习的起止月份 | 槽位转移原本只在 campus/project/internship 三组启用（`sectionGroupOf` 对「教育及实习经历」这类混合标题会返回 education，启用就会误伤），教育板块的时间栏没人管 | `DATE_SLOTS` 单列两组时间槽；education 组**只在标题不含实习/项目/校园字样时**启用，且只转移时间栏 | `tests/realLabels.bytedance.test.ts`（`教育经历 / 开始时间` → `education.startDate`）、`tests/matcher.test.ts` 混合标题用例仍绿 |
| 「职位描述」被裸别名「职位」抢去当岗位名 | 别名表里 responsibilities 只有「工作职责/岗位职责」这一族，没有站点实际用的「职位描述」 | `internship.responsibilities` 补 `职位描述 / 职务描述`（完整写法 1.0 分压过 0.85 的包含式） | 同上（实习经历板块的「职位描述」→ `internship.responsibilities`） |
| 「姓名」出现在「紧急联系人信息」这一块里时被当成应聘者本人的姓名 | 他人守卫只看 label/aria/placeholder/name/id/fieldset，不看控件前面那行标题 | `whoText` 并入 `prevSiblingText`（方向仍是宁缺勿错：只会少填，不会错填） | `tests/realLabels.bytedance.test.ts` 的「姓名 + 紧急联系人信息」用例 |
| 携程内推表单里的「候选人姓名 / 手机号 / 邮箱」会被填成应聘者自己 | 他人守卫词表只有推荐人/家长/配偶等，缺站点明说的形态；真实文案自带「（请勿填写你的个人信息）」 | `OTHER_PERSON_MARKERS` 增加 `请勿填写你的/您的个人信息`；**刻意不收裸词「候选人」**（北森/大易把应聘者本人的资料区也叫「候选人信息」，一刀切会造成大面积少填） | `tests/realLabels.ctrip.test.ts`（3 用例：三个他人栏 → unknown；`sectionTitle=候选人信息` 下的「姓名/手机号码」照常命中）；文案由 `curl careers.ctrip.com` + grep 取自站点自身 bundle，见 issue-008 |
| 只有 JD 的页面上，面板说「网页上的内容已撤销，可重新识别」 | 这句话挂在 `phase==="done"` 分支，而真机字节跳动那种没有表单的页面走的是 `phase==="ready"` + 0 候选：既没填过也没撤销过，却说撤销了；主按钮还是一个空的「查看填写预览」 | 新增 `undone` 状态（只有真撤销过才说撤销）；0 候选时副标题如实说「这个页面没有网申表单字段（岗位已记录，进入投递页再识别）」，主按钮换成出路「投递下一个岗位」，notice 同步改口径 | `e2e/jd-only-page.spec.ts`（fixture `job-agent.html` 无任何表单控件） |
| 岗位卡片写着「开始申请 ›」，点了却到不了那个岗位 | 「开始 / 继续申请」只切到「投递」标签页，对着的是**当前活动标签页**（可能是别的网站）；「来源」也只是印在面板上的一段死文字，全仓没有任何 `chrome.tabs.create` | `focusOrOpenJobSource()`：该 URL 已开在某个标签里就激活它，否则新开；「来源」改成真链接 | `e2e/jobs-open-source.spec.ts`（关掉原页 → 点开始申请 → 轮询确认扩展把那个页面重新打开；不断言 `>0` 而是先 close 再查，杜绝空断言） |
| 英文 ATS 的岗位条公司栏印着职位名、职位栏「未识别岗位」（真机 issue-009） | 一条链上三个错：① `jobCapture` 把 `og:title` 当 `metaCompany`（ATS 上 og:title 就是职位名）→ 公司=职位，随后 `isReasonablePositionTitle` 的「候选与公司名相同即拒绝」把真 `<h1>` 挤掉；② 句子标点正则把半角逗号算进去，而英文标题惯例就是「Software Engineer, Data Platform」；③ ATS 宿主页连雇主自己写的 `alt="General Matter Logo"` 都不采信 | `metaCompany` 不再回落 og:title；`SENTENCE_PUNCTUATION` 去掉半角逗号（中文「，」仍拦）；ATS 宿主页接受 `logo_alt`（厂商名仍被 `ATS_BRAND_PATTERN` 一律拒绝）+ `NOISE_SUFFIXES` 剥 `logo/标志/图标`；职位详情节点选择器补 `posting-headline/posting-title/app-title`（Lever 无 h1） | `tests/realdata.ats-capture.test.ts`（真机原料回放）+ `tests/positionExtraction.test.ts` 逗号用例；真机复跑 `Spotify · Android Engineer - Experience`、`General Matter · Software Engineer, Data Platform` |
| 点进 `/apply` 之后，刚捕获的好岗位被覆盖成「未识别岗位」 | `tryCaptureJob` 的守卫是 `position===未识别岗位 && jd.length<200`，而申请子页正文里带着职位描述，长度守卫形同虚设 | 岗位名就是这条记录的身份证：`position === "未识别岗位"` 一律不捕获、不覆盖 | 真机 Lever 复跑：`/apply` 页识别完 19 张卡片后岗位条仍是 `Spotify · Android Engineer - Experience` |
| 设置页写着「Mock（离线测试）… 用于验证流程本身」、面板里还印着一行裸 URL | 开发者视角的文案泄漏到用户界面 | Provider 默认档改名「离线（不联网）」并说明「开放题回答由资料库条目拼装、Key 只存本机」；URL 行改成「当前页面：<可点开的链接>」 | `python smoke/smoke.py` 截图 `10-settings.png` / `07-done.png`、`PROBLEMS (none)` |
**明确不做**：自动点击提交、自动同意协议/承诺、代填验证码、上传简历文件（`input[type=file]` 只能人工）。

## 11. 资料索引

- `README.md` — 生成评测体系（Validator / 评测集 / Prompt Regression）
- `docs/SAFETY_FLOW_AUDIT.md` — 安全流程根因审计。注意它是 2026-09-25 的历史记录：里面
  「本项目无 git 仓库（HANDOVER §7）」当时属实、现已不成立，且旧 HANDOVER 的章节号与本文不再对应
  （迁移清单在本文是 §9）。
- `docs/TEST_INVENTORY.md` — 测试分层清单
- `docs/TEST_DATA_POLICY.md` · `docs/GIT_PRIVACY_HISTORY_AUDIT.md` · `real-validation-results/README.md`
- `real-validation-results/` — pilot-log（流程 + 停止条件）、sessions/、issues/
- `fixtures/real-regressions/` — 结构回归 HTML 样本
- `compatibility-results/report.md`、`e2e-report/` — 可重生成的测试产物（已 gitignore 的是后者）
