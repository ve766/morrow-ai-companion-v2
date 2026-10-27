# Phase 2.2.3 — 人格反馈应用的一致性与恢复

- 实现：`FeedbackCandidateService.apply` / `recoverInterruptedApplications`
- 存储：`persona_feedback_applications`（v18）
- 测试：`feedback-candidate-service.test.ts`

## 1. 保证范围（先声明）

`SqliteDatabase.transaction` 使用 `BEGIN IMMEDIATE`，不可重入；`PersonalityService.save` 自己开事务。因此**不能**把「保存人格 + 更新应用记录」放进一个事务。

本实现提供的是：

- **至多一次**应用（唯一应用行）；
- 基于过期版本写入的拒绝（`baseVersion` 校验）；
- 失败可区分（`failed`）；
- 中断可识别（`applying → needs_review`）。

**不提供**「恰好一次」。人格保存与状态更新之间的崩溃窗口无法自动消除。

## 2. 状态机

```text
(无应用记录) --apply--> applying --成功--> applied
                              \--异常--> failed
                              \--崩溃--> needs_review（恢复时）
```

- `candidate_id` 唯一：同一候选只能有一行。
- 候选必须 `pending` / `supported`；`rejected` / `withdrawn` / `applied` → `CONFLICT`。
- `baseVersion !== currentVersion` → `CONFLICT`（拒绝基于过期人格写入）。
- `sensitive` 未授权 → `FORBIDDEN`。

## 3. 崩溃点

| 崩溃点 | 数据库状态 | 人格 | 恢复行为 |
|---|---|---|---|
| 插入 applying 前 | 无应用记录 | 未变 | 可重试 |
| 插入 applying 后、保存前 | `applying` | 未变 | `needs_review`，不自动重试 |
| 保存成功后、更新应用前 | `applying` | **可能已变** | `needs_review`，需人工核对 |
| 更新事务中 | 回滚为 `applying` | 已变 | 同上 |
| 更新后 | `applied` + 版本 | 已变 | 无需恢复 |

`recoverInterruptedApplications()` 只把 `applying` 标为 `needs_review`，**不重试**，因为无法判断保存是否发生。

## 4. 测试结果

| 场景 | 结果 |
|---|---|
| 保存前失败 | 候选 `supported`，应用 `failed`，人格未变 |
| 二次应用 | `CONFLICT` |
| 过期 baseVersion | `CONFLICT`，无应用记录，人格未变 |
| 中断的 `applying` | 重试 `CONFLICT`；恢复后 `needs_review` |
| 已拒绝候选应用 | `CONFLICT` |
| 回滚后审计 | 应用记录仍 `applied` + 原版本；人格历史仍含该版本 |
| 敏感未授权 | `FORBIDDEN` |

## 5. 对账能力

- `applicationFor(candidateId)` 返回应用状态与版本。
- `personality.history()` 可确认该版本是否存在。
- **没有**自动对账任务：不会扫描「人格已前进但应用仍 applying」并自动修复。

## 6. 无法消除的风险

1. 崩溃窗口内的「人格已变、应用未 applied」只能人工判断。
2. 若另一条路径在崩溃后修改人格，版本号无法证明是哪次写入。
3. 没有分布式锁；唯一索引是单进程 SQLite 下的锁。

## 7. 结论

| 项 | 状态 |
|---|---|
| 显式授权 | PASS |
| 并发至多一次 | PASS |
| 过期 baseVersion 拒绝 | PASS |
| 失败可区分 | PASS |
| 崩溃识别 | PASS（识别，不自动修复） |
| 恰好一次 | **FAIL**（明确不提供） |
| 自动对账 | **NEEDS_REVIEW**（未实现） |
