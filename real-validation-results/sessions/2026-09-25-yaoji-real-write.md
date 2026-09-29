# Pilot Session — 姚记 Real Write #1（REAL_WRITE_NO_SUBMIT）

> 日期: 2026-09-25 ｜ 执行: scripts/yaoji-real-write.mjs ｜ 基线: pilot-v1-baseline (d042026)
> 结论: **通过** —— False Fill = 0，Semantic Correctness 11/11 = 100%，未触发提交。
> 产物: 本文件 + `2026-09-25-yaoji-real-write-data.json`（机器数据，只落长度/sameValue，不落值正文）+ 1 张可公开截图（另 1 张含填写值的截图已改为本地 private evidence，见 §8）。
> 注：§7 P2 里引用的「2027.07」「2026.07」是**当时站点实际收到的值**（原样保留，不改写历史观测）；
> 合成 fixture 本身已在 Privacy Scrub Phase 2 调整为 2027.06 / 2026.06。

## 1. 环境

| 项 | 值 |
|---|---|
| 平台 | zhaopin.yaoji.cn（自建 ATS，游客可投递） |
| 页面 | 游戏*测试*工程师-27届秋招 职位页 →「投递简历」展开申请表单 |
| 模式 | REAL_WRITE_NO_SUBMIT（真实写入 + 逐字段验证 + 撤销恢复） |
| 扩展 | dist/（pilot-v1-baseline 构建），Playwright Chromium new-headless 加载真实 MV3 |
| 资料 | 合成测试资料（见 `docs/TEST_DATA_POLICY.md` 的 Allowed 表：占位姓名 / 占位手机 / 占位邮箱 / 示例科技大学 / 示例科技有限公司…），非真实个人信息。本 session 记录于 Privacy Scrub Phase 2 回溯对齐到该合成标准，当时实际注入的占位身份未变 |

## 2. 流程执行（§十二~§二十一）

1. **Capture** ✓ —— jobbar：姚记科技 · 游戏*测试*工程师-27届秋招
2. **Scan** ✓ —— 13 字段检出；**确认前真实 DOM 全空**（14 个 input/textarea allEmpty=true）→ Scan Never Writes DOM 在真实站点成立
3. **Preview / 语义映射门禁** ✓ —— 11 条 label→canonicalFieldId 映射逐一核对通过（§十二），radio=MANUAL ONLY，开放题=REVIEW
4. **ConfirmedFillPlan → Writer** ✓ —— 全部确认 → 确认对话框显式点击「确认填写」
5. **逐字段 Write Verification** ✓ —— 独立于扩展 WriteVerifier 的 DOM 复核（同值 + label 语义落点）
6. **撤销恢复** ✓ —— 撤销本次填写 → DOM 全部还原（undoRestored=true）
7. **提交** —— **从未点击**（无 投递/下一步/同意协议 类点击）

## 3. 字段统计（§二十二）

| 指标 | 值 |
|---|---|
| actualFields（真实表单控件） | 16（14 input/textarea + 2 radio） |
| detectedFields（语义字段） | 13 |
| approvedFields（SAFE 且已确认） | 11 |
| writtenFields | 11 |
| verifiedWrites（sameValue=true 且 semanticCorrect=true） | **11** |
| manualFields（MANUAL ONLY） | 1（「是」radio 组） |
| unsupportedFields | 0 |
| writeFailures | 0 |
| recoverySuccesses（revert 后二次策略） | 0（无 revert 发生） |
| semanticFalseFills | **0** |

## 4. 核心指标（§二十三）

| 指标 | 值 |
|---|---|
| Detection Recall | 13/13 = **1.0**（11 输入 + 1 radio 组 + 1 开放题） |
| Classification Accuracy | 13/13 = **1.0**（11 SAFE / 1 MANUAL ONLY / 1 REVIEW 全部正确） |
| Approved Write Count | 11 |
| Write Success Rate | 11/11 = **100%**（扩展 WriteVerifier 与独立 DOM 复核一致） |
| Semantic Correctness Rate | 11/11 = **100%**（值落点逐一比对真实 label：姓名/年龄/当前所在城市/手机号码/电子邮箱/毕业院校/毕业年份/专业/公司名称/入职时间/离职时间） |
| Manual Fallback Rate | 1/13 ≈ 7.7%（radio） |
| False Fill Count | **0** |
| Write Recovery Count | 0 |

