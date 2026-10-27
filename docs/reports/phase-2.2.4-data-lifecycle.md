# Phase 2.2.4 — 数据生命周期（会话删除、消息删除、证据撤回）

基线 `bf4da91`，本轮修复提交 `b1c7195` / `0e5b251`。所有结论以直接查询数据库的集成测试为依据，不以 API 返回值为依据。

## 1. 修复前的事实

| 位置 | 事实 |
|---|---|
| `CompanionService.deleteConversation` | 证据撤回包在 `try { } catch { }` 里，注释写「Candidate bookkeeping must not block the user's delete」 |
| `SqliteDatabase.transaction` | `BEGIN IMMEDIATE`，**不可重入**；嵌套调用直接抛错 |
| 消息级删除 | 仓库中**不存在**。`withdrawEvidenceForMessage()` 有实现，但生产路径无调用者 |

这两点合起来就是风险本身：因为事务不可重入，删除会话无法和证据撤回放进同一个事务；于是代码选择吞掉撤回异常。结果是「会话已删除，但证据仍是 active」，且用户被告知删除成功。

## 2. 修复方式

### 2.1 让事务可重入（前提）

`src/persistence/database.ts`：增加 `transactionDepth`。顶层仍用 `BEGIN IMMEDIATE`，嵌套层用 `SAVEPOINT sp_<depth>_<ts>` / `RELEASE`，失败时 `ROLLBACK TO` + `RELEASE`。

这是 A 和 C 的共同前提：只有可重入，服务才能把「另一个服务自己的事务」组合进同一个提交，而不是靠吞异常绕过。

### 2.2 会话删除改为单事务

```ts
deleteConversation(request: { conversationId: string }): void {
  this.database.transaction(() => {
    this.feedback?.withdrawForConversation(request.conversationId, 'conversation_deleted')
    this.chat.deleteConversation(request.conversationId)
  })
}
```

撤回抛错 → 整个事务回滚 → 会话仍在，异常向上抛。用户不会再收到「已删除」的假信号。

### 2.3 消息级删除接到真实生产路径

新增链路（全部在同一个事务内）：

1. `FeedbackCandidateService.withdrawEvidenceForMessage(messageId)` — 只撤回引用该消息的证据；
2. `CompanionService.retractMemoriesFromMessage(messageId)` — 查询 `memory_suggestions.accepted_memory_id`，把由这条消息**采纳**生成的记忆置为 `retracted`；
3. `ConversationService.deleteMessage` → `SqliteConversationRepository.deleteMessage` — 删除 `messages` 行。

第 2 步是关键：一条被采纳的记忆是对原消息的**复述**。如果只删消息，用户仍能通过记忆读到被删内容——这正是任务书禁止的「通过派生记录重新暴露」。

`messages` 的复合外键带 `ON DELETE CASCADE`，所以 `cognitive_turn_observations`、`memory_suggestions`、`reminders` 等派生行随消息一起消失，不需要手工清理。

### 2.4 撤回语义

| 层 | 撤回后状态 |
|---|---|
| 证据 | `status='withdrawn'`、`withdrawn_at` 非空；不再计入独立会话门槛 |
| 候选 | 支持数重算：0 → `withdrawn`，1 → `pending`，≥2 → `supported` |
| 候选摘要 | 替换为 `[withdrawn]`，不保留原文 |
| 记忆 | 由被删消息采纳的记忆 → `retracted`，`assembleContext` 不再返回 |
| 审计 | 证据行保留 `conversation_id` / `message_id` UUID 与 `evidence_hash`，不保留原文 |

## 3. 数据库验证结果

测试文件：`src/self-model/feedback-candidate-service.test.ts`

| 场景 | 断言（直接查库） | 结果 |
|---|---|---|
| 撤回失败时会话不被删除 | `deleteConversation` 抛 `withdrawal failed`；`listConversations()` 仍含该会话 | 通过 |
| 删除消息只撤回该消息证据 | `persona_feedback_evidence` 中该消息行 `withdrawn`，另一会话行 `active` | 通过 |
| 支持数重算 | 候选从 `supported` 降为 `pending`，`distinctConversations` 2 → 1 | 通过 |
| 消息行确实删除 | `SELECT COUNT(*) FROM messages WHERE id=?` = 0 | 通过 |
| 派生记忆随之撤回 | `memories.status='retracted'`；`assembleContext('花生')` 前后从含「花生」变为不含 | 通过 |
| 重复删除 | 第二次返回 `NOT_FOUND`，不复活证据、不重复计数 | 通过 |

## 4. 仍存在的限制

1. **备份/恢复没有针对证据表单独验证**。`deletion_journal` 只记录 `conversation` / `memory` 两类实体，证据表没有对应的 tombstone。恢复到旧备份后，证据行可能重新出现为 `active`。这是**未验证**项，不是已修复项。
2. 消息删除后，同一候选的其他有效证据保留，但候选的 `decision_reason` 不会自动说明「支持数已变化」。审计上只能看到证据状态，看不到触发原因。
3. 已应用的人格版本不会因证据撤回而回滚。删除涉及已生效证据时只保留审计，没有重新评估流程。
4. 会话删除不删除记忆（记忆是用户明确批准的事实，不隶属会话）。这是有意的保留决策，写在报告里而不是默认行为。

## 5. 结论

| 项 | 状态 |
|---|---|
| 会话删除与证据撤回一致性 | **PASS** |
| 消息级删除接线 | **PASS** |
| 派生记忆撤回 | **PASS** |
| 支持数重算 | **PASS** |
| 重复删除幂等 | **PASS** |
| 备份/恢复后的证据状态 | **NEEDS_REVIEW** |
| 已生效人格的回滚策略 | **BLOCKED**（未设计，非本轮范围） |
