# Issue #006 — 国内主流招聘官网的公司名提取错误（团队段 / 筛选条当公司）

Issue ID: ISSUE-006
Platform Family: 国内自建招聘官网（jobs.bytedance.com、job.xiaohongshu.com、careers.ctrip.com）
页面类型: 职位详情页 / 在招职位列表页
问题字段: JobContext.company（岗位识别结果卡片的「公司」）
Severity: **P1**（识别结果错误，用户可见；不影响写入值正确性）
Stage: JD CAPTURE → COMPANY EXTRACTION
Status: **real_site_verified**（2026-09-30 delivery-pilot 复跑）
进度：reproduced → raw_captured → fixed → regression_passed → **real_site_verified**

## 现象（全部来自真实页面，非构造）

真机跑 `node scripts/delivery-pilot.mjs "https://jobs.bytedance.com/campus/position/7667881533285566725/detail"`：

| 页面 | 真实 title / DOM | 修复前扩展识别 | 应为 |
|---|---|---|---|
| 字节跳动校招详情 | `Android开发工程师 - 移动OS - 字节跳动` | `移动OS · Android开发工程师 - 移动OS` | `字节跳动 · Android开发工程师 - 移动OS` |
| 小红书校招列表 | `[class*="company"]` 命中筛选条 `全部/算法/研发/非技术/北京市/上海市/武汉市` | `全部 · …` | `小红书` |
| 携程招聘官网首页 | `携程集团招聘官网` | `携程集团`（正确） | `携程集团` |

原料落盘（`scripts/jd-raw-dump.mjs` → `real-validation-results/sessions/2026-09-30-*-raw.json`）显示：
这两个站点**没有** JSON-LD、没有 `<header>`/`<footer>` 品牌节点、没有 logo alt、没有 og:site_name，
公司名只剩 `document.title` 一条信号可用 —— 所以 title 段的取法必须正确。

## 根因

1. **title 段按原顺序入候选，同分时取第一个。**
   `「职位 - 团队 - 公司」` 是国内官网通行格式，`移动OS` 排在 `字节跳动` 前面，
   两个候选同为 0.65 分 → 稳定排序让团队段胜出。
2. **筛选条词没有硬拒绝门槛。**
   `companyExtraction` 只把含职位词的候选**降权**（-0.45），
   于是 `company_element`（0.95）来源的 `全部` 降权后仍有 0.5，照样胜出；
   城市词（`北京市`）、类别词（`算法`/`研发`/`非技术`）、标签词（`职位方向`/`工作地点`）同理会存活。

## 修复

| 文件 | 改动 |
|---|---|
| `src/job/companyExtraction.ts` | ① 新增 `FILTER_CITY_WORDS`（筛选条/职位类别/城市）与 `ADMIN_DIVISION_PATTERN`（`…市/…省/…自治区`），在 `makeCandidate` 里**精确匹配即拒绝，不看来源置信度**；② title 段改为**倒序**入候选（末段最像公司），岗位词候选已被降权过滤，所以「公司-职位」与「职位-公司」两种顺序都不会取错 |
| `src/job/jobParser.ts` | 事后不变量：`company` 是 `position` 的子串 → 置空（Unknown > Wrong），并且不再输出 `companyExtraction` 元数据 |

没有加任何站点专属分支：三条规则都是「候选词表 + 采集顺序 + 事后不变量」。

## 验证

- **真机复跑**（同一 URL，同一构建）：`岗位: 字节跳动 · Android开发工程师 - 移动OS`，`recognized_jd_page` 正常。
- **真机回放单测** `tests/realdata.cn-careersites.test.ts`：把上面三个真实页面的原料 JSON 喂给正式 `RuleBasedJobParser`
  （文件不存在则 `describe.skipIf` 跳过，不伪造数据）。4 个用例：字节公司名+岗位+地点、公司名不得是岗位片段、
  小红书筛选条词不得成为公司名、携程「招聘官网」后缀剥离且无岗位信号时不编造岗位。
- 修复前该文件 **3 failed / 1 passed**（携程那条本来就过），修复后 4/4 过；
  全量单测 **35 文件 / 627 用例** 全绿，`tsc --noEmit` 干净，既有 `companyExtraction` / `positionExtraction` /
  `realdata.moka-retest` 无回归。

## 仍未覆盖（诚实记录）

字节跳动、小红书、Moka 的**申请表单**都在手机号+验证码登录之后，游客不可达，
因此这三家只验证到「岗位识别」，**字段识别 + 资料库写入**的国内真实站点证据仍只有姚记（自建 ATS）。
