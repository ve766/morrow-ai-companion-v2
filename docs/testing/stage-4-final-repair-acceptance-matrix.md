# Stage 4 最终修复验收矩阵（Issue #42 + Issue #43 增量）

> **版本/轮次说明（Issue #44 追加）**
> - **§1–§8 是 Issue #42 的历史验收记录**：绑定代码 SHA `1ab1f64d…`、110 文件 / 1034 测试、
>   定向 88/88；这些数字是当时的事实，保留原样，不代表当前最终基线。
> - **§9 是 Issue #43 的增量验收**：绑定代码 SHA `294dcd50c64ee5af2d99cca47dd8a0e6669539b8`，
>   A 组 5 个 test case、B 组 3 个 test case；全量 111 文件 / 1042 测试、定向 85/85。
> - **CI 证据**绑定 evidence HEAD `9384eb9781341c8434605f2e15bd1a3cbb2ef615`：
>   run [41667548702](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41667548702)，
>   三个 job 全部 success。

## 0. 当前最终基线快照（仅供索引，不替代历史记录）

| 项 | 值 |
|---|---|
| PR | [#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40)，OPEN、未合并，base `release/morrow-v2-final-delivery` |
| 代码 SHA | `294dcd50c64ee5af2d99cca47dd8a0e6669539b8` |
| evidence HEAD | `9384eb9781341c8434605f2e15bd1a3cbb2ef615` |
| 当前测试 | 111 文件 / 1042 测试；定向 85/85 |
| CI | run 41667548702，head `9384eb9`，success（ubuntu/windows typecheck+tests+build+smoke、Windows upgrade path） |
| 外部项 | humanReview=PENDING_HUMAN；secondProvider=NOT_RUN；realMachineInstall=PENDING_HUMAN；localElectronSmoke=BLOCKED_ENV |

代码 SHA `1ab1f64d…`（§1–§8）与 `294dcd5…`（§9 起）的机器结果分别按各自 SHA 归属；
`evals/stage-4-companion-confirmation/results/` 中的历史 JSON 未被覆盖。

## 1. 审阅差异（报告 vs 代码）

| 项 | 测试/证据 | 状态 |
|---|---|---|
| accept 刷新正式目标 | `goal-candidates-ui.test.ts`（accept 后 `formal` 有 1 项；`refreshGoalViews` 调用）；`stage4-goal-candidate-e2e.test.ts` accept→`listGoals` | FIXED |
| companion goal 与 goals.list 不同源 | 报告 §2.5；e2e `listGoals` 返回 companion goal；`goals-ui` 任务目标未混入 | FIXED（显式适配） |
| pending decide route changes/缺失/NULL | `reflection-routing.test.ts`：route 缺失拒绝、原子回滚、legacy NULL 兼容 | FIXED |
| 旧 complete IPC 绕过 | `ipc.test.ts` “keeps the removed complete channel unregistered”；全仓 grep 无通道 | FIXED |
| ingestRun 原子性 | `reflection-routing.test.ts` “rolls the route back when the pending item cannot be written” | FIXED |
| startup 进入统一 ingestion | `stage4-reflection-producer.integration.test.ts` startup trigger 用例；index.ts 源码 | FIXED |
| 仅 Fake DOM | 新增生产装配测试：producer（真实 SQLite）、goal IPC e2e（真实 service/IPC/SQLite）；DOM stub 仅作 renderer 补充 | FIXED |
| open_question 无 producer | producer 用例从真实 knowledge-gap 事件产生 open_question；非手工构造 finding | FIXED |

## 2. 工作包 A：pending 唯一写路径

| 要求 | 测试 | 结果 |
|---|---|---|
| item/route/audit 同事务 | `accepted, rejected and dismissed converge…`；`rolls the item back…` | PASS |
| 同决策幂等、相反 conflict | 同上 | PASS |
| route 缺失/不可变 → 回滚 | `refuses to decide a new item whose reflection route is missing` | PASS |
| 历史 NULL 明确兼容 | `keeps the documented compatibility path…` | PASS |
| 审计必需 | `requires a durable audit sink for decisions` | PASS |
| 旧 complete 入口移除 | `ipc.test.ts` 通道未注册；grep 无 `pendingItemsComplete` | PASS |

## 3. 工作包 B：目标候选进入正式视图

| 要求 | 测试 | 结果 |
|---|---|---|
| accept 后 DB 正式目标可查 | `stage4-goal-candidate-e2e.test.ts` accept→`goal_candidates.status=accepted`→`listGoals` | PASS |
| 正式列表显示该目标 | 同上；`goal-candidates-ui.test.ts` 正式列表渲染 | PASS |
| reject 不创建 goal | e2e reject→candidate rejected→listGoals [] | PASS |
| accept/reject 并发/重放 | `goal-lifecycle.test.ts` reject 幂等、accept replay、conflict | PASS |
| 来源删除不可接受且 expired 持久 | `a disappeared source persists expired…` | PASS |
| 重启状态一致 | `src/app/stage4-restart-consistency.integration.test.ts`（真实文件关闭/重开；含 open 与已决策两种状态）；P09 不覆盖 Stage 4 | PASS |
| UI loading/成功/冲突/失败 | DOM 测试成功/拒绝；冲突/source_unavailable 由 `resultMessage` 分支 + 服务测试 | PASS（文案分支） |
| 不自动执行目标 | 无工具/外部副作用路径；UI 只有确认/拒绝 | PASS |

## 4. 工作包 C：反思生产链

| 入口 | 代码 | 测试 |
|---|---|---|
| post-conversation | `companion-service.ts` projector → `ingestRun` | 既有 Stage 3 套件 |
| manual | `index.ts` runReflection → `ingestRun` | 代码核对 |
| startup | `index.ts` startupReflection → `ingestRun`（新增） | producer integration（startup trigger） |
| open_question producer | `reflection-service.ts` 单会话 gap → open_question | producer integration（真实事件→finding→pending） |
| 拒绝后不复活 | route terminal + upsert 不重置 | `rejected pending concern…` |
| 未知 kind fail-closed | required unroutable audit | `records unroutable kinds…` |

## 5. 工作包 D：审计与安全

| 要求 | 证据 | 状态 |
|---|---|---|
| 决策审计必需 | `PENDING_AUDIT_UNAVAILABLE` 测试；repository 构造需 events | PASS |
| 审计不含原文 | `writes a sanitized audit event…`；payload 仅 ids/decision/状态 | PASS |
| renderer 不直写数据库 | 所有变更经 preload/IPC/service；UI 只调用 bridge | PASS（架构 + 测试） |
| 无授权/无效 UUID | `ipc.test.ts` 非 UUID/未知字段/不可信 frame | PASS |
| DB busy/事务中断 | 事务回滚测试（ABORT trigger）；SQLite busy_timeout 既有 | PASS |
| 审计失败回滚 | 决策/ingest 事务内 required audit | PASS |
| 迁移版本 | 本任务无新迁移；v48 见 migration verification | N/A / 已验证 |

## 6. 工作包 E：纵向验收

| 场景 | 证据 | 状态 |
|---|---|---|
| producer→route→pending | `stage4-reflection-producer.integration.test.ts`（真实 SQLite） | PASS |
| 重复 ingest | `reflection-routing.test.ts` idempotent route | PASS |
| accepted/rejected/dismissed | `reflection-routing.test.ts` 终态用例 | PASS |
| audit 失败回滚 | 决策事务 + required audit；ingest ABORT 用例 | PASS |
| goal accept→正式目标 | `stage4-goal-candidate-e2e.test.ts`（IPC→service→SQLite→IPC） | PASS |
| goal reject 不建 goal | 同上 | PASS |
| 并发 accept/reject | `goal-lifecycle.test.ts` | PASS |
| source deleted | `goal-lifecycle.test.ts` expired 持久 | PASS |
| renderer 成功/失败 | `goal-candidates-ui.test.ts`（真实 bridge） | PASS |

## 7. 全量回归

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 110 文件 / 1034 测试 |
| 定向 7 文件 | 0 | 88/88 |
| `npm run eval:stage5` / `:live` | 0 | 12/12 / 12/12 |
| `npm run eval:stage3` / `:stage4a` | 0 | 15+1NOT_RUN/16 / 7/7 |
| `npm run build` | 0 | 成功 |

## 8. 未完成（未改写）

真人自然度 PENDING_HUMAN；第二 Provider NOT_RUN；真机安装/升级 PENDING_HUMAN；
本机 Electron smoke BLOCKED（环境）。AUD-04/AUD-08 不在本任务范围。

## 9. Issue #43 增量验收（A/B，绑定代码 SHA `294dcd5`）

### A. Goal candidate 审计强制

| 要求 | 测试 | 结果 |
|---|---|---|
| 构造时无法省略 audit 依赖 | `goal-lifecycle.test.ts` `@ts-expect-error` 契约 | PASS（tsc） |
| accept：goal + candidate terminal + audit | `accepted, rejected and dismissed…` / `writes exactly one audit event…` | PASS |
| reject：candidate terminal + audit，无 goal | `reject is durable…` + audit 计数 | PASS |
| audit 抛错：全部回滚 | `rolls accept back when the audit write throws`、`rolls reject and source-unavailable back…` | PASS |
| audit inserted=false 且事件不存在：回滚 | `treats a duplicate audit result as written only when the event exists` | PASS |
| replay 无重复 goal/额外审计 | `writes exactly one audit event per terminal decision…` | PASS |
| 所有构造点注入依赖 | 全仓 `new CompanionGoalService` 搜索 | PASS |

### B. 真实 startup composition

| 要求 | 测试 | 结果 |
|---|---|---|
| 生产 composition 执行 startup→router→SQLite | `stage4-startup-composition.integration.test.ts`（调用 `composeStartupReflectionServices` + `runStartupReflection`） | PASS |
| finding/route/pending/audit 关联一致 | 同上：findingId 贯穿、audit payload 匹配 | PASS |
| 无 finding 的 startup 无虚假 pending | 同上第二用例 | PASS |
| ingestion 故障无部分提交 | 同上第三用例（ABORT 触发器） | PASS |
| 测试未手动调用 reflection.run/router.ingestRun | 测试仅调用生产函数；源码说明 | PASS |
