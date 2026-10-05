# Application Form Assistant（网申自动填写助手）

[English](README.md) | **简体中文**

网申自动填写助手：识别岗位 → 识别字段 → 按资料库一键填写。不逐项确认，但绝不自动提交。

一个 Chrome/Edge（Manifest V3）浏览器扩展：读取当前打开的网申表单，识别需要填写的字段，
与本地资料库匹配后一键写入页面 —— 绝不编造值，也绝不自动提交。英文介绍见 [README.md](README.md)。

## 快速开始

前置要求：Node.js 18+、npm、Microsoft Edge（或 Chrome）114+。

```bash
git clone https://github.com/<你的账号>/application-form-assistant.git
cd application-form-assistant
npm install
npm run build          # 产出 dist/：侧边栏 + content script + service worker
```

**装进 Edge**（`dist/` 是构建产物，不入库；改过代码要重新 `npm run build`，
然后回扩展卡片上按一次刷新图标）：

1. Edge 地址栏打开 `edge://extensions`；
2. 左侧栏底部打开「**开发人员模式**」开关；
3. 点「**加载解压缩的扩展**」，选择项目里生成的 **`dist/`** 目录；
4. （可选）在工具栏固定这个扩展，然后打开任意网申页面；
5. 打开侧边栏：点工具栏上的扩展图标 → **Application Form Assistant**
   （或右键页面 → 「更多操作」→ 选它）；
6. 第一次用：先到「**资料**」页粘贴简历文本 —— 解析完全离线，不联网、不上传；
   然后回「**投递**」页点「开始识别」。

装进 Chrome 是同一套：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `dist/`。

常用命令：

```bash
npm test                 # 单元测试（Vitest + jsdom，离线、确定、免费）
npm run typecheck        # tsc --noEmit
npm run build            # 三个构建目标：sidepanel / content / background
npm run test:e2e         # Playwright 端到端（真实 Chromium + dist/ 扩展）
npm run test:compat      # 兼容性矩阵 → compatibility-results/report.md（可再生，不入库）
npm run privacy:scan     # 扫一遍入库文件里的个人标识与凭据，必须 0 ERROR
npm run agent:serve      # 本地 Agent API → http://127.0.0.1:8797
npm run agent:mcp        # MCP stdio 桥（同一套工具）
python smoke/smoke.py    # 真实 Chromium UI 冒烟测试（截图见 smoke/shots/，不入库）
npm run eval:generation  # 生成质量评测（需要 Provider，见下文）
```

## 安全红线（这是产品定义，不是待优化的限制）

下面每一条都既在代码里强制，也有测试守着：

| 红线 | 落在哪 |
| --- | --- |
| **永不点击提交** —— 扩展负责填，人负责提交 | `src/rules/ignoreRules.ts`（`BLOCKED_ACTIONS`）+ `e2e/safety-flow.spec.ts` |
| **风险字段只允许手动** —— 承诺、声明、电子签名、是否接受调剂、已阅读并同意、背调授权、签证/工作许可，一律不代填：这些不是「资料」，是替人做保证 | `src/rules/riskRules.ts`（`MANUAL_ONLY_KEYWORDS`） |
| **扫描阶段绝不写 DOM** —— scanner 只读；每一次写入都必须经过「用户点确认」才生成的 ConfirmedFillPlan | `src/content/scanner.ts` + `src/pipeline/fillPlan.ts` + `e2e/scan-does-not-write.spec.ts` |
| **绝不编造值** —— 资料库没有就留空；超出字数上限、数字框收不下的值交回人工，不截断也不改写 | `src/pipeline/scanPipeline.ts`（`deriveStatus`） |
| **人口统计/受保护类别不是资料** —— 民族、种族、残障、兵役、EEO 自证题即使别名命中也绝不自动写 | `src/matching/matcher.ts`（`PROTECTED_CLASS_MARKERS`） |
| **别人的字段不是你的** —— 标签写着「推荐人 / 内推人 / 家长 / 紧急联系人」时，不许拿你本人的姓名手机去顶 | `src/matching/matcher.ts`（`OTHER_PERSON_MARKERS`） |
| **只在本地** —— 无云端后端、无埋点；唯一的外呼是你明确配置过的 AI Provider。API Key 默认只在本次会话内存里、不写磁盘；勾选「留在这台机器」才会进 `chrome.storage.local` —— 那是**存储**不是**保护**（明文文件、不加密、无访问控制） | `src/generation/provider.ts` |

