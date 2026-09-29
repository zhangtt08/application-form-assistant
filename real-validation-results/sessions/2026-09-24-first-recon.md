
## Session #5 — 姚记招聘官网（国内自建 ATS）★ 首个国内平台全链路验证
- URL: zhaopin.yaoji.cn/job/065bf5c4-c421-490e-9b9e-e337d9d6f75f（游戏测试工程师-27届秋招 · 上海）
- Platform Family: yaoji（自建 ATS）
- 页面类型: JD 详情页 + 点击「投递简历」展开申请表单（游客可投递，无需登录）
- 字段数量对照: 真实 14 控件（radio 是/否为同一问题 2 选项）= 13 语义字段 / **Detected 13 → Recall = 1.0**
- Capture: position ✓「游戏测试工程师-27届秋招」；company=?（Issue #001 通用化：title 无公司名的站点均复现）
- 内容来源（Preview 级，注入 fixture 资料后）: **11 Safe**（姓名/年龄/城市/手机/邮箱/院校/毕业年份/专业/公司/入职/离职 全部正确映射到 basic/education/internship 且值正确）
- 高风险拦截: 「是/否」radio → UNKNOWN → MANUAL ONLY（「网页控件暂不支持，请人工填写」）✓ 保守策略正确
- 开放问题: 工作内容 textarea → REVIEW + AI 生成回答入口 ✓
- 可一键确认: 11 字段 ✓
- False Fill: 0（本轮为 Dry Run 级，未对真实站点执行填写/提交）
- 测试: e2e/compat/real-yaoji.spec.ts（RealYaoji）✓ passed
mily: moka
- 页面类型: SPA 职位列表 + hash 路由详情侧栏
- Capture: 失败 — company="?"（缺失）、position="校园招聘"（抓到栏目名）→ Issue #001
- Scan: 详情页 1 字段（搜索框）；申请表单需登录，游客不可达（平台限制记录）
- Issues: Issue #001（P2 · Moka capture 解析）

## Session #4 — Moka · 寒武纪
- URL: app.mokahr.com/apply/cambricon/1113#/job/…
- 结果: 职位已停止招聘；扩展容错正常（0 字段、不崩溃）

## 其他尝试
- 智联招聘: Security Verification 反爬拦截 headless 环境（真实用户浏览器预计可过；环境限制，非产品 Bug）
- 猎聘: 目标职位已暂停；登录墙

## 首轮结论
- Greenhouse（国际 ATS 代表）: Scan/Capture 全链路可用，Detection Recall ≥0.9，False Fill 0（未填写阶段）
- Moka: 布局可达但 Capture 解析需修复（Issue #001）；申请表单需登录，留待用户登录态后二轮
- 真实 Issue 1 个（Moka capture P2）——待 Minimal Fixture → Failing Test → Root Cause → Generic Fix
