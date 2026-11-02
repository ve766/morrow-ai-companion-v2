# Stage 5 最终收尾根因矩阵（F1–F5）

- 分支：`fix/stage-5-final-closeout`
- 起始 SHA：`9d54c6e02dea443f5b6911810327a9fa08c5353c`（PR #28 head）
- 代码提交：`80851cf1e4bf67332496c76955ecb390cc79140d`
- 行号以 `80851cf` 为准。

## 1. 根因 → 代码 → 测试

| 缺陷 | 根因（文件/函数/SQL） | 修复 | 回归测试 | 证据 |
|---|---|---|---|---|
| F1 删除残留 | v44 触发器只降级；v43 CHECK 不允许空值/空来源；`reconcile()` 未接入启动；历史孤儿无 backfill | v46 重建关系表（可空来源、`tombstoned_at`、条件 CHECK）；迁移 backfill；触发器 tombstone；`reconcile()` 清孤儿 + tombstone；`app/index.ts` 启动前 reconcile（fail-closed） | 测试 1–4（删除消息、删除会话、reconcile 幂等、v43→v46 backfill） | `src/app/stage5-final-closeout.integration.test.ts` |
| F2 入队时机 | relationship obligation 在 assistant `afterPersist` 才入队 | 用户消息 `afterPersist`（同一事务）入队 `module='relationship'`；assistant 只入队其余模块；下一轮/启动 drain；删除取消；`observe()` 校验来源 | 测试 5–9（Provider 失败、重启、pending 删除、重放、旧任务竞态） | 同上 |
| F3 distress 误判 | `distressSignal` 单字 `烦` 子串 + `tension >= 0.05` | `assessDistressEvidence()` E/C/T/D；显式情绪句式；线索类别；直接请求优先；旧 rationale 兼容 | `src/affective-state/distress-evidence.test.ts`（10 例正/负/边界） | 同上 + `src/app/stage5-presence.integration.test.ts` 更新 |
| F4 证据不一致 | 三份 PR #28 文档引用旧 run `41385531397` / 旧 head `e293656` | 统一为 `41386833397` / `9d54c6e`；新增 closeout 结果区分 code/docs/CI head | 文档逐文件核对（grep） | 见证据索引 |
| F5 外部验证 | 无真人评审、无第二 Provider 凭据 | 盲评包 + PENDING_HUMAN；第二 Provider NOT_RUN | 人工流程 | `human-review-packet.md` |

## 2. 事务边界与持久化点

| 步骤 | 位置 | 事务 | 失败语义 |
|---|---|---|---|
| 打开数据库/迁移 | `SqliteDatabase.open` → `applyMigrations` | 每个迁移 `BEGIN IMMEDIATE` | 迁移失败回滚并保留 recovery copy |
| 关系清理 | `app/index.ts` `relationships.reconcile()` | 单事务（证据删除 + tombstone + 事件） | 抛出 → 启动失败，不提供对话 |
| 用户消息 + obligation | `appendMessage(...,'user')` → `afterPersist` → `outbox.enqueue` | 同一 `database.transaction` | 任一失败 → 消息与 obligation 都不提交 |
| Provider 调用 | `sendChat` | 无写事务 | 失败 → 用户消息与 obligation 保留 |
| assistant 消息 + 其余 obligation | `afterPersist` | 同一事务 | 失败 → assistant 与其余模块不提交 |
| 关系投影 | `drainCognition` → `observe` | `database.transaction`（savepoint） | 失败 → 证据/线程/事件回滚，outbox pending |
| 删除消息 | `DELETE FROM messages` | 删除事务 | 触发器删证据、清指针、tombstone；outbox pending→cancelled |
| 备份恢复 | `backup.restore` → deletion replay → `relaunch` | staging 事务 + 重启 | 启动时 v46 backfill + reconcile |

## 3. 旧任务竞态

`supersedeIfStale(threadId, kind, value)`：

```
if 存在同 kind、value 不同、lastSeenAt > input.at 的 live 线程:
    older thread.status = 'superseded'
    older thread.supersedes_thread_id = newer.id
```

即使旧任务晚到，也不能与更新决定并列 active；证据保留供审计。

## 4. 迁移与回滚

| 迁移 | 内容 | 回滚 |
|---|---|---|
| v46 `relationship-deletion-tombstones` | 重建两张关系表；新增 `tombstoned_at`；backfill；新触发器 | 前向兼容：旧代码读到 tombstone 行（value=''）不会注入；如需彻底回滚，需重建 v43 表结构并恢复 v44 触发器（数据不可复活已删除内容） |

升级测试：`src/persistence/migrations.test.ts`（16/16），以及 closeout 测试中的
v43→CURRENT backfill 用例。

## 5. 不变量

1. 删除来源消息后，证据、线程 value、source/conversation 指针、pending obligation 全部失效。
2. tombstone 不含用户原文、称呼、承诺、话题内容或来源消息 ID。
3. 用户消息提交成功即代表 obligation 持久化；Provider 失败不改变这一点。
4. 同一消息重放不增加证据权重；旧任务不能覆盖更新决定。
5. 普通否定、工具性“麻烦”、直接请求都不触发 distress 安慰。
6. 真人评分与客观断言分开；第二 Provider 未真实执行不得标 PASS。
