# Issue #007 — 国内主流平台的「带限定词字段」被裸别名抢走（学历类型 / 紧急联系人关系 / 职位描述 / 教育时间栏）

Issue ID: ISSUE-007
Platform Family: 国内自建招聘官网（字节跳动 jobs.bytedance.com 校招）
页面类型: 申请表单（游客不可达，字段文案取自站点自己的前端产物）
问题字段: `education.degree` / `basic.emergencyContactName` / `internship.position` / `internship.startDate`
Severity: **P1**（错填形态：把一份资料顶到语义不同的另一栏）
Stage: MATCH（包含式别名 + section 槽位转移）
Status: **fixture_verified**（真机表单需登录，无法在未登录态写入验证；文案与判定均由站点产物 + 离线回放固定）

## 素材怎么来的（不编造标签）

```bash
curl -s https://jobs.bytedance.com/campus/position/7667881533285566725/detail > page.html
grep -oE '"[^"]{0,28}(姓名|手机|邮箱|学历|专业|工作地|紧急联系|实习|项目经历|教育经历)[^"]{0,28}"' page.html | sort -u
```

页面的 SPA bundle 里内联了表单全部文案，于是拿到了真实标签：
`姓名 / 手机号码 / 邮箱 / 学历 / 学历类型 / 专业 / 学校 / 期望工作地点 / 工作地点 / 户口所在地 / 婚姻状况 /
教育经历 / 实习经历 / 项目经历 / 开始时间 / 结束时间 / 公司名称 / 职位 / 职位描述 /
紧急联系人姓名 / 紧急联系人电话 / 紧急联系人与自己的关系 / 个人证件 / 内推码`。

把它们逐条喂给正式 `matchField` → **三个错填 + 一个少填方向的问题**：

| 真实标签 | 修复前判定 | 为什么错 | 修复后 |
|---|---|---|---|
| `学历类型` | `education.degree`（写「本科」） | 别名「学历」以包含式命中；资料库里没有「全日制/非全日制」这一栏 | `unknown`（留人工） |
| `紧急联系人与自己的关系` | `basic.emergencyContactName`（写应聘者/联系人姓名） | 别名「紧急联系人」包含式命中 | `unknown` |
| `职位描述`（实习经历板块） | `internship.position`（写「AI 实习生」） | 裸别名「职位」命中，而 responsibilities 词表里没有这个写法 | `internship.responsibilities` |
| `开始时间` / `结束时间`（教育经历板块） | `internship.startDate`（把实习时段填进求学时段） | 槽位转移只对 campus/project/internship 启用，教育板块的时间栏没人管 | `education.startDate` / `education.endDate` |
| `姓名`（上一行标题是「紧急联系人信息」） | `basic.name`（把自己的名字填进他人栏） | 他人守卫不读 `prevSiblingText` | 守卫覆盖该信号 → `unknown` |

## 修复（通用规则，不写站点分支）

| 文件 | 改动 |
|---|---|
| `src/matching/matcher.ts` | ① `QUALIFIED_SUFFIX_PATTERN = /(类型\|类别\|种类\|关系)$/`：标签以限定词结尾、而胜出候选**不是完整别名精确命中**时判 `unknown`（写法完整的「学位类型」仍正常落 `education.degreeType`）；② `DATE_SLOTS` 两组时间槽，`sectionGroupOf` 判为 education 时**仅在标题不含实习/项目/校园字样**时启用（混合标题「教育及实习经历」维持原行为，不替用户猜是哪一段）；③ 他人守卫的 `whoText` 并入 `prevSiblingText` |
| `src/rules/fieldAliases.ts` | `internship.responsibilities` 补 `职位描述 / 职务描述`（1.0 精确分压过 0.85 包含式） |

方向性说明：这些改动只会把「错填」变成「留人工」，不会把「能填」变成「不填」——`类型/关系` 结尾的标签本来就没有对应资料槽位。

## 验证

- 新增 `tests/realLabels.bytedance.test.ts`（6 用例，标签全部来自上面的真实文案），新增 `tests/matcher.test.ts` 教育/混合标题 2 用例；
- 全量单测 **37 文件 / 639 用例** 全绿；`tests/realLabels.yaoji.test.ts`、`labelCoverage`、`aliasCoverage`、`aliasWordBoundary` 无回归；
- **真机回归**：姚记（自建 ATS）同页复跑 `识别卡片 15 / 汇总 15 0 0 / 控件 filled=13 unexplained=0 empty=1`，与 2026-09-29 基线逐位一致（见 `pilot-log.md` 2026-09-30 行）。

## 仍未覆盖（诚实记录）

字节跳动 / 小红书的申请表单在手机号 + 验证码登录之后，本 issue 的判定改进**没有在真机上写入验证过**；
真机 Real Write 证据仍是姚记 + Lever + Greenhouse 三个平台。登录后表单如出现新的错填形态，按同样方式补规则与用例。
