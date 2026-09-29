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

## Pilot Matrix

| Platform | Capture | Dry Run | Real Write | 备注 |
|---|---|---|---|---|
| yaoji（自建 ATS） | ✓ | ✓ | **✓ re-confirmed 2026-09-27** | 红线全过；issue-003（number 控件收不下年份值）已由 Batch #3 修复并真页复验，`rejectedBySiteValidation` 归零 |
| moka | ✓ | ✗ |  **pending login** | Capture Verified ／ **Unauthenticated Context Safety Verified**（Batch #4）／ Real Write Pending Login —— 真实申请表单需手机号 + 短信验证码登录，游客不可达 |
| Boss 直聘 / 牛客 等 | ✗ |  | ✗ | 未开始 |

