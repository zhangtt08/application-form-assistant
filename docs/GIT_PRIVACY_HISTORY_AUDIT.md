# Git Privacy History Audit — 2026-09-26 / Phase 2 追加 2026-09-27

本轮名称：**Repository Privacy Scrub**（Phase 1 + Phase 2）
执行范围：**只审计，不重写**。未运行 `git filter-repo` / `filter-branch` / BFG / `rebase --root` / 任何 force push。

> 本文档**故意不写出**被清理的字面值。审计文档如果只是把脏值换个地方再抄一遍，
> 等于没清理。下面用类别 + 掩码指代；完整值只存在于 `d042026` 起的旧 tree 里，
> 需要核对时 `git show d042026:smoke/smoke.py` 本地查，不要复制进任何会被跟踪的文件。
>
> `npm run privacy-scan` 会扫本文档——这是有意的：文档里重新出现 banned 值同样算 ERROR。

## 1. 当前工作树状态

`npm run privacy:scan` → **0 ERROR / 0 WARN**。
另有若干处命中落在已登记的教科书占位号段上（13800001234 一类顺序号、尾号 1234 且校验位不合法的
身份证形状），已逐条人工复核并登记进扫描器的 `KNOWN_PLACEHOLDER`，只计数不逐行告警
（见 `docs/TEST_DATA_POLICY.md` 末节）。审计当时的计数为 26 处；本文档与政策文档本身也引用这些
号段，所以现在跑会更大——以命令输出为准。

工作树里已不存在这两类值：

```text
疑似真实账号 handle（含其邮箱形态与 GitHub 主页形态）  —— 0 处
疑似真实 QQ 号                                          —— 0 处
```

## 2. Git 历史仍包含旧值

`git log -S<value> --all` 统计的是「改变了该字符串出现次数的提交」；
blob 本身会留在引入点之后的**每一棵 tree** 里，直到被删除的那次提交为止。

| 值（掩码） | 引入提交 | 出现次数变化的提交数 | 仍可在哪些 tree 中检出 |
|---|---|---|---|
| `zhan****`（handle / 邮箱 / portfolio 三种形态同源） | `d042026` | 1 | `d042026`、`c719f34`、`9ac913d` |
| `99****56`（QQ 号） | `d042026` | 1 | 同上 |

涉及文件（历史上出现过，工作树已清理）：

```text
smoke/smoke.py
tests/resumeTextParser.test.ts
```

**注意 tag**：`pilot-v1-baseline` → `d042026`，即脏 blob 可从 tag 直接检出。

本轮的 scrub 提交（`f085ea2`）把这些值从**新 tree** 中移除，但**不会**从
`d042026` / `c719f34` / `9ac913d` 这三棵已有 tree 及其对象里消失。

## 3. 外泄面评估

| 渠道 | 状态 |
|---|---|
| 远端仓库 | 无 remote（`git remote -v` 为空），历史只在本地 |
| 离线 bundle | 本机 `Desktop` / `Documents`（maxdepth 3）**未找到任何 `.bundle`**。上一轮记录声称生成过 `afa-pilot-v1-baseline.bundle`，本机现已不存在 |
| 打包交接件 | 未见 `afa-handover.zip` |
| gitignored 产物 | `smoke/shots/` 旧截图曾渲染出那枚邮箱（未入库；本轮 smoke 重跑已用合成身份覆盖） |

本轮**没有**新生成 bundle：bundle 会把脏历史完整复制一份到仓库之外，在 scrub 完成前做这件事是反向操作。

## 4. Phase 2：教育·雇佣履历（已处理）

Phase 1 只清了合成身份字段（姓名/手机/邮箱/微信/QQ/Portfolio）。Phase 2 补上第二类残留：
一组可能是真实的**学校 / 学院 / 专业 / 公司 / 部门 / 岗位 / 任职时间 / 项目名**，
分布在 17 个文件、约 75 处（含 ~30 处断言）。现全部对齐 `docs/TEST_DATA_POLICY.md` 的合成履历表。

**Current tree: clean.** 这些值在工作树里已不存在（`git grep` 复核）。

**History: contains pre-scrub resume data.** 与 Phase 1 同一机制——引入点在 `d042026`，
所以教育·雇佣字符串仍可从 `d042026` / `c719f34` / `9ac913d` / `f085ea2` / `f5fd15b` 的 tree 检出，
tag `pilot-v1-baseline` 同样指向脏 tree。**本文档不抄写这些值**（抄一遍等于没清理）。

**History rewrite: NOT PERFORMED.** 需要单独批准，步骤见 §6。

**Before public release: required review / scrub.** 公开或分发前必须做历史重写，
并且要一并处理下面这条截图项。

### 截图

`real-validation-results/sessions/yaoji-real-write-2-filled.png` 画面里能直接读出被写入的
教育·雇佣字段。Phase 2 已 `git rm --cached` 移出跟踪，本地原件移到
`real-validation-results/private/`（已 gitignore）。

注意：**该 PNG 的 blob 仍在历史 tree 里**（`d042026` 之后的提交）。也就是说
即使文本值被重写，只要不重写历史，这张图依旧可被检出——这是「公开前必须 scrub 历史」
最硬的一条理由。

同目录的 `yaoji-real-write-1-preview.png` 只含公开职位页与侧边栏（无任何填写值），继续入库，
并已登记进扫描器的 `ALLOWED_TRACKED_IMAGES`。

### 未处理（判断后保留）

- `src/sidepanel/components/ImportPanel.tsx` 的产品示例文本用 `某某大学 / 计算机学院 / 计算机科学与技术`。
  `某某大学` 本就是占位，后两者是国家学科目录里的通用名称，不指向任何具体个人或院校；
  且属产品 UI 文案，不并入本 privacy batch。
- 公开招聘信息（姚记科技、广州诗悦、公开岗位名与 JD 正文、公开 ATS URL）**按 §六 保留**，
  它们是 Job Capture / position extraction 的回归原料。
- `evaluation/dataset.ts` 的数值型 fixture（`5000-6000`、`90%`、`5 个`）保留——
  它们被 `shouldMention` / `mustNotMention` 断言依赖，且明显是人工构造的评测数据；
  只把域指向的词（标注 / 达人）换成了合成说法。

## 5. 环境事件记录（与隐私无关，但影响可复现性）

本轮验证过程中 `%LOCALAPPDATA%\ms-playwright` 整个目录被会话外的因素清空
（本会话在 `AppData` 下没有做过任何删除），导致 E2E 与 smoke 一度无法启动浏览器。
已用 `npx playwright install chromium` 恢复（chromium-1243 + headless shell + ffmpeg + winldd），
随后 smoke 重跑通过。**下一轮 Real Write Pilot 前建议确认浏览器仍在。**

## 6. 如果这个仓库将来要公开

必须先做 history scrub，再公开。推荐步骤（**本轮未执行**）：

```bash
# 需要单独批准；执行前先把工作树完整备份
pip install git-filter-repo

# patterns.txt 不要提交进仓库（否则又是在复制脏值），放在仓库外：
#   <value-A>***REMOVED***
#   <value-B>***REMOVED***
git filter-repo --replace-text ../privacy-patterns.txt

# filter-repo 会重写所有 commit hash：tag、bundle、任何已有 clone 都要重建
```

配套动作：删除并重建 `pilot-v1-baseline` tag；丢弃旧 bundle；通知所有持有 clone 的人重新 clone
（历史重写后 `git pull` 不可合并）。

清理完成后，本文档 §2 那张表应当改写成「历史已重写于 <commit/日期>」。
