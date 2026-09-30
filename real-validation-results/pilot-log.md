# Real-world Validation Pilot Log

> 测试流程（每个网站）：打开 JD 页 → Capture Job → 核对 company/position/location/jobType → 进入申请页 → 扫描 → 人工比对真实字段数 vs DetectedFields → 检查 Matcher/Entry Binding/Preview → 检查高风险字段阻止 → 确认填写 → 逐字段比对 requestedValue vs actual → 人工抽查 Semantic Correctness → 记录 Compatibility Result。
> 停止条件：False Fill ≥1、非预期提交、未知组件被点击、值串位、高风险字段被自动处理 → 立即停止并生成 Debug Report。
> 禁止：自动提交、自动下一步、自动同意协议。

| Date | Platform | Company (anonymized) | Field count | Result | Issues |
|---|---|---|---|---|---|
| （待真实测试回填） | | | | | |
| 2026-09-24 | yaoji（自建ATS） | 姚记 | 13/13（Recall 1.0） | Capture✓ Scan✓ 11 Safe ✓ | 0 |
| 2026-09-25 | yaoji（自建ATS） | 姚记 | 13/13（Recall 1.0） | **Real Write Verified**：11 写入 11 验证（Write 100% / Semantic 100%），radio MANUAL ONLY 未触碰，开放题未写，Undo 恢复，**未提交** | 0（2×P2 格式观察） |
| 2026-09-27 | yaoji（自建ATS） | 姚记 | 13/13（Recall 1.0，16 控件重新清点） | **Real Write Verified（re-confirmed，合成 Profile §五 重跑）**：T1 11/11 → T2 11/11 无 revert，False Fill 0，Scan 逐控件 diff=0，radio 0/2，开放题未写，Undo 还原，**未提交** | **1**：issue-003（P1 毕业年份 number stepMismatch，站点判定值无效）+ 3×P2 观察 |
| 2026-09-27 | yaoji（自建ATS） | 姚记 | 13/13（同一页面复验） | **Batch #3 修复后复验**：毕业年份被约束门禁降 manual、**未写入**；10/10 T1=T2 无 revert，`rejectedBySiteValidation=[]`，False Fill 0，Scan diff=0，radio 0/2，Undo 还原，**未提交** | 0（issue-003 已 verified） |

| 2026-09-27 | moka | 广州诗悦 | 详情页 3 控件 / 登录面板 7 控件 | **Real Write 未执行**：申请表单在手机号 + 短信验证码登录之后（游客不可达，与 09-24 记录一致）。Capture 无回归（company=header/medium，position=job_detail/high，Moka 品牌未污染 company）。发现 **issue-004（P1）**：登录手机号→`basic.phone`、导航搜索框→`internship.position`，均 SAFE 且会进 ConfirmedFillPlan | **1**（issue-004，同日 Batch #4 已修并真机验证） |

| 2026-09-27 | moka | 广州诗悦 | 登录面板 7 控件 | **Batch #4 语境门禁真机验证**：申请候选 **0**、语境排除 2（登录手机号 authentication + 导航搜索框 search）、计划 0、Scan DOM diff 0、未登录未输入未提交 | 0（issue-004 → real_site_verified） |

