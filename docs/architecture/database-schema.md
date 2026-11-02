# 数据库 schema 索引（当前 v48）

单一索引；逐版本 SQL 与约束以 `src/persistence/migrations.ts` 为准。本文只记录
版本号、变更面与不变量，避免与迁移代码重复一份“第二实现”。

## 1. 版本与升级

| 版本 | 名称 | 变更面 |
|---|---|---|
| … | （历史） | 见 migrations.ts |
| v43 | relationship-threads | 关系线程 + 证据 |
| v44 | relationship-evidence-deletion-propagation | 删除触发器 |
| v45 | cognitive-outbox-relationship-module | outbox 允许 relationship |
| v46 | relationship-deletion-tombstones | tombstone、历史 backfill |
| v47 | effect-ledger-lease-generation | `lease_generation` fencing |
| **v48** | **pending-decision-terminal-state** | **pending item 的 `finding_id` + `decision`** |

- 每个迁移单事务；失败回滚；升级前自动快照（保留 2 份）。
- 升级测试：`src/persistence/migrations.test.ts`；备份恢复：`backup-service.test.ts`。
- 降级打开最低 v9；schema < v46 时启动跳过关系 reconcile（fail-closed 的等价降级）。

## 2. v48 变更

```sql
ALTER TABLE cognitive_pending_items ADD COLUMN finding_id TEXT
  CHECK (finding_id IS NULL OR length(finding_id) = 36);
ALTER TABLE cognitive_pending_items ADD COLUMN decision TEXT
  CHECK (decision IS NULL OR decision IN ('accepted','rejected','dismissed'));
CREATE INDEX cognitive_pending_items_finding_idx ON cognitive_pending_items(finding_id);
```

- 历史行两列为 NULL：仍可决策，只是没有可更新的 reflection route。
- 新 reflection 项由 router 传入 findingId；决策在同一事务更新 item + route。
- 不清空、不重写历史 finding/pending 行；升级失败保持原库可恢复。

## 3. 状态与不变量

`cognitive_pending_items.status`：`open | done | dropped`（既有）。
`decision` 记录终态选择；`reflection_finding_routes.status` 终态：
`consumed`（accepted）、`rejected`、`dismissed`。

- 同一决策重放幂等；相反决策 conflict；终态不因 ingest/重放复活。
- outbox：`cognitive_effect_ledger.lease_generation` fencing；旧代际 complete/fail 被拒绝。
- 关系：无证据线程 tombstone，不含 value/source 指针。
