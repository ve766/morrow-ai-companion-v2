# PR #40 运行链与事务追踪（Issue #45）

审计基线：`052bcaa9c0320ef5e726c7bf66df85a49055628d`
base：`3812b185398c0442fcc0d0ba5b180713cafee1d9`

本文只记录代码事实：调用链、状态机、事务边界、幂等键、失败分支与独立复现。
行号以审计基线为准。

## 1. 生产调用图

### 1.1 启动路径（Electron main）

```
app.whenReady()
 └─ SqliteDatabase.open(userData/morrow.sqlite3)                     src/app/index.ts:191
     ├─ 升级前 VACUUM INTO 备份 + applyMigrations                    src/persistence/database.ts:105-112
     └─ schemaVersion / cognitivePersistenceAvailable
 └─ EventLogService                                                 src/app/index.ts:192
 └─ composeStartupReflectionServices(database, eventLog)            src/app/index.ts:197
     ├─ MemoryImportanceService / FactMemoryService / MemoryService
     ├─ InterestService / SelfModelService
     ├─ ReflectionService(SqliteReflectionRepository, deps, events)
     ├─ PendingCognitionService(SqlitePendingItemRepository(database, events))
     └─ ReflectionFindingRouter({ database, pending, events })
 └─ factMemory.reindexAll()                                         src/app/index.ts:202
 └─ MemoryMaintenanceScheduler.start()                              src/app/index.ts:219
 └─ CompanionService({ ...selfModelLoop, continuity:{pending,...} }) src/app/index.ts:265-279
 └─ recoverInterruptedTurns() / drainCognition()                    src/app/index.ts:283/303
 └─ reminders.startScheduler()                                      src/app/index.ts:362
 └─ runStartupReflection({ reflection, findingRouter, logger })     src/app/index.ts:367
     ├─ reflection.run('startup')                                   src/app/startup-composition.ts:74
     │   ├─ canRun() 每小时最多 6 次                              reflection-service.ts:274-280
     │   ├─ events.listAfter(cursor) 最多 5×200                     reflection-service.ts:287-297
     │   ├─ producer: memory_gap/intent_correction/bias_hint/...
     │   ├─ open_question ← 单会话 knowledge_gap（pickOpenQuestionCandidate）
     │   └─ repository.transaction: run+finding+effect+cursor       reflection-service.ts:535-614
     └─ findingRouter.ingestRun(run.id, findings)                   startup-composition.ts:80
         └─ 每个 finding 一个 transaction                           reflection-routing.ts:165
 └─ createMainWindow()                                              src/app/index.ts:466
```

启动失败语义：
- `runStartupReflection` 只捕获 **routing** 异常（返回 `failed`，记 warn）；
- `reflection.run` 本身抛错会冒泡到 `app.whenReady().then(...).catch`，进入
  `reportStartupFailure` 并退出（P3-08；与改动前一致）。

### 1.2 手动反思（IPC）

```
renderer → preload selfModel.runReflection()
 → IPC morrow:selfmodel:reflection:run                              ipc.ts:273
 → Continuity? no: SelfModelActions.runReflection                    index.ts:449
 → runBounded(2s) { reflection.run('manual'); findingRouter.ingestRun(...) }
 → 成功: ReflectionRunSummary | {skipped}
 → 失败/超时: ApplicationError('STORAGE_ERROR')                     index.ts:460
```

### 1.3 对话后反思（outbox 投影）

```
ChatService 提交 assistant message
 → cognitive_outbox 一行 module='reflection'                          companion-service.ts:992-1001
 → CognitionOutbox.drain → projector.project()
     ├─ reflection.run('post_conversation')
     └─ findingRouter.ingestRun(run.id, findings)
 → 任一 throw: 该 row attempts+1；5 次后 failed（visibility: stats()） cognitive-outbox.ts:281-297
```

### 1.4 用户决策 pending item

```
renderer pending-ui.ts:67
 → window.morrow.continuity.decidePendingItem
 → preload invoke('morrow:continuity:pending:decide')                preload/index.ts:106
 → ipc handler: trusted sender + parsePendingItemDecisionRequest     ipc.ts:279
 → PendingCognitionService.decide(id, decision)                      pending-items.ts:323
 → SqlitePendingItemRepository.decide(id, decision, at)              cognitive-context-repository.ts:235
```

