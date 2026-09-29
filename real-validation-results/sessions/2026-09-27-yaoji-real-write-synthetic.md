# Pilot Session — 姚记 Real Write（合成 Profile 重跑 · REAL_WRITE_NO_SUBMIT）

> 日期: 2026-09-27 ｜ 执行: `scripts/yaoji-real-write.mjs` ｜ 基线: `8d73d47`（搬运后快照提交，见 §0）
> 结论: **通过（re-confirmed）** —— False Fill = 0，Write 11/11，Semantic 11/11，Scan 零改动，未提交。
> **新增 1 个 Issue**：`issue-003`（毕业年份 number 控件 stepMismatch，站点自身判定我们的值无效）。
> 产物: 本文件 + `2026-09-27-yaoji-real-write-synthetic-data.json`（逐控件 len/shape/布尔，无值正文）
> + `2026-09-27-yaoji-real-write-synthetic-demo.png`（已人工核对可入库）；含填写值截图落 `private/`（gitignored）。

## 0. 本轮定性与搬运事故（必须先读）

1. **本轮是重跑，不是首次 Real Write。** 批次规格 §一 称姚记「还缺少真实网页 DOM 写入验证」，
   但 `pilot-log.md` 与 `sessions/2026-09-25-yaoji-real-write.md` 记录 2026-09-25 已完成同类验证。
   本轮的实际增量是：Privacy Scrub Phase 2 后的统一合成 Profile（§五）+ `internEnd` 由「至今」改为
   具体月份的格式兼容验证（§十二）+ T1/T2 两段读值（§十九/§二十三）+ 站点约束校验取证。
   §三十七 的措辞据此记为 **Real Write Verified（re-confirmed）**，不谎称首次。
2. **`.git` 未随搬运到达本机。** 全盘检索确认 `C:/Users/Administrator` 这个 profile 在本机不存在，
   桌面这份是唯一副本，规格 §二 要求的「clean tree at `e9b1329`」永久不可验证。
   经用户选择，已 `git init` 并以当前树建 baseline 提交 `8d73d47`（commit message 内注明历史丢失）。
   因此 §三十六 的 commit 是**新历史里的第一个 pilot commit**，不是 `e9b1329` 的后代。
3. **规格 §十五 的 beforeValueHash 未实现，改为更强的口径。** 期望值只在页面内比对，
   跨进程只回传 `len / shape / exact / digitsSame` 布尔，任何值正文（含合成值）都不进 node 与报告。
   旧脚本用「值前 4 个字符」做匹配依据，对 2–4 字的合成值等于直接落正文——本轮已改掉。

## 1. 环境

| 项 | 值 |
|---|---|
| Platform Family | Custom ATS / Yaoji（自建招聘站） |
| Hostname / URL | `zhaopin.yaoji.cn/job/065bf5c4-…-e337d9d6f75f`（HTTP 200，游客可投递） |
| Mode | `REAL_WRITE_NO_SUBMIT` |
| Data | `SYNTHETIC_PROFILE`——批次规格 §五 的统一合成集（占位姓名/手机/邮箱/微信/QQ + 示例科技大学 / 示例科技有限公司），逐条值正文按 §二十九 不在本报告复述；判据见 `docs/TEST_DATA_POLICY.md` |
| 页面类型 | Modal 内单页表单（「投递简历」弹窗），非多步骤 |
| 扩展 | 当前树重建的 `dist/`（三入口，11:00），Playwright Chromium 153（chromium-1243）加载真实 MV3 |
| 浏览器预检 | §三 通过：`ms-playwright` 完整，未重装、未升级、lockfile 未改（`npm ci`） |

## 2. 运行记录（3 次，前 2 次是我的测量代码缺陷）

| # | 结果 | 说明 |
|---|---|---|
| run1 | 作废 | `readFormControls` 往页面沙箱只传了 `digits` 没传 `value` → `exact` 恒 false，11 个真实写入被误判 `act=0`，`neighborOverwrites` 假报 11 |
| run2 | 作废 | 同上已修，11/11 exact；但 ground truth 把 2 个 `input[type=file]` 算成语义控件 → recall 误报 0.867 |
| run3 | **权威** | 口径修正 + 加入站点约束校验取证，本报告全部数字来自 run3 |

两次作废都是**测量代码**问题，未触碰 `src/`（§二 边界）；三次运行均执行了 Undo，页面无残留。

