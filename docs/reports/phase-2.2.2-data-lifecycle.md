# Phase 2.2.2 — 删除、撤回与证据引用治理

## 1. 概念区分

| 概念 | 含义 |
|---|---|
| 候选撤回 | 该候选不再允许进入人格应用 |
| 证据撤回 | 某条证据不再计入支持门槛 |
| 会话删除 | 撤回该会话的全部证据，并重算支持 |
| 消息删除 | 撤回该消息的证据，并重算支持 |
| 审计保留 | 仅保留状态、时间与原因，不保留可复原的内容 |

## 2. 实现

- `persona_feedback_evidence` 增加 `status ('active'|'withdrawn')` 与 `withdrawn_at`。
- `withdrawForConversation(id, reason)`：事务内把该会话的 active 证据置为 withdrawn，写原因；然后按候选重算。
- `withdrawEvidenceForMessage(messageId, reason)`：同上，按消息。
- 支持重算：`distinctConversations` 只统计 `status='active'` 的证据；0 → 候选 `withdrawn`，1 → `pending`，≥2 → `supported`。
- 会话删除路径已接线：`CompanionService.deleteConversation` 先撤回，再删除。

## 3. 关键性质

| 性质 | 结果 |
|---|---|
| 删除后不再计入跨会话门槛 | 是（`COUNT(DISTINCT conversation_id) WHERE status='active'`） |
| 删除一条证据后重算 | 是（`supported → pending`） |
| 全部证据删除后候选撤回 | 是 |
| 删除幂等 | 是（只更新 active 行；重复调用返回 0） |
| 已应用人格不被静默篡改 | 是（`applied` 候选不参与重算） |
| 已删除内容不再通过摘要暴露 | 是：撤回时把 `evidence_excerpt` 置为 `[withdrawn]`，不再保留用户原文 |

## 4. 未完成（重要）

1. 没有消息级删除服务；`withdrawEvidenceForMessage` 已实现并有测试，但生产路径暂无调用者。
2. 没有备份恢复后的证据状态测试。
3. 已应用候选对应的证据被删除时，没有重新评估或回滚策略；只保留审计与 `needs_review` 的应用记录。
4. 证据行仍保留会话/消息 UUID（引用而非内容），用于审计；未做去标识化。

## 5. 结论

支持门槛与候选状态会随删除重算，但**内容级清理未完成**。这一点必须在最终报告和合并建议中列为阻塞项。