### 1.5 目标候选确认

```
renderer goal-candidates-ui.ts:104-112
 → window.morrow.companionGoals.acceptCandidate/rejectCandidate      preload/index.ts:148-149
 → ipc: trusted sender + parseGoalCandidateIdRequest                 ipc.ts:249-250
 → CompanionGoalService.decideCandidate(candidateId,'accept'|'reject') companion-goal.ts:338
 → SqliteDatabase.transaction
```

## 2. 契约表

### 2.1 路由唯一性

| 项 | 内容 |
|---|---|
| 输入 | `finding.kind`（producer 产生）、`REFLECTION_FINDING_KINDS`（domain 单一来源） |
| 前置条件 | `FINDING_ROUTES` 覆盖每一个 domain kind，无 fallback |
| 状态转换 | `routed → injected/expired/consumed/rejected/dismissed`；`pending_user` 只由用户决策收敛 |
| 事务边界 | 每个 finding：`database.transaction`（BEGIN IMMEDIATE 或 SAVEPOINT） |
| 失败分支 | 未知 kind → `reflection.finding_unroutable`（required audit）+ continue；route 已存在且 route 不一致 → `REFLECTION_ROUTE_MISMATCH`；pending/audit 失败 → 事务回滚 |
| 幂等键 | `reflection_finding_routes.finding_id` PK；audit key `reflection-routed:<findingId>` / `reflection-unroutable:<findingId>` |
| 持久化字段 | route/status/reason/run_id/kind/created_at/updated_at |
| 审计事件 | `reflection.finding_routed`、`reflection.finding_unroutable`（`recordDeterministic`，重复不抛） |
| 源码/测试 | `reflection-routing.ts:52-93,151-221`；`reflection-routing.test.ts` 14 用例 |
| 结论 | **通过**；但“同 statement 新 finding”破坏该契约（P1-01） |

### 2.2 pending 决策原子性

| 项 | 内容 |
|---|---|
| 输入 | `itemId`, `decision ∈ {accepted,rejected,dismissed}`, `at` |
| 前置条件 | 审计 sink 存在（否则 `PENDING_AUDIT_UNAVAILABLE`） |
| 状态转换 | open + accepted → done/consumed；open + rejected → dropped/rejected；open + dismissed → dropped/dismissed |
| 事务边界 | 单个 `database.transaction`：读 item → route 校验 → 条件 UPDATE item → 条件 UPDATE route（changes===1）→ audit |
| 失败分支 | not_found；terminal+same → unchanged；terminal+opposite → conflict；route 缺失/不可变 → throw（回滚）；route changes≠1 → `PENDING_ROUTE_UPDATE_FAILED`（回滚）；audit 抛错 → 回滚 |
| 幂等键 | 条件 UPDATE `WHERE id=? AND status='open'`；audit key `pending-decision:<id>:<decision>` |
| 持久化字段 | status/decision/completed_at/updated_at/reflection_finding_routes.status |
| 审计事件 | `pending.decision`（ids/decision/itemStatus/routeStatus/source，无原文） |
| 源码/测试 | `cognitive-context-repository.ts:235-287`；`reflection-routing.test.ts` 终态/回滚/缺失/legacy/audit 用例 |
| 结论 | **新记录通过**；legacy 行 route 不收敛（P2-03），legacy audit 的 routeStatus 可能不实（P3-12 相关） |

### 2.3 决策幂等性

| 项 | 内容 |
|---|---|
| 同决策重放 | item.status !== 'open' 且 item.decision === decision → `{status:'unchanged'}`，**不写 audit、不改 route**；`reflection-routing.test.ts:185` |
| 相反决策 | `{status:'conflict', current}`，数据库不变 |
| 并发 | 单连接同步 API；Electron 单实例锁；SQLite `BEGIN IMMEDIATE` + `busy_timeout=5000`；两窗口 IPC 在主进程串行 |
| 结论 | **通过** |

### 2.4 候选互斥与来源有效性

