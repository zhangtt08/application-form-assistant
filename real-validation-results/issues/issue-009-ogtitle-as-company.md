# Issue #009 — 岗位识别第一步就错：og:title 被当成公司名，英文职位名里的逗号被当句子标点

Issue ID: ISSUE-009
Platform Family: 英文 ATS 宿主页（jobs.lever.co / job-boards.greenhouse.io）+ 申请子页
页面类型: 职位详情页 → 点「投递」后同页展开的申请表单
Severity: **P1**（用户可见：岗位条印着错公司 + 「未识别岗位」；并会污染岗位库）
Stage: CAPTURE（信号采集口径）→ POSITION/COMPANY EXTRACTION
Status: **real_site_verified**（2026-09-30 真机复跑，见 `pilot-log.md`）

## 症状（真机，非构造）

| 页面 | 真实 DOM 信号 | 修复前岗位条 | 应为 |
|---|---|---|---|
| Greenhouse 详情 | `<h1>Software Engineer, Data Platform</h1>`、`og:title` 同文、`<img alt="General Matter Logo">` | `Software Engineer, Data Platform · 未识别岗位` | `General Matter · Software Engineer, Data Platform` |
| Lever 详情 | JSON-LD `hiringOrganization=Spotify`、`<div class="posting-headline"><h2>Android Engineer - Experience</h2>`、无 `<h1>` | `Spotify - Android Engineer - Experience · 未识别岗位` | `Spotify · Android Engineer - Experience` |
| Lever `/apply` 子页 | 无职位标题，正文含职位描述 | 把上面那条好岗位**覆盖**成 `未识别岗位` | 保持原岗位不动 |

## 三个根因（一条链）

1. **`metaCompany` 取了 `og:title`**（`src/content/jobCapture.ts`）。
   `og:title` 是「这一页的标题」，在 ATS 上就是职位名。于是 company=职位名；
   接着 `extractPositionWithMetadata` 的互斥规则（`isReasonablePositionTitle`：候选与 company 相同即拒绝）
   把真正的 `<h1>` 候选踢掉 → position 落到「未识别岗位」。**一个错误信号同时毁掉两个字段。**
2. **`SENTENCE_PUNCTUATION` 把半角逗号当句子标点**（`src/job/positionExtraction.ts`）。
   英文 ATS 的标题惯例是「职位, 团队/方向」（真机：`Software Engineer, Data Platform`），
   逗号一拦，即使公司名修好了职位仍然识别不出。
3. **ATS 宿主页完全不看 logo alt**（`companyExtraction` 的 `if (!hostAts)` 分支）。
   厂商模板噪音（title/header/meta）确实不能信，但 `alt="General Matter Logo"` 是**租户自己填的**，
   属于雇主署名；厂商名另有 `ATS_BRAND_PATTERN` 一律拒绝，不会漏出「Greenhouse/Lever/Moka」。
4. （附带）**申请子页会覆盖已捕获的好岗位**：`tryCaptureJob` 的守卫是
   `position === "未识别岗位" && jd.length < 200`，而 Lever 的 `/apply` 页正文里带着职位描述，
   长度守卫形同虚设。

## 修复

| 文件 | 改动 |
|---|---|
| `src/content/jobCapture.ts` | `metaCompany` 只认 `meta[name=company]` / `og:site_name` / `application-name`，**不再回落到 `og:title`**；职位详情节点选择器补 `posting-headline / posting-title / app-title`（Lever 真机结构，页面没有 h1）；logo 采集补 `[class*="logo"] img`、`[class*="brand"] img`、`a[href$="/"] img[alt]` |
| `src/job/positionExtraction.ts` | `SENTENCE_PUNCTUATION` 去掉半角逗号（中文「，」仍拦：真机里带它的是句子，如「负责 3C 品类的载具策划，产出玩法设计方案」） |
| `src/job/companyExtraction.ts` | ATS 宿主页也接受 `logo_alt`（雇主署名）；`NOISE_SUFFIXES` 增加 `logo/标志/图标`，把 `alt="Spotify logo"` 归一成 `Spotify` |
| `src/sidepanel/App.tsx` | `tryCaptureJob`：`position === "未识别岗位"` 一律不捕获（岗位名就是这条记录的身份证，抓不到身份证的页面不许新建/覆盖岗位） |

## 验证

- **真机回放**（真实原料落盘 → 正式 parser）：`tests/realdata.ats-capture.test.ts`
  - Lever → `company=Spotify`、`position=Android Engineer - Experience`
  - Greenhouse → `position=Software Engineer, Data Platform`、`company=General Matter`，并断言 `company !== position`（原始症状）
- 词表用例：`tests/positionExtraction.test.ts` 接受清单补 `Software Engineer, Data Platform`、`Senior Product Manager, Growth`
- 全量单测 **38 文件 / 644 例** 绿、`tsc --noEmit` 零输出
- 真机复跑（见 `pilot-log.md` 2026-09-30）：Lever / Greenhouse / 姚记 / 字节跳动 四站岗位条

## 顺带纠正一条旧记录

`real-validation-results/sessions/2026-09-29-delivery-pilot-lever.md` 里写的
「岗位捕获 `Spotify - Android Engineer - Experience`（公司 + 岗位都对）」是**误读**：
那串是页面 `<title>`，面板当时把整串放进了公司栏、职位栏写着「未识别岗位」。
本 issue 修复后该记录已在 pilot-log 里更正。
