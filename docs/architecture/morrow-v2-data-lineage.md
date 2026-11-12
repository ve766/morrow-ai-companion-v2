# Morrow V2 数据血缘、来源依赖与失效传播

> 审计基准：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 迁移总数 33，`CURRENT_SCHEMA_VERSION = 33`（`src/persistence/migrations.ts:1470`），55 张表，16 个存活触发器（24 条 `CREATE TRIGGER` 语句，其中 8 条是对同名触发器的重建）。

---

## 1. 一句话结论

**数据写入链路比读取链路完整得多。** 大多数认知表都有可靠的写入、来源与级联删除；但至少 4 处是「只写不读」或「只读不写」，另有 3 处血缘字段缺失或指错，导致「来源撤回 → 派生失效」在部分路径上不成立。

---

## 2. 实体血缘总表

图例：**→payload** 表示该数据能否进入最终序列化请求；「间接」表示只能通过别的列/别的表影响载荷。

### 2.1 会话与消息

| 表 | 主键 | 来源 | 血缘列 | 生命周期 | 写 | 读 | →payload | 失效 |
|---|---|---|---|---|---|---|---|---|
| `conversations` | `id` | `ConversationService.create`（IPC `conversations:create`） | 无 | 无状态列 | `conversation-repository.ts:65-69` | `:71-96`；`companion-service.ts:1155` | **是**（历史窗口） | 删除即级联 |
| `messages` | `id`；`UNIQUE(conversation_id,sequence)`；`UNIQUE(conversation_id,turn_id,role)` | `appendMessage` `:98-135` | `turn_id`、`sequence` | `role ∈ user/assistant` | `:120-121` | `:77-96` | **是**（原文进 `messages`） | 仅随会话级联；**无单条删除 API** |
| `cognitive_turn_observations` | `(source_message_id, attempt)` | `:137-161` | `attempt`、`analyzer_version` | 无 | `:148-160` | `:82-89` | 否 | FK 级联 |
| `cognitive_core_settings` | `id=1` | `cognitive-settings.ts:30-44` | `updated_at` | `enabled 0/1` | 同上 | `:20` | **是（门控）** | 无 |

### 2.2 记忆

| 表 | 主键 | 来源 | 血缘列 | 生命周期 | →payload | 失效 |
|---|---|---|---|---|---|---|
| `memories` | `id` | `MemoryService.create` `:85-125`；建议接受 `companion-service.ts:2014-2018` | `source_category`、`revision`、`confidence`、`last_confirmed_at`、`sensitivity`、`archived_at` | `status ∈ active/retracted`；归档是独立列 | **是**（`:1568`） | 服务层 |
| `memory_revisions` | `(memory_id, revision)` | `create/transition` | `previous_revision`、`change_type` | 追加式 | 间接（纠正次数 → 重要度） | FK 级联 |
| `memory_importance` | `memory_id` | `memory-importance.ts:133-156` | `components_json`、`version` | 无 | **间接**（只通过 `archived_at` 影响检索） | FK 级联；**无触发器** |
| `memory_consolidations` | `id`；`UNIQUE(slot_key)` | `consolidate()` `:215-242`，启动期一次 | `member_ids_json`（只存 id） | 无 | **否** | **无任何失效机制** |
| `memory_suggestions` | `id` | `propose()` | `source_message_id`、`evidence_hash`、`accepted_memory_id` | `pending/accepted/rejected` | 间接（接受后成为 memory） | FK 级联 |

**血缘缺口**：`memories` **没有 `source_message_id`**。从建议接受的记忆只在事件日志里留了 `correlationId`（`companion-service.ts:2017`），行本身不知道来自哪条消息。

### 2.3 兴趣

