# Phase 2.2.2 — 人格应用的一致性、并发与恢复

## 1. 事实前提

- `SqliteDatabase.transaction` 使用 `BEGIN IMMEDIATE`，**不可重入**。
- `PersonalityService.save` 自己开事务。
- 因此不能把「保存人格 + 更新候选」包成单个事务。本轮不声称原子性，而是用**应用状态机 + 唯一锁行**保证至多一次。

## 2. 状态机

```text
candidate: pending | supported --apply--> applied
application: (无) -> applying -> applied
                        \-> failed
                        \-> needs_review (崩溃恢复)
```

- `persona_feedback_applications.candidate_id` **唯一**：同一候选只能有一行应用记录。
- 状态只能是 `applying / applied / failed / needs_review`。
- 候选只有在 `pending` / `supported` 时可应用；`rejected` / `withdrawn` / `applied` 一律 `CONFLICT`。
- `sensitive` 候选必须 `includeSensitive: true`，否则 `FORBIDDEN`。

## 3. 执行顺序与失败窗口

1. 插入 `applying` 行（含 `base_personality_version`）。
2. 调用外部 `apply(candidate)` → 真正保存人格，返回新版本。
3. 事务内：应用行 → `applied` + 版本；候选 → `applied` + 版本。

失败处理：

| 失败点 | 结果 |
|---|---|
| 第 1 步冲突 | `CONFLICT`，人格未变 |
| 第 2 步抛错 | 应用行 → `failed`，候选仍 `supported`，人格未变 |
| 第 2 步返回非法版本 | 应用行 → `failed`，候选仍 `supported` |
| 第 2 步成功后、第 3 步前崩溃 | 应用行停在 `applying`，候选仍 `supported`，**人格可能已变** |
| 第 3 步事务失败 | 回滚，应用行仍 `applying`（同上） |

**崩溃窗口是真实存在的**：进程若在第 2 步后死亡，无法从数据库判断人格保存是否发生。`recoverInterruptedApplications()` 把 `applying` 标记为 `needs_review`，不自动重试；后续 `apply` 因已有应用行而 `CONFLICT`。这是「至多一次 + 人工核对」，不是「恰好一次」。

## 4. 测试

| 场景 | 结果 |
|---|---|
| 保存前失败 | 候选 `supported`，应用 `failed`，人格未变 |
| 重复提交 / 二次应用 | 第二次 `CONFLICT` |
| 进程停在 `applying` | 再次应用 `CONFLICT`；恢复后 `needs_review` |
| 已撤回候选并发应用 | 状态检查 → `CONFLICT` |
| 回滚与旧应用 | 回滚写新版本，不覆盖历史；应用记录保留 |

## 5. 未做

- 没有自动对账「人格版本已前进但应用行仍是 applying」的机制；需要人工确认后手动处理。
- 没有分布式锁；单进程 SQLite 前提下，唯一索引是锁。
