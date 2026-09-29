# Pilot Session — Moka Real Write #2（**未执行：前置条件不成立**）

> 日期: 2026-09-27 ｜ 目标: 广州诗悦网络科技有限公司 · Moka 校招租户
> **结论：本轮 Real Write 没有发生，也不会发生 —— 真实申请表单在手机号 + 短信验证码登录之后。**
> 批次规格 §五 假设「此前已真实验证过的 Moka 页面」可直达申请表单；该假设今天仍然不成立
> （`2026-09-24-first-recon.md` 早已记录「申请表单需登录，游客不可达」，HANDOVER §8.3 把它列为
> 「登录态二轮」待办）。本轮按 §一「遇到真实问题立即停止、不要边测边修」中止。
> 中止前把**能测的都测了**，并因此发现一个新的 P1：`issue-004`。

## 1. 开工基线（§一，全部为本轮实测，不引用旧数字）

| 门禁 | 实测 |
|---|---|
| `npm run typecheck` | 零输出，exit 0 |
| `npm test` | **539 / 539**（24 文件，系统 node） |
| `npm run build` | 三入口全部 `✓ built`（dist 为当前树唯一可信产物） |
| `npm run test:e2e` | **77 / 77**（4.3m，exit 0） |
| `npm run test:compat` | **29 / 29**（2.2m，exit 0） |
| `npm run privacy:scan` | **0 ERROR / 0 WARN** / 47 已登记占位号段 |
| `python smoke/smoke.py` | exit 0，`=== PROBLEMS === (none)`（`AFA_CHROME` 指向 chromium-1243） |

§二 issue-003 收尾：AA13 在 e2e 与 compat 两次运行中均通过；姚记毕业年份已被约束门禁降为 manual，
不再进入 Writer 产生 invalid value（同日复验 `rejectedBySiteValidation = []`）。**本批未为此改动 gate。**

## 2. 目标页面与可达性（§五）

| 项 | 值 |
|---|---|
| Platform Family | **Moka** |
| Mode | REAL_WRITE_NO_SUBMIT（实际达到：`RECON_ONLY`，未进入 Write 阶段） |
| 旧记录 URL | `campus_apply/shiyuehr/72055`（裸路径 302 → 落到租户首页，`未识别到岗位`） |
| 本轮实际 URL | `https://app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4-1328-4bb4-b341-2ad4783529ce` |
| 职位 | **载具策划 - 3C（望月）-2027届校招**（§五 指定的那个，仍在招） |
| 租户在招规模 | 2027届校招：游戏策划类 9 / 美术设计类 10 / 技术研发类 4 / 产品运营类 4 / 市场营销类 3 / 公共职能类 1 |

**登录墙取证（3 样本，同租户）**

| 职位 | 点「申请职位」后 |
|---|---|
| 载具策划 - 3C（望月） | 原地弹层：`+86` / 请输入手机号 / 获取验证码登录 / **「首次登录会自动创建新账号」** |
| 数值策划 | 同上（验证码 + 自动建号文案均命中） |
| 战斗策划 - 3C（望月） | 4s 内未采到面板文案（点击后弹层未及渲染，未复测） |

→ 结论按 2/3 正样本 + 首样本的完整控件清单判定：**该租户投递流程强制账号登录**。
URL 全程不变（原地弹层），`form` 类申请字段数为 0。

**不尝试登录**：需要真实手机号 + 短信验证码，且"首次登录自动创建账号"会在招聘方侧留下真实账号与真实履历
—— 与 §四「只允许 synthetic 数据」和 `docs/TEST_DATA_POLICY.md` 直接冲突，也超出本轮授权范围。

## 3. Capture 回归（§六）—— 通过

```text
company  = 广州诗悦网络科技有限公司   companyExtraction  = { source: "header",     confidence: "medium" }
position = 载具策划 - 3C（望月）-2027届校招   positionExtraction = { source: "job_detail", confidence: "high" }
jobbar   = 广州诗悦网络科技有限公司 · 载具策划 - 3C（望月）-2027届校招
```

- `captureCompanyCorrect = true` —— **ATS 品牌 "Moka" 未污染 company** ✓
- `capturePositionCorrect = true` —— 未退回「未识别岗位」，走 `job_detail` 高置信 ✓
- **Issue #001 / #002 在真实 Moka 页面上无回归**

## 4. 控件清单（§九 —— 本轮唯一能实测的部分：可达页面）

### 4.1 职位详情页（登录面板未弹开）

