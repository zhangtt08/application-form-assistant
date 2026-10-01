# afa Agent API / MCP

把 **ATS Application Assistant**（网申自动填写助手，Edge MV3 扩展）当成一个带 schema 的 tool 来调用。

契约：`personal-agent-hub/docs/AGENT_API_STANDARD.md` v1 · 端口 **8797** · 只监听 `127.0.0.1`

```bash
npm run agent:serve      # HTTP 服务 → http://127.0.0.1:8797
npm run agent:mcp        # MCP stdio 桥（同一套工具，给任何 MCP 客户端）
```

## 这个 Agent 能做什么、不能做什么

**能**：复用扩展自己的判断逻辑，离线回答「这个网页字段会被认成什么、为什么、会不会被红线拦下」。

**不能**：它**不连浏览器**。扩展的真实数据在用户自己浏览器的 `chrome.storage.local` 里，
填写发生在用户浏览器的 content script 里——这个 Node 进程两者都碰不到，也不假装能碰。

因此八个工具**全部 `risk: 'read'`**。这里**没有**任何写 DOM、点提交、向第三方站点写入的能力：
不是还没做，是产品的安全红线本身就排除这些（不自动提交 · 风险字段只允许手动 · 扫描阶段不写 DOM）。
把「提交申请」包成一个工具，等于把这条红线拆掉。

## 单一事实源（不在 agent 里重写第二份）

`agent/tools.mjs` 通过 `agent/ts-loader.mjs`（一个只补 `.ts` 扩展名的 ESM 解析钩子）
用 Node 直接 import 扩展的源码：

```
agent/tools.mjs
   └─→ src/core/index.ts        ← 纯逻辑门面：matcher / riskRules / scanPipeline /
   │                              fillPlan / Profile 校验 / JobParser / 字段中文名 /
   └─→ src/content/scanner.ts   ← 匹配依据解释
```

`src/core` 不是给 agent 抄的一份副本，它 re-export 的就是扩展侧边栏 import 的那同一批文件。
所以 agent 报的置信度和侧边栏徽章上的百分比**必然一致**——两份 matcher 迟早给出两个结论，
这个项目里不发生这种事。

### 唯一的环境补偿

`scan_form` / `plan_fill` 用 jsdom 提供 DOM。jsdom 没有布局引擎，`getBoundingClientRect()`
恒为 0，而 scanner 有一条「零尺寸控件不算候选」的过滤。所以这里给 rect 打了一个固定桩，
**与 `tests/scanner.test.ts` 的 `beforeAll` 桩同一口径**。除布局数字外没有任何判定被替换。

## 工具清单

| 工具 | 风险 | 输入 | 返回 |
| --- | --- | --- | --- |
| `afa.list_fields` | read | `group?` `risk?` `query?` `limit?` | 91 个 canonical 字段：中文名、板块、是否多条目、风险等级与原因、别名数 |
| `afa.read_profile` | read | `file?` `only_filled?` `limit?` | 资料档案**脱敏摘要**：真实条数 + 逐字段有无内容。身份证/手机/邮箱/住址/姓名只给长度与打码值 |
| `afa.validate_profile` | read | `file` | 用扩展自己的 fail-safe 校验器检查档案，逐条错误 + 归一化结构统计 |
| `afa.scan_form` | read | `html` \| `file` \| `url`，`profile_file?` `profile_type?` `limit?` | 只读扫描真实 DOM：字段清单 + 匹配建议 + 为什么 + 红线统计 |
| `afa.match_question` | read | `question`，`section?` `options?` `kind?` … | 单条问题的匹配结论：字段、置信度、逐条依据、次选、风险、语境门禁判定 |
| `afa.plan_fill` | read | 同 `scan_form`，`include_values?` | **填写计划 JSON（不落 DOM）**：会写哪些、被拦下哪些及原因。与扩展走同一个 `buildFillPlan` 门禁 |
| `afa.export_results` | read | `kind?` `include_headings?` `limit?` | 真实验证产物：`real-validation-results/` 的 session/issue 清单与结论、兼容性矩阵与 fixture |
| `afa.storage_overview` | read | `export_file?` | 扩展 `chrome.storage.local` 的**真实键登记表**（键名/写它的模块/存什么/是否含个人标识）；可选读一份导出文件 |

## HTTP 契约

```
GET  /api/health          -> {ok:true,data:{project:"afa",version,agent_api:1,tools:8,uptime_ms}}
GET  /api/agent/manifest  -> {ok:true,data:{project,version,base_url,tools:[...]}}
GET  /api/agent/tools     -> {ok:true,data:[{name,description,input_schema,risk}]}
POST /api/agent/tool      -> body {tool:"afa.scan_form",input:{...}} -> {ok:true,data,tool,ms}
                             失败 -> {ok:false,error:{code,message}}   (HTTP 400/500)
```

未知工具返回 `unknown_tool` 并带 `available` 全清单；缺必填/多传参数返回 `bad_input`。

```bash
curl -s http://127.0.0.1:8797/api/health
curl -s http://127.0.0.1:8797/api/agent/tools
curl -s -X POST http://127.0.0.1:8797/api/agent/tool \
  -H 'content-type: application/json' \
  -d '{"tool":"afa.match_question","input":{"question":"毕业院校","section":"教育经历"}}'
```

## MCP

任何 MCP 客户端直接起 `node agent/mcp-server.mjs`：`tools/list` 转发 `/api/agent/tools`，
`tools/call` 转发 `POST /api/agent/tool`。服务没起时桥按 `agent/launch.json`
（`{"command":"node","args":["agent/server.mjs"],"ready_port":8797}`）自行拉起。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.mjs` | 标准实现。与模板只有两处差异：默认端口 8790→8797（项目相关值），以及补上未知工具分支缺的 `return`（模板缺这一行会让请求穿透到 `tool.input_schema`，抛 TypeError 后二次写响应 → `ERR_HTTP_HEADERS_SENT` → 进程退出） |
| `mcp-server.mjs` | 标准实现，与模板逐字节相同 |
| `tools.mjs` | **本项目唯一写的逻辑**：八个工具，全部只读 |
| `ts-loader.mjs` | Node ESM 扩展名补全钩子（`.ts`/`.tsx`/`index.ts`），不做转译、不替换逻辑 |
| `launch.json` | MCP 桥的自启动声明 |
| `.endpoint` | server 每次启动写的实际地址（8797 被占会 +1），已 gitignore |

## 隐私

`read_profile` / `scan_form` / `plan_fill` 的输出会进模型上下文，所以个人标识默认不外发：
姓名只给首字，手机/邮箱/身份证/住址/出生日期/紧急联系人只给长度与打码形态，
其余值截断到 160 字。判据与 `docs/TEST_DATA_POLICY.md` 的 Forbidden 表一致。
`storage_overview` 会指出 `afa.generation.settings.v1` 里存着模型 API Key——它只报「这个键存在」，
永不回显值，也没有任何工具会去读它。
