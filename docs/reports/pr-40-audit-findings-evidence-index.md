# PR #40 审计发现修复证据索引（Issue #47）

- 代码 SHA：`dd9f59b10c7c812c3af36684a32d15193bda7d50`
- 修复分支：`fix/pr-40-audit-findings`
- 实现 PR：见 Issue #47 评论 / PR 链接（base `feat/stage-4-companion-confirmation-closure`）
- 独立复审：见 `docs/audit/pr-40-repair-*.md` 与 review PR（另行提交）

## 1. 源码

| 主题 | 文件/符号 |
|---|---|
| concern identity | `src/self-model/reflection-concern.ts`（`normalizeConcern`、`concernKeyOf`、`concernDigestOf`、`legacyConcernDigestOf`、`reflectionPendingKeys`） |
| finding 身份 | `src/self-model/reflection-mapping.ts:dedupeKeyOf` |
| 重复观察/恢复 | `src/cognition/reflection-routing.ts:ingestRun/ingestFinding/recoverUnrouted/recordLifecycle` |
| pending 去重 | `src/cognition/pending-items.ts:absorbReflection/findReflectionConcern` |
| 唯一决策 | `src/persistence/cognitive-context-repository.ts:decide/resolveLegacyRoutes` |
| 审计必需 | `src/persistence/cognitive-context-repository.ts` 构造函数 + `PendingAuditSink` |
| 删除绕过 | `pending-items.ts`、repository 删除 `complete/drop` |
| startup 语义 | `src/app/startup-composition.ts:runStartupReflection`；`src/app/index.ts` 日志 |
| outbox 恢复 | `src/app/companion-service.ts` reflection projector |
| schema 降级 | `src/persistence/cognitive-context-repository.ts:assertStage4Writable`；`src/cognition/pending-items.ts:PendingSchemaUnavailableError`；`src/app/companion-service.ts:applyFinalization`；`src/app/ipc.ts` |
| UI 结果 | `src/renderer/src/pending-ui.ts`；`src/renderer/index.html#pending-feedback` |
| eval 元数据 | `src/evaluation/git-metadata.ts`；`evals/stage-5/run.ts`；`evals/stage-4a/run.ts` |
| CI | `.github/workflows/ci.yml:75` 步骤名 |

## 2. 测试

| 文件 | 新增/变更 | 关联 |
|---|---|---|
| `src/self-model/reflection-concern.test.ts` | 4 | P1-01 |
| `src/self-model/reflection-mapping.test.ts` | +1（concern/evidence 身份） | P1-01 |
| `src/cognition/reflection-routing.test.ts` | +3 新用例；legacy audit 断言 | P1-01、P2-03、P3-06 |
| `src/cognition/pending-items.test.ts` | complete→decide；编译期/边界 2 用例 | P3-06、P3-07 |
| `src/app/stage4-startup-composition.integration.test.ts` | +3（第二次 gap/skipped/producer failed） | P1-01、P3-08 |
| `src/app/stage4-reflection-producer.integration.test.ts` | +1（第二次 correction） | P1-01 |
| `src/persistence/migrations.test.ts` | +1（v47→v48） | P2-02、P2-03 |
| `src/app/stage4-restart-consistency.integration.test.ts` | 新增 2 | P2-04 |
| `src/evaluation/git-metadata.test.ts` | 新增 5 | P2-05 |
| `src/persistence/pending-schema-gate.test.ts` | 新增 1（含 startup degraded） | P3-11 |
| `tests/pending-ui.test.ts` | 新增 5 | P3-12 |
| `src/app/ipc.test.ts` | +1 schema 错误映射 | P3-11 |
| 既有集成测试 | 构造点补 `EventLogService` | P3-06 |

## 3. 结果文件

| 套件 | 文件 | SHA | branch/workingTree | 结果 |
|---|---|---|---|---|
| Stage 5 scripted | `evals/stage-5/results/20261104T050753Z-dd9f59b.json` | dd9f59b | fix/pr-40-audit-findings / clean | 12/12 |
| Stage 4-A scripted | `evals/stage-4a/results/20261104T050814Z-dd9f59b.json` | dd9f59b | fix/pr-40-audit-findings / dirty（Stage 5 结果未提交） | 7/7 |
| Stage 3 | `evals/stage-3/results/20261104T050848Z-dd9f59b.json` + `-summary.json` | dd9f59b | 无 branch 字段（历史 schema） | 15 PASS + 1 NOT_RUN / 16 |
| 机器结果 | `evals/pr-40-audit-findings/results/<UTC>-<sha>-repair.json` | dd9f59b | — | 12 项状态 |

历史 24 份 JSON（PR #40 原结果）未改写。其 `branch` 字段在 Stage 5/4-A 生成器中被硬编码
（`feat/stage-5-relational-presence` / `feat/stage-4a-companion-continuity`），本轮已在
生成器修复；旧文件按“不得改写历史结果”保留，读者应以 `codeCommit` 为代码身份主键。

## 4. 命令（代码 SHA `dd9f59b`）

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                               # 116 files / 1073 tests
npx vitest run <Stage 4 11 files>                            # 116/116
npx vitest run src/persistence                               # 8 files / 61 tests
npm run build                                                # 0
npm run eval:stage5                                          # 12/12
npm run eval:stage4a                                         # 7/7
npm run eval:stage3                                          # 15+1NOT_RUN/16
```

## 5. CI

实现 PR 的 CI run 在本文件生成时尚未完成；完成后由 Issue #47 / PR 评论与 closure 结果记录
run URL、head SHA、三个 job 结论。不得把旧 run 当作本轮证据。

## 6. 迁移

- v48 仍是当前最新 schema；本轮无新迁移。
- v47→v48 专项测试：`upgrades a v47 database with pending items and keeps them decidable`。
- 备份/恢复、重复迁移、失败回滚由既有 `migrations.test.ts`、`backup-service.test.ts`
  覆盖；新测试另断言 `integrity_check` 与 `foreign_key_check`。

## 7. 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| Stage 5 live 重跑 | NOT_RUN |
| 本机 Electron smoke | NOT_RUN（CI 双平台） |
| 独立复审 | 由独立上下文提交（review PR） |
