# Application Form Assistant（网申自动填写助手）

[English](README.md) | **简体中文**

网申自动填写助手：识别岗位 → 识别字段 → 按资料库一键填写。不逐项确认，但绝不自动提交。

一个 Chrome/Edge（Manifest V3）浏览器扩展：读取当前打开的网申表单，识别需要填写的字段，
与本地资料库匹配后一键写入页面 —— 绝不编造值，也绝不自动提交。英文介绍见 [README.md](README.md)。

## 快速开始

前置要求：Node.js 18+、npm、Chrome 或 Edge 114+。

```bash
git clone https://github.com/zhangtt08/application-form-assistant.git
cd application-form-assistant
npm install
npm run build
```

然后在 `chrome://extensions`（或 `edge://extensions`）打开「开发者模式」→「加载已解压的扩展程序」→ 选择生成的 `dist/` 目录。

常用命令：

```bash
npm test                 # 单元测试（Vitest，离线、确定、免费）
npm run test:e2e         # Playwright 端到端测试
python smoke/smoke.py    # 真实 Chromium UI 冒烟测试（截图见 smoke/shots/）
npm run eval:generation  # 生成质量评测（需要 Provider，见下文）
```

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
   十几个字段不再铺成两屏滚动；`basic.name` 这类内部标识和置信度百分比只在
   「设置 → 开发者模式」里出现。填完后主按钮是出路「投递下一个岗位」，不是一个灰掉的死句。
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
`response_format: { type: "json_object" }`。Key 只存 `chrome.storage.local`，不进代码与日志。

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
  background/            MV3 Service Worker（标签页 / 运行时编排）
  content/               页面内连接器与字段写入（所有 frame 生效）
  sidepanel/             React UI：投递 / 岗位 / 资料 / 设置（底部导航）
  pipeline/              识别 → 匹配 → 写入 的流水线编排
  matching/              字段 ↔ 资料匹配
  profile/               多资料库存储（afa.profiles.v2）+ 纯文本简历解析
  rules/                 确定性规则（是否题极性匹配等）
  answering/ generation/ job/ context/ workspace/ compatibility/ types/ utils/
tests/  e2e/  smoke/  evaluation/    单测（Vitest）· e2e（Playwright）· 冒烟 · 生成评测
```

## 许可证

[MIT](LICENSE)
