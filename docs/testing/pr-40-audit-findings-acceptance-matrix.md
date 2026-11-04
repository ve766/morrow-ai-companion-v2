# PR #40 审计发现修复验收矩阵（Issue #47）

- 代码 SHA：`dd9f59b10c7c812c3af36684a32d15193bda7d50`
- 分支：`fix/pr-40-audit-findings`
- 最终全量/定向数字见 §13；CI 见 evidence index

| # | Finding | 修复文件/符号 | 测试 | 命令 | 结果 |
|---|---|---|---|---|---|
| 1 | AUD45-P1-01 同关切新证据 | `src/self-model/reflection-concern.ts`（`normalizeConcern`/`concernKeyOf`）；`reflection-mapping.dedupeKeyOf`；`pending-items.absorbReflection/findReflectionConcern`；`reflection-routing.ingestFinding/ingestRun/recoverUnrouted`；`companion-service` 投影；`startup-composition` | `reflection-concern.test.ts`（4）；`reflection-mapping.test.ts` 2；`reflection-routing.test.ts` `ingests a second finding…`、`routes later findings…`、`recovers a finding…`；`stage4-startup-composition` `a second startup gap…`；`stage4-reflection-producer` `a second correction event…` | `npx vitest run src/self-model/reflection-concern.test.ts src/self-model/reflection-mapping.test.ts src/cognition/reflection-routing.test.ts src/cognition/pending-items.test.ts src/app/stage4-startup-composition.integration.test.ts src/app/stage4-reflection-producer.integration.test.ts` | PASS |
| 2 | AUD45-P2-02 v47→v48 迁移 | `src/persistence/migrations.test.ts` 新增 describe；`.github/workflows/ci.yml:75`；`docs/reports/stage-4-migration-verification.md` | `upgrades a v47 database with pending items and keeps them decidable` | `npx vitest run src/persistence` | PASS（8 files / 61 tests） |
| 3 | AUD45-P2-03 legacy route | `cognitive-context-repository.decide/resolveLegacyRoutes`；audit `routeResolution`；`docs/architecture/database-schema.md` | `converges a legacy item route by its stored concern digest`；`does not guess a legacy route when the concern cannot be proven`；v47 迁移测试 | 同上 + `npx vitest run src/cognition/reflection-routing.test.ts` | PASS |
| 4 | AUD45-P2-04 真实重启 | `src/app/stage4-restart-consistency.integration.test.ts`；两处验收矩阵 | `keeps an open pending item decidable after a real close/reopen`；`keeps a decided pending item and its route terminal after close/reopen` | `npx vitest run src/app/stage4-restart-consistency.integration.test.ts` | PASS |
| 5 | AUD45-P2-05 eval branch | `src/evaluation/git-metadata.ts`；`evals/stage-5/run.ts`；`evals/stage-4a/run.ts` | `src/evaluation/git-metadata.test.ts`（5）；Stage 5/4-A 新结果 branch 动态 | `npx vitest run src/evaluation/git-metadata.test.ts`；`npm run eval:stage5`；`npm run eval:stage4a` | PASS（新结果见 §12） |
| 6 | AUD45-P3-06 必需 audit sink | `PendingAuditSink` + `SqlitePendingItemRepository` 构造函数；Stage 2/helper/b4/集成测试构造点 | `pending-items.test.ts` 编译期 `@ts-expect-error`；`requires a durable audit sink for decisions` | `npx vitest run src/cognition/pending-items.test.ts` | PASS |
| 7 | AUD45-P3-07 删除 complete/drop | `pending-items.ts`、`cognitive-context-repository.ts` | `has no public write path that changes status without a decision`（`@ts-expect-error`）；旧测试改为 `decide` | 同上 | PASS |
| 8 | AUD45-P3-08 startup 语义 | `startup-composition.runStartupReflection`；`index.ts` 日志 | `returns skipped…`、`reports producer failure…`、ingest 失败/恢复用例 | `npx vitest run src/app/stage4-startup-composition.integration.test.ts` | PASS |
| 9 | AUD45-P3-09 注释错位 | `reflection-service.ts` docstring | 代码审阅 + 全量 | `npx tsc --noEmit` | PASS |
| 10 | AUD45-P3-10 死代码 | `validation.ts`、`contracts.ts`、`ipc.ts`、`preload/index.ts` | 全仓 grep 无引用；tsc | `npx tsc --noEmit` | PASS |
| 11 | AUD45-P3-11 schema 降级 | repository schema gate；`PendingSchemaUnavailableError`；IPC `SCHEMA_UPGRADE_REQUIRED`；`ChatService.applyFinalization`；startup/outbox 降级 | `pending-schema-gate.test.ts`（真实 v47 降级库 + startup degraded）；`ipc.test.ts` schema 错误映射 | `npx vitest run src/persistence/pending-schema-gate.test.ts src/app/ipc.test.ts` | PASS |
| 12 | AUD45-P3-12 pending UI | `pending-ui.ts`；`index.html` `#pending-feedback` | `tests/pending-ui.test.ts`（成功/conflict/not_found/IPC 失败/unchanged） | `npx vitest run tests/pending-ui.test.ts` | PASS |

## 13. 全量回归

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | **116 files / 1073 tests passed** |
| Stage 4 定向 11 文件 | 0 | **116/116** |
| `npx vitest run src/persistence` | 0 | **8 files / 61 tests passed** |
| `npm run build` | 0 | 成功 |
| `npm run eval:stage5` | 0 | 12/12，branch/workingTree 动态 |
| `npm run eval:stage4a` | 0 | 7/7，branch/workingTree 动态 |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |

定向 11 文件：reflection-routing、pending-items、goal-lifecycle、ipc、startup-composition、
reflection-producer、goal-candidate-e2e、restart-consistency、goal-candidates-ui、
pending-ui、pending-schema-gate。

## 14. 新评估结果（代码 SHA `dd9f59b`）

| 套件 | 文件 | branch | workingTree | 结果 |
|---|---|---|---|---|
| Stage 5 scripted | `evals/stage-5/results/20261104T050753Z-dd9f59b.json` | `fix/pr-40-audit-findings` | clean | 12/12 |
| Stage 4-A scripted | `evals/stage-4a/results/20261104T050814Z-dd9f59b.json` | `fix/pr-40-audit-findings` | dirty（Stage 5 结果尚未提交） | 7/7 |
| Stage 3 | `evals/stage-3/results/20261104T050848Z-dd9f59b.json` + summary | 无 branch 字段（历史 schema） | — | 15+1NOT_RUN/16 |

历史 24 份结果 JSON 未改写；旧 `branch` 字段的误标在 evidence index 说明。

## 15. 未完成 / 外部项

- 真人自然度：PENDING_HUMAN
- 第二真实 Provider：NOT_RUN
- 真机安装/升级：PENDING_HUMAN
- Stage 5 live 重跑：NOT_RUN（无新增 live 结论）
- 本机 Electron smoke：NOT_RUN（CI 双平台覆盖）
- 独立复审：由独立上下文另行提交（见 review PR）