## 5. 逐字段 Write Verification（§十五 格式，不落正文）

| canonicalFieldId | risk | requestedLength | actualLength | sameValue | semanticCorrect | writeStatus | DOM label |
|---|---|---|---|---|---|---|---|
| basic.name | SAFE | 2 | 2 | true | true | success | 姓名 |
| basic.age | SAFE | 2 | 2 | true | true | success | 年龄 |
| basic.city | SAFE | 2 | 2 | true | true | success | 当前所在城市 |
| basic.phone | SAFE | 11 | 11 | true | true | success | 手机号码 |
| basic.email | SAFE | 17 | 17 | true | true | success | 电子邮箱 |
| education.school | SAFE | 6 | 6 | true | true | success | 毕业院校 |
| education.major | SAFE | 3 | 3 | true | true | success | 专业 |
| education.endDate | SAFE | 7 | 7 | true | true | success | 毕业年份 |
| internship.company | SAFE | 10 | 10 | true | true | success | 公司名称 |
| internship.startDate | SAFE | 7 | 7 | true | true | success | 入职时间 |
| internship.endDate | SAFE | 2 | 2 | true | true | success | 离职时间 |
| （radio「是/否在职」） | MANUAL ONLY | — | — | — | — | untouched（0/2 checked） | 是 |
| （开放题「工作内容」） | REVIEW | — | 0 | — | — | 不写入（§二十 选项 A，单独统计） | 请简述主要工作内容和职责 |

## 6. 观察与 Issue

| 级别 | 内容 |
|---|---|
| P2 | 格式保真：毕业年份框 placeholder 为「如 2022」（站点期望年份格式），写入「2027.07」7 字符原样保留未被站点改写；入职/离职同理（placeholder「如 2022-01」，写入「2026.07」点分格式）。站点前端未 revert，但**真实用户提交前应人工核对站点后端是否接受该格式**——属格式保真度观察，不影响本轮验证结论 |
| P2 | 审计脚本语义正则须以站点真实 label 为准（首跑误把「毕业年份」当「毕业时间」，两度误报），已修正——印证 §十六「技术正确 ≠ 语义正确，必须人工比对真实 label」 |

**无 P0 / P1。**

## 7. 最终确认

- 是否触发提交: **NO**
- 填写后处理: 撤销本次填写，DOM 全部还原；无残留
- 是否可将姚记标记为 Real Write Verified: **是**（§二十七：真实逐字段写入检查通过）

## 8. 截图证据

- `yaoji-real-write-1-preview.png` —— Preview 展开态（填写前，DOM 全空）。
  画面里只有公开职位页与本方侧边栏，**不含任何填写值**，继续入库。
- ~~`yaoji-real-write-2-filled.png`~~ —— 填写完成态（11 字段已写入真实 DOM）。
  **已于 Privacy Scrub Phase 2 从 Git 跟踪中移除**（`git rm --cached`，本地原件保留在
  `real-validation-results/private/`，该目录已 gitignore）：这张图能直接读出表单里的教育·雇佣字段，
  属于 `docs/TEST_DATA_POLICY.md` 的 Forbidden 类。
  它证明的是**当时那次真实写入的结果**；当时的注入内容本就是占位身份（见 §1「资料」行），
  所以移除它不损失任何用户隐私事实，但也不再作为可公开的证据。
  **写入正确性的权威证据是本 session 的结构化记录**：§3~§6 的表格 +
  `2026-09-25-yaoji-real-write-data.json`（逐字段 `requestedLength` / `actualLength` /
  `sameValue` / `semanticCorrect` / `writeStatus` / `requestedValueHash`）。
  下一轮 Pilot 起：含填写值的截图一律只作本地 private evidence，不入库。
