# Issue 报告模板（Real Regression Intake）

> 每个 P0/P1/P2 问题修复前，必须先按此格式整理，再做 Minimal Fixture → Failing Test → Root Cause → Generic Fix → Regression → Real Re-test。
> 禁止保存：input value、手机号、身份证、邮箱、完整简历文本。

```text
Platform Family:
页面类型:
问题字段:
系统识别:
实际应该识别:
预期行为:
实际行为:
是否稳定复现:
Severity:
Trace ID:
```

## 示例（P0 False Fill）

```text
Platform Family: Moka
页面类型: 多段项目经历
问题字段:
第二段「项目名称」
系统识别:
projects[0].name
实际应该识别:
projects[1].name
预期行为:
绑定 Master Profile 第二个项目
实际行为:
重复填入第一个项目
是否稳定复现:
是
Severity:
P0 False Fill
```

## Severity 分级速查

| 级别 | 含义 | 处置 |
|---|---|---|
| P0 | False Fill（内容写入错误字段） | 立即停止该网站自动填写 |
| P1 | Unsafe Write（高风险字段被填/未知组件被操作） | 立即停止 + 强制 Manual |
| P2 | Missing / Failed Write（漏识别/写不进/回滚） | 记录 + 排队修复 |
| P3 | UX / Explainability（提示不明确） | 记录 |
| P4 | Cosmetic | 记录 |

## 高风险检查清单（每页面必查）

- [ ] 学校 / 专业是否串位
- [ ] 实习 / 项目 Multi-entry 是否串位（Entry 1 → Entry 2）
- [ ] 日期字段（毕业/入职/离职/到岗）是否正确
- [ ] 开放问题识别是否正确（intent 是否对）
- [ ] 薪资 / 证件 / 协议是否保持 Manual
- [ ] 高风险自定义 Select 是否被乱点
- [ ] Semantic Correctness 抽查：随机 ≥3 个 Direct Fields 逐字段比对
