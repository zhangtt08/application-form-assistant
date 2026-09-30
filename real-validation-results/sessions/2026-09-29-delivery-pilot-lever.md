# Delivery Pilot — Lever（jobs.lever.co / Spotify）

日期：2026-09-29 ｜ 工具：`scripts/delivery-pilot.mjs`（合成身份，绝不提交）
命令：`node scripts/delivery-pilot.mjs https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1 --apply "apply for this job"`
机器数据：`delivery-pilot-b030-8f92c9882bf1.json`

第三个平台（Lever 与 Greenhouse 又是不同实现：`/apply` 是同站另一条路由、
表单字段由 postings API 配置驱动、国家下拉是原生 `<select>`）。

## 结果

| 项 | 值 |
|---|---|
| 岗位捕获 | ~~`Spotify - Android Engineer - Experience`（公司 + 岗位都对）~~ **2026-09-30 更正**：那串是页面 `<title>`；面板当时把整串放进公司栏、职位栏写着「未识别岗位」（issue-009，已修：真机复跑为 `Spotify · Android Engineer - Experience`） |
| 进入网申 | 点 `apply for this job` → 同页展开表单 |
| 识别卡片 | 19 |
| 汇总 | 7 已填写 / 0 待确认 / 8 需人工 / 3 其他（面板四格） |
| 页面控件 | total=33 filled=7 unexplained=2 empty=24 |
| 提交按钮 | `submittedClicked=false` |

写入的字段：`Full name✱ → basic.name`、`Email✱ → basic.email`、`Phone ✱ → basic.phone`、
`Current company ✱ → internship.company`、`LinkedIn URL → basic.linkedin`、
`Portfolio URL → basic.portfolio`、`Other website → basic.portfolio`。

## 这一轮真机暴露并修掉的覆盖缺口

- **`GitHub URL` 认不到**（技术岗标配字段）→ 新增 `basic.github`
  （资料页 GitHub 栏 + 别名 `github / github url / 代码仓库 / 开源主页` +
  导入映射 + `tests/englishAtsAliases.test.ts` + `e2e/fixtures/english-ats.html` 的 `#github`）。
  与 `portfolio` / `linkedin` 三个来源互不抢标签。

## 如实记录的行为（不是 bug）

- `Spotify has my consent to contact me` 被词表认成 `basic.phone`（标签里有 `contact`），
  但它是**同意被联系的授权勾选** → 状态 `manual`，没有写入。
  授权类不代签是红线，宁可标签认歪也不点。
- `What is your location?` / `Current location✱` 是**国家**下拉（选项是 Afghanistan/Sweden…），
  资料库里的「上海」在国家列表里没有 → 判 `failed` 并给出可读原因，
  没有退化成「随便选第一项」。这是宁缺勿错，不是链路坏在手里。
- `He/him`（代词）、`No`/`Yes`/`0-4`（无标题的裸选项）、`Verify` 邮箱验证组件 → `unknown`，交人工。
- 撤销：`恢复 0 / 7`，站点自己保留值；面板如实提示手动清空（HANDOVER §5.1 同一限制）。
