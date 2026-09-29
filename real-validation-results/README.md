# real-validation-results/ —— 真实站点验证产物入库规则

这个目录是**唯一**记录真实站点 Pilot 结果的地方，也是最容易把用户个人信息写进仓库的地方。
规则以 `docs/TEST_DATA_POLICY.md` 为准，这里只讲本目录怎么放。

## 入库（tracked）

| 内容 | 位置 | 说明 |
|---|---|---|
| Pilot 流程与停止条件 | `pilot-log.md` | 含 Pilot Matrix 状态 |
| Session 报告 | `sessions/YYYY-MM-DD-<platform>.md` | 结构化结论：平台、公开岗位、各类计数、P0/P1/P2 |
| 机器数据 | `sessions/*-data.json` | **只允许**长度 / sameValue / hash / status / 语义判定 |
| Issue 记录 | `issues/*.md` | Bug 全过程 |
| 模板 | `session-template.md`、`issue-template.md` | |
| 公开页面原料 | `sessions/*-retest-raw.json` | 公开 JD 的 DOM 文本，用于 parser 回归 |
| 可公开截图 | `sessions/*.png` | 见下 |

## 不入库（untracked）

一律放 `real-validation-results/private/`（已在 `.gitignore` 里）：

- **含填写值的表单截图** —— 画面里能读出学校、公司、手机、邮箱的那类
- 真实简历原文 / 用户实际填进表单的正文
- Cookie、localStorage / sessionStorage 导出、storageState、auth token
- 任何真实联系方式

## 截图判定

一张 Pilot 截图能不能入库，只看一个问题：**画面里有没有可读的「用户填写值」？**

- 只有公开职位页 + 本方侧边栏（字段名、风险徽章、长度）→ 可以入库
- 能看到目标表单里被填进去的姓名 / 学校 / 公司 / 手机 / 邮箱 → **不入库**，放 `private/`

需要一张能公开、又要展示填写流程的图时：用合成 profile 重新跑一次，
文件名带 `-sanitized-demo`，并在 session 报告里写明
「Sanitized demonstration screenshot. Form structure is real; profile data is synthetic.」
—— 它**不是**原始 Pilot 证据，不能替代结构化记录。

## 写入正确性的证据是什么

不是截图，是结构化数据：

```json
{
  "fieldId": "education.school",
  "requestedLength": 6,
  "actualLength": 6,
  "sameValue": true,
  "semanticCorrect": true,
  "writeStatus": "success",
  "domLabel": "毕业院校",
  "requestedValueHash": "a1b2c3d4e5f6"
}
```

`npm run privacy:scan` 会把 `real-validation-results/` 下任何被跟踪的位图报成 WARN，
提醒人眼过一遍上面那条判定；确认是合成/公开内容的，把文件名加 `-sanitized-demo` 或在
`scripts/privacy-scan.mjs` 的 `ALLOWED_TRACKED_IMAGES` 里登记。

## 公开 JD 数据（允许）

真实招聘公司名、岗位名、JD 正文、公开 ATS URL 属于招聘主体的公开信息，
是 Job Capture / position extraction 的回归原料，**保留**：
姚记科技、广州诗悦网络科技有限公司、游戏测试工程师-27届秋招、载具策划 - 3C（望月）-2027届校招 等。
要区分的是「招聘方公开信息」与「用户自己的履历」——后者才需要脱敏。