| 表 | 主键 | 来源 | 血缘列 | →payload | 失效 |
|---|---|---|---|---|---|
| `interests` | `id`；`UNIQUE lower(label)` | 每轮 `observe()`（`companion-service.ts:850-855`）；反思 `reflection-service.ts:400-410` | `origin`、`source_message_id`、`conversation_id`、`evidence_count`/`conversation_count`/`strength`/`confidence`（均为**缓存**） | **是**（`:652,664-671`） | 消息删除触发器（**删整行**）；读时 `reconcile` 自愈 |
| `interest_evidence` | `(interest_id, evidence_ref)`；`UNIQUE(evidence_ref)` | `:148-154` | `evidence_kind ∈ message/memory/legacy/reflection`、`evidence_revision`、`polarity` | 间接 | 5 个触发器（消息/会话/记忆删除、记忆撤回、记忆改写） |

**三个硬缺陷**：

1. **删除一条消息会删掉整条兴趣**（`migrations.ts:754-759`）：
   ```sql
   CREATE TRIGGER self_model_entries_delete_with_source_message
   AFTER DELETE ON messages
   BEGIN
     DELETE FROM self_model_entries WHERE source_message_id = OLD.id;
     DELETE FROM interests WHERE source_message_id = OLD.id;   -- 删的是聚合，不是观测
   END;
   ```
   一条消息只是兴趣的**一个**证据，却会抹掉整条兴趣（哪怕另有 5 条消息支持）。
2. **`interest_evidence.interest_id` 没有外键**（`migrations.ts:1301`）。上述触发器删了父行却不删证据 → 永久孤儿行。
3. **`UNIQUE(evidence_ref)` 单独成索引**（`migrations.ts:1318`）。一条消息若同时支持两个主题，只有一个能记账。

### 2.4 自我模型与反思

| 表 | 来源 | 血缘列 | →payload | 失效 |
|---|---|---|---|---|
| `self_model_entries` | 仅 `kind='fact'`（`companion-service.ts:886-904`）与 `kind='correction'` | `source_message_id`、`superseded_by` | **是**（`:672-675`） | 消息删除触发器；v20 回溯撤回逐字复制 |
| `pending_personality_candidates` | `reflection-service.ts:74-81` | `evidence_json`、`expires_at` | **否** | FK 级联自 findings；`expires_at` **从不执行**，`status` 永远 `pending` |
| `reflection_runs` | 手动/启动/回合后 | `trigger_kind`、`examined_*` | 否 | **无** |
| `reflection_findings` | `:65-71` | `dedupe_key = sha256(kind|statement|evidence)`、`evidence_json` | **否** | FK 级联自 runs |

> `kind ∈ inference/unknown` 生产从不写入（只有测试），所以反思里依赖 `inference` 的 `consistency_note`/`next_turn_suggestion` 分支是死的。

### 2.5 人格

| 表 | 来源 | →payload | 失效 |
|---|---|---|---|
| `personality_profiles` | 仅用户编辑（`companion-service.ts:535-553`） | **是**（`:1558`） | 无 |
| `personality_revisions` | 每次保存 | 否 | 无 |
| `personality_growth_signals` | `:876-885` | **是**（经折叠，`:687`） | 消息删除触发器（按 `turn_id`） |
| `personality_growth_state` | `apply()` 写 | 否（只读 `revision`/`updated_at`） | 无 |
| `personality_growth_events` | `apply()` 写 | 否（`history()` 无生产调用方） | 无 |

### 2.6 个性化

| 表 | 来源 | →payload | 失效 |
|---|---|---|---|
| `personalization_state` | `personalization-service.ts:209-220` | 间接（值每次重折，缓存列是死列） | 无 |
| `personalization_signals` | `companion-service.ts:859-872` | **是**（`:679-683`）；也经 `preferenceFor` 进入检索 `P` 项 | 消息删除触发器 |

### 2.7 探索

| 表 | 来源 | →payload | 失效 |
|---|---|---|---|
| `exploration_events` | `exploration-policy.ts:234-240` | 间接（许可行 `:1567`） | 消息删除触发器（按 `turn_id`） |
| `exploration_budget` | `:177-202`（`BEGIN IMMEDIATE` 内预留） | 间接 | **无清理、无过期** |

### 2.8 目标（两套，互不相干）

