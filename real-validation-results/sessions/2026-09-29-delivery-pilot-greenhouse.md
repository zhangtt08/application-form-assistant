# Delivery Pilot — Greenhouse（job-boards.greenhouse.io / General Matter）

日期：2026-09-29 ｜ 工具：`scripts/delivery-pilot.mjs`（合成身份，绝不提交）
命令：`node scripts/delivery-pilot.mjs https://job-boards.greenhouse.io/generalmatter/jobs/5412538008 --apply "Apply for this job"`
机器数据：`delivery-pilot-jobs-5412538008.json`（只含标签 / 长度 / status，不含正文）

## 为什么选这个站点

Pilot Matrix 此前只有姚记（自建 ATS、游客可投递）一条 Real Write 记录，
「识别大多数官网招聘」这句话就只有一个平台的证据。Greenhouse 是**另一套完全不同的实现**：
react-select 组合框、姓名拆成 First/Last、问题由招聘方逐条自定义、并且带美国 EEO 自证题。

## 流程与结果

| 步骤 | 结果 |
|---|---|
| 识别岗位（JD 页） | `Software Engineer, Data Platform` 捕获成功；方向为英文 JD → 未落到中文方向词表（面板如实显示「未识别岗位」，不影响填写） |
| 进入网申 | 点击 `Apply for this job` 后表单在同页展开，`fill_done` |
| 识别字段 | 20 张卡片 |
| 一键填写 | 9 张卡片 filled / 1 张 manual / 10 张 unknown；页面上可写入控件 6 个，False Fill = 0 |

写入成功的字段（只看标签与长度，不落正文）：

```
First Name*  → basic.givenName      Last Name*   → basic.surname
Email*       → basic.email          Phone*       → basic.phone
Location (City)* → basic.city       School*      → education.school
Degree*      → education.degreeType LinkedIn Profile → basic.linkedin
Gender       → basic.gender
```

## 这一轮真机暴露并修掉的三个错填（都是「填错」而不是「少填」）

| 真机现象 | 根因 | 修复 | 复验 |
|---|---|---|---|
| `Are you Hispanic/Latino?` 被填进城市 | 别名 `city` 用**裸包含式**匹配，命中 `ethni|city|`（该控件 `id=hispanic_ethnicity`） | 纯 ASCII 别名必须**整词**命中（`src/matching/matcher.ts` 的 `aliasIn` + 词边界正则缓存）；中文仍走包含式 | 卡片 → `unknown` |
| `Tell us about your proudest accomplishment.`（开放问答文本框）被填进手机号 | 别名 `tel` 命中 `\|tel\|l`（"tell"） | 同上 | 卡片 → `unknown` |
| `Country`（电话控件里的国家下拉）被填进手机号 | 它没有自己的匹配来源，只靠 `<legend>Phone</legend>` 的分组信号（0.65）成立 | **组合控件子控件不继承分组标题**：控件自身有标签、候选又只来自 fieldset/section/parent 时判 unknown | 卡片 → `unknown` |

另外新增「人口统计 / 自证类」守卫：民族 / 种族 / 残障 / 兵役 / ethnicity / veteran / disability
一类问题即使词表命中也不自动写（这类是**对一类人的声明**，不是资料）。

## 站点侧边界（如实记录，不是链路 bug）

- `Are you legally authorized to work in the US?` / `require sponsorship` /
  `Clearance Eligibility` / `access to export-controlled information` → 全部 manual / unknown，
  扩展没有替用户做任何授权或身份声明。
- react-select 的下拉选项要靠站点自己的渲染；`Country` / `Discipline` 这类组合框在游客态
  没有可点中的匹配项时，扩展什么都不点（`不误点第一项`），因此留人工。
- 撤销：站点自己把值留在表单草稿里，撤销后 `filled=6` 未回落 —— 与姚记同一类站点侧对抗，
  面板如实提示「页面没有交还控制权，请在网页上手动清空」。

## 结论

Greenhouse 是第二个完成 Real Write 的平台，且这一轮真机把「错填」的三个根因（裸包含式别名、
分组标题继承、自证类问题）全部堵住并留下回归用例
（`tests/aliasWordBoundary.test.ts`、`e2e/delivery-flow.spec.ts` 的英文 ATS 用例）。
