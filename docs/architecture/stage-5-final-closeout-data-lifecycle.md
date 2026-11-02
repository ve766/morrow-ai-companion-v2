# Stage 5 最终收尾：删除生命周期与数据流

本文描述 `fix/stage-5-final-closeout`（代码 SHA `80851cf`）的生产实现，重点标注事务边界、
持久化点、崩溃恢复点和删除传播。设计目标：用户删除什么，系统就不再使用什么；重试和重启
不会复活已删除或已撤回的内容。

## 1. 目标链路与当前实现

任务要求的数据链路：

```
接收消息 → [事务] 保存 user message + 关系 obligation → Provider → assistant 提交
         → projector 执行 mutation → [事务] evidence/thread + obligation 完成
         → 删除传播 → 启动/恢复顺序
```

当前实现与之一致：

| 步骤 | 代码 | 说明 |
|---|---|---|
| 1. 分配 ID | `sendChat` → `requestId`、`messageId` | turn/message 稳定 ID |
| 2. 用户消息 + obligation | `appendMessage(..., 'user', ..., { afterPersist })` → `outbox.enqueue({modules:['relationship']})` | repository 在同一 `database.transaction` 内调用 `afterPersist` |
| 3. Provider | `provider.generate` | 失败不回滚用户消息/obligation |
| 4. assistant 提交 | 另一 `appendMessage(..., 'assistant', ..., { afterPersist })` | 同事务入队其余模块；关系模块不重复 |
| 5. 投影 | `drainCognition` → `relationship` projector → `observe()` | `database.transaction`（savepoint）；证据唯一键 |
| 6. 删除 | `DELETE FROM messages` / `conversations` | v46 触发器；outbox 取消触发器 |
| 7. 启动/恢复 | `index.ts` | 迁移 → reconcile → 服务 → 恢复 interrupted → drain outbox |

## 2. 关系线程状态机

```
(none) --support--> candidate --MIN_GROUPS/score--> active
                        |                              |
                        |---- user retract -----------> retracted（保留内容供审计）
                        |---- replaced ---------------> superseded（保留历史）
                        |---- TTL --------------------> expired
                        |
                        +---- 来源删除（无证据）------> tombstone（retracted, value='', 无指针）
```

- **retracted**：用户明确撤回。内容保留，证据保留；不再注入。
- **superseded**：被同 kind 的新值替代；内容保留，证据保留；不再注入。
- **tombstone**：来源已删除且无证据。`status='retracted'`、`value=''`、
  `source_message_id=NULL`、`conversation_id=NULL`、`supersedes_thread_id=NULL`、
  `tombstoned_at` 非空。只保留 id/kind/时间戳用于审计，不含个人内容。
- **expired**：最后证据超过 180 天；内容保留但不再注入。

`recompute()` 对 `retracted`/`superseded` 直接返回；tombstone 也是 retracted，分数重算不能
复活。

## 3. v46 表结构与约束

```sql
relationship_threads(
  id, kind, value,
  status IN ('candidate','active','superseded','retracted','expired'),
  strength [0,1], confidence [1,100],
  source_message_id TEXT NULL, conversation_id TEXT NULL, supersedes_thread_id TEXT NULL,
  first_seen_at, last_seen_at, expires_at, tombstoned_at, created_at, updated_at,
  CHECK (
    (tombstoned_at IS NOT NULL AND value='' AND source_message_id IS NULL AND conversation_id IS NULL)
    OR (tombstoned_at IS NULL AND length(trim(value)) BETWEEN 1 AND 200)
  )
)
relationship_thread_evidence(
  thread_id, source_message_id, conversation_id, polarity, weight, created_at,
  PRIMARY KEY(thread_id, source_message_id),
  FOREIGN KEY(thread_id) REFERENCES relationship_threads(id) ON DELETE CASCADE
)
```

- 唯一索引 `(kind, value, source_message_id) WHERE source_message_id IS NOT NULL`：
  同一消息同一值只一行；tombstone 不参与。
- 迁移时重建表并复制全部旧行；旧证据表先删除，避免 FK 指向被重命名的表。

## 4. 删除传播

### 4.1 单条消息

v46 触发器：

