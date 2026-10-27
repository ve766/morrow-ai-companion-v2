# Phase 2.2.3 — 记忆证据的删除与撤回闭环

- 实现：`FeedbackCandidateService.withdrawForConversation` / `withdrawEvidenceForMessage`
- 接线：`CompanionService.deleteConversation`
- 迁移：v18（证据 `status` / `withdrawn_at`）
- 测试：`feedback-candidate-service.test.ts`（24 例，含数据库直查）

## 1. 调用链

```text
CompanionService.deleteConversation
→ feedback.withdrawForConversation(conversationId, 'conversation_deleted')
   → UPDATE persona_feedback_evidence SET status='withdrawn', withdrawn_at=?
   → 重算 distinctConversations（只统计 active）
   → 0 → 候选 withdrawn，摘要替换为 [withdrawn]
→ chat.deleteConversation
```

撤回在删除之前执行：删除失败时，候选已经不可用，而不是指向一个被删掉的会话。

## 2. 数据库级验证

测试直接查询 SQLite，不依赖 API 返回值：

| 查询 | 期望 | 结果 |
|---|---|---|
| `evidence.status` | `withdrawn` | 通过 |
| `evidence.withdrawn_at` | 非空 | 通过 |
| `candidate.status` | `withdrawn` | 通过 |
| `candidate.evidence_excerpt` | `[withdrawn]` | 通过 |
| 重复撤回 | 返回 0，不二次变更 | 通过 |

支持重算：`supported → pending → withdrawn`；跨会话门槛只统计 `status='active'`。

## 3. 数据保留策略

| 数据 | 处理 | 理由 |
|---|---|---|
| 用户原文摘要 | 撤回时替换为 `[withdrawn]` | 不再保留个人内容 |
| 会话 / 消息 UUID | 保留 | 审计引用，不含内容 |
| 证据哈希 | 保留 | 去重与审计，不可逆 |
| 状态与时间 | 保留 | 证明删除发生过 |
| 已应用人格版本 | 保留 | 不得静默篡改历史 |

## 4. 消息级删除：BLOCKED

仓库中**不存在消息级删除功能**（无 `deleteMessage` / `DELETE FROM messages`）。因此：

- `withdrawEvidenceForMessage` 已实现并有单测；
- 但**没有生产调用者**，无法验证「消息删除确实触发证据撤回」。

这一项不能标记为通过。需要先有消息删除功能，才能接线。

## 5. 迁移与恢复

- v18 只加列/加表/换索引；升级测试保留 v16/v17 数据。
- 证据表新增列的默认值保证旧行为。
- **备份/恢复未针对本表单独测试**；数据库整体备份会包含新列，但未验证恢复后证据状态。

## 6. 并发与部分失败

- 撤回在事务内更新证据与候选原因；失败回滚。
- 重复撤回只匹配 `status='active'`，第二次返回 0。
- 并发删除同一会话：第二次找不到 active 证据，幂等。
- 未模拟「进程在事务中途崩溃」；SQLite 事务回滚覆盖单次失败，但未做 kill 进程测试。

## 7. 结论

- 会话删除路径：**PASS**（含数据库直查）。
- 消息删除路径：**BLOCKED**（功能不存在）。
- 摘要内容清理：**PASS**。
- 备份/恢复：**NEEDS_REVIEW**（未测）。