## Agent API / MCP

本产品是浏览器扩展，**没有常驻服务**，所以 Agent 是一个独立的本地进程（端口 **8797**）：

```bash
npm run agent:serve      # HTTP  → http://127.0.0.1:8797
npm run agent:mcp        # MCP stdio 桥（任何 MCP 客户端可直接接同一套工具）
```

八个工具，全部 `afa.` 前缀、全部 `risk: 'read'`：
`list_fields`（可填字段清单）、`read_profile`（**脱敏**档案摘要）、`validate_profile`、
`scan_form`（对给定 DOM 只读扫描 + 匹配建议）、`match_question`（单条问题为什么匹配到某字段）、
`plan_fill`（生成填写计划 JSON，**不落 DOM**）、`export_results`（导出真实验证/兼容性产物）、
`storage_overview`（扩展存储键登记表）。

它们**不重写任何判断**：`agent/tools.mjs` import 的是 `src/core`，
而 `src/core` re-export 的正是侧边栏用的同一批 matcher / 风险分级 / 扫描管线 / 写入门禁源码。
所以 Agent 报出的置信度与界面上的徽章**不可能各说一套**。
这里刻意**没有**任何能写页面、点提交、向第三方站点写入的工具 ——
把「提交申请」包成一个工具，等于把上面那条红线拆掉。

详见 [`agent/README.md`](agent/README.md)（契约、参数 schema、以及 jsdom 无布局引擎这一条环境补偿）。


## UI 交互模型

侧边栏只有四个一级入口（底部导航）：**投递 / 岗位 / 资料 / 设置**。

### 投递页：一条流水线，不是一堆按钮

1. **开始识别**（唯一主动作）——一次点击串起全部环节，每步状态确定、不装转圈：
   连接当前页面（含页面内所有框架）→ 识别岗位与填写方向 → 等 SPA 把字段渲染出来 →
   识别需要填写的字段 → 匹配你的资料 → **直接写入页面**。
   「识别需要填写的字段」**只把处于申请语境中的控件纳入填写流程**：
   登录面板、验证码、导航栏搜索框、页脚订阅框等全局控件会被语境门禁排除，
   侧边栏只以一行统计呈现，不会伪装成待填字段（issue-004）。
2. **写入判定**（没有逐项确认这一步）：
   - 资料库里有内容 → 直接写入（含政治面貌 / 婚姻状况 / 身份证号 / 籍贯 / 户口 / 紧急联系人等
     客观信息 —— 它们存在资料库里，就该被填上；资料库没有则保持空着，绝不编值）；
   - 内容超出字段字数上限 → **不写**（既不截断也不硬塞超长值），标记「请人工填写」；
   - 数字框收不下该值（如整数年份框收到 `2027.06`）→ 不写，标记「请人工填写」；
   - 承诺 / 声明 / 电子签名 / 是否接受调剂 / 已阅读并同意协议 → **永不代填**，
     这不是「资料」，是替用户做保证；
   - 文件上传、验证码、密码框 → 不支持，也不碰。
