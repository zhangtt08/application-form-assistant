# Session — Issue #002 Regression Guard + Moka 真机复测（2026-09-24 晚）

## 本轮范围
用户 Batch 指令：Issue #002 补完整 Regression Guard + Moka 真机复测 + 下游验证；不加新功能。

## 0. 前置修复：跨机传输文件树修复（先于一切任务）
项目从其他电脑拷贝到本机时产生 182 个 `*-<hash>` 双胞胎文件（同步工具对冲突文件用哈希名落盘）。
两台机器存在**分叉**：他机 09-24 的 job 管线修复链（Issue #001/#002 前置）vs 本机 09-23 的 Library UI/DeepSeek Provider 工作。
- 逐文件按「测试即规格 + tsc 交叉验证」判方向合并：
  - 取他机版（双胞胎）：jobCapture / jobParser / schema / scanPipeline / message / background / content 四件套 / workspaceRepository / profileResolver（Stage 6.5 Pack）/ e2e specs / package.json（test:compat）/ manifest（webNavigation）
  - 取本机版（本体）：provider.ts（DeepSeek 预设）/ profileStore / useProfile / base.css（.jobbar 样式）/ 全部 sidepanel tsx
- 134 个冗余文件清理（内容先校验后删），28 个被覆盖的旧版本备份在 `_transfer-backup/stale-20260924/`。
- 合并后基线：431/431 + tsc 干净 + build 通过（交接文档的 376 为他机快照，不含本机 Library/Provider 分支的测试）。

## 1. Issue #002 回归 Guard（全部落地）
- `real-validation-results/issues/issue-002-position-non-h1.md`（status: verified）
- `fixtures/real-regressions/issue-002-moka-position.html`（.job-name 结构 + 导航干扰词 + 干扰 meta）
- 新模块 `src/job/positionExtraction.ts`：
  - POSITION_SOURCE_SCORES：h1(1.0) > job_detail(0.95) = structured(0.95) > body(0.8) = meta(0.8) > title(0.65) > dropped_suffix(0.55)
  - GENERIC_JOB_PAGE_LABELS 黑名单（职位详情/校园招聘/加入我们/岗位列表/职位信息/申请职位/官方公众号 等 22 词，单一来源）
  - isReasonablePositionTitle（2-60 字；拒栏目词/纯城市/纯招聘词/ATS 品牌/公司名形态/与 company 相同/JD 段落；年份/括号/项目名不误杀）
  - 关键词词表降级为 title 弱信号辅助——job_detail/h1/structured 的合理短标题直接成立
- JobContext 新增 positionExtraction 元数据（与 companyExtraction 对称）
- capture：真实 h1 与详情节点分两路（h1Texts / jobDetailTitles），+ sd-foundation-heading（真机结构）
- parser：title 只有公司样后缀不再编造成职位；JD 提取加页脚截断（JD_FOOTER_MARKERS）
- 测试：positionExtraction.test（来源优先级/黑名单/合理性）、jobCapture.test（Case A-D + sd-heading）、workspace duplicate（same URL 更新旧记录不新增）、profilepack（载具策划不误路由）

## 2. Moka 真机复测（verified）
- 真实 URL：app.mokahr.com/campus_apply/shiyuehr/72055 → 载具策划 - 3C（望月）-2027届校招
- 真机原料：`sessions/2026-09-24-moka-retest-raw.json`（scripts/issue002-retest.mjs 采集）
- 回放断言全过：position 完整标题（job_detail/high）、company 完整（版权行）、Pack 无推荐/low、Router 不高置信
- 真机驱动的三个二次修复：sd-foundation-heading 选择器、copyright 正则（年份区间/网截断/换行）、JD 页脚截断

## 3. 已知问题（下批候选）
- **e2e/compat 全套阻塞（既有，非本批引入）**：specs 写于 UI 改版前——期望「扫描当前页面→逐字段确认→填写」流程；当前 UI 是「开始识别→自动填写安全字段→可撤销」新流程。已做机械文案对齐（扫描→识别按钮、一键确认→全部确认、填写已确认→填写确认的 N 项），AA1 实测证明扩展端到端工作正常（截图：扫描 fixture → 4 字段识别 → 自动填写成功），但断言流程需要按新 UX 重写 → 下批专项。
- dist 已重建（content.js 含 sd-foundation-heading 选择器），重载扩展即可生效。

## 测试终态
- Unit: 512/512 passed（21 文件）
- tsc --noEmit: 干净
- build: 三段全过，dist 新鲜
- e2e/compat: 阻塞（见上）
