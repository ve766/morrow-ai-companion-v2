# Stage 5 最终收尾复审发现（Issue #29）

- 仓库：`ve766/morrow-ai-companion-v2`
- 复审基线：PR [#28](https://github.com/ve766/morrow-ai-companion-v2/pull/28) head `9d54c6e02dea443f5b6911810327a9fa08c5353c`，代码修复基线 `d9864031221b3e7df238cb87ea50a29a7c4aaf59`
- 收尾分支：`fix/stage-5-final-closeout`（自 `9d54c6e`）
- 结论：F1–F4 已修复并有生产路径证据；F5 真人自然度保持 PENDING_HUMAN，第二 Provider 保持 NOT_RUN。

> 本文只记录本轮复审确认的缺口、根因与修复证据；不把修复者自测冒充独立审计。
> 历史结果（`1b7ab9c`、`d986403` 等）保持原样，未覆盖。

## 1. 发现总表

| ID | 严重度 | 领域 | 修复前行为 | 根因位置 | 状态 |
|---|---|---|---|---|---|
| F1 | P0 隐私 | 删除传播 | 删除消息后 v44 仅把线程降为 candidate/strength=0，`value`（称呼/话题/承诺）、`source_message_id`、`conversation_id` 仍保留；`reconcile()` 未接入生产启动/恢复 | `migrations.ts` v44 触发器；`relationship-threads.ts` `reconcile()`；`app/index.ts` 启动顺序 | FIXED |
| F2 | P1 可靠性 | 入队时机 | 关系 obligation 在 assistant 消息提交后的 `afterPersist` 才入队；Provider 超时/崩溃/assistant 未保存时，用户的关系统表达丢失 | `companion-service.ts` 旧 enqueue 位置 | FIXED |
| F3 | P1 误判 | distress 识别 | `distressSignal` 正则含单字 `烦`，`麻烦你帮我检查一下代码` 命中；注释声称需要显式情绪陈述，实现不一致 | `expression-policy.ts` `distressSignal` | FIXED |
| F4 | P1 证据一致性 | CI/文档 | PR #28 交付文档仍引用旧 run `41385531397` / 旧 head `e293656`，与最终 run `41386833397` / head `9d54c6e` 不一致 | 三份 Stage 5 修复文档 | FIXED |
| F5 | 外部验证 | 自然度/第二 Provider | 真人自然度 PENDING；第二 Provider 无凭据 NOT_RUN | 环境/凭据 | PENDING_HUMAN / NOT_RUN |

## 2. F1 — 删除后关系内容残留

### 2.1 已证实的缺陷

v44 触发器：

```sql
DELETE FROM relationship_thread_evidence WHERE source_message_id = OLD.id;
UPDATE relationship_threads
  SET status = 'candidate', strength = 0, updated_at = ...
  WHERE status IN ('active','candidate')
    AND NOT EXISTS (SELECT 1 FROM relationship_thread_evidence e WHERE e.thread_id = relationship_threads.id);
```

`value`、`source_message_id`、`conversation_id`、`supersedes_thread_id` 都没有清除。v43 的 CHECK
约束还要求 `value` 非空、`source_message_id`/`conversation_id` 非空，所以旧实现无法表达
“无内容的 tombstone”。

`reconcile()` 只在修复测试和手动调用中出现；`src/app/index.ts` 启动时没有调用它。备份恢复
通过 `relaunchAfterDataReplacement()` 重启应用，但启动链同样没有 reconcile。

历史数据库可能已有：证据行指向已删除消息、线程保留 `value`/source 指针。

### 2.2 复现（修复前）

1. 发送“以后叫我小林。”→ `address_preference=小林` active。
2. `DELETE FROM messages WHERE turn_id = ?`。
3. 证据行被 v44 删除，线程 `status='candidate'`、`strength=0`，但
   `value='小林'`、`source_message_id=<已删除消息>`、`conversation_id=<会话>` 仍在。
4. 备份/导出仍包含该内容；新会话虽不再注入（candidate），但“删除即清除个人内容”不成立。

### 2.3 修复

- v46 `relationship-deletion-tombstones` 重建两张表：
  - `value` 允许空串但有条件 CHECK；
  - `source_message_id`/`conversation_id` 可空；
  - 新增 `tombstoned_at`；
  - 条件 CHECK 保证 tombstone 行 `value=''` 且没有任何来源/会话指针。
- 迁移内历史 backfill（幂等）：
  - 删除来源消息不存在的证据；
  - 清空指向已删除消息的线程级 source 指针；
  - 无证据线程 → tombstone（清空 value/source/conversation/supersedes，status=retracted）。
- v46 触发器改为：删证据 → 清 source 指针 → 无证据线程 tombstone。
- `reconcile()` 执行同样的清理并写 `relationship.reconciled` 事件（仅计数，无内容）。
- `src/app/index.ts` 在构造 `CompanionService` 之前调用 `relationships.reconcile()`；
  失败即启动失败（fail-closed），不会在未清理的数据上构建 prompt。
- 备份恢复：恢复 → deletion journal replay → `relaunch()` → 新进程启动执行 v46/backfill +
  reconcile，再开放对话服务。
- 所有读路径（`activeThreads`、检索、prompt、导出、备份）只读线程表；tombstone 为
  `retracted` 且 value 为空，不可能被注入。

## 3. F2 — 入队晚于用户消息

### 3.1 已证实的缺陷

旧链路：user message commit → provider request → assistant message commit → `afterPersist`
→ `cognitive_outbox.enqueue`（relationship 模块）。Provider 超时、断网、进程崩溃或
assistant 未保存时，`afterPersist` 不执行，关系表达没有 durable obligation。

### 3.2 修复

- `appendMessage(..., 'user', ...)` 的 `afterPersist` 内、与用户消息同一事务写入
  `cognitive_outbox(module='relationship')`；`afterPersist` 由 repository 在事务内调用。
- 幂等键：`(turn_id, module='relationship', handler_version)` + 证据
  `(thread_id, source_message_id)` 唯一；同一消息重放不增权。
- assistant 消息事务只入队其余模块（`COGNITIVE_MODULES.filter(m => m !== 'relationship')`）。
- 下一轮开始前 `drainCognition()` 处理更早的 pending；启动时 `drainCognition()` 处理重启。
- 删除消息/会话：现有 `cognitive_outbox_cancel_with_message` 触发器把 pending 行设为
  cancelled；`observe()` 还校验 source message 仍存在，双保险。
- 旧任务竞态：projector 使用 obligation 的原始 `occurredAt`；`supersedeIfStale()` 把
  “晚到但更早”的新值标为 `superseded`，不能与更新决定并列 active。
- 状态映射（复用现有机制，不另造队列）：
  outbox `pending` ≈ pending；effect ledger `running` + lease ≈ processing；outbox `done` +
  ledger `applied` ≈ committed；outbox `failed` / ledger `terminal_failed` ≈ dead_letter。
  重复投影由 effect ledger 直接标记 done，不再次执行。

### 3.3 复现（修复前）

Provider 失败后检查 `cognitive_outbox`：没有 relationship 行；用户消息存在但关系表达永久
丢失。修复后同一场景行状态为 pending，重启后恰好投影一次。

## 4. F3 — distress 误判

旧实现：`/(?:...|烦|...)/u.test(text)`。子串匹配使“麻烦你帮我检查一下代码”“这个操作很麻烦”
命中“烦”，被当作用户困扰；注释与算法不一致。

修复：`assessDistressEvidence()` 输出 E/C/T/D：

```
D = 0.55E + 0.25C + 0.20T
distress = E >= 0.85 OR (D >= 0.65 AND C >= 0.40)
```

- E 只由完整第一人称/情绪句式产生；`烦` 后接 `麻/请/琐/杂` 时排除。
- C 来自独立线索类别（显式句式、躯体线索、强调标点）；单一类别不足以触发。
- T 只是 20% 权重；单独张力不触发 acknowledge。
- 直接请求仍最高优先级。

对照结果见 `docs/algorithms/stage-5-distress-evidence-calibration.md` 与
`src/affective-state/distress-evidence.test.ts`。

## 5. F4 — CI/证据引用

- PR #28 三份文档统一到最终 run `41386833397`、head `9d54c6e`。
- 本轮新增 `evals/stage-5/final-closeout/results/<ts>-<sha>.json`，分别记录
  `codeSha`、`ciHeadSha`、`docSha`（见报告说明），不修改历史结果 JSON。
- 新代码提交的 CI 以提交自身 run 为准，不引用旧 run 证明新代码。

## 6. F5 — 外部验证

- 真人自然度：7 个固定样本 + 盲评表见
  `evals/stage-5/final-closeout/review/human-review-packet.md`，状态 **PENDING_HUMAN**。
- 第二真实 Provider：无合法凭据/endpoint，**NOT_RUN**；同库运行时重建不等于真实切换。
- Agent rubric 不等于真人评分；报告中分开标注。