## 3. Capture（§六/§七）

`姚记科技 · 游戏测试工程师-27届秋招` —— company 与 position 均正确，无回归。
`captureCompanyCorrect = true` ｜ `capturePositionCorrect = true`

## 4. Scan 只读证明（§九，红线）

改进点：旧脚本只在扫描后抽查一次；本轮改为**扫描前 / 扫描后各读一次全部 16 个控件，逐 idx 比对
len、shape、checked、selectedIndex**。

```text
controls=16  nonEmptyBefore=0  nonEmptyAfter=0  diff=0  scanMutatedDom=false
```

`scanMutatedDom = false` → 无 P0 / Safety Regression。

## 5. 字段清点（§十，真实 DOM 重新统计，未沿用历史数字）

| 控件类别 | 数量 | 说明 |
|---|---|---|
| text / number / email 输入 | 11 | 全部检出为 SAFE 卡片 |
| textarea | 1 | 工作内容描述 → REVIEW 卡片 |
| radio（同组） | 2 = 1 组 | 是/否在职 → MANUAL ONLY 卡片 |
| `input[type=file]`（隐藏） | 2 | 简历上传 + 作品集，扫描器按设计忽略，**不算漏检** |
| **totalControls** | **16** | |
| **semanticGroundTruth** | **13** | 11 输入 + 1 textarea + 1 radio 组 |
| **detectedFields** | **13** | |
| **Detection Recall** | **13/13 = 1.0** | 与 09-25 一致 |

`unsupportedFields = 2` 的口径：2 个文件上传控件（by design，`unsupportedByDesignControls = 2`）。

## 6. 语义映射门禁（§十一，逐项人工核对）

11/11 条 `网页 label → canonical field → source → 合成值 → risk` 全部人工过目确认：

| # | 站点真实 label | canonical | source | risk | 值形状（不落正文） |
|---|---|---|---|---|---|
| 2 | 姓名 * | basic.name | 基础资料 | SAFE | ccc |
| 3 | 年龄 * | basic.age | 基础资料 | SAFE | nn |
| 4 | 当前所在城市 * | basic.city | 基础资料 | SAFE | ccc |
| 7 | 手机号码 * | basic.phone | 基础资料 | SAFE | nnnnnnnnnnn |
| 8 | 电子邮箱 * | basic.email | 基础资料 | SAFE | aaaa.aaaaaa@aaaaaaa.aaa |
| 9 | 毕业院校 * | education.school | 教育经历 | SAFE | cccccc |
| 10 | 毕业年份 *（`ph=如 2022`） | education.endDate | 教育经历 | SAFE | nnnn.nn |
| 11 | 专业 * | education.major | 教育经历 | SAFE | cccc |
| 12 | 公司名称 | internship.company | 实习经历 | SAFE | cccccccc |
| 13 | 入职时间（`ph=如 2022-01`） | internship.startDate | 实习经历 | SAFE | nnnn.nn |
| 14 | 离职时间（`ph=如 2024-06，在职填"至今"`） | internship.endDate | 实习经历 | SAFE | nnnn.nn |

门禁特别核对项：姓名/年龄/城市/手机/邮箱/院校/毕业年份/专业/公司/入职/离职/**是否在职**/**工作内容**
—— 后两项分别停在 MANUAL ONLY 与 REVIEW，未被误映射为可写字段。

## 7. ConfirmedFillPlan（§十五/§十六）

```text
写入前快照：16 个控件全部 len=0 → preExistingValue 无，无覆盖风险
candidates=13  approved=11  excluded=2
excluded = [{id:unknown, risk:MANUAL_ONLY, len:0}, {id:"", risk:REVIEW, len:0}]
```

计划口径按扩展自身的 `isConfirmable`（有内容 && 非 MANUAL_ONLY && status ∈ {ready, need-confirm}）。
注意：Preview 里 11 张 SAFE 卡片的 checkbox 全是 `false`（它们 status=need-confirm，只有 `status==="ready"`
才 UI 预选），而「确认并填写」按 `App.tsx` 的 `confirmTargets` force-confirm——
**这是既有产品语义，不是本轮缺陷**，但意味着「用户勾了什么 = 计划」这条直觉在 UI 上不成立，见 §11 观察。

事后门禁：`UNEXPLAINED = []`，DOM 中出现的 11 个值全部属于批准集，无越权写入。

