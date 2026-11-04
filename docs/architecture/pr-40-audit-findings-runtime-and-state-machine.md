# PR #40 审计发现修复：运行链与状态机（Issue #47）

代码 SHA：`dd9f59b10c7c812c3af36684a32d15193bda7d50`
修复分支：`fix/pr-40-audit-findings`（base `feat/stage-4-companion-confirmation-closure`）

## 1. 调用图

### 1.1 启动

```
app.whenReady()
 └─ SqliteDatabase.open(path)                    # v48；失败则降级到 >=9
 └─ EventLogService
 └─ composeStartupReflectionServices(database, events)
     ├─ MemoryService / InterestService / SelfModelService
     ├─ ReflectionService
     ├─ PendingCognitionService(SqlitePendingItemRepository(database, events))
     └─ ReflectionFindingRouter({database, pending, events})
 └─ runStartupReflection({reflection, findingRouter, logger})
     ├─ reflection.run('startup')
     │    └─ transaction: run + findings + effects + cursor
     ├─ findingRouter.ingestRun(run.id, findings)    # 每个 finding 一个事务
     ├─ findingRouter.recoverUnrouted()              # 历史/中断遗留
     ├─ recordLifecycle(reflection.startup_result|failed)
     └─ returns ran | skipped | failed | degraded
 └─ 主窗口、IPC 注册等（不受非致命反思故障阻断）
```

### 1.2 手动反思

```
IPC morrow:selfmodel:reflection:run
 → runBounded(2s) { reflection.run('manual'); findingRouter.ingestRun(...) }
 → 成功: ReflectionRunSummary | skipped
 → 失败: ApplicationError('STORAGE_ERROR')
```

### 1.3 对话后反思（outbox）

```
CognitiveOutbox.drain
 → projector('reflection')
     ├─ reflection.run('post_conversation')
     ├─ 成功: ingestRun(...)
     ├─ skipped: recoverUnrouted()
     ├─ schema < v48: recoverUnrouted() 抛 PendingSchemaUnavailableError
     │                → 记录 cognition.pending_schema_unavailable
     │                → findings 保留，升级后 startup recover 路由
     └─ 其它错误: 抛出 → outbox 按模块重试（5 次后 failed）
```

### 1.4 用户决策 pending item

```
renderer pending-ui.ts
 → preload continuity.decidePendingItem
 → ipc trusted sender + parsePendingItemDecisionRequest
 → PendingCognitionService.decide → SqlitePendingItemRepository.decide
 → transaction:
     read item
     if finding_id: route 存在且可变 → 更新 route（changes=1）
     else: resolveLegacyRoutes(item)（按 statement digest 证明）
     UPDATE item status/decision（WHERE status='open'）
     audit pending.decision（routeStatus/routeResolution/routesUpdated）
```

## 2. Concern identity 与 finding 身份

```
normalizeConcern(s):
  NFKC
  移除零宽字符
  空白折叠 + trim
  受控全角标点 → ASCII（，。！？；：（）【】、“”‘’、）
  标点邻接空白移除
  ASCII 小写
  （不删除否定/时间/实体/数值/主体/谓词）

concernKey = SHA-256("concern:v1|kind|normalizeConcern(statement)")
```

- 适用 kind：`memory_gap`、`open_question`、`intent_correction`、`consistency_note`
  （`CONCERN_KINDS`）。
- 其它 kind（`interest_candidate`、`morrow_interest_candidate`、`bias_hint`、
  `next_turn_suggestion`）仍使用 kind + statement + evidence refs 的完整身份：
  它们的效果消费具体 evidence，合并会改变证据归属。
- `dedupeKeyOf` 的 concern 分支直接返回 concernKey；`CONCERN_IDENTITY_VERSION = 1`。

### 2.1 同一关切的第二次观察

```
ingestFinding(runId, finding):
  transaction:
    existing route?
      same route → return（幂等）
      different → REFLECTION_ROUTE_MISMATCH
    pending_user?
      item = findReflectionConcern(kind, statement)   # 当前 + legacy key
      item && item.findingId && != finding.id:
        recordDeterministic("reflection-reobserved:<id>",
          { findingId, existingFindingId, pendingItemId, kind, concernKey })
        return                                    # 显式归档，不插 route
    INSERT route
    pending_user: absorbReflection → 复用/创建唯一 item；adopt finding_id
    recordDeterministic("reflection-routed:<id>", ...)
```

