# Issue #003 — 数字型年份控件写入小数导致站点判定无效（毕业年份 stepMismatch）

Issue ID: ISSUE-003
Platform Family: Custom ATS / Yaoji（`zhaopin.yaoji.cn`）
页面类型: Modal 内单页申请表单
问题字段: `education.endDate`（站点 label「毕业年份 *」，placeholder「如 2022」）
Severity: **P1**（不影响安全红线，但会让真实用户提交时被页面拦下）
Stage: FILL / VALUE_FORMATTING（Writer 侧值格式保真）
Platform: 姚记招聘官网
Expected: 写入后 `input.validity.valid === true`，值形如 `2027`
Actual: 写入 `2027.06` → `validity.valid = false, stepMismatch = true, badInput = false, tooLong = false, patternMismatch = false`
Reproducible: **是**（`scripts/yaoji-real-write.mjs` run3，逐控件取证）
Status: **verified（Real Regression Batch #3，2026-09-27 修复）**

## 修复记录（Batch #3 · 2026-09-27）

采用**门禁降级**方案，不做格式自适应。理由：`deriveStatus` 里已有同族先例——字数超限是
「禁止自动截断，请人工处理」（`scanPipeline.ts:51-58`）。「控件收不下这个值」与它是同一类问题：
值语义没错、控件不接受，正确答案是交给人，而不是系统悄悄改内容。

| 层 | 改动 |
|---|---|
| `src/types/field.ts` | `RawFieldContext` 增可选 `step?: number \| null`（`null` = 站点声明 `step="any"` 不设限；`undefined` = 未采集，按 HTML 默认 1 从严） |
| `src/content/contextExtractor.ts` | number 控件读 **`step` 属性**（不读 IDL，避开默认值口径分歧）；非数字控件保持 `undefined` |
| `src/pipeline/scanPipeline.ts` | 新增导出纯函数 `numberValueFitsStep(value, step)`；`deriveStatus` 在字数超限之后加一条：`kind === "number"` 且值不合步长 → **`status: "manual"`** + 中文原因 |

### 为什么是 `manual` 而不是 `need-confirm`

`need-confirm` 正是「确认并填写」会批量 force-confirm 的那一批
（`App.tsx` 的 `reviewTargets` / `confirmTargets`，`buildFillPlan` 也放行 `need-confirm`）。
降到 `need-confirm` 只是换个徽章、照样写进页面。`manual` 才真正被 `isConfirmable` 与
`buildFillPlan` 双重排除，并在 UI 上落到「需人工处理」桶、`.manual-note` 显示原因。

### 不误伤

- 同页 `年龄`（也是 `input[type=number]`，值 `22`）照常写入 —— 门禁拦的是**格式**，不是控件类型；
- `step="0.01"` 的小数控件收到 `3.5` 不被拦（浮点用 `1e-9` 容差，`0.3 / 0.1` 不误判）；
- 站点显式 `step="any"` 完全不设限；
- 文本框收到 `2026.06` 不受影响（姚记的入职/离职时间就是文本框，见下）。

## 现象（原始记录）

`毕业年份` 在真实 DOM 里是 `input[type="number"]`（非文本框）。我们的 Profile 存的是
`2027.06`（`YYYY.MM`），Writer 原样写入。number 控件默认 `step=1`，`2027.06` 违反步长约束，
于是**页面自己**把该字段判为无效。

值本身没被改写、没被回滚、语义落点也正确（`exactValueMatch=true`、`semanticCorrect=true`），
所以这不是 False Fill、不是 Fake Success——是**写入值与目标控件类型不匹配**。


## 与前一轮记录的关系

`2026-09-25-yaoji-real-write.md` §6 把同一现象记为 **P2「格式保真观察」**，理由是
「站点前端未 revert，后端接受度未知」。本轮补上了当时缺的证据：站点前端**确实**通过
HTML5 constraint validation 明确判定了无效。故升级为 P1。

## 同类风险面（未逐一取证，但同一根因）

| 控件 | 类型 | 我们写的 | 站点 placeholder 期望 | 本轮 validity |
|---|---|---|---|---|
| 毕业年份 | `number` | `2027.06` | `如 2022` | **invalid / stepMismatch** |
| 入职时间 | `text` | `2026.06` | `如 2022-01` | valid（但格式与示例不符） |
| 离职时间 | `text` | `2026.09` | `如 2024-06，在职填"至今"` | valid（同上） |

## 回归样本

- `tests/e2e/fixtures/compatibility/number-year-field.html` —— 复刻姚记结构：`姓名`(text) /
  `年龄`(number 默认 step) / `毕业院校`(text) / `毕业年份`(number) / `专业`(text)。
- `e2e/compat/aa-core.spec.ts` **AA13** —— 断言 ① 毕业年份卡片 `data-status="manual"` 且 `.manual-note`
  写明「数字控件」；② 填完后 `#ny-year` 仍为空；③ `#ny-age="22"`、`#ny-name="张三"`、
  `#ny-school="示例科技大学"` 照常写入；④ 收尾不变量：**页面上所有非空控件的 `validity.valid` 必须为 true**。
- 单测：`tests/stage2.test.ts` 新增 `number 控件收不下该值 → manual` 7 例
  （含 `2027` 放行、`至今` 拦下、`step=0.01` 不误伤、`step=any` 不设限、text 不受影响、浮点容差）。

## 测试状态

| 项 | 结果 |
|---|---|
| Unit | **539 / 539**（532 + 7），24 文件，系统 node |
| typecheck | 零输出 |
| build | 三入口重建 |
| Compat | **29 / 29**（28 + AA13） |
| E2E | 见下方批次汇报 |

## 遗留（本批不处理）

`入职时间` / `离职时间` 是**文本**控件，`2026.06` 能通过 `validity`（valid=true），所以门禁看不见它们
与 placeholder 示例（`如 2022-01`）的格式差异 —— 站点后端是否接受仍未证实。要覆盖它需要引入
placeholder/pattern 的语义解析，属独立工程，不在 issue-003 范围内。


## 取证位置

- `real-validation-results/sessions/2026-09-27-yaoji-real-write-synthetic-data.json`
  → `stats.rejectedBySiteValidation`、`filledControls.T2stable[idx=10]`
- `real-validation-results/sessions/2026-09-27-yaoji-real-write-synthetic.md` §9、§11
