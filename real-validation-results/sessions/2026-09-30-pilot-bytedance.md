# Delivery Pilot — 字节跳动校招（jobs.bytedance.com，自建官网）

日期：2026-09-30 ｜ 工具：`scripts/delivery-pilot.mjs` + `scripts/jd-raw-dump.mjs`（合成身份，绝不提交、绝不登录）
命令：
```bash
node scripts/jd-raw-dump.mjs https://jobs.bytedance.com/campus/position/7667881533285566725/detail bytedance
node scripts/delivery-pilot.mjs https://jobs.bytedance.com/campus/position/7667881533285566725/detail
```
机器数据：`delivery-pilot-7667881533285566725-detail.json`、`2026-09-30-bytedance-raw.json`

## 为什么选这个站点

用户诉求是「在各个主流网申或招聘平台识别岗位」。此前真机证据只有姚记（自建 ATS）+ Lever + Greenhouse，
国内主流平台一条都没有。字节跳动校招官网是国内自建招聘站的代表形态：**没有 JSON-LD、没有 `<header>` 品牌节点、
没有 logo alt、没有 og:site_name**，公司名只剩 `document.title` 一条信号可用。

## 结果

| 步骤 | 结果 |
|---|---|
| 打开 JD 页 | `Android开发工程师 - 移动OS - 字节跳动`（真实在线职位，非缓存页） |
| 识别岗位 | 首跑 `移动OS · Android开发工程师 - 移动OS` → **公司名取了团队段**（issue-006，P1） |
| 修复后复跑 | `字节跳动 · Android开发工程师 - 移动OS`，`recognized_jd_page` 通过；地点 `北京`（同一份真机原料的离线回放断言，pilot 本身不打印地点） |
| 字段识别 / 写入 | **未执行**：投递入口在手机号 + 验证码登录之后，游客不可达；不存凭证（§7） |
| 红线 | 未点登录、未输入任何内容、未点提交 |

## 顺带的两个真机观察

1. **已下线职位是负样本**：`…/position/7238484559548696888/detail` 正文被替换成「该职位已下线」，
   扩展输出「未识别到岗位」——没有从 `<title>` 里拼一个岗位出来。这是期望行为，记录以免下个人误判成 bug。
2. **本网络访问北森失败**：`nio.hotjob.cn` → `net::ERR_CONNECTION_CLOSED`，未采集，不算验证过。
   同一时间 Chromium 走 Windows 系统代理会全站 `ERR_PROXY_CONNECTION_FAILED`，
   已在 pilot / dump 脚本里把 `HTTPS_PROXY` 显式传给浏览器（环境问题，非产品缺陷）。

## 由此产生的修复与回归网

| 改动 | 文件 | 证据 |
|---|---|---|
| title 段倒序采集 + 筛选条/城市词精确拒绝 + 「公司名是岗位片段则置空」 | `src/job/companyExtraction.ts`、`src/job/jobParser.ts` | `tests/realdata.cn-careersites.test.ts`（真机原料回放，修复前 3 failed） |
| 从站点自己的 bundle 里抠出表单真实文案逐条断言 | `tests/realLabels.bytedance.test.ts`（新增 6 用例） | 暴露 4 个错填/跨线形态 → issue-007 |
| 限定词标签守卫（`类型/类别/种类/关系` 结尾且非精确命中 → unknown）、教育板块时间栏归教育线、他人守卫读 `prevSiblingText`、`职位描述` 别名 | `src/matching/matcher.ts`、`src/rules/fieldAliases.ts` | issue-007；全量单测 36 文件 / 635 例绿；姚记真机逐位复验无回归 |