| 表 | 来源 | →payload | 备注 |
|---|---|---|---|
| `companion_goals` | **生产无写入** | 读（`:690-698`），但表永远空 | `source_message_id` 无外键、无触发器 |
| `companion_goal_progress` | 无生产调用方 | 否 | FK 级联 |
| `goals` / `goal_tasks` / `goal_actions` / `goal_approvals` / `goal_audit` | 任务型 `GoalService`（IPC `goals:*`） | **否** | `goal_audit` 随目标级联删除（审计轨迹被一起删掉） |

### 2.9 内在状态

| 表 | 来源 | →payload | 失效 |
|---|---|---|---|
| `cognitive_feeling_state` | 事件重放 | **是**（`:1561`） | `dirty` 标记 + revision 不一致强制重建 |
| `cognitive_feeling_events` | `:1337`（事务内） | 间接 | FK 级联；`MAX=5000` 硬上限后 `recordCompletedTurn` 抛错 |
| `cognitive_feeling_revisions` | 同上 | 否 | FK 级联 |

### 2.10 回合连续性

| 表 | 来源 | →payload | 失效 |
|---|---|---|---|
| `cognitive_turn_contexts` | `:1780` | 否（明确是描述不是输入） | 会话删除触发器 |
| `cognitive_pending_items` | `:1776` | **否**（只经 IPC 展示） | 会话删除触发器；**无消息级触发器** |
| `cognitive_turn_finalizations` | `:1315-1326` | 否 | 消息/会话删除触发器 |
| `turn_states` | `:1113-1119` | 否 | 消息/会话删除触发器 |

### 2.11 日志

| 表 | 保留策略 |
|---|---|
| `event_journal` | 只追加，**无轮转、无清理** |
| `deletion_journal` | 只记 `memory` 与 `conversation` 两类；**无清理** |
| `schema_migrations` | 追加，带实现指纹（`(version,name)` 必须完全匹配） |

---

## 3. 触发器全表（16 个存活）

| # | 名称 | 表 / 事件 | 动作 | 首次版本 | 重建 |
|---|---|---|---|---|---|
| 1 | `cognitive_feeling_insert_marks_dirty` | `cognitive_feeling_events` AFTER INSERT | 置 `dirty=1` | v10 | — |
| 2 | `cognitive_feeling_update_marks_dirty` | 同上 AFTER UPDATE | 同上 | v10 | — |
| 3 | `cognitive_feeling_delete_marks_dirty` | 同上 AFTER DELETE | 同上 | v10 | — |
| 4 | `self_model_entries_delete_with_source_message` | **`messages`** AFTER DELETE | 删 `self_model_entries` **与整条 `interests`** | v19 | — |
| 5 | `cognitive_turn_contexts_delete_with_conversation` | `conversations` AFTER DELETE | 删 contexts / pending_items / finalizations | v19 | — |
| 6 | `cognitive_turn_finalizations_delete_with_message` | `messages` AFTER DELETE | 删 finalizations | v21 | — |
| 7 | `personalization_signals_delete_with_turn_message` | `messages` AFTER DELETE | 按 `turn_id` 删信号 | v22 | — |
| 8 | `turn_states_delete_with_conversation` | `conversations` AFTER DELETE | 删 turn_states | v23 | v28 |
| 9 | `turn_states_delete_with_turn_message` | `messages` AFTER DELETE | 删 turn_states | v23 | v28 |
| 10 | `interest_evidence_delete_with_message` | `messages` AFTER DELETE | 删 `kind='message'` 证据 | v24 | v30 |
| 11 | `interest_evidence_delete_with_conversation` | `conversations` AFTER DELETE | 按会话删证据 | v24 | v30 |
| 12 | `interest_evidence_delete_with_memory` | **`memories`** AFTER DELETE | 删 `kind='memory'` 证据 | v25 | v30 |
| 13 | `interest_evidence_invalidate_on_memory_retract` | `memories` AFTER UPDATE OF status | 同上 | v25 | v30 |
| 14 | `interest_evidence_invalidate_on_memory_revision` | `memories` AFTER UPDATE OF revision | 同上 | v25 | v30 |
| 15 | `personality_growth_signals_delete_with_turn` | `messages` AFTER DELETE | 按 `turn_id` 删信号 | v29 | — |
| 16 | `exploration_events_delete_with_turn` | `messages` AFTER DELETE | 按 `turn_id` 删事件 | v29 | v30 |