| 项 | 内容 |
|---|---|
| 输入 | `candidateId`, `accept|reject` |
| 前置条件 | candidate 存在；accept 要求 `source_state='live'` 且 `messages` 中存在源消息 |
| 状态转换 | pending → accepted（+ companion_goals active）；pending → rejected；pending → expired（来源失效）；accepted/accepted 重放 → 同 goal；其他终态 → conflict |
| 事务边界 | `decideCandidate` 单个 transaction：读 candidate → 终态判断 → 来源校验 → createInner(goal+creation key) → UPDATE candidate → `recordCandidateEvent` |
| 失败分支 | not_found；conflict(current)；source_unavailable（persist expired/source_deleted 后返回）；audit 抛错/未写入 → `GOAL_CANDIDATE_AUDIT_FAILED` 并回滚 goal/candidate/key |
| 幂等键 | `goal_creation_keys.idempotency_key = goal:candidate:<id>`；`goal_candidates(id)` PK；audit key `goal-candidate:<id>:<outcome>` |
| 持久化字段 | goal_candidates.status/source_state/updated_at；companion_goals；goal_creation_keys；event_journal |
| 审计事件 | `goal.candidate_decision`（outcome/owner/due set|none，无标题/正文） |
| 源码/测试 | `companion-goal.ts:338-439`；`goal-lifecycle.test.ts` 33 用例（含 A 组 5） |
| 结论 | **通过**；接受后来源消息删除由 trigger `goal_candidates_source_deleted` 取消 goal（migrations.ts:2006+） |

### 2.5 证据完整性

| 项 | 内容 |
|---|---|
| 全量 | 111 files / 1042 tests（本审计独立执行，见 test-and-ci 文档） |
| 定向 | 8 files / 96 tests；PR 声称的 7 files / 85 已按同集合复现 |
| 迁移 | v48 在 CI 的 `src/persistence` 7/59 中执行；无 v47 fixture（P2-02） |
| Eval | 24 个结果文件 SHA 与文件名一致；历史结果未改写；live 未重跑 |
| 结论 | **PASS（附 P2-02/P2-04/P2-05 证据缺陷）** |

## 3. 事务实现事实

`SqliteDatabase.transaction`（`src/persistence/database.ts:142-163`）：

- 顶层：`BEGIN IMMEDIATE` / `COMMIT`；嵌套：`SAVEPOINT morrow_sp_<depth>` / `RELEASE`；
- 异常：顶层 `ROLLBACK`，嵌套 `ROLLBACK TO` + `RELEASE`；rollback 失败包装为
  `Local storage operation failed.`；
- 单 `DatabaseSync` 连接（默认非线程并行），所有 repository 共享同一连接；
- `decide`/`decideCandidate`/`ingestRun` 均由同一个 `database` 实例进入事务；
- `EventLogService.recordDeterministic` 是同一连接上的普通 INSERT（ON CONFLICT DO NOTHING），
  不另开事务，因此不会出现“审计写入独立提交”；
- `reflection.run` 在投影器/手动入口是顶层事务；`ingestRun` 在其之后是独立顶层事务
  （post-conversation 路径不是同一事务，这是 P1-01 影响放大的原因之一）。

## 4. 失败、重放、并发与重启矩阵

| 场景 | 实际行为 | 证据 |
|---|---|---|
| 同一 finding 重复 ingest | 已存在 route → 直接 return；不重复 pending/audit | `reflection-routing.ts:169-174`；测试 `routes kinds…` |
| 同 statement、不同 finding | `PENDING_LINK_MISMATCH`，route/pending/audit 回滚；finding 已落库且 cursor 前移 → 永久 unroute | 本文附录 A 复现 |
| pending 插入失败 | route/audit 同时回滚（ABORT trigger） | `rolls the route back…` |
| route 终态写入失败 | item 回滚为 open，decision NULL | `rolls the item back…` |
| 审计写失败 | item/route/goal/candidate 回滚 | `requires a durable audit sink`；A 组 |
| 审计返回 inserted=false 且事件不存在 | companion goal 回滚；pending decide 不检查（key 由 decision 决定，重复不可能改变状态） | `goal-lifecycle` A 组；`cognitive-context-repository.ts:276` |
| 相反决策 | conflict，不覆盖 | 测试 |
| accept vs reject | 单终态，另一方向 conflict | `accept vs reject…` |
| 来源消息删除 | trigger 先把 pending candidate → expired/source_deleted、active goal → cancelled；decide 再校验 | `migrations.ts:2006-2016`；`a disappeared source…` |
| 应用重启 | 状态全在 SQLite；无进程级 candidate/pending/route/audit 重启测试（P2-04） | 代码 + 测试缺口 |
| 双窗口/双击 | 按钮禁用 + 服务端条件 UPDATE；主进程串行 | `goal-candidates-ui.ts:100-118`；`decideCandidate` |
| DB busy | `busy_timeout=5000`；无 busy 注入测试 | `database.ts:100` |
| 降级 schema < v48 | pending upsert/decide 引用不存在列；finalization catch 静默丢草稿（P3-11） | `database.ts:110-119`；`cognitive-context-repository.ts:148-181` |

