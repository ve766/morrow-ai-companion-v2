# Phase 2.2.5 — 数据生命周期与备份恢复

基线 `8ddec1f`，本轮代码 `42cc5bd`…`b55ba7b`，证据 `203d4bb`。

## 1. 数据生命周期清单（按真实调用路径，不按表名推断）

| 数据 | 存储 | 写入入口 | 删除入口 | 关联 | 备份 | 恢复行为 | 验证方式 |
|---|---|---|---|---|---|---|---|
| 会话 | `conversations` | `ConversationService.create` | `CompanionService.deleteConversation` | messages（FK CASCADE）、evidence（仅存 UUID） | `VACUUM INTO` 快照 | 按 `deletion_journal('conversation')` 重放删除 | `backup-service.test.ts`、`feedback-recovery.test.ts` |
| 消息 | `messages` | `ConversationService.appendMessage` | `CompanionService.deleteMessage`（2.2.4 新增） | cognitive_turn_observations、memory_suggestions、reminders（复合 FK CASCADE） | 同上 | **本轮新增** `deletion_journal('message')` 重放删除 | `feedback-recovery.test.ts` |
| 记忆 | `memories` + `memory_revisions` | `MemoryService.create/correct` | `delete` / `retract` | revisions（FK CASCADE） | 同上 | `journal('memory', deleted/retracted/unretracted)` | `backup-service.test.ts` |
| 反馈候选 | `persona_feedback_candidates` | `FeedbackCandidateService.record` | `withdraw` / `reject` | evidence、applications（FK CASCADE） | 同上 | **本轮新增** `journal('candidate')` | `feedback-recovery.test.ts` |
| 反馈证据 | `persona_feedback_evidence` | `record` | `withdrawEvidence*` | candidate | 同上 | **本轮新增** `journal('evidence')` + 支持数重算 | `feedback-recovery.test.ts` |
| 人格应用记录 | `persona_feedback_applications` | `apply` | 不删除（审计） | candidate、personality_revisions | 同上 | 不重放（是结果不是意图） | `feedback-candidate-service.test.ts` |
| 人格版本 | `personality_profiles` / `personality_revisions` | `PersonalityService.save` | 不删除（审计） | — | 同上 | 快照整体替换 | `kill-recovery.test.ts` |
| 删除日志 | `deletion_journal` | `recordDeletionState` | `applyDeletionBoundary` 重写 | 全部上述实体 | 同上 | 与备份内日志合并，较新者胜 | 同上 |

## 2. 修复前的缺口

`deletion_journal` 的 `entity` 只允许 `memory` / `conversation`，`entity_id` 强制长度 36。后果：

1. 撤回一条证据只改 `status`，**不写日志**；
2. 恢复旧备份时，证据行原样回来，`status='active'`；
3. 候选在备份里是 `supported`，支持数重新变成 2；
4. 消息删除（2.2.4 新增）也没有日志，恢复后消息回来。

第 1–3 条意味着：用户撤回的反馈，只要恢复一次旧备份就全部复活，而系统不会提示。

## 3. 修复方式

### 3.1 迁移 v19

```sql
ALTER TABLE deletion_journal RENAME TO deletion_journal_v18;
CREATE TABLE deletion_journal (
  entity TEXT NOT NULL CHECK (entity IN ('memory','conversation','message','evidence','candidate')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  state TEXT NOT NULL CHECK (state IN ('deleted','retracted','unretracted')),
  operation_id TEXT CHECK (operation_id IS NULL OR length(operation_id) = 36),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id)
) STRICT;
INSERT INTO deletion_journal SELECT entity, entity_id, state, NULL, recorded_at FROM deletion_journal_v18;
DROP TABLE deletion_journal_v18;
```

`entity_id` 对证据是 `candidateId:conversationId:evidenceHash`——两个 UUID 加一个 SHA-256，**不含任何用户文本**。`operation_id` 把一次删除请求写入的多行归组，恢复时能报出「这次撤回来自哪个操作」，同样不含内容。

### 3.2 写入点