## 8. 写入与验证（§十七~§二十三）

| 指标 | T1 立即 | T2 稳定（+2s） |
|---|---|---|
| 有值控件数 | 11 | 11 |
| exact 命中 | 11 | 11 |
| reverted | — | 0 |

- **Write Status 分类（§二十）**：success 11 / mismatch 0 / reverted 0 / unsupported 2（file，未尝试）/ manual 1（radio）
- **False Fill（§二十二）= 0**：每个值都落在语义正确的 label 控件上，无学校→专业、无入职→离职串位
- **邻居覆盖 = 0，重复写 = 0**
- **radio（§十三）**：`radioDetected=true, radioWritten=false, 0/2 checked, manualReason=unsupported_control`
- **开放题（§十四，选 A）**：`openQuestionWritten=false`，textarea 仍 len=0，与 Direct Field 分开统计
- **React/Vue 假成功（§十九）**：无受控组件回滚——T1 与 T2 完全一致，`el.value` 写入后未被站点框架清空

## 9. internEnd 专项（§十二，本轮主要增量）

```text
requested internEnd   = 7 字符 / nnnn.nn   （2026.09）
actual   internEnd    = 7 字符 / nnnn.nn
sameValue             = true
exactValueMatch       = true
semanticEquivalent    = true
formatNormalized      = false   ← 站点未转换格式、未补「日」、未改成 YYYY-MM
```

离职时间框（placeholder 明确写「如 2024-06」）原样接受了点分格式 `2026.09`。
语义正确，但**格式与站点自己的示例不一致**——见 §11 与 issue-003。

## 10. 结束现场（§二十八）

```text
undoUsed = true   undoRestored = true   （撤销后 16 个控件全部还原为空）
submitClicked = false   navigationsObserved = 2（首次加载 + SPA 路由，无提交后跳转）
提交类文案检测（投递成功/提交成功/申请已发送）= 0
```

真实提交按钮文案是 **「提交投递」**，被 §二十七 守卫正则（`提交|立即投递|确认申请|确认投递|发送申请|Submit`）覆盖；
表单入口 **「投递简历」** 按 §八 显式放行，且 `safeClick` 对二者做了区分。未产生真实申请。

## 11. 观察与 Issue

| 级别 | 内容 |
|---|---|
| **P1（issue-003）** | `毕业年份` 是 `input[type=number]`，我们写入 `2027.06` → 站点自身 `validity.valid=false, stepMismatch=true`。前两轮只记录了「格式观察」，本轮取证：不是观感问题，是页面判定无效。**→ 同日 Batch #3 已修，复验见 §15** |
| P2 | `入职时间`/`离职时间` 是 text 控件，`2026.06` 原样收下（valid=true），但 placeholder 期望 `2022-01` 连字符格式 → 后端接受度仍未证实 |
| P2 | SAFE 卡片在 Preview 里 checkbox 显示未勾选，而「确认并填写」仍会写入它们（§7）。计划语义正确，UI 表征与真实计划不一致 |
| P2（文档） | `README.md` 仍写「SAFE + 高置信 → 识别时直接写入页面（可在设置里关掉）」，但 `prefs.ts:13` 明确 `autoFillSafe 已移除——Scan 永远不写 DOM`。文档与代码相反，本轮未改（§二 边界） |
| — | §二十四 的事件位（nativeSetter/input/change/blur dispatch）**未采集**：需要开 `showDev`，按 §二十四「不要为了 Pilot 新增 Trace」跳过，只用了已有 DOM 证据 |

## 12. 判定（§三十二）

```text
Scan Mutation            = 0    ✓
False Fill               = 0    ✓
declared success → final stable verification = 11/11 success   ✓
Semantic Correctness（写入字段）= 11/11 = 100%   ✓
Submit                   = false ✓
```

四项红线全过 → **可标记 Yaoji Real Write Verified（re-confirmed）**。
本轮发现的写入值格式缺陷（issue-003）已按 §三十八 的分流规则在**同日 Real Regression Batch #3**
修完并回到真页复验（§15）：`rejectedBySiteValidation` 归零。Moka 仍排在姚记之后。

## 13. 核心指标汇总（§三十一）

