# Stage 4 迁移验证（v48）

本任务没有新增迁移；PR #40 已包含 v48 `pending-decision-terminal-state`。
本文件记录该迁移在最终代码 SHA 下的升级/恢复验证。

## 1. v48 内容

```sql
ALTER TABLE cognitive_pending_items ADD COLUMN finding_id TEXT
  CHECK (finding_id IS NULL OR length(finding_id) = 36);
ALTER TABLE cognitive_pending_items ADD COLUMN decision TEXT
  CHECK (decision IS NULL OR decision IN ('accepted','rejected','dismissed'));
CREATE INDEX cognitive_pending_items_finding_idx ON cognitive_pending_items(finding_id);
```

- 历史行保留，两列为 NULL；旧项仍可决策。决策时按 item 的 statement digest 匹配可证明的 route 并收敛（`routeResolution: resolved_by_concern`）；无法证明时 audit 记录 `routeStatus: null / unresolved`，不伪造 route 终态。
- 升级失败自动 ROLLBACK；升级前 `VACUUM INTO` 快照（保留 2 份）。

## 2. 验证

| 项 | 命令/测试 | 结果 |
|---|---|---|
| 干净库 v1→current | `src/persistence/migrations.test.ts` | PASS |
| v47→current（含已有 open/done pending 行、reflection run/finding/route） | `src/persistence/migrations.test.ts` → `upgrades a v47 database with pending items and keeps them decidable` | PASS（代码 SHA 见修复报告） |
| 迁移事务失败回滚 | 同上（migration failure cases） | PASS |
| schema 版本 | 测试断言 `CURRENT_SCHEMA_VERSION`（48） | PASS |
| 备份恢复 | `src/persistence/backup-service.test.ts` | PASS |
| 重启后候选/目标/pending/route/audit | `src/app/stage4-restart-consistency.integration.test.ts`（真实文件关闭/重开） | PASS |

## 3. 回滚

- v48 为加列迁移，旧代码可读（忽略新列）；如需彻底回滚需重建表并保留历史行。
- 不回退 schema version；不删除历史 finding/pending 行。
