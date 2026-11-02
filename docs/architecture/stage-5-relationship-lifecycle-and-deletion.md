# Stage 5 关系线程生命周期、删除与事务边界

本文描述修复后的实现（`fix/stage-5-review-findings`，最终提交 `d986403`）。数据结构沿用
v43 的 `relationship_threads` / `relationship_thread_evidence`，新增 v44 删除触发器与
v45 outbox 模块；不引入第二套关系记忆。

## 1. 状态机

```
                 support (>= MIN_GROUPS 独立消息)
   (none) ──support──> candidate ────────────────> active
                          ^   │                      │
                          │   └── TTL 到期 ──> expired（不再注入）
                          │                          │
                          │        replace / 新值 replaces
                          │                          v
                          └───────────────────> superseded（终态，仅审计）
                                                      
   active/candidate ──用户撤回（目标唯一）──> retracted（终态，不再注入）
   active/candidate ──显式全局撤回──> retracted（逐条，附全局意图事件）
```

| 状态 | 是否注入 | 进入条件 | 退出 |
|---|---|---|---|
| `candidate` | 否 | 新证据但未达 active 门槛 | 证据累积→active；撤回→retracted；被替代→superseded |
| `active` | 是 | `strength ≥ 0.5` 且独立消息数 ≥ `MIN_GROUPS[kind]` | TTL→expired；撤回→retracted；替代→superseded |
| `expired` | 否 | 最后证据超过 180 天 | 新证据（若未被撤回/替代）可重新计算 |
| `superseded` | 否 | 同 kind 的新值写入且旧值为目标 | 终态（不自动复活） |
| `retracted` | 否 | 用户明确撤回 | 终态；只有**严格更新**的用户陈述可重新确认同值 |

`recompute()` 在 `retracted`/`superseded` 上直接返回：分数重算不是状态转移，不能让已撤回
的线程复活。

## 2. Mutation 模型

`planRelationshipMutation(text, rows)` 返回：

```ts
type RelationshipMutation =
  | { type: 'support'; kind; value; replaces? }
  | { type: 'replace'; kind; oldThreadId; newValue }
  | { type: 'retract'; threadId; reason }
  | { type: 'retract_kind'; kind }
  | { type: 'retract_all'; explicitGlobalIntent: true }
  | { type: 'clarify'; reason }
```

计划器是确定性的、保守的：

| 输入形态 | 结果 |
|---|---|
| “把这些约定和偏好都撤回吧” / “撤回所有约定” | `retract_all`（必须同时出现集合与动作） |
| “那个约定就算了”，恰好 1 个 `shared_topic/shared_plan` | `retract` 该线程 |
| 同上，0 个 | `clarify: no_agreement_to_retract` |
| 同上，≥2 个 | `clarify: ambiguous_agreement_target` |
| “别再叫我小林，叫我阿林” | `replace`（旧线程→superseded，新值带 `supersedes_thread_id`） |
| “别再叫我小林”/“不要这样称呼我” | 停用唯一当前称呼；否则 `clarify` |
| “还是叫我之前那个名字” | `clarify: address_without_value` |
| “以后叫我阿林”（无否定） | `support + replaces`（替代同 kind 的其他 active 值） |
| “我们下次聊X” / “说好Y” / “简单点说” | `support` topic / plan / rhythm |

`clarify` 不写任何业务行，只写 `relationship.clarify` 事件（reason code，不含原文）。

## 3. 写入路径（生产链）

```
prepare()                      只读 activeThreads(4, evaluationAt) → 连续性块进入 payload
  ↓
用户消息 commit                conversations.appendMessage(user)
  ↓
Provider 请求/回复             （关系状态不参与本轮事实判断）
  ↓
assistant 消息事务              afterPersist:
                               cognitive_outbox.enqueue({modules: [...,'relationship']})
                               —— obligation 与消息同事务提交
  ↓
commit
  ↓
drainCognition(turnId)         逐模块消费；relationship projector:
                                 readUserMessage() → observe({text,messageId,conversationId,at})
                                 → planRelationshipMutation
                                 → database.transaction(() => applyMutation)
                                   · 证据 INSERT ... ON CONFLICT DO NOTHING
                                   · recompute(strength/status/expiry)
                                   · relationship.mutated 事件（operation/targets/reason）
                               成功→effect ledger=applied、outbox=done
                               失败→outbox=pending、attempts+1；≥5→failed
  ↓
下一轮 prepare()               只读 active 线程；retracted/superseded/expired 不出现
```

要点：

- **消息未提交不产生关系状态**：obligation 与 assistant 消息同事务，消息回滚则 obligation 不存在。
- **消息成功、关系失败可重试**：outbox 行保留 pending，`drainCognition()` 在启动与下一轮重放；
  `(turn_id, module, handler_version)` 与 effect ledger 保证只应用一次。
