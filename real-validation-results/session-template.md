# 单页面 Validation Session 记录模板

> 每测试一个申请页面复制一份填写；完成后在 pilot-log.md 加一行。
> 插件内操作：扫描后 Dry Run → 确认填写 → 逐字段比对 → Dev 区块「记录验证 Session」。

```text
## Session #___
Date:
Platform Family:            # 插件 Pilot banner 显示（如 moka-ats / company-x）
Hostname:                   # 如 apply.company-a.com（页面类型相同的多公司可只记 family）
页面类型:                    # 单页表单 / 多步骤 / 多段经历 / Modal / SPA 路由内
JD Capture 核对:             # company/position/location/jobType 是否正确

## 字段数量对照（Detection Recall）
页面真实字段数（人工清点）:
Detected Fields:            # 插件显示
未识别字段（label 列表）:
误识别字段（label → 系统判成了什么）:

## Dry Run 语义映射检查（填写前）
- [ ] 学校/专业无串位
- [ ] Multi-entry：Entry 1/2 分别绑定正确项目
- [ ] 日期字段正确
- [ ] 开放问题 intent 正确
- [ ] 薪资/证件/协议保持 Manual
- [ ] 自定义 Select 未被自动点击

## Fill 后逐字段比对（Write Verification + Semantic Correctness）
Write Success:              # 成功数 / 尝试数
Reverted/Mismatch:          # 数量 + 字段 label
Semantic False Fill:        # 数量（必须如实；≥1 立即停止该站自动填写）
Manual Fallback:            # 数量 + 原因（未识别/高风险/无内容）

## Issues
- Issue #1：（按 issue-template.md 格式，或附文件名）
- Issue #2:

## 备注
scanDurationMs / writeDurationMs / 其他观察:
```
