# PR #40 审计发现修复报告（Issue #47）

- 仓库：`ve766/morrow-ai-companion-v2`
- 修复分支：`fix/pr-40-audit-findings`（自 PR #40 head `052bcaa9c0320ef5e726c7bf66df85a49055628d`）
- 代码 SHA：`16620217cd0fd1ace9598fd57c74bc6425a6b16f`
- base：`feat/stage-4-companion-confirmation-closure`；PR #40 仍 OPEN、未合并
- 承接：[Issue #45](https://github.com/ve766/morrow-ai-companion-v2/issues/45) / [PR #46](https://github.com/ve766/morrow-ai-companion-v2/pull/46) 的 12 项审计发现
- 本任务性质：生产代码、测试、迁移/兼容性、评测元数据与文档修复；不开发 Agent、不扩展产品范围

## 1. 结论

12 项发现全部完成代码修复。P1 的“第二次 gap/correction”在真实 SQLite 上已不再抛
`PENDING_LINK_MISMATCH`；历史未路由 finding 可在 startup 自动恢复；v47→v48 升级有专项
测试；legacy item 决策按可证明的 concern digest 收敛 route，无法证明时如实记录
`routeStatus: null / unresolved`；Stage 4 有真实关闭/重开数据库文件的 restart 测试；
eval 生成器动态读取 branch；P3 全部处理。

验证（代码 SHA `1662021`）：

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx vitest run` | **118 files / 1083 tests passed** |
| Stage 4 + review 定向 13 文件 | **126/126** |
| `npx vitest run src/persistence` | **9 files / 63 tests passed** |
| `npm run build` | 成功 |
| `npm run eval:stage5` | 12/12；branch/workingTree 动态 |
| `npm run eval:stage4a` | 7/7；branch/workingTree 动态 |
| `npm run eval:stage3` | 15 PASS + 1 NOT_RUN / 16 |
| CI | 见 evidence index（实现 PR run） |

## 2. 逐项修复

### AUD45-P1-01 — 同一关切、新 evidence 使 reflection ingestion 永久失败

**根因**：finding 身份包含 evidence refs；同一 statement 的新证据生成 F2。pending item 只按
kind + statement digest 去重，命中 F1 的 item。router 把 `item.findingId !== finding.id`
当作 `PENDING_LINK_MISMATCH` 抛出；route/pending/audit 回滚，但 `reflection.run` 的 cursor
已提交 → F2 永久无 route；manual 返回 `STORAGE_ERROR`；outbox 重试后可能 failed/done 而
finding 仍未路由。

**实现**：

1. 新模块 `src/self-model/reflection-concern.ts`：
   - `normalizeConcern()`：NFKC、空白折叠/trim、零宽字符移除、受控全角标点归一、
     标点邻接空白移除、ASCII 小写；**保留**否定、时间、实体、数值、主体与谓词；
   - `concernKeyOf(kind, statement)` = `SHA-256("concern:v1|kind|normalized")`，
     `CONCERN_IDENTITY_VERSION = 1`；
   - `concernDigestOf` / `legacyConcernDigestOf` / `reflectionPendingKeys`。
2. `reflection-mapping.dedupeKeyOf`：`memory_gap`、`open_question`、`intent_correction`、
   `consistency_note` 使用 concern key（不含 evidence）；其余 kind 保留
   kind+statement+refs 的完整身份，避免两个不同 memory 的 interest 合并。
3. `PendingCognitionService.absorbReflection` / `findReflectionConcern`：先查当前与
   legacy 两种 pending key，命中即复用，不创建第二个 item。
4. `ReflectionFindingRouter.ingestFinding`：当 pending_user 关切的 item 已链接另一个
   finding 时，不再抛错；写入确定性 `reflection.finding_reobserved`（含 findingId、
   existingFindingId、pendingItemId、concernKey）并归档该 finding。找不到同关切证据时
   仍 fail-closed 抛 `PENDING_LINK_MISMATCH`。
5. `ingestRun` 逐 finding 隔离：失败写入 `reflection.finding_ingest_failed`（findingId、
   kind、code）后继续处理后续 findings，最后抛聚合
   `REFLECTION_INGEST_FAILED:<n>`；schema 不可写则立即中止。
6. `ReflectionFindingRouter.recoverUnrouted`：扫描“无 route 且未被 reobserved 归档”的
   finding，逐条重放 ingest；启动与限流重试都会调用，用于修复历史遗留和中断写入。
7. outbox 投影：**成功分支和限流分支都会调用 `recoverUnrouted`**；若返回 `failed > 0`
   则抛 `REFLECTION_RECOVERY_INCOMPLETE`，outbox 行保持可重试而不是 done；schema 不可用时
   记录 `cognition.pending_schema_unavailable` 后同样抛出，findings 保留供升级后恢复。
   手动反思同样在 run 后执行 recovery。

**测试**：
- `reflection-routing.test.ts` `ingests a second finding for the same concern without PENDING_LINK_MISMATCH`
- `reflection-routing.test.ts` `routes later findings when one finding cannot be routed, and records the failure`
- `reflection-routing.test.ts` `recovers a finding that was stored without a route, idempotently`
- `stage4-startup-composition.integration.test.ts` `a second startup gap for the same label keeps the run successful`
- `stage4-reflection-producer.integration.test.ts` `a second correction event does not fail manual ingestion`
- `stage4-outbox-reflection.integration.test.ts` `does not mark the row done while recovery still has failed findings`、`does not mark the row done when the schema cannot route findings`、`recovers a finding stranded by a transient pending write on a non-rate-limited retry`
- `reflection-concern.test.ts`（规范化/不合并否定、数量、时间、实体、kind）
- `reflection-mapping.test.ts`（concern kind 忽略 evidence；消费 evidence 的 kind 不合并）

**状态**：FIXED。cursor 提交与 finding 的关系：每个 finding 的 route/pending/audit 仍为
一个事务；失败 finding 有 durable 失败记录，且 `recoverUnrouted` 可在后续启动重放。

### AUD45-P2-02 — v47→v48 无专项迁移回归，CI 名称/文档误导

**实现**：
- `migrations.test.ts` 新增 `upgrades a v47 database with pending items and keeps them decidable`：
  真实 `applyMigrations(connection, 47)` → 插入 open/done pending 行 +
  reflection run/finding/route → 升级到 48 → 断言行保留、状态/时间不变、
  `finding_id`/`decision` 为 NULL、索引存在、`integrity_check`/`foreign_key_check` 通过；
  再用生产 `SqliteDatabase.open` + `SqlitePendingItemRepository.decide` 决策，断言
  item/route/audit 一致。
- CI 步骤名改为 `Persistence and migration tests (up to the current schema, includes v47 feature paths)`。
- `docs/reports/stage-4-migration-verification.md` 删除无依据的“上一个 schema→current PASS”，
  写入真实测试名、fixture、目标 schema 与 CI 命令。

**状态**：FIXED。

### AUD45-P2-03 — legacy pending 决策后 route 永远 routed

**实现**：
- `SqlitePendingItemRepository.decide`：`finding_id` 非空仍走精确 route；
  `finding_id` 为 NULL 时调用 `resolveLegacyRoutes`：解析 item 的
  `reflection:<kind>:<digest>`，对同 kind 的可变 route 计算当前/legacy statement digest，
  只收敛可证明匹配的 route（可能多条，均为同一关切）；0 条匹配不改 route。
- audit payload：`routeStatus` 仅在真实更新时写入；否则 `null`；
  `routeResolution` 为 `linked | resolved_by_concern | unresolved`；`routesUpdated` 计数。
  不再出现“item 已终态但 audit 声称 route 已 consumed”。
- 采用“精确 route + 同关切 sibling routes”策略：item 被后到的 F2 采纳后，决策同时收敛
  item 指向的 route 与同 statement digest 的其它可变 route，audit `routeResolution:
  linked_with_siblings`、`routesUpdated` 为总数；不会留下无解释的 `routed`。
- 不引入 v49：没有新增列/表，读取与匹配均在现有 v48 schema 上完成；因此无迁移回滚风险。

**测试**：
- `migrations.test.ts` 上述 v47 用例（真实 legacy open item → route consumed + audit resolved_by_concern）
- `reflection-routing.test.ts` `converges a legacy item route by its stored concern digest`
- `reflection-routing.test.ts` `converges every route of a legacy concern adopted by a later observation`
- `reflection-routing.test.ts` `does not guess a legacy route when the concern cannot be proven`
- `reflection-routing.test.ts` 原 `keeps the documented compatibility path...` 增加 audit
  `routeStatus: null / unresolved`

**状态**：FIXED。

### AUD45-P2-04 — 验收矩阵错误声称 P09 覆盖 Stage 4 重启一致性

**实现**：
- 新增 `src/app/stage4-restart-consistency.integration.test.ts`：
  - 用例 1：真实文件创建 finding/route/open pending + candidate accept →
    `database.close()` → `SqliteDatabase.open(path)` 重开 → 断言 candidate accepted、
    goal、creation key、pending/route 一致；随后决策 accepted、重放 unchanged、
    相反 conflict；route consumed；audit 只有 1 条 `pending.decision`；
  - 用例 2：决策 rejected 后关闭/重开 → item dropped、route rejected、重放/冲突语义一致。
- 两处验收矩阵改为引用该真实测试；P09 仅描述其 memory/address/personality 范围。

**状态**：FIXED。

### AUD45-P2-05 — Eval 结果 branch 字段硬编码

**实现**：
- 新模块 `src/evaluation/git-metadata.ts`：`readGitMetadata()` 返回
  `branch | null`、`branchReason`（ok/detached/git_unavailable/command_failed）、
  `commit`、`workingTree`（clean/dirty/unknown）；`MORROW_EVAL_SHA` 仍只覆盖 commit。
- `evals/stage-5/run.ts` 与 `evals/stage-4a/run.ts` 的 scripted/live payload 全部改为
  `branch: git.branch`、`branchReason`、`workingTree`；不再硬编码其他阶段分支。
- 旧 24 份 JSON 未改写；证据索引导注明历史 branch 字段的误标与修正边界。
- 本轮新结果：Stage 5 `20261104T050753Z-dd9f59b.json`（branch=fix/pr-40-audit-findings，
  tree=clean）、Stage 4-A `20261104T050814Z-dd9f59b.json`（tree=dirty，原因是 Stage 5
  结果尚未提交，已在证据中注明）、Stage 3 `20261104T050848Z-dd9f59b*`。

**测试**：`src/evaluation/git-metadata.test.ts`（正常分支、detached、git 缺失、
命令失败、dirty、override、空 branch）。

**状态**：FIXED。

### AUD45-P3-06 — pending repository 的 audit sink 仍是可选依赖

**实现**：`PendingAuditSink` 成为必需构造依赖；所有生产/eval/test helper 构造点注入
`EventLogService` 或明确的 test sink（Stage 2 runner/ablation、companion-stack、
b4-crash-child、全部集成测试）。`decide` 仍保留运行期 `PENDING_AUDIT_UNAVAILABLE`
防御，防御对象是 JS/未类型化调用，不是正常装配路径。

**测试**：`pending-items.test.ts` 的 `@ts-expect-error` 编译期契约 +
`requires a durable audit sink for decisions` 运行期用例。

**状态**：FIXED。

### AUD45-P3-07 — complete/drop 原语仍可绕过唯一决策入口

**实现**：从 `PendingItemPort`、`PendingCognitionService`、`SqlitePendingItemRepository`
删除 `complete`/`drop`；全仓无业务调用者；测试改为 `decide`。新增
`@ts-expect-error` 边界测试，确认没有公开入口只改 item status。

补充（独立复审发现）：`IntentReadingRepository.closeOpenItems` 原以裸 SQL 把
`source='open_question'` 的 item 置 done。现改为 `SqlitePendingItemRepository.resolveSystem`：
同一事务写 `decision=dismissed`、收敛同关切 route、写 `pending.system_dismissed`（actor=system），
不再有状态-only 路径；`IntentReadingRepository` 必需注入 audit sink。
测试：`intent-reading-pending-closure.test.ts`（成功、失败后重试、降级 schema）。非 schema 的
决策失败不会中断 intent reading 保存：item 保持 open，记录 `pending.system_dismiss_failed`。

**状态**：FIXED。

### AUD45-P3-08 — Startup reflection 错误处理和可观测性不足

**实现**：
- `runStartupReflection` 不再抛出；返回
  `ran | skipped | failed | degraded` + reason + recovered；
  `reflection.run` 失败 → `failed/producer_failed`；限流 → `skipped`（仍执行 recovery）；
  ingest 部分失败 → 先 recovery，若全部修复则 `degraded/ingest_recovered`，否则
  `failed/ingest_failed`；schema 不可写 → `degraded/schema_upgrade_required`。
- 每次结果/失败写 `reflection.startup_result` / `reflection.startup_failed`
  durable audit（best-effort，失败只回退日志）。
- `index.ts` 在状态非 `ran` 时记录结构化 warn；应用启动不被非致命反思故障阻断。

**测试**：startup composition 的 `returns skipped when the service rate-limits the run and never throws`、
`reports producer failure without throwing and records the failed stage`、ingest 失败/恢复用例。

**状态**：FIXED。

### AUD45-P3-09 — Reflection service 注释错位

`pickMorrowGapCandidate` 的 docstring 移回其上方；`pickOpenQuestionCandidate` 使用自己的
说明；算法未变。**状态**：FIXED。

### AUD45-P3-10 — 删除旧 complete channel 后遗留死代码

删除 `parsePendingItemIdRequest`、`PendingItemIdRequest` 与 `ipc.ts` 未使用导入；
全仓检索无引用。**状态**：FIXED。

### AUD45-P3-11 — schema < v48 降级模式下 pending 写入静默丢失

**实现**：
- `SqlitePendingItemRepository.assertStage4Writable()`：`schemaVersion < 48` 时抛出
  `PendingSchemaUnavailableError`（message `SCHEMA_UPGRADE_REQUIRED`），不执行引用新列的 SQL。
- IPC `toFailure` 映射为新的 `SCHEMA_UPGRADE_REQUIRED`，用户看到“需要重启完成版本升级”。
- 手动反思的 `runBounded` 保留原始 error，`index.ts` 将 schema 错误映射为
  `SCHEMA_UPGRADE_REQUIRED`，不再统一报 `STORAGE_ERROR`。
- `ChatService.applyFinalization` 在 schema < 48 时跳过 pending 草稿并
  `recordDegradation('pending_item_schema')`，不无限重试不可写草稿；主聊天继续可用。
- startup reflection 在 schema 不可写时返回 `degraded/schema_upgrade_required`；
  outbox 投影记录 `cognition.pending_schema_unavailable`，findings 保留供升级后
  `recoverUnrouted` 恢复。

**测试**：`pending-schema-gate.test.ts`（真实 v47 降级库：upsert/decide 抛错，
read 安全，startup degraded）；`ipc.test.ts` schema 错误映射。

**状态**：FIXED（主聊天降级、待确认能力显式不可用且可恢复）。

### AUD45-P3-12 — Pending UI 静默吞掉 conflict/not_found

**实现**：`pending-ui.ts` 按 `PendingDecisionResult.status` 渲染
accepted/rejected/dismissed、unchanged、conflict、not_found、IPC error；冲突/不存在
刷新持久层列表；失败恢复按钮并保留重试态；新增 `#pending-feedback`
（`role=status aria-live=polite`），沿用现有 button/feedback 样式与键盘可达性。

**测试**：`tests/pending-ui.test.ts`（成功、conflict、not_found、IPC 失败、unchanged）。

**状态**：FIXED。

## 3. 事务、cursor 与恢复（摘要）

- 每个 finding 的 route + pending + required audit 仍是一个
  `SqliteDatabase.transaction`（BEGIN IMMEDIATE/SAVEPOINT，单连接）。
- `reflection.run` 的 run/finding/effect/cursor 仍是独立事务；本修复没有把 cursor 与
  route 放进同一事务，而是通过 `recoverUnrouted` 保证“cursor 已消费但无 route”的
  finding 可在下一次启动/限流重试时被重放，且 re-observation 有确定性归档事件，
  不会被无限重试。
- `ingestRun` 的失败隔离保证后续 findings 不被跳过；失败 finding 有
  `reflection.finding_ingest_failed` 记录，可被 recovery 重试。
- outbox 投影失败仍按模块重试；限流分支执行 recovery，避免“row done 但 finding 未路由”。

## 4. 迁移与兼容

- 没有新增 schema 版本（仍为 v48）；P2-03 的 legacy 解析在运行时完成，不写回
  `finding_id`，不猜测。
- v47→v48 专项测试覆盖 open/done 行、route、决策、索引、完整性检查；
  `applyMigrations` 既有的事务/回滚/备份行为未改。
- schema < v48 的降级行为见 P3-11；不执行引用缺失列的 SQL。

## 5. 风险与未完成

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN（未改写） |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| Stage 5 live 重跑 | NOT_RUN（无新增 live 结论；旧 live 结果保留） |
| 本机 Electron smoke | NOT_RUN（CI 双平台 smoke 覆盖） |
| concern 规范化边界 | 仅合并无语义差异（空白/全角标点/零宽/大小写）；否定/数量/时间/实体保留并有测试 |
| 历史重复 finding | 首次出现时归档一次并写确定性 audit；不会自动合并到旧 finding 行 |
| legacy route 多匹配 | 同一 statement digest 的多个 route 全部收敛（同一关切）；不同 statement 不匹配 |

## 6. 变更文件

见 `docs/reports/pr-40-audit-findings-evidence-index.md`。