```sql
AFTER DELETE ON messages
BEGIN
  DELETE FROM relationship_thread_evidence WHERE source_message_id = OLD.id;
  UPDATE relationship_threads SET source_message_id=NULL WHERE source_message_id = OLD.id;
  UPDATE relationship_threads
    SET status='retracted', value='', source_message_id=NULL, conversation_id=NULL,
        supersedes_thread_id=NULL, strength=0, confidence=1,
        tombstoned_at=now, updated_at=now
    WHERE tombstoned_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM relationship_thread_evidence e WHERE e.thread_id = relationship_threads.id);
END;
```

- 线程仍有其他独立证据：保留内容，下次读取按剩余证据重算。
- 线程无证据：tombstone。
- outbox：`cognitive_outbox_cancel_with_message` 把该消息的 pending obligation 置为 cancelled。
- `observe()` 额外校验 source message 仍存在；即使某个投影已越过取消检查，也不会写入。

### 4.2 整个会话

`DELETE FROM conversations` → `messages` FK `ON DELETE CASCADE` → 每条消息触发上述触发器。
Node 22 `node:sqlite` 的级联删除会触发 AFTER DELETE 触发器（项目已用测试验证）。

### 4.3 备份恢复与 deletion journal

```
restore(token):
  copy snapshot → staged DB → open/migrate (v46 backfill applies)
  merge live deletion journal → replay:
      conversation deleted → DELETE FROM conversations → cascade → trigger
      memory deleted/retracted → existing memory boundary logic
  integrity_check + foreign_key_check
  close live DB → swap → relaunch
startup:
  migrate → relationships.reconcile() → services → recover interrupted → drain outbox
```

恢复后的旧快照若带孤儿证据，v46 backfill 与启动 reconcile 都会清理；`reconcile()` 幂等。

## 5. Startup 顺序（fail-closed）

`src/app/index.ts` 当前顺序：

1. `SqliteDatabase.open` → 应用迁移（含 v46 backfill）；
2. 构建各服务（memory、self-model、outbox 等）；
3. **`relationships.reconcile()`**；
4. 构建 `CompanionService`；
5. `recoverInterruptedTurns()`；
6. `drainCognition()`；
7. 注册 IPC、创建窗口。

第 3 步失败直接抛错，应用不进入对话服务。理由：在未完成隐私清理的库上构建 prompt，
等于把已删除内容暴露给 Provider。

## 6. Outbox 状态与恢复

| 任务要求 | 当前机制 |
|---|---|
| pending | `cognitive_outbox.status='pending'` |
| processing + lease | `cognitive_effect_ledger.state='running'` + `lease_until` |
| committed | `outbox.status='done'` + ledger `applied` |
| retryable failure | outbox 回 `pending`、attempts+1；ledger `failed_retryable` |
| dead_letter | outbox `failed`（≥5 次）；ledger `terminal_failed` |
| 删除取消 | `cognitive_outbox_cancel_with_message`（pending→cancelled） |
| 崩溃恢复 | 启动 `drainCognition()`；effect ledger 防重复执行 |

不新增平行队列；复用 v45 已有的 `relationship` 模块。

## 7. 崩溃点分析

| 崩溃位置 | 结果 | 恢复 |
|---|---|---|
| 用户消息事务内 | 消息与 obligation 均未提交 | 重试产生一条 |
| 用户消息提交后、Provider 前/中 | 消息与 obligation 已提交 | 下一轮/启动 drain 投影一次 |
| assistant 事务内 | assistant 与其余模块未提交；关系 obligation 已提交 | 重试；关系投影独立成功 |
| 投影写入后、outbox mark 前 | effect ledger 已 applied | 重放标记 done，不重复 |
| 删除事务内 | 证据/线程/outbox 一起回滚 | 重试删除 |
| 启动 reconcile 失败 | 应用不启动 | 修复存储后重启；fail-closed |

## 8. 读路径审计

| 路径 | 是否读取关系内容 | 删除后行为 |
|---|---|---|
| `activeThreads()` | 是（仅 active） | tombstone/retracted 不返回 |
| `TurnEvaluation.relationshipThreads` | 仅 id/kind | 无行可读 |
| prompt 连续性块 | 仅 active 线程 value | 无行可读 |
| `reconcile()` | value/source 仅用于清理 | 清空并 tombstone |
| 备份导出 | 整库复制 | tombstone 无个人内容 |
| 评测 harness | 通过 `activeThreads` | 不注入 |