3. **投递视图**先给结论再给细节：`已填写 N / 待补资料 M / 需人工 K`，
   字段明细按「需要你确认 / 已自动填写 / 需人工处理」折叠分桶（也可切「按板块」看）。
   已按资料库填好的客观信息**一行一条**（字段 · 内容 · 来源），点开才看完整卡片 ——
   十几个字段不再铺成两屏滚动。
   **每张卡片都有「为什么是这个字段」**：展开后能看到匹配到的资料项中文名（如「教育经历 · 学校」）、
   把握等级，以及逐条依据（命中了哪个信号源：字段标签 / aria-label / 提示文字 / 控件 name /
   所在板块加成 / 网页自己声明的 `autocomplete`、`type`）。内部标识 `basic.name` 与百分比
   仍然只在「设置 → 开发者模式」出现，但**依据本身不再藏起来**：一个 92% 的数字用户核对不了什么，
   「它凭什么说这一栏是我的手机号」才是能核对的话。
   **两个字段分不开时**（次选候选），卡片上给一个「改用这一项」：改挂后**重新走一遍完整判定**
   （风险分级 → 取值 → 状态推导），不是只换个标签，确认状态一并作废。
   **忽略可以撤销**：点错一下不必整页重识别。
   填完后主按钮是出路「投递下一个岗位」，不是一个灰掉的死句。
   **缺资料的出路**：识别到了某栏但资料库里没有内容时，面板会列出**具体缺哪几项**并给一个
   「去补这几项」的跳转，而不是留一句「暂无可填项」让用户自己猜。
   **填写结果回执**：写完不再只报一行「成功 N 失败 N」，而是分组摊开 ——
   已填写（可逐项定位回页面）、其中哪几项请重点核对（把握不到「高」这一档或属主观表达）、
   被红线拦下的**以及为什么**（承诺/声明/调剂类不代填、语境门禁排除的登录框、
   网页给的选项里没有你资料里那个答案、超出字数上限）、没填进去的与失败原因、
   资料库里没有内容的、没认出来的、你忽略的。
   扩展**故意没做**的事如果不说出来，就会被当成「软件漏填了」—— 这是回执要解决的问题。
   **一屏只留一个主操作**：识别跑完后四行进度条收成一行（`识别完成 · 4/4 步 · 已识别 17 个字段…`，
   点开才看逐步明细，有失败步时自动展开），「重新识别 / 撤销本次填写」降成文字链，
   「我已完成投递」降成小按钮，当前页面 URL 只在开发者模式显示。
   如果当前页面只有岗位描述、还没有网申表单（招聘官网的职位详情页常是这个形态，
   投递入口在登录之后），面板会直说「这个页面没有网申表单字段（岗位已记录，进入投递页再识别）」，
   而不是假装网页被改过。
4. 岗位方向、路由依据、命中关键词、历史岗位全部收进岗位条的「调整」展开区，
   默认只显示「当前岗位 + 采用的方向」两行。
5. **岗位**页是投递过的机会清单：每张卡片写着这一步该干什么（开始申请 / 继续填写 / 去笔试…），
   点进详情后「开始 / 继续申请」会把你带回那个岗位的网页（已经开着就切过去，没开就新建标签），
   「来源」也是可点开的链接 —— 列表不是只给你看的流水账。
   备注 / 标签 / 归档 / 删除这些「维护记录」的动作收进详情底部的「更多操作」折叠，
   所以详情页永远只有一个主按钮。
6. **撤销**始终可用；提交永远由你手动点。
7. 设置页可以关掉「识别后直接填写」，回到先看清单、勾选后再写的节奏（第一次用某个站点时有用）。

### 资料页：多资料库 + 纯文本导入

**多资料库**：一个人投产品岗和运营岗会准备两套不同的经历侧重 —— 所以资料不是一个整体，
而是「公共信息 + 若干资料库」。

- **公共信息（`shared`）**：姓名 / 联系方式 / 教育背景 / 敏感信息 —— 每个岗位都一样，
  只存一份，改一次全库生效（不会出现「哪个库里的手机号是旧的」）。
  英文招聘网站（Greenhouse / Lever / Workday 类）把姓名拆成 `First name` + `Last name`，
  所以库里另有「姓氏 / 名字 / 领英 / GitHub」几栏 —— 各填一次，英文站就不再整片认不到。
  扩展**不会**把「赵合一」自作主张拆成「赵 / 合一」（复姓、中英混排都会拆错）。
- **库内容（`content`）**：经历 / 技能 / 求职意向 / 常用文本 —— 每个库各自一份。
- **每个库声明「适用方向」**（可多选，也可不选 = 通用兜底库）：
  识别出岗位方向后自动切到对应库（更专用的库优先，没有专用库就用兜底库），
  投递页的岗位条里随时可以手动换。
- 资料页顶部是库切换器，支持新建 / 编辑（名称 + 方向）/ 复制 / 删除；
  只剩一个库时禁止删除。
- **两层内容优先级**：资料库放你**提前写好的固定内容**，AI 只在缺的时候兜底 ——
  库内的「岗位方向变体」仍是表达层，未配置时才回退默认表达。
- **「是否…」单选题有地方存了**：是否接受线下面试 / 线上面试 / 出差 / 异地外派 / 加班，
  在资料页各答一次（是 / 否 / 未设置）。站点选项常写成「可以接受 / 不接受」，
  扩展按**同极性写法**匹配（`src/rules/yesNoAnswers.ts`），绝不会把「是」勾到「不接受」上；
  选「未设置」时留空不猜。