| 类别 | 数量 |
|---|---|
| text input | 3（其中 2 个是导航栏「输入职位关键字」搜索框，1 个隐藏 `moka-version`） |
| 申请类 CTA | `申请职位`、`登录`、`分享` |
| 职位名所在结构 | `positionExtraction.source = job_detail`（非 `h1`）→ 按 Issue #002 的来源打分口径，职位名取自详情节点而非真实 `<h1>`；本轮未逐项核对标签名，不冒充 DOM 实测 |

> 口径说明：`iframe = 0`、`open shadowRoot = 0`、`body 元素 406` 是在**租户首页**上采的
> （裸 `/72055` 路径 302 落到首页那一次），详情页未逐项采这三项，不在此冒充。

### 4.2 登录面板弹开后（原地弹层，URL 不变）

| 控件类别 | 数量 | 明细 |
|---|---|---|
| `input[type=text]` | 6 | 2× 导航职位搜索框（`op-search-input-*`、`navbar-search-input-*`，**均 visible**）、1× 隐藏 `moka-version`、`+86` 区号（readOnly）、**手机号**、**验证码** |
| `input[type=checkbox]` | 1 | 协议勾选（"阅读并同意《…》"） |
| textarea / select / number / date / 自定义 select / 自定义 DatePicker / contenteditable | **0** | 本轮根本未出现 —— 它们在登录之后的申请表单里 |
| **合计** | **7** | |

**因此 §九 想要的「Moka 真实控件形态分布」本轮拿不到**：custom select、DatePicker、Cascader、
多步骤、简历上传这些决定下一批 Regression Batch 打哪一层的证据，全在登录墙之后。
已知的只有：登录面板自身含 1 个 checkbox（协议）与 1 个验证码字段 —— 两者都**绝不应**被自动写入。

## 5. Scan 只读性（§八）

在可达页面上执行扫描，扩展未修改页面：

```text
BANNER: 已识别 2 个字段，暂无可直接填写的项。扫描不会修改网页内容。
```

未出现 value / checked / selected 变化。**但这条结论的覆盖度有限**：Moka 可达页面上根本没有
待填申请表单，所以 §八 要求的"扫描前后所有可写控件状态比对"只在登录面板这一非目标场景成立。

## 6. 本轮的真实产出：issue-004（P1）

在登录面板上点「开始识别」，**种入合成资料后**（探针只读到计划态，未点任何填写按钮、页面零写入）：

| 站点控件 | 被判成 | risk | status | 有内容 | 会进 ConfirmedFillPlan |
|---|---|---|---|---|---|
| 登录用**手机号**输入框 | `basic.phone` | **SAFE** | need-confirm | 11 | **是** |
| 导航栏**职位搜索框** | `internship.position` | **SAFE** | need-confirm | 8 | **是** |

即：用户在这个界面点「确认并填写」，扩展会把他的真实手机号推进**登录表单**，把实习职位推进**站内搜索框**。
字段语义上甚至"匹配对了"，错的是**语境** —— 认证与导航控件被当成申请表单字段。

详见 `real-validation-results/issues/issue-004-moka-login-panel-as-form.md`（含根因定位与修复方向）。
姚记没暴露它，是因为那个页面里只有申请表单本身。

## 7. 未执行项（诚实清单）

§十~§二十五、§二十七、§二十九 的全部写入相关指标：**未测量**（前置条件不成立）。

```text
Total Controls          = 7（仅登录面板；非申请表单）
Detected Fields         = 2（且两者都是误判 → issue-004）
Approved / Written      = 未执行
T1 / T2 / Constraint    = 未执行
False Fill              = 未执行（无写入，故无 False Fill 发生）
Submit                  = false（从未接近提交）
```

## 8. 要跑成这一轮，需要什么

三选一，都需要你决定：

1. **你登录一次，复用登录态**：把 Playwright 指向一个已登录的持久化 profile（或你手动登录后导出
   storage state）。真实账号会进入测试链路 —— 隐私政策要求显式批准，且证据文件必须只落长度/hash。
2. **换一个游客可投递的 ATS**：§三十五 的下一站候选里，BOSS / 牛客 同样有登录墙；
   需要先确认哪个平台游客可直接填申请表（姚记这类自建 ATS 是目前唯一已证实可写的）。
3. **先修 issue-004**：它不依赖登录态就能复现和回归（fixture 已可离线构造），
   且修完对任何平台都是净收益 —— 我的建议是先开这个 Batch #4。

## 9. 现场清理

- 全程未点击任何 submit-like 元素（`申请职位` 是打开弹层的入口，非提交；未点 `获取验证码`、未点协议 checkbox）
- 未发送任何验证码请求、未创建账号、未提交申请 → **submitted = false**
- 一次性探针脚本（recon / find / dump / apply / loginwall / planstate / src 共 7 个）已全部删除，未入库
- 本轮 `src/` **零修改**
