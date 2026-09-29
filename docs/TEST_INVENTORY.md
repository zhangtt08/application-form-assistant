# TEST_INVENTORY — 测试分层清单

> 更新: 2026-09-25（Safety Flow Reconciliation 批次收尾：五连全绿）
> 目的：明确每一层测试验证什么，避免再次出现「Unit 全绿但 Browser 流程已经换代」的脱节。
> 运行环境注意（本机）：WorkBuddy 托管 node 带文件代理 shim，会间歇性对 vitest 临时缓存写返回 EPERM，
> **静默丢弃部分测试文件的收集**（数量在 19~21 文件间漂移）。验收必须用系统原生 node：
> `"/c/Program Files/nodejs/node.exe" "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/npm/bin/npm-cli.js" test`

## 分层总览

| 层 | 命令 | 运行环境 | 验证什么 | 当前规模（2026-09-25 实测） |
|---|---|---|---|---|
| Unit / Integration | `npm test`（必须用系统 node，见上） | vitest + jsdom | 纯逻辑与 DOM 无关解析：parser/capture/pipeline/matcher/store/writer 契约 | **24 文件 / 530 例全绿** |
| Browser E2E | `npm run test:e2e` | Playwright + 真实 Chromium + dist 扩展 | 真实扩展端到端流程与安全语义（Scan Never Writes DOM） | **76 例全绿** |
| Compatibility | `npm run test:compat` | 同上 | 真实表单形态的写入兼容（受控组件/Shadow DOM/iframe/多条目…）与真实站点（姚记） | **28 例全绿**（e2e/compat/ 5 文件；compat 报告 False Fill Count = 0） |
| Real-data Replay | `npm test` 内 `tests/realdata.moka-retest.test.ts` | vitest | 真实 Moka 页面原料（落盘 JSON）→ 正式 parser 的回归；JSON 缺失自动跳过，不伪造 | 5 例 |
| Real-site Optional | `scripts/issue002-retest.mjs` 等脚本 | Playwright 无头 | 真机结构侦察与原料采集（需要网络）；产物作为 Real-data Replay 的输入 | 按需 |

## Unit 层文件清单（tests/，24 文件）

| 文件 | 验证什么 |
|---|---|
| job.test.ts | JobParser：position/company 提取、分类、变体接线、Moka 回归 |
| jobCapture.test.ts | capture 端选择器：h1/jobDetailTitles 分路、Case A-D 长度过滤、sd-foundation-heading |
| positionExtraction.test.ts | 来源打分优先级、GENERIC 栏目词黑名单、isReasonablePositionTitle 接受/拒绝清单 |
| realdata.moka-retest.test.ts | **真机回放**：真实 Moka 原料 → parser 断言（position/company/source/Pack 不误路由） |
| companyExtraction.test.ts | 公司名管线：ATS 域名短路、品牌拦截、domain fallback 收紧 |
| safetyContract.test.ts | **安全契约**：scanPipeline 源码无写入动作、runScanPipeline 输出形状、buildFillPlan 过滤规则、fillFields 运行时门禁 |
| filler.test.ts | Writer：native setter 写入、Write Verification、undo、**ConfirmedFillPlan 门禁（未确认/空计划拒绝）** |
| stage2.test.ts | buildFillPlan / summarizeFillOutcome / schema 兼容 |
| multiEntry.test.ts | 多条目 entryIndex 轮转分配 |
| matcher.test.ts | 表单字段 → Profile 匹配 |
| profile.test.ts / profilepack.test.ts | Profile 解析/库；Pack CRUD、matcher 确定性、**不因「策划」误路由** |
| workspace.test.ts | JobRecord CRUD、**Duplicate Detection（same URL 更新不新增）**、session |
| pilot.test.ts | Safe Mode / Pilot 仓储 |
| libraryStore.test.ts / importMapper.test.ts | 资料库 CRUD / 简历导入映射 |
| answering.test.ts / generation.test.ts / provider.test.ts | 开放题生成链、事实追溯守卫、Provider 预设 |
| evaluation.test.ts | 生成评测集标注 |
| scanner.test.ts / compatibility.test.ts | 字段扫描、环境检测/恢复 |
| resumeTextParser.test.ts | 简历文本导入解析 |
| __probe.test.ts | 临时探针（custom-select.html 扫描分级 dump，供 Safety E2E 参考） |

## Browser E2E / Compatibility 文件清单（e2e/，76 例，其中 compat/ 28 例）

| 文件 | 验证什么 |
|---|---|
| scan-does-not-write.spec.ts | **长期安全红线**：Scan→Preview 期间真实 DOM 必须为空；确认后才写入（永远不许删） |
| safety-flow.spec.ts | 8 个安全场景：DOM 空 / LOW 默认勾选不写 / 确认才写 / HIGH 不写 / 取消勾选不写 / MEDIUM 未确认不写 / 手工编辑生效 / Write Verification |
| scenarios.spec.ts | 场景 A~Y + 跨页面/刷新恢复/Dev Trace：JD→变体切换、方向手动指定（调整→chip）、高风险拦截、maxlength 不截断、开放题生成与事实守卫、Provider 设置 |
| stage5-z1-z6 / z7-z12.spec.ts | Stage 5 工作区/会话/恢复（Inbox→Workspace→开始申请、标记投递、Session Resume、迁移、删除） |
| compat/aa-core.spec.ts | AA1~AA12：受控组件回滚、动态字段、多条目、SPA 路由、Shadow DOM、iframe 边界、DOM remount、Mutation Guard |
| compat/compat-report.spec.ts | 兼容性基准跑分（Native/React/Vue/Shadow/iframe/自定义 Select/Multi-entry/Hidden Duplicate） |
| compat/real-yaoji.spec.ts | 真实姚记站：Capture（开始识别内置）+ 13 字段识别回归（radio 正确 MANUAL ONLY） |
| compat/ux-profilepack.spec.ts | 资料库 UX：首启默认库、路由仅建议不强切（UX4）、手动指定方向（UX5）、新建/切换/删除库（UX8/UX9） |
| compat/ux-order-pilot.spec.ts | Multi-entry 两条目按资料顺序映射不串位（UX11，Pack 体系已移除）、Dev 轨迹开关持久化（UX12，旧 Pilot Mode 已移除） |
| debug.spec.ts | 开发调试入口 |

## 层间关系（为什么不能只看 Unit）

- Unit 层不启动扩展、不加载 dist、不经过真实消息通道——**Side Panel 行为换代 Unit 感知不到**（auto-fill-on-scan 事件即为例证：512 Unit 全绿时 Browser 流程已违反安全架构）。
- Browser 层的安全断言（scan-does-not-write / safety-flow）是「Scan Never Writes DOM」不变量的最外层守护。
- 任何 UI 流程改动必须同时过：Unit（系统 node）+ test:e2e + test:compat。
