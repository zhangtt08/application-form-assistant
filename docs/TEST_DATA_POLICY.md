# Test Data Policy

## Production rule

测试 / smoke / fixture / pilot 脚本里**永不出现真实个人标识**——只用合成身份。
判据不是「这个值看起来像不像真的」，而是：**只要一个值可能是真实个人标识，它就不该留在测试代码里。**

`npm run privacy:scan` 在 commit 前跑，ERROR 必须为 0。

## Allowed（唯一认可的合成身份）

主身份：

```text
姓名      张小明
手机号    15300001122
邮箱      test.resume@example.com
微信      test_resume_01
QQ        100000001
Portfolio https://example.com/portfolio
```

需要第二组用户时：

```text
姓名      李测试
手机号    15300002222
邮箱      second.resume@example.com
微信      test_resume_02
QQ        100000002
Portfolio https://example.org/profile
```

域名只用 RFC 2606 保留域（`example.com` / `example.org` / `example.net`）与 `test.com`。
IP 只用文档保留段（`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`）。

合成履历（教育 / 实习 / 项目）——**不用任何真实高校名、真实公司名、真实部门、真实岗位**：

```text
学校      示例科技大学        （需要第二所：示例学院）
学院      测试学院
专业      测试专业            （不要用真实学科名去凑真实感）
学历      本科
毕业时间  2027.06
公司      示例科技有限公司    （第二家：示例互动有限公司 / 示例水务有限公司）
部门      测试部门
职位      AI 应用实习生
入职/离职 2026.06 / 2026.09
项目名    示例流程自动化系统
```

多条目（multi-entry）测试**必须保持公司/条目彼此不同**——三个条目都叫「示例科技有限公司」
会让「项目 A → #1 / 项目 B → #2」的串位检查失去判别力。

需要一段经历正文时用明显合成的话术，例如：

```text
负责测试业务流程自动化工具的需求整理、规则配置与验证，
用于验证表单识别、内容映射和批量填写流程。
```

技术名（Python / Playwright / RAG / Agent）可以保留；真实业务客户、真实部门、真实营收、
真实团队规模、真实项目数据不要留。

## Forbidden

真实的：姓名 · 手机号 · 邮箱 · 微信号 · QQ 号 · 身份证号 · 账号 handle（GitHub 等）·
住址 · 教育/雇佣经历等可识别个人的简历正文 · API Key · Cookie · Token。

不重新引入「真实用户名风格的 handle」，即使换掉域名也不行。

## Real Pilot 数据

允许保存（属于公开招聘信息，不是个人隐私）：

```text
公司 / 岗位 / JD 正文 / 公开 URL / 页面结构样本
```

用户实际填进表单的内容**只允许保存**：

```text
field type / risk level / 值长度 / 可选 hash / sameValue / status
```

禁止保存完整真实值——包括截图里能读出真实姓名、手机、邮箱、公司的画面。
机器可读结果参照 `real-validation-results/sessions/2026-09-25-yaoji-real-write-data.json`：
只有 `requestedLength` / `actualLength` / `requestedValueHash` / `sameValue` / `writeStatus`，没有值正文。

## 现有占位值说明（privacy-scan 的「已登记占位号段」）

历史 fixture 里有一批明显非真实的占位值。它们已被逐条复核并登记进
`scripts/privacy-scan.mjs` 的 `KNOWN_PLACEHOLDER`，只计数、不再逐行告警：

```text
13800001234 / 13800000000 / 13800138000     —— 全 0 或顺序尾号，教科书式占位
110101199001011234 / 330106200305011234 / 330106199001011234
                                            —— 身份证形状，尾号 1234，校验位不合法
张三 / 李四 / zhangsan@test.com             —— 通用示例名（邮箱走保留域，不告警）
```

复核日期 2026-09-26。当前计数直接看 `npm run privacy:scan` 的第三项——政策与审计文档本身
会引用这些号段，所以计数会随文档增长，这是预期行为，不必去消。
**新增一个未登记的号段仍会报 WARN**——这正是登记机制的目的：
让 WARN 重新变成「需要人看一眼」的信号，而不是长期噪音。

新增 fixture 请直接用上面的 Allowed 表，不要再造新的占位号段。

## Screenshots

图片没法用 regex 扫，所以按「这张图里有没有可读的用户填写值」来判，规则写在
`real-validation-results/README.md`，扫描器对 `real-validation-results/` 下**被跟踪的位图**一律报
WARN，确认干净的登记进 `scripts/privacy-scan.mjs` 的 `ALLOWED_TRACKED_IMAGES`（不给目录整体豁免——
整体豁免正是漏掉 filled-form 截图的那种失败）。

Allowed：

- 合成 fixture 渲染出的界面
- 公开职位页 / 公开 JD
- 只含字段名、风险徽章、长度的扩展 UI
- 明确标注的合成演示图（文件名含 `sanitized` / `demo`）

Forbidden：

- 能看到真实用户简历 / 申请内容的截图（学校、公司、手机、邮箱、正文）
- 真实手机号、邮箱、教育·雇佣值出现在画面里
- 登录态、会话、Cookie 画面

**真实 Pilot 截图默认 private / ignored**：放 `real-validation-results/private/`（已 gitignore），
本地留存但不入库。写入正确性由结构化记录证明，不由截图证明。

不要用「把真实截图涂黑几个字段」的办法把它变成可公开证据——那既不干净也不是原始证据。
需要可公开的图，就用合成 profile 重跑一张，并在报告里写明
`Sanitized demonstration screenshot. Form structure is real; profile data is synthetic.`

## 不要动的东西

正常依赖 URL、README 里的通用 GitHub 示例、公开招聘 JD、真实 ATS 域名、代码逻辑字符串
（例如 `fieldAliases.ts` 里的「微信 / wechat / weixin id」是匹配别名，不是个人数据）。

招聘主体的公开信息（姚记科技、广州诗悦网络科技有限公司、游戏测试工程师-27届秋招、
载具策划 - 3C（望月）-2027届校招、公开 ATS URL）**保留**——它们是 Job Capture 回归原料。
要区分的是「招聘方公开信息」和「用户自己的履历」，只有后者需要脱敏。