- **同一 source message 不重复计权**：证据表主键 `(thread_id, source_message_id)`。
- **重放不覆盖新决定**：替代/降级只作用于 `lastSeenAt <= input.at` 的目标；`upsertThread`
  在全状态范围内按 `(kind,value)` 查重，旧消息重放命中 `lastSeenAt >= input.at` 时直接 no-op。

## 4. 读取与注入

`activeThreads(limit, at)`：

1. 对 `active/candidate` 行先 `recompute()`（TTL/分数）；
2. 只保留 `status === 'active'`；
3. 按 `strength`、`lastSeenAt` 排序，取前 `limit`；
4. 渲染为连续性块（kind/value 的最小结构），明确“不是新事实、不是权限”。

因此撤回/替代/过期/删除在下一次读取就生效，无需清理缓存。

## 5. 删除传播

### 5.1 单条消息删除

v44 触发器（`migrations.ts:2392`）：

```sql
CREATE TRIGGER relationship_evidence_delete_with_message
AFTER DELETE ON messages
BEGIN
  DELETE FROM relationship_thread_evidence WHERE source_message_id = OLD.id;
  UPDATE relationship_threads
    SET status='candidate', strength=0, updated_at=...
    WHERE status IN ('active','candidate')
      AND NOT EXISTS (SELECT 1 FROM relationship_thread_evidence e WHERE e.thread_id = relationship_threads.id);
END;
```

- 删除来源消息→证据行删除；
- 线程失去全部证据→降为 `candidate/strength=0`，不再注入；
- 仍有其他独立证据的线程保留，并在下次读取时按剩余证据重算。

产品当前没有“删除单条消息”的 UI/IPC；该触发器覆盖数据库层删除与未来的单条删除实现，
测试 7 以 SQL 删除验证。

### 5.2 会话删除

`DELETE FROM conversations` 触发 `messages` 的 `ON DELETE CASCADE`；SQLite 在本项目
（Node 22 `node:sqlite`，`foreign_keys=ON`）上对级联删除行触发 AFTER DELETE 触发器，因此
证据与线程降级与会话删除同一事务。测试 8 验证。

### 5.3 备份恢复与 deletion journal replay

恢复流程（`backup-service.ts`）把备份快照复制到 staging，合并 live journal 后：

- `conversation: deleted` → `DELETE FROM conversations WHERE id=?` → 级联删除消息 → v44 触发器清理证据；
- `memory: deleted/retracted/unretracted` → 原有的记忆边界回放逻辑，不受影响；
- 恢复后再做 `integrity_check` 与 `foreign_key_check`。

若备份本身带回了“来源消息已不存在”的孤儿证据（例如更早的备份与手工清理混合），
`RelationshipThreadService.reconcile()` 删除孤儿证据并重算全部 `active/candidate` 线程。
测试 9 构造该孤儿行并断言 `reconcile()` 删除；测试 9b 走真实备份 → 删除会话 → 恢复 →
deletion journal 回放，断言证据为 0、无线程 active。

## 6. 失败与恢复语义

| 场景 | 表现 | 恢复 |
|---|---|---|
| 关系写入抛错 | assistant 回复仍提交；outbox 行 pending，`cognition_outbox_drain` 降级事件 | 下次 `drainCognition()`（启动/下一轮）重试；幂等 |
| 连续失败 ≥5 次 | outbox 行 `failed`；effect ledger `terminal_failed` | 人工检查 `cognitionOutboxStats()`；不自动无限重试 |
| 进程在消息提交后、drain 前崩溃 | obligation 已随消息持久化 | 启动 drain 重放 |
| 进程在关系写入后、outbox mark 前崩溃 | effect ledger 已 `applied` | 重放时标记 done，不重复执行 |
| 删除来源消息 | 证据删除、线程降级 | 无需额外恢复 |
| 索引写入失败 | 主记录保留；`fact_index_jobs` degraded；操作 `recovery_required` | `retryDue()` 到期重索引；成功后 `indexed` |
| 多事实验证不符（无索引故障） | 整批回滚；`rolled_back` | 不保留部分结果；可重试 |

## 7. 边界与不变量

- 关系线程只保存用户明确陈述的低敏感连续性信息；不推断情感依赖、身份、健康或诊断。
- `strength` 是 0–1 的有界启发式分数，不是概率，不向用户展示。
- 表达策略与关系状态都不改写事实账本、权限、人格基线；Provider 切换不重置它们。
- 已删除/已撤回/已替代的内容不得经检索、prompt、恢复路径重新出现。