> v30 重建时先 DROP 全部 5 个 `interest_evidence` 触发器再改名，因为 `ALTER TABLE … RENAME` 会把触发器体里的表名一起改写——这是上一轮踩到的真实坑（`migrations.ts:1290-1298` 有注释）。

---

## 4. 删除传播矩阵

生产**没有单条消息删除 API**（只有 `conversations:delete`），所以「消息删除」实际只通过会话级联发生。

| 删除对象 | 消失的派生数据 | **残留的幽灵** |
|---|---|---|
| 会话 | 消息、观察、感受事件/修订、建议、自我模型条目、**整条兴趣**、消息型证据、终结意图、个性化信号、回合状态、回合上下文、待决项 | `event_journal` 条目；`memory_suggestions` 已接受的 memory 本体 |
| 记忆（撤回/删除） | 记忆型证据（触发器 12/13）；重要度行（FK） | `memory_suggestions.accepted_content`（旧文本副本）；`memory_consolidations.member_ids_json` 里的死 id；`cognitive_pending_items` 的 dedupe key |
| 记忆（纠正） | 该记忆的**全部**证据（触发器 14，v30 已去掉「只删旧 revision」谓词） | 同上 |
| 人格编辑 | 无（基线只增不改） | 无 |

**`deletion_journal` 只覆盖 `memory` 与 `conversation`**（`migrations.ts:411`）。兴趣、自我模型、反思结论、人格编辑、陪伴目标、**记忆归档**都没有边界记录。后果：从旧备份恢复会把已撤回的兴趣/自我模型条目/人格编辑**复活**，并把已归档的记忆**取消归档**。

---

## 5. 证据独立性

| 实体 | 独立性单位 | 计数实现 | 重试安全 | 修订安全 |
|---|---|---|---|---|
| 兴趣 | **每个来源事件**（一条消息 / 一条记忆 / 一个 finding） | `UNIQUE(evidence_ref)`（`migrations.ts:1318`）+ `INSERT OR IGNORE`（`interest-service.ts:148-154`）+ 折叠 `:168-197` | 是（同一 `messageId` 幂等） | **否**：一条记忆终身只能支持一个兴趣 |
| 成长 | **每个回合 × 维度** | PK `(dimension, turn_id)`（`migrations.ts:1168`）+ `DO NOTHING`（`personality-growth.ts:308`） | 值安全；但 `apply` 仍会 bump revision 并追加审计行 | — |
| 个性化 | 每个回合 × 维度 | 同上（`migrations.ts:841`） | 同上 | — |
| 探索事件 | 每个回合 × 状态 | `UNIQUE(turn_id, state)` | 是 | — |
| 探索预算 | 每个 (scope, day, turn) | PK | 是 | — |
| 反思结论 | `(kind, 规范化陈述, 排序后的证据集)` | `dedupe_key` + 部分唯一索引 | 是 | — |
| 人格候选 | **无去重** | 无唯一索引 | 事实上受限（只在 finding 新建时产生） | — |

**能否被重试或修订灌水？**

- 兴趣：同一回合重试不会（`interest-service.ts:334-338`）。
- 但存在**系统性少计**：`onTurnCompleted` 在 assistant 提交之后执行；若此时崩溃，重试会命中重放分支（`companion-service.ts:1159-1184`）而**不执行钩子**，该回合证据永久丢失。
- 兴趣强度里的时间衰减是**死代码**：`computeInterestStrength(support, conversations, 0)` 把 `daysSinceLastSeen` 硬编码为 0（`interest-service.ts:585`），文档里的 14 天半衰期（`self-model-domain.ts:186-193`）从未生效。

---

## 6. 备份 / 恢复

