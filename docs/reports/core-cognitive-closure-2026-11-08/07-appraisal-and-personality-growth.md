# 07 · Appraisal 与人格增长

## 现状审计

- `src/affective-state/feeling.ts`、`cognitive-feeling-engine.ts`、`cognitive-feeling-service.ts`、`expression-policy.ts`：固定六类事件 + 固定 delta + 未校准规则强度（`unvalidated_rule_strength`）。
- `personality`：用户 baseline + 有界 growth + interaction profile；growth 主要来自用户表达要求/反馈。
- 这些是计算性 affective state 与表达调节，不是主观感受。

## 本轮改动

- 未改写 feeling engine/personality 公式（避免未验证大改）。
- 新增 `InnerCognitionService`：不确定/纠错 → thought；priority 使用 uncertainty/recurrence/relevance，影响后续 context 与 review 优先级。这是 appraisal 影响后续认知决策的最小真实路径。
- 没有预设“温柔/活泼/幽默”等性格标签；identity contract 不规定语气。

## 缺口（未能称 PASS）

1. appraisal 仍主要由固定规则事件产生，没有目标/信念/关系/可控性/新颖性/结果差异的联合评价。
2. 人格长期变化仍以用户沟通适配为主；没有“Morrow 通过自身经历形成长期倾向”的 evidence-gated 路径。
3. 用户沟通适配与 Morrow 自身偏好未在同一数据模型中严格分栏（新 self-state 仅 actor=morrow，来自自身不确定，不来自用户偏好；但用户适配仍在旧 personalization）。
4. 没有情绪状态对注意力/记忆巩固/表达倾向的独立行为对照。

## 结论

`PARTIAL`：内部 thought priority 已受不确定性影响；完整 appraisal/personality 由内向外形成仍未完成。