| 2026-09-30 | 字节跳动校招（jobs.bytedance.com，自建官网） | 字节跳动 | 职位详情页（无表单，游客可达部分仅 JD 正文） | **岗位识别真机验证**：`Android开发工程师 - 移动OS - 字节跳动` → 首跑识别为「移动OS · …」（公司取到团队段），修复后复跑 `字节跳动 · Android开发工程师 - 移动OS`，地点 北京；`recognized_jd_page` 通过，未点登录、未投递 | **1**（issue-006 P1，同日修复 + 真机复跑 verified） |
| 2026-09-30 | 小红书校招（job.xiaohongshu.com） | 小红书 | 在招职位列表页 171 条 | **反编造真机验证**：`[class*="company"]` 命中的是筛选条（全部/算法/研发/北京市…），首跑会产出 `company=全部`；修复后真机回放单测产出 `company=小红书`；详情页路由需前端交互，未取到职位名（已如实记录，不当作通过） | 1（同一 issue-006 的第二形态，已修） |
| 2026-09-30 | 携程招聘官网（careers.ctrip.com） | 携程集团 | 首页/栏目页 | **无回归真机验证**：`携程集团招聘官网` → `company=携程集团`（剥掉「招聘官网」后缀），且无职位信号时 position 保持「未识别岗位」不编造 | 0 |
| 2026-09-30 | 字节跳动校招（已下线职位） | — | `…/position/7238484559548696888/detail` 显示「该职位已下线」 | **负样本验证**：正文已被替换为下线提示，扩展产出「未识别到岗位」而不是从 `<title>` 里拼一个岗位出来 | 0 |
| 2026-09-30 | 前程无忧（jobs.51job.com） | — | 未采集 | **反爬拦截 + 负样本通过**：真机打开公开校招页拿到的是阿里云 WAF「滑动验证页面」（`<title>=滑动验证页面`，无职位内容），扩展输出「未识别到岗位」，**没有从验证页里编出一个公司/岗位** | 0（站点不可达，非扩展缺陷） |
| 2026-09-30 | Workday（hkex.wd3.myworkdayjobs.com，简体界面） | 租户名 hkex（未从页面证实） | 未采集 | **未验证（两次尝试）**：① 公开文章里的详情页深链被站点重定向到「搜索职务」列表（`<title>=搜索职务`，1 个控件）；② 为此给 pilot 加了 `--click "暑期实习"` 想从列表点进详情，列表页找不到该文案（`click_not_found`——Workday 的职位要 XHR 搜索后才渲染，静态列表里没有）。两次扩展都输出「未识别到岗位」+ 0 卡片，**没有编造公司/岗位** | 0（未执行成功，不能算验证过；Workday 的字段识别与写入仍未覆盖） |
| 2026-09-30 | 智联招聘（sou.zhaopin.com） | — | 未采集 | **反爬拦截**：搜索页在自动化浏览器里返回「Security Verification」页（0 控件、无可读职位），`--click "工程师"` 找不到文案；扩展输出「未识别到岗位」+ 0 卡片，**没有从验证页编造岗位** | 0（站点不可达；真人浏览器带登录态能否通过未验证，不下结论） |
| 2026-09-30 | BOSS 直聘（zhipin.com） | — | 未采集 | **反爬拦截**：搜索页渲染为空（`<title>` 都没有，0 控件）；扩展同样输出「未识别到岗位」而不是编造 | 0（站点不可达，不能算验证过） |
| 2026-09-30 | 北森（nio.hotjob.cn） | 蔚来 | — | **未执行**：`net::ERR_CONNECTION_CLOSED`（本网络不可达），未采集、未验证 | 环境限制，非扩展缺陷 |
| 2026-09-30 | 携程招聘官网（careers.ctrip.com） | 携程集团 | bundle 内 4 条他人栏文案 | **字段文案挖掘**（不登录）：从站点自己的前端产物里 grep 到 `候选人姓名`、`候选人手机号（请勿填写你的个人信息）`、`候选人邮箱（请勿填写你的个人信息）`、`我的内推码` 等真实文案 → 他人守卫补「明示型」短语并钉成用例；`携程集团招聘官网` → `company=携程集团` 真机复跑无回归 | **1**（issue-008 P1 红线形态，离线修复 + 反向用例防过度拦截；表单需登录，未做写入） |
| 2026-09-30 | yaoji（自建ATS） | 姚记 | 卡片 15 / 控件 14 | **issue-006 + 国内标签守卫改动后的真机回归**：`姚记科技 · 游戏测试工程师-27届秋招`（公司名未被 title 倒序改坏），识别卡片 15、汇总 `15 / 0 / 0`，控件 `filled=13 unexplained=0 empty=1`（empty 是同一单选组的另一个选项「否」），写入样例含 姓名/年龄/城市/手机号码/电子邮箱/毕业院校/毕业年份/专业/公司/入离职时间，**未提交**；撤销仍受站点侧回填对抗（`恢复 0 / 未交还 15`，§5.1） | 0（与 09-29 基线逐位一致） |
| 2026-09-30 | Lever（jobs.lever.co） | Spotify | 卡片 19 / 控件 33 | **issue-009 修复后复跑**：岗位条 `Spotify · Android Engineer - Experience`（修复前：公司栏印着整串标题 `Spotify - Android Engineer - Experience`、职位栏「未识别岗位」，且点进 `/apply` 后连这条也会被覆盖），识别卡片 19、汇总 `8 / 0 / 7 / 3`，控件 `filled=8 unexplained=2 empty=23`；写入 Full name/Email/Phone/Current company/LinkedIn/**GitHub**/Portfolio/Other website；`Spotify has my consent to contact` 授权勾选仍是 manual、三个 location 下拉**没有退化成选第一项**（如实报 failed），civic-status 选项组保持 unknown，**未提交** | 0（issue-009 → real_site_verified；比 09-29 基线多 1 项写入＝当天新增的 `basic.github` 别名生效） |
| 2026-09-30 | Greenhouse（job-boards） | General Matter | 卡片 20 / 控件 22 | **issue-009 修复后复跑**：岗位条 `General Matter · Software Engineer, Data Platform`（修复前公司栏=职位名、职位栏「未识别岗位」：`og:title` 被当公司名 + 英文标题里的半角逗号被当句子标点），识别卡片 20、汇总 `9 / 0 / 11`，控件 `filled=6 unexplained=0 empty=16`，与 09-29 基线一致；First/Last name 拆开、LinkedIn/Gender 正常，EEO / 自证题（民族·残障·兵役）与 `Country` 组合控件、开放问答全部未被代填，**未提交** | 0（issue-009 → real_site_verified） |

