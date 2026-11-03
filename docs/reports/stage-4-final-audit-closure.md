# Stage 4 最终验收收口（Issue #43）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4-companion-confirmation-closure`（继续 PR #40）
- 基线：PR #40 head `75a3d5517bc77cdfcd5cb0ea96e2439e7d542017`
- 最终代码 SHA：`294dcd50c64ee5af2d99cca47dd8a0e6669539b8`
- PR：[#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40)，base `release/morrow-v2-final-delivery`

## 1. 工作包 A：Goal candidate 审计改为强制依赖

### 根因

`CompanionGoalService` 的 `events` 构造参数可省略，`recordCandidateEvent()` 使用
`this.events?.recordDeterministic?.(...)`；装配遗漏时 accept/reject 仍提交候选与目标，
审计被静默跳过。try/catch 只覆盖“调用后抛错”，不覆盖“依赖不存在”。

### 修复

- `GoalAuditSink` / `GoalAuditResult` 为非可选契约；构造函数第二个参数
  `events: GoalAuditSink` 必需（`companion-goal.ts:248-252`）。
- `recordCandidateEvent()` 直接调用必需依赖（`:414`）：
  - 抛错 → `GOAL_CANDIDATE_AUDIT_FAILED`；
  - 返回 `inserted=false` 时检查 `event_journal` 中事件 id 是否真的存在，
    不存在同样失败；
  - 调用仍在 `decideCandidate()` 的同一 SQLite 事务内，失败回滚 candidate/goal/
    creation key/audit。
- 所有构造点显式注入真实 `EventLogService` 或明确的失败 fake：
  生产 `index.ts`、harness、real-provider、goal 测试、correction-round、helper stack。
- 编译期契约测试：`@ts-expect-error` 断言无法省略 audit 依赖。

### 测试

`src/motivation/goal-lifecycle.test.ts`：
- audit 抛错 → accept 回滚（candidate 仍 pending、无 goal、无 creation key）；
- audit 抛错 → reject / source_unavailable 回滚（candidate 仍 pending）；
- `inserted=false` 且事件不存在 → 回滚；
- 正常 accept + replay 只写 1 条审计事件；
- 构造契约编译期断言。

## 2. 工作包 B：真实 startup composition 测试

### 根因

原 startup 测试自己调用 `reflection.run('startup')` 再手动 `router.ingestRun()`，
没有证明 `src/app/index.ts` 的真实启动装配会执行该链路。

### 修复

- 新增生产模块 `src/app/startup-composition.ts`：
  - `composeStartupReflectionServices(database, events, {clock?})` 构建
    MemoryImportance/FactMemory/MemoryService/Interest/SelfModel/Reflection/
    PendingItemRepository/PendingCognitionService/FindingRouter；
  - `runStartupReflection({reflection, findingRouter, logger?})` 执行 startup run
    并把 findings 交给统一 router；失败 fail-safe 记录，不抛到启动路径。
- `src/app/index.ts` 的真实装配改为调用这两个函数（`:197`、`:367`），不再内联
  反射/待处理/路由构造和 startup 调用。

### 测试

`src/app/stage4-startup-composition.integration.test.ts`（真实临时 SQLite）：
- 调用 `composeStartupReflectionServices` + `runStartupReflection`（生产函数），
  不自己调用 `reflection.run` 或 `findingRouter.ingestRun`；
- 真实 knowledge-gap 事件 + gap ledger → startup finding；
- 断言 finding、route(`pending_user/routed`)、pending item（`finding_id` 一致）、
  `reflection.finding_routed` 审计（payload findingId 匹配）；
- 无 finding 的 startup → 无 pending、无 route；
- pending 插入触发器 ABORT → `runStartupReflection` 返回 failed，route/pending/routed
  审计均为 0，无半成品。

## 3. 回归

- 全量：111 文件 / **1042 测试通过**；定向 7 文件 85/85；
- Stage 5 scripted 12/12、live 12/12；Stage 3 15+1NOT_RUN/16；Stage 4-A 7/7；
- typecheck/build 0；CI 以更新后的 PR #40 head run 为准。

## 4. 未完成 / 风险

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED（环境；CI 另列） |
| AUD-04/AUD-08 | 不在本任务范围 |

- `composeStartupReflectionServices` 只覆盖 reflection 依赖图；Electron 主进程其余
  装配（窗口、reminders、备份）仍在 `index.ts`，测试边界在报告与本文件中说明。
- 旧 `PendingCognitionService.complete/drop` 仍为仓库内部原语，无 IPC 暴露；
  决策语义以 `decide()` 为准。