## 5. 安全边界追踪

```
renderer (contextIsolation, no nodeIntegration)
  → preload contextBridge (Object.freeze bridge)                    preload/index.ts:66-175
  → ipcMain.handle(channel)                                         register-ipc.ts
  → execute(): isTrustedSender(event, trustedRendererUrl)           ipc.ts:205-218
      - senderFrame === sender.mainFrame
      - isTrustedRendererUrl(senderFrame.url)
  → parse(payload) strict: parseObject(allow-list) + UUID
  → action() → service → SQLite
  → IpcResult 统一错误映射（不泄漏路径/密钥/原文）
```

- 新 channel 全部经过同一 `execute`，无单独 handler；
- 候选/决策只接受 `candidateId`/`itemId` + enums，未知字段被 `parseObject` 拒绝；
- renderer 不直接 import Node/SQLite；`goal-candidates-ui.ts` 只调用 bridge；
- 审计 payload 只含 ID/状态/decision/owner/due 标志，不含 finding 原文、候选标题或消息正文；
- 关联来源：候选 accept 在事务内校验 `messages` 存在；goal 的 trigger 在源消息删除时
  取消 active/paused goal。

## 6. v47 → v48 升级独立复现

脚本（本地审计目录，未提交）：

```ts
applyMigrations(raw, 47)                    // 真实 v47 库
// 插入 reflection_runs/finding/route + cognitive_pending_items(open)
applyMigrations(raw)                        // → 48
// 断言：行保留；finding_id/decision=NULL；索引存在
SqliteDatabase.open(path)                   // 生产边界
pending.decide(itemId, 'accepted')
```

实际输出：

```text
v47 columns  [... ,"completed_at"]
upgrade target 48 current const 48
rows after upgrade [{"id":"3333…","status":"open","finding_id":null,"decision":null}]
v48 columns  [...,"finding_id","decision"]
indexes      [...,"cognitive_pending_items_finding_idx"]
decide       {"status":"decided","decision":"accepted","itemStatus":"done"}
item after   [{"id":"3333…","status":"done","decision":"accepted","finding_id":null}]
route after  [{"finding_id":"2222…","status":"routed"}]   ← P2-03
```

结论：v48 加列迁移本身安全、可重复、行不丢失；旧项可决策；但旧 route 不会被收敛。

## 7. 附录 A：P1-01 复现脚本与输出

脚本 `repro-duplicate-label.ts`（审计本地，未提交）：

```ts
const services = composeStartupReflectionServices(database, events)
gap('量子计算')                       // knowledge_gap + gap ledger
runStartupReflection(services)        // run1: ran, F1 + route + item
gap('量子计算')                       // 第二次 gap（同 label、同会话）
runStartupReflection(services)        // run2: failed（PENDING_LINK_MISMATCH）
// 另：两次 manual run，第二次 correction 新证据 → 同一错误
```

实际输出（节选）：

```text
run1 {"status":"ran"}
findings1 [F1 open_question]
items1    [P finding_id=F1]
routes1   [F1 routed]
run2 {"status":"failed"}
findings2 [F1, F2 open_question]      # F2 dedupe_key 不同
items2    [P finding_id=F1]
routes2   [F1 routed]                 # F2 无 route
routed_audits 1
manual findings [memory_gap, intent_correction F3]
manual ingest ok
manual findings [intent_correction F4]
manual ingest error PENDING_LINK_MISMATCH
```

根因链：`dedupeKeyOf`（finding）包含 evidence refs → F2 新 id；`pendingItemFromReflection`
（item）只用 statement digest → 命中 P（F1）；`ingestRun` 把“item 已链接别的 finding”
视为不可恢复错误 → 抛错。

推荐修复见主报告 AUD45-P1-01。
