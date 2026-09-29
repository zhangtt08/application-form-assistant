# SAFETY_FLOW_AUDIT — Scan 后自动填写安全字段的行为审计

> Batch: Safety Flow Reconciliation ｜ 日期: 2026-09-24 ｜ 审计先于修改（本文件完成前未改任何产品代码）

## 结论（TL;DR）

**自动填写由 `handleRecognize` 的第 ⑤ 步触发，写入前没有任何用户确认动作，且默认开启。**
它没有完全绕过 `ConfirmedFillPlan` 机制（写入前确实调用了 `buildFillPlan`），但 plan 的
`confirmed: true` 是**程序自动打的**（`isSafeFillable` → 自动标记），用户确认（Preview → 确认填写）
被整段跳过——Human-in-the-loop 从 Write 之前被挪到了 Write 之后（靠 Undo 补救）。
该行为来自**跨机合并中的本机分支（Branch-L，2026-09-23 快照）**，与交接文档 §1 的产品红线
（「所有填写必须先 Preview 人工逐字段确认」）直接冲突。

## 1. 完整调用链

```
[开始识别] hero 按钮（src/sidepanel/App.tsx:1040，idle 态）
  ↓
handleRecognize（src/sidepanel/App.tsx:574）
  ├─ ① ENSURE_CONTENT_SCRIPT → ② 岗位捕获/路由 → ③ SCAN_PAGE（只读，无写入 ✓）
  ├─ ④ runScanPipeline（src/pipeline/scanPipeline.ts，纯函数：DetectedField[]+Profile → FillCandidate[]，无写入 ✓）
  ↓
  ⑤「自动填写安全项」（App.tsx:756-780）★违规点
      ├─ App.tsx:744  withConfirm = scanned.map(c => isSafeFillable(c) ? { ...c, confirmed: true } : c)
      │               ↑ 程序化把 SAFE 候选标记为「已确认」——用户没有点任何确认
      ├─ App.tsx:746  autoTargets = withConfirm.filter(isSafeFillable)
      ├─ App.tsx:757  开关：prefs.autoFillSafe（src/sidepanel/prefs.ts:18，默认 true）
      ├─ App.tsx:763  writeFields(autoTargets, ...)                     ← 写 DOM 发生在这里
      │     ↓ writeFields（App.tsx:518）
      │     ├─ buildFillPlan(targets, ...)（src/pipeline/fillPlan.ts:9）
      │     │    规则：confirmed===true ∧ status∈{ready,need-confirm} ∧ 有值 ∧ risk≠MANUAL_ONLY
      │     │    ↑ plan 机制本身健在，但 confirmed 已被 ⑤ 程序化打上 → gate 形同虚设
      │     └─ chrome.tabs.sendMessage({ type: "FILL_FIELDS", items })（src/types/message.ts:46）
      │           ↓ content/index.ts:76
      │           └─ fillFields(items)（src/content/filler.ts:17）→ DOM 写入 + Write Verification
      └─ App.tsx:775  setNotice("已自动填写 N 项安全字段，可以撤销。")   ← 用户看到的横幅
  ↓
setPhase("ready")
```

## 2. 逐项回答

### 2.1 哪个函数在 Scan 后触发 Write？

`handleRecognize`（App.tsx:574）内部第 ⑤ 步，经由 `writeFields`（App.tsx:518）→
`chrome.tabs.sendMessage(FILL_FIELDS)` → content 侧 `fillFields`（filler.ts:17）。

### 2.2 是否绕过 ConfirmedFillPlan？

**部分绕过。** 写入路径仍然经过 `buildFillPlan`（confirmed/empty/MANUAL_ONLY 过滤逻辑完好），
但候选的 `confirmed: true` 在扫描后由程序自动设置（App.tsx:744），**用户没有做任何确认动作**。
安全机制的「字母」还在，「精神」（Human-in-the-loop before Write）已被绕过。
FillConfirmDialog（用户点「确认填写」后的唯一合法路径，App.tsx:791 handleFillConfirmed）在该场景下被完全跳过。

### 2.3 是否是跨机 merge 带来的 Branch-L 行为？

**是。** 证据链：
- 违规代码位于 `src/sidepanel/App.tsx` 本机 09-23 快照（Branch-L）——该文件在跨机合并中取的是本机版本（他机版本为旧 UI 结构，见 `_transfer-backup/` 合并记录）；
- `src/sidepanel/prefs.ts` 的 `autoFillSafe`（默认 true）与 App.tsx hero 区开关「识别后自动填写安全项」同属本机分支；
- 他机 09-24 交接态自述的产品红线是「所有填写必须先 Preview 人工逐字段确认」（HANDOVER §1），且共享的 compat e2e specs 全部按 confirm-first 流程编写——自动填写与他机语义不符。

### 2.4 哪次 commit / 文件版本引入？

本项目无 git 仓库（HANDOVER §7），无法定位 commit。文件版本定位：
- `src/sidepanel/App.tsx`（本机 2026-09-23 20:14 快照）`handleRecognize` 第 ⑤ 步 + `isSafeFillable`（:112）；
- `src/sidepanel/prefs.ts`（同快照）`autoFillSafe: true` 默认值；
- `src/sidepanel/components/FieldList.tsx:50` 分组文案「已自动填写 / 可直接填写（安全字段在识别时已自动写入页面）」为配套 UI。

### 2.5 是否还有其他入口可以绕过 Preview？

全量排查写入口（grep `writeFields` / `FILL_FIELDS` / `fillFields`）：

| 入口 | 位置 | 判定 |
|---|---|---|
| `handleRecognize` ⑤ 自动填写 | App.tsx:756-780 | **违规**（本 Batch 移除） |
| `handleFillConfirmed`（对话框「确认填写」） | App.tsx:791 | 合规：confirmTargets 来自 FillConfirmDialog 用户动作 |
| `FILL_FIELDS` 消息处理 | content/index.ts:76 | 唯一 content 写入口；**无 plan gate**（防御深度缺失，本 Batch 加第二道防线） |
| background/index.ts | — | 无任何写路径（仅 ENSURE_CONTENT_SCRIPT / 转发）✓ |
| undoFill | filler.ts | 只恢复，不写入 ✓ |

结论：绕过 Preview 的入口**只有一处**（⑤ 自动填写），其余写路径均以用户确认为前提。

## 3. 修复方向（本 Batch 实施项，记录备查）

1. 删除 `handleRecognize` ⑤（Scan 阶段禁止写 DOM）；`prefs.autoFillSafe` 整体移除（两种模式统一 Preview before Write）。
2. 扫描后 UX：摘要「已识别 N 个字段（X 可直接填写 / Y 需要确认 / Z 需人工处理）」+ 主 CTA「查看填写预览」；FieldList 在点击 CTA 后展开。
3. `ConfirmedFillPlan` 增加 `confirmed: true` 字段；`writeConfirmedPlan` 成为唯一正式写入口；content 侧 `fillFields` 增加运行时 gate（plan 未确认 / 空 → 拒绝执行）。
4. Undo 保留，定位降级为 Recovery。
5. Safety 回归测试：`scan-does-not-write.spec.ts`（长期红线）+ 8 个 Safety E2E + 单元契约测试 10 项。