- **「是否有实习经历 / 是否有项目经验」不用答**：资料库里录了实习或项目，扩展就答「是」。
  反向不成立 —— 库里没录 ≠ 没有这段经历，扩展绝不会因此替你勾「否」（那是替用户编造事实）。

存储：`afa.profiles.v2`（`{ schemaVersion, shared, libraries[], activeLibraryId }`）。
单库时代的 `afa.profile.v1` 会自动迁移成一个「默认资料库」，并作为**当前库的镜像**继续同步写入
（旧版扩展 / 脚本 / e2e 继续可用）。读盘时缺字段按默认形状补齐，不整库丢弃。

**纯文本导入**：粘贴一份中文简历的纯文本即可 —— 离线规则解析，不联网、不上传、不需要 API Key：

- 识别分节标题（教育背景 / 实习经历 / 项目经历 / 校园经历 / 技能与证书 / 自我评价 / 求职意向）；
- 支持 Markdown 记号、全角空格、多种日期写法（`2024.06-2024.09` / `2024年6月—9月` / `2024.06-至今`）；
- 解析结果**先预览再落盘**：列出识别到哪几类信息 + 每条经历的实体，再选落点
  「覆盖当前库」/「只填空白项」/「新建一个资料库」；
- fail-safe：识别不出任何经历条目时整体拒绝，现有资料不受影响；
- 岗位方向变体（variants）是表达层，导入时一律留空，绝不编造。

代码：`src/profile/libraryStore.ts`（多库存储 + 选库）、`src/profile/resumeTextParser.ts`（文本解析）。
单测：`tests/libraryStore.test.ts`（29 项）、`tests/resumeTextParser.test.ts`（11 项）。

### 设置页

自动填写开关、JD 自动捕获开关、AI Provider 配置、Dev Trace —— 全部从主流程里挪走。

AI Provider 支持 **Mock（离线）/ DeepSeek / OpenAI 兼容（自定义 / 本地代理）**：
选 DeepSeek 会自动带出 `https://api.deepseek.com/v1` 与 `deepseek-chat`，只需要粘 API Key。
`deepseek-reasoner` 等推理型模型不会发送 `temperature`；期望 JSON 的请求会带
`response_format: { type: "json_object" }`。
**Key 的存放**：默认只留在本次会话的内存里，磁盘上的配置记录里没有它（关掉侧边栏或浏览器就要重新粘贴）；
界面上的「把 API Key 留在这台机器上（不推荐）」是显式勾选，勾了才写 `chrome.storage.local`，
警告文案就贴在勾选框下面。要写清楚的是：`chrome.storage.local` 是明文 leveldb 文件，不加密、
没有访问控制，本机其它进程读到那个文件就等于读到 Key —— 所以勾选带来的是**留存**，不是**保护**。
两种情况都一样：Key 不进代码仓库、不进日志、不进 trace/snapshot，界面也不回显完整内容。
`clearPersistedApiKey()` 会把磁盘和内存两份一起收回。

## UI 冒烟验证

单测覆盖不到「侧边栏能不能渲染、按钮点了有没有反应」，`smoke/smoke.py` 补这一层：
用真实 Chromium 加载 `dist/sidepanel.html`，注入 chrome API 桩（storage / tabs / runtime）
与假的表单字段，把识别（按资料库直接写入）→ 撤销 → 岗位列表 → 资料导入 → 设置全流程走一遍并逐步截图，
截图落在 `smoke/shots/`（改 UI 后要看图，不要只看 typecheck 绿）。

脚本里预置了**两个资料库**（通用 / AI 产品），用于验证「按方向自动切库」真的生效。

```bash
npm run build
python smoke/smoke.py          # 截图落在 smoke/shots/
# 退出码非 0 = 页面上出现未捕获异常或 console.error
```

## Evaluation（生成质量评测）

本项目的完成标准**不是**「LLM 能生成」，而是：

1. **事实准确** —— 生成的 Variant 中每个数字/技术/角色表达都必须能追溯到 Master Profile Facts；Validator（Numeric / Technology / Responsibility Guard）对不可追溯的表达判定 fail 并禁止保存。
2. **可验证** —— 每次生成输出结构化 Validation Report（Claim 级别 supported/unsupported/uncertain），人工可在 Review UI 逐条核对。
3. **可回归测试** —— `evaluation/` 目录维护 20 个 Case 的生成评测数据集（含 10+ Adversarial 诱导性 JD）与 13 条人工标注的 Validator 标注集；修改 Prompt / ClaimExtractor / FactValidator / FactSelection 后运行 `npm run eval:generation` 对比 Fact Precision、Unsupported Claim Rate、Requirement Coverage、Forbidden Hits，防止改好一处坏一片。

