# 反思与自主探索机制

## 1. 反思运行时

- `src/self-model/reflection-service.ts`
- 触发：manual / startup / post_conversation；有速率限制和预算。
- 产物：`reflection_runs` + `reflection_findings`（去重键、证据 JSON、confidence）。
- `ReflectionFindingRouter.promptBlock(turnId)` 最多注入 2 条未过期 finding，并记录注入；这是唯一 prompt 消费点。
- 失败：run 标 failed / 路由失败记录，不阻断聊天。

## 2. 自我修正

本轮新增的 self-model state 允许 `revise` / `conflict_pending` / `weaken`，并保留旧 revision；但反思 findings **不会自动**写回 self-model。当前边界：

- `NOT_IMPLEMENTED`：finding → self-model state 自动写回；
- `PARTIAL`：既有 reflection hint 仍进入下一轮上下文；
- 证据不足时保留 unknown/low confidence，不编造。

## 3. 自主探索候选

- `src/self-model/exploration-policy.ts`：interest/自身问题 → 候选；`selected_for_prompt → permitted → settled`；
- 候选只进入 pending/选择状态，不自动成为用户目标、不执行工具；
- 用户目标与 Morrow 兴趣在 `interests.origin`（user/morrow/shared）中保持分离。

## 4. 未完成

- 统一候选公式 `Priority = Interest × InformationGain × Relevance × Feasibility × UncertaintyNeed − RiskPenalty` 未实现；
- 认知缺口 → 候选的新数据源未扩展；
- 反思 findings → self-model revision 的自动闭环未实现。

以上标记 `NOT_IMPLEMENTED` / `PARTIAL`；不把现有 interest 探索冒充成新的统一候选模型。
