# Stage 4 最终修复证据索引

> **版本/轮次说明（Issue #44 追加）**
> - §1–§7 与标题下方的 SHA 是 **Issue #42** 的历史记录，绑定 `1ab1f64` / 110 文件 / 1034 测试；
>   它们保留原样，不代表当前最终基线。
> - §8 起是 **Issue #43** 的增量修复证据，绑定代码 SHA `294dcd50c64ee5af2d99cca47dd8a0e6669539b8`。
> - 当前 CI 证据绑定 evidence HEAD `9384eb9781341c8434605f2e15bd1a3cbb2ef615`
>   （run 41667548702，三个 job success）。

- 分支：`feat/stage-4-companion-confirmation-closure`
- 当前代码 SHA：`294dcd50c64ee5af2d99cca47dd8a0e6669539b8`
- 当前 evidence HEAD：`9384eb9781341c8434605f2e15bd1a3cbb2ef615`
- 当前测试：111 文件 / 1042 测试；定向 85/85（代码 SHA `294dcd5`）
- PR #40：OPEN、未合并；base `release/morrow-v2-final-delivery`

## 1. 源码

| 修复 | 位置 |
|---|---|
| 唯一 pending 决策、审计必需、route 校验 | `src/persistence/cognitive-context-repository.ts:235`（`decide`） |
| 旧 complete IPC 移除 | `src/shared/contracts.ts`、`src/preload/index.ts`、`src/app/ipc.ts`、`src/app/index.ts`、`src/app/companion-service.ts` |
| 原子 ingest | `src/cognition/reflection-routing.ts:151`（`ingestRun`） |
| 启动反思接入 | `src/app/index.ts:383` |
| open_question producer | `src/self-model/reflection-service.ts:450`、`:643` |
| 正式 companion goals 列表 | `src/app/ipc.ts`、`src/preload/index.ts`、`src/shared/contracts.ts`、`src/renderer/src/goal-candidates-ui.ts` |

## 2. 测试

| 文件 | 用例 | 结果 |
|---|---|---|
| `src/cognition/reflection-routing.test.ts` | 14 | PASS |
| `src/cognition/pending-items.test.ts` | 19 | PASS |
| `src/motivation/goal-lifecycle.test.ts` | 28 | PASS |
| `src/app/ipc.test.ts` | 21 | PASS（含 complete 通道移除、候选 IPC） |
| `tests/goal-candidates-ui.test.ts` | 2 | PASS（真实 bridge，DOM stub） |
| `src/app/stage4-reflection-producer.integration.test.ts` | 2 | PASS（真实 SQLite，startup/manual） |
| `src/app/stage4-goal-candidate-e2e.test.ts` | 2 | PASS（IPC→service→SQLite→IPC） |
| 定向合计 | 88 | 88/88 |
| 全量 | 110 文件 / 1034 | 1034/1034 |

## 3. 结果文件

| 套件 | 文件 | SHA | 结果 |
|---|---|---|---|
| Stage 4 final repair | `evals/stage-4-companion-confirmation/results/20261103T044602Z-1ab1f64d561ab241e3a9321167f7dbc6c607f1b4.json` | `1ab1f64` | 审计项/生产者/UI PASS |
| Stage 5 scripted | `evals/stage-5/results/20261103T042723Z-1ab1f64.json` | `1ab1f64` | 12/12 |
| Stage 5 live | `evals/stage-5/results/20261103T042909Z-1ab1f64-stage-5.json` | `1ab1f64` | 12/12（spark-x2.6） |
| Stage 3 | `evals/stage-3/results/20261103T042747Z-1ab1f64*` | `1ab1f64` | 15+1NOT_RUN/16 |
| Stage 4-A | `evals/stage-4a/results/20261103T042827Z-1ab1f64.json` | `1ab1f64` | 7/7 |
| 历史（PR #40 第一轮） | `.../20261102T155319Z-7b83fea….json` 等 | `7b83fea` | 未覆盖 |

## 4. 命令

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                                # 0 · 110 files / 1034 tests
npx vitest run reflection/pending/goal/ipc/ui/producer/e2e    # 0 · 88/88
npm run eval:stage5 / :live                                   # 0 · 12/12 / 12/12
npm run eval:stage3 / :stage4a                                # 0 · 15+1NOT_RUN/16 / 7/7
npm run build                                                 # 0
```

## 5. CI

更新后的 PR #40 head 上的 Actions run 链接见 PR #40 与 Issue #42 最终评论。

## 6. 迁移

本任务无新迁移；PR #40 的 v48 已验证，见
`docs/reports/stage-4-migration-verification.md`。

## 7. 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED（环境；CI 另列） |

## 8. Issue #43 追加证据

| 项 | 位置/结果 |
|---|---|
| GoalAuditSink 必需 | `src/motivation/companion-goal.ts:100`、`:248`、`:414` |
| 审计失败/未写入回滚 | `src/motivation/goal-lifecycle.test.ts`（A 组 **5** 个 test case，已按源码核对） |
| startup composition | `src/app/startup-composition.ts:39`、`:69`；`src/app/index.ts:197`、`:367` |
| startup composition 测试 | `src/app/stage4-startup-composition.integration.test.ts`（3 用例） |
| 全量 | 111 文件 / 1042 测试；定向 85/85 |
| CI | run [41667548702](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41667548702)，head `9384eb9`，success（3 jobs：ubuntu typecheck/tests/build/smoke、windows 同、Windows upgrade path） |
| Issue #43 machine result（生成时 CI=PENDING，历史保留） | `evals/stage-4-companion-confirmation/results/20261103T154342Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8.json` |
| Issue #44 CI closure result | `evals/stage-4-companion-confirmation/results/20261103T162520Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8-ci-closure.json` |