### 运行评测

```bash
npm run eval:generation
# 无 Provider 配置时明确退出 PROVIDER_UNAVAILABLE（不影响普通测试）
# 真实调用需环境变量（Key 不落盘）：
EVAL_PROVIDER_BASE_URL=https://api.example.com/v1 EVAL_PROVIDER_MODEL=gpt-4o-mini EVAL_PROVIDER_API_KEY=... npm run eval:generation
```

普通测试（`npm test`）保持离线/稳定/免费，仅覆盖 Mock Provider 与确定性规则。

### Prompt Regression

GenerationResult 记录 `promptVersion`（当前 `variant-generator-v1`）。修改 Prompt 时递增版本号，用 `EVAL_BASELINE_RESULTS` 指向旧报告即可输出 v1 vs v2 对比（RegressionReport 不自动下结论——覆盖率提升但 unsupported 增加时明确提示不能认为更好）。Golden Cases（6 个高价值 Case）作为快速回归集。

## Application Lifecycle（Stage 5）

三层关系与状态机：

```
Job（JobRecord，一个岗位机会，status 由用户手动维护）
├── Session 1（ApplicationSession，一次网申过程）
│   ├── Answers（开放题回答，Fact-grounded + Validation）
│   ├── Fill Plan（确认后的填写计划）
│   └── Trace（开发用 Debug Trace）
├── Session 2（同一岗位可多次申请）
└── Timeline Events（ApplicationEvent，用户可见：捕获/开始申请/填写完成/标记投递/状态变更）
```

- **Job.status**：saved → preparing → applying → submitted（用户手动确认）→ assessment → interview → offer / rejected / withdrawn / archived
- **Session.status**：created → scanned → reviewing → filled → completed / abandoned（completed ≠ submitted——插件不知道用户是否真的提交成功）
- **存储**：`afa.jobs.v2`（v1 自动无损迁移）、`afa.sessions.v2`、`afa.events.v1`，全部 chrome.storage.local 本地保存，无后端

## 目录结构

```
public/manifest.json     MV3 manifest（侧边栏 + Service Worker + 全框架 content script）
src/
  core/                  ★ 扩展与 Agent 共用的纯逻辑门面：字段中文名 + 「为什么匹配到这个字段」
                         的解释层，并 re-export matcher / 风险分级 / 扫描管线 / 填写计划门禁 /
                         Profile 校验 / 岗位解析。判断只在这里有一份。
  background/            MV3 Service Worker（标签页 / 运行时编排）
  content/               页面内连接器与字段写入（所有 frame 生效）
  sidepanel/             React UI：投递 / 岗位 / 资料 / 设置（底部导航）
  pipeline/              识别 → 匹配 → 写入 的流水线编排
  matching/              字段 ↔ 资料匹配
  profile/               多资料库存储（afa.profiles.v2）+ 纯文本简历解析
  rules/                 确定性规则（别名表 / 风险分级 / 是否题极性 / 忽略清单）
  answering/ generation/ job/ context/ workspace/ compatibility/ types/ utils/
agent/                   本地 Agent API（server.mjs + tools.mjs + mcp-server.mjs + ts-loader.mjs）
                         见 agent/README.md
tests/ e2e/ smoke/ evaluation/    单测（Vitest）· e2e（Playwright）· 冒烟 · 生成评测
docs/                  设计原则、测试数据政策、隐私与安全审计
real-validation-results/          真实站点验证证据（sessions / issues；含填写值的截图在 private/，不入库）
```

主要存储键：`afa.profiles.v2`（shared + 多资料库，自动从旧 `afa.profile.v1` 迁移）、
`afa.jobs.v2` / `afa.sessions.v2` / `afa.events.v1`（岗位生命周期）、`afa.apply.prefs.v1`（行为开关）。

**仓库卫生**：构建产物、测试运行目录、可再生的验证报告、以及任何能读出填写值的截图，
一律 gitignore。真实简历原文、联系方式、Cookie 不进仓库 ——
由 `npm run privacy:scan` 把守，判据写在 [`docs/TEST_DATA_POLICY.md`](docs/TEST_DATA_POLICY.md)。

## 许可证

[MIT](LICENSE)
