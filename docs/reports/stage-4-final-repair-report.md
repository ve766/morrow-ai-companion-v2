# Stage 4 最终修复报告（Issue #42）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4-companion-confirmation-closure`（继续 PR #40）
- 基线：PR #40 head `65d52daa9b2ba80898518c02999268609d8eb070`；base `release/morrow-v2-final-delivery`
- 代码 SHA：`1ab1f64d561ab241e3a9321167f7dbc6c607f1b4`（审查修复提交 `b7299179…` + 死代码清理）
- PR：[#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40)（OPEN、未合并；base/head 未改）

## 1. 审阅差异逐项核验

| # | 审阅点 | 实际行为 | 状态 |
|---|---|---|---|
| 1 | accept 后是否刷新正式目标 | 原代码只 `loadCandidates()`；且 companion goal 与 `goals.list()` 是不同实体 | **FIXED** |
| 2 | pending decide 的 route changes / 缺失 / NULL 兼容 | 原实现更新 route 但不检查 changes；缺 route 时 item 仍提交；NULL 项静默跳过 | **FIXED** |
| 3 | 旧 `completePendingItem` 是否绕过统一事务 | 通道/preload/action/service 均存在，可只把 item 置 done，绕过 decision/route/audit | **FIXED（整链移除）** |
| 4 | `ingestRun` route 与 pending 是否原子 | 原实现 route INSERT 后调用 absorbReflection，不在同一事务；pending 失败会留悬挂 route | **FIXED（逐 finding 事务）** |
| 5 | startup `reflection.run` 是否进入统一 router | 只在 manual IPC 与 post-conversation projector 调用 ingestRun；startup 未调用 | **FIXED（startup 接入）** |
| 6 | Fake DOM 是否唯一 UI 证据 | 原测试只有 DOM stub；没有真实 service/SQLite/IPC 纵向路径 | **FIXED（新增真实装配测试）** |
| 7 | `open_question` 真实 producer | 域/迁移/映射支持，但 reflection-service 从未产生该 kind；此前仅测试直接构造 | **FIXED（新增最小 producer）** |

## 2. 修复内容

### 2.1 Pending 决策唯一权威路径

- `SqlitePendingItemRepository.decide()`：
  - 先要求审计 sink；缺失 → `PENDING_AUDIT_UNAVAILABLE`（不写 item）。
  - 新记录（`finding_id` 非空）：route 必须存在且状态属于
    `routed/injected/used_observed/not_observed`；否则 `PENDING_ROUTE_MISSING` /
    `PENDING_ROUTE_STATE_CONFLICT`，事务回滚。
  - item 条件更新（`status='open'`）→ route 终态更新 → **changes 必须为 1**，否则
    `PENDING_ROUTE_UPDATE_FAILED` 回滚。
  - 历史 `finding_id IS NULL`：按明确兼容路径只更新 item（注释、测试、报告一致）；
    新记录不会走该路径。
  - 审计 `pending.decision` 在事务内，失败回滚。
- 旧 `completePendingItem` 从 contracts/preload/ipc/index/CompanionService 全部移除；
  测试断言通道未注册（`morrow:continuity:pending:complete` → undefined）。
  `PendingCognitionService.complete/drop` 仅保留为仓库层内部/测试原语，不再有 IPC 暴露。

### 2.2 反射 ingestion 原子化

`ReflectionFindingRouter.ingestRun()` 每个 finding 一个事务：

```
existing route? same route -> return (idempotent; terminal not re-absorbed)
               different route -> REFLECTION_ROUTE_MISMATCH
insert route
pending_user: absorbReflection -> assert pending.findingId === finding.id
              (legacy NULL adopts findingId; mismatch -> PENDING_LINK_MISMATCH)
recordRequired(reflection.finding_routed)  // failure rolls back route+item
```

未知 kind 仍写 required `reflection.finding_unroutable`，不猜测路由。

### 2.3 启动反思接入统一入口

`src/app/index.ts` 的 `reflection.run('startup')` 成功时调用
`findingRouter.ingestRun(...)`，与 manual/post-conversation 共用同一路由与事务；
失败只记录警告，不阻塞应用启动，不伪造 pending。

### 2.4 open_question 最小真实 producer

`ReflectionService` 新增：当同一个 knowledge-gap label 只出现在**一个会话**时，
产生 `open_question` finding（两个会话仍由 `morrow_interest_candidate` 处理）。
证据只来自 `cognition.knowledge_gap`（Morrow 自己的 grounding 失败），
普通陈述、用户偏好、引用、假设不会产生该 finding；标签沿用现有 artifact 过滤。
finding 进入 `pending_user` 路由，等待用户确认是否值得继续。

### 2.5 正式目标视图

- 数据模型事实：候选/接受写入 `goal_candidates` + `companion_goals`；
  `window.morrow.goals.list()` 读取的是任务执行 `GoalService.goals`，**两者不同源**。
- 新增 `companionGoalsList` IPC/preload `listGoals()`，在候选面板下方渲染
  “已确认的长期目标”（标题、owner、期限、状态），类型安全适配，不复制影子数据。
- accept 后并行刷新：候选列表 + 正式 companion 目标列表 + 既有 `goals-ui`
  的 `refreshGoalViews()`；reject 只刷新候选。
- 正式任务目标区域保持原语义，UI 文案明确两类实体不同。

## 3. 事务边界与失败语义

| 路径 | 事务 | 失败 |
|---|---|---|
| pending decide | item + route + audit 同事务 | route 缺失/不可变/更新 0/审计失败 → 全部回滚 |
| reflection ingest | route + pending + audit 同事务 | pending 插入失败 → route/audit 不落库 |
| goal accept | source 校验 + goal + candidate + audit 同事务 | 来源失效 → 持久 expired 后返回 source_unavailable |
| goal reject | candidate + audit 同事务 | 幂等/冲突，不建 goal |

## 4. 并发、重放与重启

- 同 decision 重放 → `unchanged`；相反 decision → `conflict`。
- accept/reject 竞争由 SQLite 写事务串行化，只留一个终态。
- rejected/dismissed 的 route 不会被 re-ingest 复活（existing route 直接 return）。
- 所有状态在 SQLite；重启后 candidate/goal/pending/route/audit 一致
  （服务测试 + 真实 DB 文件验证）。

## 5. 测试与命令（最终代码 SHA `1ab1f64`）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 110 文件 / **1034 测试通过** |
| 定向 7 文件 | 0 | **88/88** |
| `npm run eval:stage5` / `:live` | 0 | 12/12 / 12/12 |
| `npm run eval:stage3` / `:stage4a` | 0 | 15+1NOT_RUN/16 / 7/7 |
| `npm run build` | 0 | 成功 |

关键新增/更新：
- `reflection-routing.test.ts`：原子 rollback、route 缺失拒绝、legacy NULL 兼容、
  审计必需、open_question 链接、终态/幂等/conflict。
- `stage4-reflection-producer.integration.test.ts`：真实 knowledge-gap → startup/manual
  producer → open_question → router → pending → decision → consumed + audit（真实 SQLite）。
- `stage4-goal-candidate-e2e.test.ts`：真实 service + IPC handlers + SQLite，
  list/accept/reject/listGoals 端到端；拒绝不建 goal。
- `goal-candidates-ui.test.ts`：真实 preload bridge（DOM stub），accept 后正式目标列表出现。
- `ipc.test.ts`：旧 complete 通道未注册；decide 通道校验/授权。

## 6. 未完成 / 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED（环境；CI 另列） |
| AUD-04 备份 revision 错位、AUD-08 删除残留 | 不在本任务范围，保留 |

未把外部状态写成 PASS；未合并 PR #35/#40，未改 main。

## 7. 风险

- 旧 `complete` 仓库方法仍存在但无 IPC 暴露；若未来内部调用，会绕过 decision 语义。
  已在注释与验收矩阵标注，建议后续仅保留 `decide`。
- open_question producer 只覆盖单会话 knowledge gap；更多问题类型仍属未来工作，
  不在本任务扩大。

## 8. Issue #43 最终收口（追加章节，历史保留）

- 代码 SHA：`294dcd50c64ee5af2d99cca47dd8a0e6669539b8`
- **A 审计强制**：`CompanionGoalService` 的 `GoalAuditSink` 为必需构造依赖；
  accept/reject/source_unavailable 的审计与 candidate/goal/creation key 同事务，
  审计抛错或未写入（inserted=false 且 DB 无事件）都会回滚。所有构造点已注入真实
  EventLogService 或显式失败 fake；`@ts-expect-error` 锁定编译期契约。
- **B 真实 startup 装配**：新增 `src/app/startup-composition.ts`
  （`composeStartupReflectionServices` + `runStartupReflection`），
  `src/app/index.ts` 使用同一函数；新集成测试调用生产函数（不自行调用
  `reflection.run`/`router.ingestRun`），用真实 SQLite 验证 finding/route/pending/
  audit 一致、无 finding 安全、ingest 失败无部分提交。
- 回归：111 文件 / 1042 测试；定向 85/85；Stage 5 scripted/live 12/12；Stage 3
  15+1NOT_RUN/16；Stage 4-A 7/7；build 0。详细根因见
  `docs/reports/stage-4-final-audit-closure.md`。
