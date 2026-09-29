# Pilot Session — Moka 未登录页语境门禁验证（Batch #4 / RECON_ONLY_NO_LOGIN）

> 日期: 2026-09-27 ｜ 执行: `scripts/moka-context-gate.mjs`（本批保留，可复跑）
> 结论: **issue-004 real_site_verified** —— 真实 Moka 登录面板上，申请候选 = 0，
> 登录手机号与导航职位搜索框均被语境门禁排除，扫描后 DOM 逐控件 diff = 0。
> **全程未登录、未输入任何值、未勾选协议、未点击登录/验证码/提交。**
> 产物: 本文件 + `2026-09-27-moka-context-gate-data.json`（只落控件数/长度/状态，无值正文）

## 1. 本轮性质

这不是 Real Write Pilot（真实申请表单仍在登录墙后，见 `2026-09-27-moka-real-write-synthetic.md`），
而是 Batch #4 的**真机安全过滤验证**：证明「未登录页不再被当成申请表」。
按 §二十七，这一步**不需要登录态**。

| 项 | 值 |
|---|---|
| Platform Family | Moka |
| Mode | `RECON_ONLY_NO_LOGIN` |
| URL | `app.mokahr.com/campus_apply/shiyuehr/72055#/job/b9117cc4-1328-4bb4-b341-2ad4783529ce` |
| 职位 | 载具策划 - 3C（望月）-2027届校招 |
| 公司 | 广州诗悦网络科技有限公司 |
| Data | SYNTHETIC_PROFILE（含手机号，用于证明「有内容可填也不写进登录框」） |
| 扩展 | 当前树重建的 `dist/`（三入口），真实 Chromium（chromium-1243）加载真实 MV3 |

种入合成资料是**必要条件**而不是可选项：不种资料，登录手机号会因「无内容」而 status=empty，
那样的"通过"什么也没证明。只有让它带上 11 位手机号，才能验证门禁真的拦在候选层。

## 2. 结果

```text
controls                      = 7     （登录面板展开后的真实页面）
detectedApplicationFields     = 0     ← §二十六 期望值
excludedByContextGate         = 2     登录手机号 + 导航职位搜索框
confirmedFillPlanApproved     = 0
scanMutatedDom                = false （逐控件 diff = 0，含 len/shape/checked）
previewCtaPresent             = true  （预览入口存在，但清单里没有任何可填候选）
submitted / loginAttempted    = false / false
```

侧边栏实际呈现（Dev 模式关闭时用户看到的）：

```text
已忽略 2 个网页控件——它们不属于申请表单（登录 / 搜索 / 导航等全局区域）
```

排除明细（Dev 模式可读，§十八）：

| 控件 | 分类结果 | zone | 处置 |
|---|---|---|---|
| `请输入手机号`（登录用） | `basic.phone` | authentication | excluded |
| `输入职位关键字`（导航搜索） | `internship.position` | search / navigation | excluded |
| 验证码框 | — | — | 由**既有**关键词忽略层先拦掉（`IGNORE_KEYWORDS` 含「验证码」），不计入语境门禁功劳 |

## 3. 中途真机打回一次（本轮最有价值的部分）

第一版实现**单测 12/12、e2e 81/81 全绿**，但 `moka-context-gate.mjs` 首跑直接报：

```text
[MOKA-GATE] 意外候选: 请输入手机号 | basic.phone | SAFE | need-confirm
[MOKA-GATE][STOP] issue-004 未生效：登录页仍产出可填候选
```

逐层 dump 真实祖先链后定位到两个**设计错误**（不是参数没调好）：

1. **采集深度不够**：真实 Moka 把 `+86获取验证码登录首次登录会自动创建新账号…` 写在
   **第 4–6 层**（`.sd-Modal-content` / `.sd-Modal-modal-*`），而第 1–3 层的文本只有 `+86`。
   我原本只在 ≤3 层读全文 → 认证语境完全不可见。
2. **正向信号列错**：`modal / dialog / drawer / panel` 被我列进了申请侧正向 class 模式，
   等于给登录弹层**加分**。§八 说得很清楚：dialog 本身不是问题，要看里面是「投递简历」还是「验证码」。

修正：祖先采集放到 6 层（`body/html` 仍永不读全文）、认证命中按层衰减 `-6 / -4 / -2`、
弹层类 class 改为语境中立。改完真机复跑才拿到上面那组数字。

**教训**：fixture 全绿只证明"我按自己的想象建了个页面"。这条真机步骤是本轮唯一能证伪它的地方，
所以它必须是验收的一部分而不是最后一步。

## 4. 未变差的其他红线

| 项 | 结果 |
|---|---|
| Scan 只读 | diff = 0；语境采集全程只读（`textContent` / `getAttribute` / `className`），未插入探针节点、未改属性、未 focus/click/dispatch（§二十二） |
| 姚记零回退 | `e2e/compat/real-yaoji.spec.ts` 与全部 81 项通过；姚记无 `<form>` 的申请区仍 `contextEligible = true`（§十六，另有 unit 断言 `document.querySelectorAll("form").length === 0`） |
| 误伤防护 | 同页并存时：搜索框被忽略、申请区手机号照写（CTX-C / AA14）；「期望职位」含「职位」二字仍照填（§十五） |
| 提交 | 从未接近。脚本另有守卫：文本命中 `登录\|验证码\|获取\|同意\|提交\|投递\|申请并\|下一步\|submit` 的点击一律 throw |

## 5. Moka Pilot 状态（§二十九）

即使 issue-004 已修，Moka 仍**不能**标 Real Write Verified。当前状态：

```text
Capture Verified
Unauthenticated Context Safety Verified   ← 本轮新增
Real Write Pending Login
```
