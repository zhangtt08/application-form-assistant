# Issue #001 — Moka 职位页 Capture 解析错位

Platform Family: moka
页面类型: SPA 职位列表 + hash 路由详情侧栏（app.mokahr.com/campus_apply/*）
问题字段: company（缺失显示 "?"）与 position（抓到「校园招聘」栏目名）
系统识别: company=null→fallback position；position=页面 title 后缀「- 校园招聘」切分
实际应该识别: company=极智嘉（Geek+）、position=机器人产品助理实习生（详情面板职位名）
预期行为: Capture 显示「极智嘉 · 机器人产品助理实习生」
实际行为: 显示「? · 校园招聘」
是否稳定复现: 是（两个 Moka 公司页均复现结构）
Severity: P2（Missing/错误解析——不产生 False Fill，但岗位信息错误会误导用户）
Trace ID: 首轮侦察脚本（scripts/moka-pilot.mjs）
状态: verified（2026-09-24 姚记站真机复测通过；Moka 站待登录态二轮）

## 修复记录（2026-09-24）
- 实现：`src/job/companyExtraction.ts` Company Extraction Pipeline（候选 → normalize → 打分 → 选择，370/370 回归全绿）：
  1. **ATS 宿主页短路**：mokahr/greenhouse/lever 等 ATS 域名页只信 JSON-LD structured data（机器产出），title/header/meta/domain 全部不作为公司候选（这些页面的 title 是「职位名-栏目名」模板噪音）。
  2. **ATS 品牌词拦截**：候选值含 moka/greenhouse/zhaopin 等品牌词一律拒绝，不论当前域名（防 header 里的「Moka招聘平台」）。
  3. **信号优先级**：JSON-LD hiringOrganization(1.0) > company_element(0.95) > logo_alt(0.9) > header(0.8) > og:site_name(0.85) > metaCompany(0.75) > title 切分(0.65) > domain(0.4)。
  4. **title 无公司名 fallback 链**（姚记场景）：header 品牌文本 / logo alt /「招聘官网」后缀 normalize（姚记科技招聘官网 → 姚记科技）。
  5. **domain fallback 收紧**：仅当 host 分段含招聘信号词（jobs./careers./zhaopin./hr. 等）才产出，裸企业域名不编造；header/logo 采样过但全部不可靠时连 domain 兜底也放弃（Unknown > Wrong）。
  6. **噪音拒绝**：导航词（首页/全部职位/登录）、问候词（欢迎/welcome）、职位词降权（-0.45 后低于 0.3 阈值不产出）；公司样后缀（有限公司/集团/科技）轻度加分。
- position 同步修复：`src/job/jobParser.ts` 无 h1 时保留完整 title 只剥公司样尾段——「游戏测试工程师-27届秋招」不再被切成「游戏测试工程师」。
- 回归样本：`fixtures/real-regressions/issue-001-moka-capture.html`（Moka SPA 面板结构）。
- 真机预期变化：姚记站 Capture 应显示「姚记科技（或域名 fallback）· 游戏测试工程师-27届秋招」；Moka 站无 JSON-LD 时 company 显示空（不再是「? · 校园招聘」，栏目名不再冒充职位名）。

## 真机复测（2026-09-24 17:34，用户重载 dist 后）
- ✅ 姚记站：Capture bar 显示「**姚记科技 · 游戏测试工程师-27届秋招**」（截图确认）——company 出值（header 品牌信号命中，非 domain fallback）、position 完整不截断。Issue #001 姚记侧关闭。
- ✅ Moka 站（广州诗悦）：company=「广州诗悦网络科技有限公司」正确（company_element 信号命中，og:site_name=Moka招聘 被 ATS 品牌规则拦截 ✓）。
- ❌→fixed Moka 站 position=「未识别岗位」（页面职位明明是「载具策划 - 3C（望月）- 202X」）：
  - 根因 1：capture 端 h1Texts 只收 `<h1>`，Moka 面板职位名在 `.job-name` 类节点 → 职位信号根本没采到；
  - 根因 2：parser 职位词白名单没有「策划」，title 切出的「载具策划-3C-望月」被误杀。
  - 修复（17:44）：capture 增加详情标题节点选择器（job-name/jobName/job-title/jobTitle/position-name/positionName/data-testid，真实 h1 优先，>60 字符容器节点被长度过滤）；parser 增加 droppedSuffix 判定（尾部剥掉招聘后缀 → 余段视为职位名）+ 白名单补「策划」。
  - 回归：376/376（新增 jobCapture.test.ts 5 例 + parser Moka 回归 1 例），tsc 干净，dist 已重建。
- ⏳ 待用户再次重载验证：Moka 站应显示「广州诗悦网络科技有限公司 · 载具策划 - 3C（望月）…」。

## Moka real re-test = PASS（2026-09-24 21:40，随 Issue #002 复测一并确认）
- 真实页面（app.mokahr.com/campus_apply/shiyuehr/72055 详情）company = 「广州诗悦网络科技有限公司」，完整不截断 ✓。
- 本次信号源为 footer 版权行（© 2026-2027 广州诗悦网络科技有限公司）——已同步修正版权行解析的三个缺陷：年份区间（2026-2027）、「网」终止符截断公司名（广州诗悦网络… → 广州诗悦）、\n 终止缺失。详见 issue-002 文档。
- company pipeline 规则本身未改动（Issue #001 修复保持原样）；og:site_name=Moka招聘 的 ATS 品牌拦截依旧生效。

## 跨平台复现记录（Issue 通用化）
- 2026-09-24 姚记招聘官网（zhaopin.yaoji.cn，title=「姚记招聘官网」无公司名）同样 company="?" → 确认为通用 parser 问题：**title 无公司名时无 fallback 来源**；position 在姚记站解析正确（title 含职位名），Moka 站解析错（title 后缀为栏目名）。
- 公司名候选来源建议：页面内「公司名称」结构化节点 / About 文本 / 请求域名主域。

## 建议修复方向（Root Cause 假设）
- RuleBasedJobParser 对 title「<公司> - <栏目>」的切分优先级高于正文职位名；
- Moka 详情面板的职位名在 `.job-name`/详情标题节点内，正文抽取未覆盖 SPA 面板结构；
- 修复路径：parser 增加「详情面板主标题」信号（h1/h2 优先于 title 切分），并在 fixture 中加入 moka 结构样本（real-regressions/issue-001-moka-capture.html）。
