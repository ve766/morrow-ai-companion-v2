# Stage 5 关系连续性运行时

## 1. 数据模型（v43）

```
relationship_threads                relationship_thread_evidence
---------------------------         ---------------------------------
id (uuid pk)                        thread_id  ─┐ (pk 之一)
kind (address_preference |          source_message_id (pk 之一)
      shared_topic |                conversation_id
      shared_plan |                 polarity (support|counter)
      rhythm_preference)            weight (0,1]
value (1..200)                      created_at
status (candidate|active|          FK thread_id → threads ON DELETE CASCADE
        superseded|retracted|expired)
strength (0..1)
confidence (1..100, 仅展示用)
source_message_id / conversation_id
supersedes_thread_id
first_seen_at / last_seen_at / expires_at
created_at / updated_at
UNIQUE(kind, value, source_message_id)
```

- 只存最小结构化值 + 来源引用；**不复制**用户原文，不建用户画像字段。
- 明确禁止：推断亲密度、依赖、排他关系、现实身份、心理诊断。
- 证据按 message 去重：同一条消息重复出现不增加权重；消息删除时其证据行随之失效（FK 级联/删除路径）。

## 2. 调用链

```
用户消息（prepare 内，provider 调用前）
  → RelationshipThreadService.observe({text, messageId, conversationId, at})
       extractRelationshipCandidates（仅显式陈述）
       → upsert thread → insert evidence（ON CONFLICT DO NOTHING）→ recompute
  → activeThreads(4)（active & 未过期 & 未撤回，按强度/最近排序）
  → prompt 连续性块「Continuity with this user …」
  → TurnEvaluation.relationshipThreads = [{id, kind}]（只记 id/kind，不记原文）
```

- 写入与读取都在**同一轮**：下一轮即可消费，跨会话持续。
- 关系线程与事实记忆分离：事实在 `fact_records`（可寻址证据），线程在 `relationship_threads`（连续性上下文）。两者都以 `source_message_id` 为证据锚点。

## 3. 权限、撤回与 TTL

| 事件 | 行为 |
|---|---|
| 显式陈述 | 形成候选/晋升（按 MIN_GROUPS） |
| 重复陈述（新消息） | 增加独立证据，强度上升 |
| 同一消息重放 | `ON CONFLICT DO NOTHING`，不增加 |
| 用户撤回（“那个约定就算了/别提那个了”） | 所有 active/candidate → retracted，立即停止注入，分数不复活 |
| 同类替换（“以后叫我X”再次出现） | 旧值 → superseded，新值建立 |
| 180 天无证据 | → expired，不再注入 |
| 删除消息 | 证据行删除（级联）；线程强度在下次 recompute 时按剩余证据重算 |

## 4. 持久化与恢复

- 全部在 SQLite（`morrow.sqlite3`），随应用重启保留；
- `activeThreads()` 每次读取都会 `recompute`，所以恢复不需要额外补偿任务；
- 迁移只增不改（v43 追加），旧库升级测试随迁移谱系覆盖。

## 5. 表达策略接线

```
feelingState（既有，持久化）
  → deriveExpressionPolicy({state, analysis, wantsDirectAnswer})
  → prompt 策略块（4 个字段 + 不暴露内部数值的指令）
  → TurnEvaluation.expressionPolicy = {adviceMode, clarifyMode, questionBudget, brevity, rationale}
```

策略与事实证据在同一 payload 中并列；S9 断言同一事实在“直接请求”策略下证据不变。

## 6. 失败行为

- observe/read 失败 → `relationship_threads` 降级事件，本轮无连续性块；
- 策略派生失败 → 无策略块（默认行为），聊天继续；
- 所有降级事件只含组件名/阶段/原因码与 correlation id，不含消息、prompt、payload 或秘密。