| 位置 | 写入 |
|---|---|
| `withdrawEvidence` | 撤回前读出受影响证据行 → 逐行写 `evidence/retracted`；候选变 `withdrawn` 时写 `candidate/retracted`；同一个 `operation_id` |
| `decide('withdrawn')` | 写 `candidate/retracted` |
| `SqliteConversationRepository.deleteMessage` | 写 `message/deleted` |
| 已有的会话/记忆删除 | 不变 |

### 3.3 恢复重放

`applyDeletionBoundary` 现在处理五种实体，并且：

- **删除会话时先撤回该会话的证据**——证据行带 `conversation_id` 但没有外键，只删会话会留下 active 证据；
- **重放后重算支持数**——`active` 会话数 0 → `withdrawn`、1 → `pending`、≥2 → `supported`，并把摘要替换为 `[withdrawn]`；
- 每一步 UPDATE 都带状态守卫（`AND status='active'`），**重复执行第二次返回 0**，不重复计数。

**事务边界（必须说清楚）**：备份是一个独立文件，无法与 live 库共享事务。实际顺序是「读 live 日志 → 在暂存库内单事务重放 → 校验 integrity/foreign_key → 原子 rename 换入」。进程在换入前死掉，live 库完全没动；换入后崩溃，得到的是完整重放过的库。没有跨文件事务，也没有假装有。

## 4. 真实恢复测试

`src/persistence/feedback-recovery.test.ts`，全流程查库：

| 步骤 | 断言 | 结果 |
|---|---|---|
| 备份 | 会话 A/B/C、候选 tone（2 会话支持）、候选 boundary、记忆「花生」+「杭州」 | 通过 |
| 删除消息 A | `evidenceWithdrawn > 0`，`memoriesRetracted = [allergy.id]` | 通过 |
| 删除后查库 | A 的证据 `withdrawn`、B 的 `active`；候选 `pending`；花生记忆 `retracted`；`assembleContext('花生')` 不含花生 | 通过 |
| 恢复旧备份 | `status: restored` | 通过 |
| 重开库查行 | 消息行 0；A 证据 `withdrawn`；B 证据 `active`；候选 `pending`；支持数 1 | 通过 |
| 无关数据 | boundary 候选仍 `pending`、其证据仍 `active`；杭州记忆仍 `active` | 通过 |
| 重新检索 | `assembleContext('花生')` 不含花生；`assembleContext('杭州')` 含杭州 | 通过 |
| 日志内容 | 含 `message/deleted`、`evidence/retracted`、`memory/retracted` | 通过 |
| 幂等 | 连续恢复两次，`reappliedEvidenceWithdrawals` 相同，最终状态相同 | 通过 |

**注意**：第二次恢复必须在新进程/新句柄上做，因为 `restore` 会关闭 live 连接。这是真实行为，测试里如实模拟。

## 5. 强制终止测试（真实进程）

`src/persistence/kill-recovery.test.ts`：

1. 父进程建库、写入候选、记录人格版本；
2. 子进程 `DatabaseSync` 打开库，`BEGIN IMMEDIATE`，`UPDATE personality_profiles SET version = version + 1`，插入 `applying` 应用记录，写标记文件，然后 `setInterval` 挂起；
3. 父进程等标记文件出现，`child.kill('SIGKILL')`（Windows 上是 `TerminateProcess`，不执行任何 JS 清理）；
4. 重新打开库断言：
   - `PRAGMA integrity_check = ok`
   - 人格 `version` 与 `warmth` 均为事务前值
   - `persona_feedback_applications` 中 `applying` 行数 = 0
   - 候选仍 `pending`（可以再次应用，不会卡在 applying）

结果：**通过**。这是真实进程终止，不是异常注入。

## 6. 结论

| 项 | 状态 |
|---|---|
| 删除日志覆盖证据/候选/消息 | **PASS** |
| 恢复旧备份不复活已撤回证据 | **PASS** |
| 恢复后支持数重算 | **PASS** |
| 无关数据不被误删 | **PASS** |
| 重放幂等 | **PASS** |
| 真实 SIGKILL 后库一致 | **PASS** |
| 日志不含用户文本 | **PASS**（只有 UUID + 哈希 + 状态） |
| 备份文件与 live 库的跨文件事务 | **不存在**，已说明边界与失败窗口 |
| 已应用人格随证据撤回回滚 | **BLOCKED**（未设计，超出本轮范围） |