- 结果：同一关切只有一个 pending item、一个 route（首次 finding）；后续 finding 有
  durable 归档事件，没有悬挂 route，也不阻断后续 findings。
- `recoverUnrouted` 排除已归档（`reflection.finding_reobserved` 中 findingId 匹配）
  的 finding，避免每次启动重复处理；未路由的正常 finding 会被重放。

## 3. Pending 决策状态机

```
item.status:  open | done | dropped
item.decision: null | accepted | rejected | dismissed
route.status: routed | injected | used_observed | not_observed | consumed | expired | rejected | dismissed

open + accepted  → done    / route consumed
open + rejected  → dropped / route rejected
open + dismissed → dropped / route dismissed
terminal + same decision  → unchanged（不写 audit、不改 route）
terminal + opposite       → conflict（不覆盖）
unknown id                → not_found
```

- 新 item（finding_id 非空）：route 缺失 → `PENDING_ROUTE_MISSING`；
  route 不可变 → `PENDING_ROUTE_STATE_CONFLICT`；route 更新 0 行 →
  `PENDING_ROUTE_UPDATE_FAILED`；均回滚 item。
- legacy item（finding_id NULL）：
  - 解析 dedupe key 为 `reflection:<kind>:<digest>`；
  - 对同 kind 的可变 route，计算 statement 的当前/legacy digest，只收敛匹配项；
  - 0 匹配 → 不改 route，audit `routeStatus: null, routeResolution: 'unresolved'`；
  - 多匹配（同一 statement）→ 全部收敛（同一关切），audit `routesUpdated = n`。
- 审计 payload 只有 decision/itemStatus/routeStatus/routeResolution/routesUpdated/source，
  无 finding 原文。

## 4. 事务边界

| 路径 | 事务 | 失败 |
|---|---|---|
| `ReflectionService.run` | 单事务：run/findings/effects/cursor | 回滚；cursor 不前移 |
| `ingestFinding` | 单事务：route + pending + audit | 回滚该 finding；其它 findings 继续 |
| `ingestRun` 失败隔离 | 每个失败写 `finding_ingest_failed` | 审计不可用则中止 |
| `recoverUnrouted` | 每条 finding 走 `ingestRun` | 单条失败计数，继续 |
| `decide` | 单事务：item + route(s) + audit | 回滚 item/route/audit |
| goal candidate | 单事务：candidate + goal + key + audit | 回滚 |
| `SqliteDatabase.transaction` | 顶层 BEGIN IMMEDIATE；嵌套 SAVEPOINT | 回滚 |

单连接（`DatabaseSync`）+ Electron 单实例锁 + `busy_timeout=5000` 是并发串行的基础；
没有跨连接事务。

## 5. Cursor / outbox 恢复

- `reflection.run` 的 cursor 在 run 事务最后提交；ingest 在其后。
- 失败 finding 不把 cursor 回退（避免重复 effect），而是依靠：
  1. `reflection.finding_ingest_failed` durable 记录；
  2. `recoverUnrouted` 在 startup / 限流 outbox 重试时重放；
  3. re-observation 的确定性归档事件避免无限重试。
- outbox 的 effect ledger/lease 语义未改；reflection 模块失败仍按 5 次重试，
  限流分支先 recovery，避免“row done 但 finding 未路由”。

## 6. Schema 与降级

- 仍为 v48；无新迁移。
- v47→v48 测试：open/done pending + finding/route，升级后行保留、列为 NULL、
  索引存在、完整性检查通过、生产 decide 可决策。
- `schemaVersion < 48`：
  - `upsert`/`decide` 抛 `PendingSchemaUnavailableError`（`SCHEMA_UPGRADE_REQUIRED`）；
  - IPC 映射为 `SCHEMA_UPGRADE_REQUIRED`；
  - `ChatService.applyFinalization` 跳过 pending 草稿并记录 degradation；
  - startup `degraded/schema_upgrade_required`；
  - 主聊天继续可用，待确认能力显式不可用，升级后可 recovery。

## 7. 证据元数据

```
readGitMetadata():
  branch        ← git rev-parse --abbrev-ref HEAD（HEAD/空 → null, detached）
  branchReason  ← ok | detached | git_unavailable | command_failed
  commit        ← MORROW_EVAL_SHA 或 git rev-parse HEAD（失败 unknown）
  workingTree   ← clean | dirty | unknown
```

stage-5/4a 的 scripted 与 live payload 均使用该结果；旧结果文件不改写。