## Pilot Matrix

| Platform | Capture | Dry Run | Real Write | 备注 |
|---|---|---|---|---|
| yaoji（自建 ATS） | ✓ | ✓ | **✓ re-confirmed 2026-09-30** | 15 张卡片全部按资料库写入（`15 / 0 / 0`），含此前留人工的「是否接受线下面试」单选题；红线全过（未点提交、未勾同意）；撤销仍受站点侧回填对抗限制（§5.1）；issue-006/007 改动后同日逐位复验无回归 |
| Greenhouse（job-boards，英文 ATS） | **✓ 2026-09-30**（`General Matter · Software Engineer, Data Platform`） | ✓ | **✓ re-confirmed 2026-09-30** | 第二平台 Real Write：9 卡片 filled、False Fill=0；真机暴露并修掉 3 个**错填**根因（裸包含式别名 `city⊂ethnicity`、`tel⊂tell/latino`，组合控件继承分组 legend，EEO 自证题）+ issue-009（`og:title` 当公司名 → 公司与职位两栏同时错）→ `sessions/2026-09-29-delivery-pilot-greenhouse.md` |
| Lever（jobs.lever.co） | **✓ 2026-09-30**（`Spotify · Android Engineer - Experience`） | ✓ | **✓ re-confirmed 2026-09-30** | 第三平台：8 卡片按资料库写入（Full name/Email/Phone/Current company/LinkedIn/GitHub/Portfolio/Other website），False Fill=0；`consent to contact` 授权勾选保持 manual、国家下拉判 failed 不退化成选第一项；issue-009 一并修掉「`/apply` 子页把好岗位覆盖成未识别岗位」→ `sessions/2026-09-29-delivery-pilot-lever.md` |
| 前程无忧（jobs.51job.com） | ✗（站点反爬） | ✗ | ✗ | 真机拿到的是阿里云 WAF「滑动验证页面」→ 扩展不编造岗位（负样本通过），但不能算覆盖 |
| Workday（myworkdayjobs.com） | ✗（进不去详情页） | ✗ | ✗ | 公开深链被重定向到「搜索职务」列表；`--click` 从列表点进去也没找到文案（职位要 XHR 搜索后才渲染）→ 这一平台的字段识别与写入**未覆盖** |
| moka | ✓ | ✗ |  **pending login** | Capture Verified ／ **Unauthenticated Context Safety Verified**（Batch #4）／ Real Write Pending Login —— 真实申请表单需手机号 + 短信验证码登录，游客不可达 |
| 字节跳动校招（自建官网） | **✓ 2026-09-30** | ✗ | ✗ pending login | 岗位识别真机通过（`字节跳动 · Android开发工程师 - 移动OS`，地点北京）；申请表单在登录后，游客不可达 → 未做字段识别 |
| 小红书校招 | **✓ 2026-09-30**（列表页公司/筛选条语境） | ✗ | ✗ pending login | 详情页需前端路由交互，真机未取到职位名 → 如实记为未验证；筛选条词已被反编造规则拦住 |
| 携程招聘官网 | **✓ 2026-09-30**（首页品牌段提取） | ✗ | ✗ 未采集 | 无职位信号 → 不编造岗位（负样本通过）；具体详情页未跑 |
| 北森 hotjob（蔚来） | ✗ | ✗ | ✗ | 本网络 `ERR_CONNECTION_CLOSED`，未采集 |
| BOSS 直聘（zhipin.com）/ 智联招聘（zhaopin.com） | ✗（反爬墙） | ✗ | ✗ | 2026-09-30 真机尝试：BOSS 搜索页渲染为空、智联返回「Security Verification」→ 两处扩展都是「未识别到岗位」不编造；真人登录态能否通过未验证 |
| 牛客网申 | ✗ | ✗ |  | 未开始（每一家公司的网申都在牛客自己的登录体系之后） |