| 项 | 结论 | 证据 |
|---|---|---|
| 内容 | 整个 SQLite（`VACUUM INTO`）+ `manifest.json` | `backup-service.ts:203-216` |
| 不含 | API 密钥（在 `secrets/*.bin`）、`-wal`/`-shm`、迁移 `.bak` | `secrets.ts:101-103`；`database.ts:167` |
| 恢复前校验 | manifest 存在/大小 → 格式与版本 → `schemaVersion ∈ [9,33]` → 字节数与 SHA-256 → `integrity_check` + `foreign_key_check` → 重数五类计数 → 预览 token（32 hex，600s，单次） | `backup-service.ts:321-354,121-137,227-269` |
| 交换 | 先复制现库、比对大小、删 `-wal`/`-shm`、`rename`、重开并再校验，失败回滚 | `:143-179` |
| 删除边界 | 只重放 `memory` 与 `conversation` | `deletion-journal.ts:55-64`；`backup-service.ts:387-427` |
| **密钥** | **不恢复**。`provider_profiles` 被替换，`secrets/*.bin` 保持本机现状 | `backup-service.ts:143-179` |

> 后果：恢复后可能出现「provider 显示已启用，但密钥是另一台机器/另一个账号的」，或「备份里删除过的密钥没有复活」。这个不对称没有任何文档说明。

---

## 7. 迁移安全

| 性质 | 状态 | 证据 |
|---|---|---|
| 迁移前备份 | 有，仅当 `sourceVersion < CURRENT` | `database.ts:94,104-105`；备份实现 `:56-79` |
| 备份校验 | `integrity_check` + 版本相等 | `database.ts:15-26,68` |
| 失败保留备份 | 是 | `migrations.test.ts:157-158,201` |
| 成功后清理 | **是**，v33 起删掉所有 `*.pre-v*-to-v33-*.bak` | `database.ts:42-54,116-118` |
| 降级打开 | 有，锚点 `DEGRADED_OPEN_MINIMUM_VERSION = 9` | `database.ts:107-112`；`migrations.ts:1476` |
| 版本地板 | `<9` 或 `>CURRENT` 直接抛错 | `database.ts:113-115` |
| 只进不退 | 无 `down()`；目标版本小于当前即抛错 | `migrations.ts:1493` |
| 实现指纹 | `(version, name)` 必须完全匹配 | `migrations.ts:1496-1506` |
| 单迁移原子性 | `BEGIN IMMEDIATE` / `COMMIT` / 失败 `ROLLBACK` | `migrations.ts:1508-1524` |

**残余风险**：迁移成功即删备份，所以「旧文本仍可从该文件恢复」只在失败窗口内成立；恢复流程内部也会跑迁移（`backup-service.ts:377`），即 v9 备份会被静默升级后再交换。

---

## 8. 只写不读 / 只读不写（汇总）

| 表 / 列 | 状态 |
|---|---|
| `memory_consolidations` | 启动期写，**生产无读** |
| `pending_personality_candidates` | 写，**生产无读、无 IPC**，`expires_at` 不执行 |
| `companion_goals` | **生产无写**，每轮读 |
| `personality_growth_state.offset/evidence_count/last_turn_id` | 写，只读 `revision`/`updated_at` |
| `personalization_state.value/evidence_count/last_turn_id` | 同上 |
| `memory_importance.score` | 写，检索排序**不读**（只用于归档判定） |
| `personality_growth_events` | 写，读它的 `history()` 无生产调用方 |
| `interest_evidence.match_score/match_reason` | 写，只有测试读 |

---

## 9. 复现

```bash
grep -n "CREATE TRIGGER" src/persistence/migrations.ts
sed -n '750,760p' src/persistence/migrations.ts        # 删消息 → 删整条兴趣
sed -n '1298,1320p' src/persistence/migrations.ts      # interest_evidence 无 FK + UNIQUE(evidence_ref)
grep -rn "consolidations(" src --include=*.ts
grep -rn "companion_goals" src --include=*.ts
```