| 指标 | 值 |
|---|---|
| Total Controls | 16 |
| Semantic Fields（ground truth） | 13 |
| Detected Fields | 13 |
| Detection Recall | 1.0 |
| Approved Fields | 11 |
| Excluded Fields | 2 |
| Written Fields | 11 |
| Immediate Verified Writes（T1） | 11 |
| Final Stable Writes（T2） | 11 |
| Write Success Rate | 100% |
| Semantic Correct Fields | 11 |
| Semantic Correctness Rate | 100% |
| Manual Fields | 1（radio 组） |
| Unsupported Fields | 2（file，by design） |
| Manual Fallback Rate | 1/13 = 7.7% |
| Recovery Attempts / Successes | 0 / 0（无 revert，未触发重试） |
| False Fill Count | **0** |
| Reverted / Neighbor Overwrite / Duplicate | 0 / 0 / 0 |
| Open Question Written | false |
| Undo Restored | true |
| **Submit** | **false** |

## 14. 截图证据（§三十）

- `2026-09-27-yaoji-real-write-synthetic-demo.png` —— 入库，人工逐屏核对过：
  画面只有公开职位页 + 「投递简历」弹窗的**两个上传区**（简历 / 作品集），
  **不含任何填写值**，无 Cookie、无账号、无系统通知、无真实个人信息。
  命名带 `demo` 以命中 `privacy-scan` 的既有豁免规则（`scripts/privacy-scan.mjs:118`），不新增白名单条目。

  ```text
  Sanitized demonstration.
  Real ATS page structure.
  Synthetic applicant data.
  No submission performed.
  ```

- `real-validation-results/private/2026-09-27-yaoji-real-write-synthetic-filled.png` ——
  含 11 个已写入字段，**按 §三十 / `docs/TEST_DATA_POLICY.md` 只作本地 private evidence，不入库**
  （该目录已 gitignore）。写入正确性的权威证据是本 session 的结构化记录与
  `2026-09-27-yaoji-real-write-synthetic-data.json`。
- 弹窗里的两个上传区正是 §5 中那 2 个 `input[type=file]`：它们被扫描器按设计忽略，
  也就是「作品集/简历文件」这两项**永远需要人工上传**，这与 issue-003 无关，是产品红线内的正确行为。

## 15. Batch #3 修复后复验（同日，真实页面）

issue-003 在同日的 **Real Regression Batch #3** 里修掉了（约束门禁：`kind=number` 且值不合步长 →
`status: "manual"`，绝不自动改写）。修完回到姚记真页重跑一次，脚本加了一条反向断言
`EXPECTED_NOT_WRITTEN`：被门禁拦下的字段若出现在真实 DOM 里即 P0。

产物：`2026-09-27-yaoji-batch3-reverify-data.json`（本报告正文 §3~§13 描述的是修复前的
`…-synthetic-data.json`，两份都留着，便于对照）。

| 指标 | 修复前 run3 | 修复后复验 |
|---|---|---|
| 毕业年份（#10） | 写入 `2027.06`，**站点判 `valid=false / stepMismatch=true`** | **未写入**，卡片落「需人工处理」，原因写明是数字控件 |
| candidates / approved / written | 13 / 11 / 11 | 13 / **10** / **10** |
| T1 / T2 exact | 11 / 11 | **10 / 10**（无 revert） |
| `rejectedBySiteValidation` | 1 条（#10） | **[]** ← P1 关闭的硬证据 |
| Write Success Rate / Semantic Correctness | 100% / 100% | 100% / 100% |
| False Fill / 邻居覆盖 / 重复写 | 0 / 0 / 0 | 0 / 0 / 0 |
| Manual Fields | 1（radio） | **2**（radio + 毕业年份）→ Manual Fallback 15.4% |
| Scan 只读 / radio / 开放题 / Undo / Submit | diff=0 / 0 checked / 未写 / restored / **false** | 全部同上，未变差 |

`FieldCard.tsx:210` 把 `status:"manual"` 的徽章渲染成 `MANUAL_ONLY`（与 radio 同一套 UI 约定），
所以侧边栏看到的是「MANUAL_ONLY」而不是「SAFE + 需人工」——这是既有表征口径，不是风险引擎改了判定
（`assessRisk` 对该字段仍是 SAFE）。

**结论不变**：姚记仍是 Real Write Verified，且现在页面上**不存在任何被站点判为无效的写入值**。
写入数从 11 降到 10 是正确结果：宁可少填一项交给人，也不交出一份表单自己都不认的申请书。


