# Issue #002 — Moka 非 h1 结构职位名提取失败（「未识别岗位」）

Issue ID: ISSUE-002
Platform Family: moka
页面类型: SPA 职位详情面板（职位名在 `.job-name` 详情节点，不在 `<h1>`）
问题字段: position
Severity: P2
Stage: JOB_CAPTURE / JOB_PARSE
Platform: Moka
Expected: 载具策划 - 3C（望月）- 202X
Actual Before Fix: 未识别岗位
Root Cause 1: capture 只采 `<h1>`，没有采 `.job-name`（职位信号根本没进原料）
Root Cause 2: parser 职位关键词白名单缺少「策划」，fallback（title 切分）过于严格，余段被误杀
Status: verified

## 修复记录（2026-09-24）

### Capture 端（`src/content/jobCapture.ts`）
- 职位名信号分两路采集：`h1Texts`（真实 `<h1>`）与 `jobDetailTitles`（详情节点：`.job-name`/`.jobName`/`.job-title`/`.jobTitle`/`.position-name`/`.positionName` + data-testid 变体）。
- 两路均做 2..60 长度过滤 → 职位列表大容器（textContent 超长）被自然排除（Issue #002 Case C）。
- 真实 h1 与详情节点去重互斥（h1.job-name 组合节点归 h1Texts）。

### Parser 端（新模块 `src/job/positionExtraction.ts`）
- **Position Candidate Scoring**（来源优先级，不第一个字符串直接返回）：
  `h1(1.0) > job_detail(0.95) = structured(JobPosting.title, 0.95) > body(0.8) = meta(0.8) > title(0.65) > dropped_suffix(0.55)`
  同分按固定次序 tiebreak；白名单命中（title）优先于 droppedSuffix fallback。
- **GENERIC_JOB_PAGE_LABELS**（单一黑名单常量，禁止散落 if）：职位详情/招聘职位/校园招聘/社会招聘/加入我们/岗位列表/职位列表/招聘官网/所有职位/查看更多职位/招聘公告/招聘信息/全部职位/在招职位/更多职位/首页/登录/注册/更多。
- **isReasonablePositionTitle()**：2–60 字；拒绝栏目词/纯城市/纯招聘词/ATS 品牌/公司名形态/与已提取公司名相同/JD 段落（句级标点、职责类标记词）/纯数字。
  必须接受：载具策划 - 3C（望月）- 202X、AI Agent 应用开发工程师、产品经理（AI方向）、AIGC内容运营、Prompt Engineer、游戏测试工程师-27届秋招——含年份/项目名/括号不误杀。
- **关键词词表降级**：职位白名单只影响 title 弱信号的 jobLike 判定与来源归属（title vs dropped_suffix），不再是 position 成立的唯一门槛——job_detail/h1/structured 等高可信来源的合理短标题直接成立（管培生/项目专员/增长/创意/交付/顾问/实施/战略/业务/运营等无法穷举的岗位名不再依赖词表）。
- `JobContext` 新增 `positionExtraction: { source, confidence }`（与 companyExtraction 对称，Pilot 复测时记录 position source）。
- 顺带修正：title 只有「XX招聘」公司样后缀（如「腾讯招聘」）→ 不再产出职位（旧实现会输出「腾讯招聘」当职位名）。

## 回归样本
- `fixtures/real-regressions/issue-002-moka-position.html`（Moka 非 h1 面板结构 + 导航干扰词 + 干扰 meta）。
- 单测：`tests/positionExtraction.test.ts`（新）、`tests/jobCapture.test.ts`（Case A–D 重写）、`tests/workspace.test.ts`（same URL 更新旧记录）、`tests/profilepack.test.ts`（不误路由）。

## 单测状态
- 基线（本批开工前，合并两机分叉后）：431/431 passed + tsc 干净。
- 本批完成后：512/512 passed（新增 positionExtraction + realdata 真机回放 5 例 + jobCapture Case A-D/sd-heading 重写扩充 + workspace duplicate +1 + profilepack +2），tsc 干净，dist 已重建。

## 真机数据落盘
- `real-validation-results/sessions/2026-09-24-moka-retest-raw.json`（真实页面原料，采集脚本 `scripts/issue002-retest.mjs`）。
- 回放测试 `tests/realdata.moka-retest.test.ts`：JSON 缺失时自动跳过，不伪造。

## Moka 真机复测（2026-09-24 21:40，verified ✓）

真实页面：`https://app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4-1328-4bb4-b341-2ad4783529ce`（广州诗悦 2027 届校招 · 载具策划 - 3C（望月））。
方法：playwright chromium 无头访问真实页面 → 以与 `src/content/jobCapture.ts` 完全一致的选择器采集原料 → 落盘 `real-validation-results/sessions/2026-09-24-moka-retest-raw.json` → `tests/realdata.moka-retest.test.ts` 把真机原料喂给正式 RuleBasedJobParser 断言（数据真实、代码为发布版）。

**真机结构新发现（导致二次修复）**：
1. 该 Moka 租户详情页**无 h1、无 .job-name、无 JSON-LD、无 og:title**——职位名在 `div.title-XXX.sd-foundation-heading-40`（Moka 设计系统标题节点，哈希类名）。
   → capture 的详情标题选择器组补 `[class*="sd-foundation-heading" i]`。
   → 真机 DOM 顺序：职位标题(第一位) → 职位描述 → 职位信息 → 官方公众号（后三者为噪音，由 GENERIC 黑名单/JD 段落标记拦截）。
2. 公司名唯一信号是 footer 版权行「**© 2026-2027** 广州诗悦网络科技有限公司」：
   → 旧 copyright 正则不认年份区间、且「网」终止符会把「…网络科技…」截断成「广州诗悦」→ 已修（年份区间 + 网 负向断言 + \n 终止）。
3. `extractJdBody` 会把 JD 之后的页脚一并吞进正文 → pack-ai-operation 的「公众号」关键词误命中 → 加 JD_FOOTER_MARKERS 截断。

**真机回放断言（全部通过）**：
- position = `载具策划 - 3C（望月）-2027届校招`（完整标题，非「包含载具策划」）✓
- position source = `job_detail`，confidence = `high`（非 title fallback）✓
- company = `广州诗悦网络科技有限公司`（真机版权行，完整不截断；Moka 不冒充）✓
- Profile Pack：recommendedProfilePackId = null，confidence = low（不因「策划」误路由）✓
- Router：不高置信误路由（JD 真实含「转化/落地/迭代」通用词 → 弱信号允许，UI 保持用户手选 Pack）✓
