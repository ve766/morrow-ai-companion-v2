# Stage 4-A 回复前记忆操作运行时

## 1. 时序（实现后）

```
用户消息（含真实 message id）
  → ChatService.prepare()
      ① 认知分析（intent / signals / reading）
      ② Memory Operation Planner（确定性）
          输入：本轮文本、message id、同会话最近 3 条用户消息、active facts、ledger 可用性
          输出：none | create | correct | clarify | rejected | failed
      ③ MemoryService.executeOperation(plan)
          create  : 每条事实 create(模板文本, provenance={messageId,'message'})
          correct : correct(目标 memory, 模板文本, messageId, provenance) —— 单事务
          之后：复读 fact ledger 验证新 active / 旧 superseded / 来源正确
          任一验证失败 → status=failed（不声称保存）
      ④ assembleContext()（此时新事实已在库中，证据块包含它）
      ⑤ 提示词装配：
          - 「Memory operation for this turn」块（仅 committed_and_verified / clarify / rejected / failed 的准确状态）
          - 历史行（过去时问句才有）：superseded 值，标注 history only
          - 证据块 / 固定原则
      ⑥ 同意预览 → 同意 → 第二次 prepare()
          复用同一 turn 的操作结果（Map<conversationId:messageId, outcome>），载荷与哈希保持一致
  → provider.generate
  → 回复持久化 → outbox（兴趣/偏好/成长/自我事实/目标/记忆重复计数/反思）
```

## 2. 幂等

| 层 | 键 | 行为 |
|---|---|---|
| 轮内 | `conversationId:messageId` 缓存 | 第二次 prepare 复用结果，不重复写入 |
| 重放 | planner 看到“该值已 active 且来源=本轮 message” | `committed_and_verified` + `replayed=true` |
| 数据库 | `UNIQUE(source_memory_id, source_revision, predicate, value_normalized, polarity)` | 同 revision 不重复行 |
| 纠正 | 目标旧值已 superseded、新值来自本轮 | 重放不二次 correction |

## 3. 失败与可观察性

- 规划/执行分别标记阶段：`planning` / `commit` / `verification`；
- 失败写 `memory.operation.failed` 事件（仅 messageId + stage + errorCode）；
- 提示词中的操作块对 clarify/rejected/failed 明确“未写入”，模型不得声称已保存；
- 认知分析本身失败仍走 fallback，并记录 `memory_operation_failed` 降级（不再与检索失败混为一谈）。

## 4. Provider 无关

人格基线（`personality_profiles`）、有效事实（`fact_records`）、修订链（`memory_revisions`）都在应用 SQLite；Provider 配置独立表，切换不触及这三者（验收 #7、#11）。
