# PR #40 独立审计报告（Issue #45）

- 仓库：`ve766/morrow-ai-companion-v2`
- 被审对象：[PR #40 — feat(stage-4): reflection routing, pending decisions and goal-candidate confirmation](https://github.com/ve766/morrow-ai-companion-v2/pull/40)
- base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 审计基线 HEAD / PR head：`052bcaa9c0320ef5e726c7bf66df85a49055628d`
- 审计分支：`audit/pr-40-independent-review`（仅新增审计文件）
- 审计时间（UTC）：2026-11-04
- 审计方式：逐文件阅读 + 生产调用链追踪 + 真实 SQLite 复现 + 独立执行测试/构建 + CI 日志核验
- 规模核实：63 changed files，8 commits，8,300 additions / 179 deletions（与 PR 元数据一致）

## 1. 最终判定

**MERGE_AFTER_FIXES**

存在 1 个阻断合并的 P1：reflection 的“同一关切、新证据”会生成新的 finding，但 router 把它当成
`PENDING_LINK_MISMATCH` 硬失败，导致该 finding 永久无法路由、手动反思返回 `STORAGE_ERROR`，
post-conversation outbox 模块进入失败重试（若重试期间 reflection 被 rate limit 跳过，还可能被标记 done 但 finding 仍未路由）。该问题在真实使用中必然出现（第二次用户纠正、同一
knowledge-gap label 的第二次不可 grounding），现有测试没有覆盖。

另有 4 个 P2（其中 1 个为迁移证据/文档与真实覆盖不符，建议与 P1 同批修复）和 7 个 P3。

### 1.1 阻断条件（全部修复并由独立证据复验后才可合并）

1. **AUD45-P1-01**：重复关切不得使 ingestion 抛错。修复后必须新增“同一 label 第二次 gap”、
   “第二次 correction”两组回归测试，证明两次运行都 `ran`、只有一个 pending item、
   新 finding 有明确去向（去重或 route 归档），手动反思不再返回 `STORAGE_ERROR`。
2. **AUD45-P2-02**：迁移验证文档删除/更正“上一个 schema→current PASS”的无依据表述；
   新增 `v47 → v48` 升级测试（带已有 pending 行），并把 CI 步骤名从
   `includes v1→v15 upgrade paths` 更正为实际覆盖（`src/persistence`，含 v48）。

以下 P2/P3 不阻断，但应与修复 PR 一并处理或在合并后立即登记：AUD45-P2-03、
AUD45-P2-04、AUD45-P2-05、AUD45-P3-06 至 AUD45-P3-12。

## 2. 总体结论（先说通过的部分）

审计确认以下内容是真实的，不是报告文字：

- Stage 4 三项交付都进入了生产装配：
  - `open_question` 有真实 producer（`ReflectionService.pickOpenQuestionCandidate`），
    只读取 `cognition.knowledge_gap` 事件，单会话 → `open_question`，双会话 →
    `morrow_interest_candidate`；普通陈述/问题/偏好不会产生该 finding。
  - pending 决策只有一个用户可触发的写路径：`PendingCognitionService.decide` →
    `SqlitePendingItemRepository.decide`；旧 `morrow:continuity:pending:complete`
    channel、preload bridge、action 与 service 方法均已移除，`ipc.test.ts` 断言其未注册。
  - 目标候选 accept/reject 由 `CompanionGoalService.decideCandidate` 单事务完成，
    `GoalAuditSink` 是必需构造依赖，审计失败会回滚 goal/candidate/creation key。
- 事务边界真实：`SqliteDatabase.transaction` 在单连接上使用 `BEGIN IMMEDIATE`/SAVEPOINT，
  item/route/audit、goal/candidate/audit、route/pending/audit 都在同一连接同一事务内；
  用 SQLite `RAISE(ABORT)` 触发器的测试证明回滚的是数据库最终状态。
- 生产启动装配真实：`src/app/index.ts` 调用 `composeStartupReflectionServices` 与
  `runStartupReflection`；`stage4-startup-composition.integration.test.ts` 调用同一函数，
  不自行调用 `reflection.run`/`router.ingestRun`。
- IPC 安全边界完整：所有新 channel 经过 `execute` 的 trusted-sender 校验与
  `parseGoalCandidateIdRequest`/`parsePendingItemDecisionRequest` 严格 schema；
  拒绝未知字段、非 UUID、不可信 frame；renderer 只通过 preload bridge 访问，不接触 Node/SQLite。
- v48 迁移本身是安全的加列迁移：我在独立 v47 真实数据库上执行升级，历史行保留、
  新列为 NULL、索引建立、旧项仍可决策（见 trace 文档 §6）。
- 独立执行：`tsc --noEmit` 0；全量 `vitest run` 111 文件 / 1042 用例全通过；
  7 文件定向 85/85；8 文件扩展定向 96/96；`src/persistence` 7 文件 / 59 用例通过；
  `npm run build` 成功。与 PR 声明的测试数字一致（详见 test-and-ci 文档）。

## 3. 发现清单

计数：P0 = 0，P1 = 1，P2 = 4，P3 = 7。

---

### AUD45-P1-01 — 重复关切（同 statement、新 evidence）使 reflection ingestion 永久失败

- **严重级别**：P1
- **是否阻断合并**：**是**
- **位置**：
  - `src/cognition/reflection-routing.ts:180-197`（`ingestRun` 的 absorb + `PENDING_LINK_MISMATCH`）
  - `src/cognition/pending-items.ts:191`（pending item 去重键 = kind + statement digest）
  - `src/self-model/reflection-mapping.ts:71-75`（finding 去重键 = kind + statement + evidence refs）
  - `src/self-model/reflection-service.ts:449-462`（`open_question` 每次 evidence 变化都会产生新 finding）
  - `src/app/startup-composition.ts:74-84`（startup 捕获所有 routing 异常并返回 `failed`）
  - `src/app/index.ts:449-460`（manual 反思把失败映射为 `STORAGE_ERROR`）
  - `src/app/companion-service.ts:994-1001` + `src/app/cognitive-outbox.ts:281-297`
    （post-conversation 投影失败按模块重试，5 次后 failed；若重试时 reflection 被限流跳过，
    可能被标记 done 但 finding 仍未路由）
- **实际行为（可复现）**：
  1. 第一次运行：单会话 knowledge-gap label「量子计算」→ finding F1（evidence: topic + E1）
     → route R1 → pending item P（`finding_id=F1`）。
  2. 同一 label 出现第二个 gap 事件 E2，再次运行：
     - 新 finding F2 的 statement 与 F1 完全相同，但 evidence 集合为 [topic, E1, E2]，
       `dedupeKeyOf` 因此不同 → F2 是新行；
     - `absorbReflection` 用 statement digest 去重，返回已存在的 P（`finding_id=F1`）；
     - router 看到 `item.findingId !== finding.id` → 抛出 `PENDING_LINK_MISMATCH`；
     - 该 finding 的 route/pending/audit 事务整体回滚；`reflection.run` 已提交的 cursor 不会回退。
  3. 结果：F2 永久没有 route（重跑不会再看到这个事件），startup 返回 `failed`；
     manual 反思在 `runBounded` 中被捕获后抛出 `ApplicationError('STORAGE_ERROR')`
     （用户看到“本地数据暂不可用”）；post-conversation 投影在 outbox 中按模块失败重试，
     最多 5 次后 failed；若重试时 reflection 被限流跳过，则可能被标记 done 而 finding 仍未路由。
  4. 同样的机制适用于 `intent_correction`（statement 常量、evidence 随新纠正变化）——
     第二次用户纠正就会触发。
- **复现证据**（本地真实 SQLite，脚本见 trace 文档附录 A）：
  ```text
  run1 {"status":"ran"}
  run2 {"status":"failed"}
  findings2 [F1(open_question), F2(open_question)]   # F2 已落库
  routes2  [F1 → routed]                              # F2 无 route
  routed_audits 1
  manual findings [intent_correction F3]
  manual ingest ok
  manual findings [intent_correction F4]
  manual ingest error PENDING_LINK_MISMATCH
  ```
- **违反的契约**：
  - 路由唯一性/完整性：producer 产生的每个 finding 必须恰好进入一个 route；
    未知/冲突必须可审计 fail-closed，而不是让一个合法 kind 的 finding 永久无 route。
  - 事务/恢复语义：route/pending 写入失败必须可恢复；当前失败后 cursor 已前移，
    finding 不可重试、不可恢复。
  - 核心产品闭环：Stage 4 的反思→待确认→用户决策链在“第二次观察到同一关切”时断裂。
- **用户/数据影响**：用户会看到手动反思失败（误导为本地存储故障）；新的 open_question /
  intent_correction 永远不进入待确认列表；同一次运行中位于失败 finding 之后的 findings
  也不会被路由（局部提交）。数据库不损坏，但状态与审计不完整。
- **为什么现有测试没发现**：`reflection-routing.test.ts` 的重放用例重复调用**同一个
  finding id**（走 `existing route -> return`），从未构造“同 statement、不同 finding id”。
  `stage4-reflection-producer.integration.test.ts` 只跑一次 producer。没有测试把真实
  第二次 gap/correction 喂给 `ingestRun`。
- **建议修复**（不含实施）：
  1. 对“只描述、不消费具体证据”的 kind（`open_question`、`intent_correction`、
     `memory_gap`、`consistency_note`）把 finding 身份收敛为 `kind + normalized statement`，
     不再把 evidence refs 放进 `dedupeKeyOf`；同一关切的再观察只更新 finding 的
     `created_at`/证据引用（或保持原行），不产生第二个 finding。
  2. 对历史已存在的重复 finding（修复前产生的行），router 不应抛错：当
     `item.findingId !== finding.id` 且 item 的去重键与本次 finding 的关切键一致时，
     创建/保留 route 并写 `reflection.finding_reobservation` 审计（或把 route 置为
     `audit_only`），明确记录“同一关切的重复观察”，不阻断后续 findings。
  3. 若产品要求“用户决策要收敛该关切的所有历史 route”，在 route 上增加
     `concern_key`（需要 v49 迁移），`decide()` 更新同 concern_key 的非终态 route；
     否则至少保证 route 终态可追溯，不出现“item done、route 永远 routed”。
- **必须新增的回归测试**：
  - `reflection-routing.test.ts`：
    `"ingests a second finding for the same concern without PENDING_LINK_MISMATCH"`
    —— 构造 F1、F2（同 statement、不同 evidence），断言 `ingestRun` 不抛、
    pending item 数 = 1、F2 有 route（或按修复方案被明确归档）、audit 计数正确。
  - `stage4-startup-composition.integration.test.ts`：
    `"a second startup gap for the same label keeps the run successful"`
    —— 两次 `runStartupReflection` 都 `ran`；只有一个 pending item；无悬挂 finding。
  - `stage4-reflection-producer.integration.test.ts`：
    `"a second correction event does not fail manual ingestion"` —— 第二次 manual
    `ingestRun` 不抛 `PENDING_LINK_MISMATCH`，不产生第二个 pending item。
  - 失败路径：断言 `runStartupReflection` 在真正不可恢复错误时返回 `failed`，
    但数据库无半成品（保持现有 ABORT 用例）。
- **修复验收证据**：上述测试在真实 SQLite 上通过；同一脚本复现输出变为
  `run2 {"status":"ran"}` 且 F2 有明确 route/去重记录；manual 第二次运行 `ok`。

---

### AUD45-P2-02 — v48 升级证据与文档不符：没有 v47→v48 测试，CI 步骤名仍是 v1→v15

- **严重级别**：P2
- **是否阻断合并**：建议作为合并前必改（证据完整性；行为本身已由独立复现证明安全）
- **位置**：
  - `docs/reports/stage-4-migration-verification.md:24`（“上一个 schema→current … PASS”）
  - `src/persistence/migrations.test.ts`（没有 `applyMigrations(connection, 47)` 用例）
  - `.github/workflows/ci.yml:75`（步骤名 `includes v1→v15 upgrade paths`）
  - `evals/stage-4-companion-confirmation/results/…-ci-closure.json`（只记录 job success）
- **实际行为**：
  - CI 的 Windows upgrade job 实际执行 `npx vitest run src/persistence`，日志为
    `Test Files 7 passed (7) / Tests 59 passed (59)`，包含 `migrations.test.ts`；
    该文件多处调用 `applyMigrations(connection)`（默认 target = `CURRENT_SCHEMA_VERSION`
    = 48），因此 v48 的 `ALTER TABLE`/索引 SQL **确实被执行**。
  - 但没有任何测试从 v47 起升级，也没有测试预置 `cognitive_pending_items` 行后升级；
    我在独立 v47 数据库上验证升级成功（见 trace §6），但这是审计复现，不是仓库证据。
  - 文档声称“上一个 schema→current”已通过，与仓库测试不符。
- **违反的契约**：迁移证据必须绑定真实测试名、fixture、执行日志与版本；不能用
  “v1→v15”步骤名或 job 绿色替代 v48 专项覆盖。
- **影响**：升级路径的实际风险未被自动化锁定（未来若 v48 被改成重建表或加约束，
  现有测试仍会绿）；读者会被文档误导。
- **为什么测试没发现**：测试只断言版本号到 current，不校验 v47→v48 的数据保留与列语义。
- **建议修复**：
  1. 新增测试 `migrations.test.ts`：
     `"upgrades a v47 database with pending items and keeps them decidable"`：
     `applyMigrations(connection, 47)` → 插入 pending 行（含 completed 行）→
     `applyMigrations(connection)` → 断言 48、行保留、`finding_id`/`decision` 为 NULL、
     `PRAGMA table_info` 含两列与索引；再用 `SqlitePendingItemRepository.decide`
     验证旧项仍可决策。
  2. 将 CI 步骤名改为实际覆盖（例如 `Persistence and migration tests (up to v48)`）。
  3. 在 `stage-4-migration-verification.md` 写入真实测试名与日志，删除无依据的
     “上一个 schema→current PASS”。
- **回归测试名**：`upgrades a v47 database with pending items and keeps them decidable`；
  `a v47 row keeps decision NULL until the user decides`。
- **验收证据**：该测试在 `npx vitest run src/persistence` 中通过；CI 新 run 的步骤名与
  日志中出现 v47 测试名。

---

### AUD45-P2-03 — 升级前的 pending 行没有 finding 链接，决策后 route 永远保持 routed

- **严重级别**：P2
- **是否阻断合并**：否（已文档化的兼容语义；但升级用户会出现审计状态不一致）
- **位置**：
  - `src/persistence/migrations.ts:2562-2576`（v48 只加列，无 backfill）
  - `src/persistence/cognitive-context-repository.ts:247-272`（`findingId` 为空则跳过 route）
  - `docs/reports/stage-4-migration-verification.md:16`、
    `docs/architecture/database-schema.md:32`（声明历史行“没有可更新的 route”）
- **实际行为**：v47 及更早的数据库里，router 创建的 pending item 与 route 同时存在，
  但 item 没有 finding 链接（列不存在）。升级到 v48 后这些 item 的 `finding_id` 为 NULL；
  用户决策只更新 item，`reflection_finding_routes.status` 永远停在 `routed`。
  我用真实 v47 数据库复现：升级后决策 → item `done/accepted`，route 仍 `routed`。
- **违反的契约**：状态机一致性（item 终态与 route 终态不一致）；审计可追溯性。
- **影响**：升级安装的审计视图会显示“已决策但 route 未消费”；不影响 prompt
  （pending_user route 不参与 hint 注入），不复活、不丢数据。
- **为什么测试没发现**：唯一“legacy NULL”测试只创建**新** item（v48 schema），
  没有升级旧库；`migration-verification` 的断言没有覆盖 route 终态。
- **建议修复**：
  1. 在 v49（或启动一次性 reconcile）中，用 `detail_json` 的 `runId` +
     statement digest 反查 finding，回填 `finding_id`；
  2. 或者在 `decide()` 对 `finding_id IS NULL` 的 item 按 `run_id + kind` 查找唯一 route
     并收敛（找不到则记录 `pending.decision` 审计里的 `routeStatus: null`，不要写
     `consumed` 造成“已收敛”的假象）；
  3. 无论哪种，`decide` 的审计 payload 对 legacy 行不应声称 route 已更新。
- **回归测试名**：`upgrades a v47 routed item and converges its route on decision`；
  `legacy item decision records routeStatus null when no route exists`。
- **验收证据**：v47 fixture 升级后决策，route 状态与 audit payload 一致。

---

### AUD45-P2-04 — 验收矩阵声称“重启由 P09/既有恢复覆盖”，但 P09 不覆盖 candidate/pending/route/audit

- **严重级别**：P2
- **是否阻断合并**：否（SQLite 持久化本身成立；是证据表述问题）
- **位置**：
  - `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md:33`
  - `docs/testing/stage-4-final-repair-acceptance-matrix.md:59`
  - `evals/final-product/run.ts:152-171`（P09 只验证 memory/address/personality）
- **实际行为**：没有任何测试在“关闭连接后重新打开真实数据库文件”的层面验证
  candidate/goal/pending/route/audit 的一致性；测试都是同一连接/同一进程内的持久行读取。
  P09 既没有 goal candidate，也没有 pending item/route/audit。
- **违反的契约**：证据完整性（每项 PASS 必须绑定实际测试；引用旧结果不得冒充新覆盖）。
- **影响**：读者会高估重启覆盖；如果未来出现 commit 后未关闭/恢复顺序问题，现有证据
  无法发现。
- **为什么测试没发现**：没有该场景的测试，只有文档引用。
- **建议修复**：新增 `stage4-restart-consistency.integration.test.ts`：创建 candidate →
  accept → 关闭 `SqliteDatabase` → 用同一文件重新 `SqliteDatabase.open` → 断言
  goal/candidate/route/audit 与关闭前一致；再对 pending item 重复一次。
  或把矩阵改为 `NOT_RUN` 并注明没有进程级重启测试。
- **回归测试名**：`reopening the database keeps candidate, goal, route and audit consistent`。
- **验收证据**：测试文件与新全量计数；矩阵引用真实测试名。

---

### AUD45-P2-05 — eval 结果的 `branch` 字段与代码实际分支不符（生成器硬编码）

- **严重级别**：P2（证据标注）
- **是否阻断合并**：否
- **位置**：
  - `evals/stage-5/run.ts:172`、`:231`（`branch: 'feat/stage-5-relational-presence'`）
  - `evals/stage-4a/run.ts:111`、`:234`（`branch: 'feat/stage-4a-companion-continuity'`）
  - PR 新增的结果文件均继承该字段，例如
    `evals/stage-5/results/20261103T152425Z-294dcd5-stage-5.json` 的
    `branch` 与实际分支 `feat/stage-4-companion-confirmation-closure` 不符。
- **实际行为**：`codeCommit` SHA 正确（24 个结果文件的 SHA 与文件名全部一致，见 §4），
  但 `branch` 是生成器硬编码，跨 PR 复用后构成错误标注。
- **违反的契约**：证据元数据真实一致；不得把旧分支标签套到本轮结果。
- **影响**：读者可能误以为结果产生于 Stage 5 分支；不影响代码/测试有效性。
- **为什么测试没发现**：没有对 eval 元数据做校验；生成器是既有代码，PR 未修改它。
- **建议修复**：生成器改为 `git rev-parse --abbrev-ref HEAD`（或记录 `branch: null` +
  `branchNote`），并在 PR 结果中注明该字段为历史生成器产物；已有结果不要改写，
  在索引中加说明。
- **验收证据**：新生成的任一结果 `branch` 与实际 `git branch --show-current` 一致。

---

### P3（非阻断，按固定结构简写）

#### AUD45-P3-06 — pending repository 的审计依赖仍是可选构造参数

- 位置：`src/persistence/cognitive-context-repository.ts:135-146`；
  `evals/stage-2/runner/cli.ts:122`、`evals/stage-2/ablation/run.ts:126`、
  `tests/helpers/companion-stack.ts:138` 仍无 events 构造。
- 行为：`decide()` 运行期 fail-closed（`PENDING_AUDIT_UNAVAILABLE`），但类型允许构造
  一个永远无法决策的服务；这与 Issue #43 对 GoalAuditSink 的强制契约不一致。
- 影响：未来调用 `decide` 的 harness/测试会得到运行期异常，而不是构造期错误。
- 修复：把 events 改为必需依赖（与 `GoalAuditSink` 同型），更新所有构造点；
  对 Stage 2 harness 显式注入 EventLogService。
- 回归测试：编译期 `@ts-expect-error` 契约 + `requires a durable audit sink` 保留。

#### AUD45-P3-07 — `complete`/`drop` 原语仍公开存在

- 位置：`src/cognition/pending-items.ts:313-315`；
  `src/persistence/cognitive-context-repository.ts:205-220`。
- 行为：无 IPC/生产调用者（全仓 grep 仅测试与内部服务），但任何内部代码仍可
  `status='done'` 而不写 decision/route/audit。
- 影响：潜在绕过唯一决策入口；当前不可由用户触发。
- 修复：删除或改为 `private`/`@internal` 并在类型层禁止；保留测试需要的 fake 原语。
- 回归测试：grep/类型断言 + `keeps the removed complete channel unregistered`。

#### AUD45-P3-08 — startup 反思异常处理与可观测性

- 位置：`src/app/startup-composition.ts:74-84`。
- 行为：`reflection.run('startup')` 在 try 之外，抛错会冒泡到 app 启动 catch；
  ingest 失败只 `logger.warn`，没有 `reflection.ingest_failed` 审计事件。
- 影响：反射运行期故障会阻断应用启动（既有行为）；路由失败只有日志，难以审计。
- 修复：包住 `reflection.run`；失败时写 required/strict 审计（或至少结构化日志），
  并保持启动 fail-safe 语义。

#### AUD45-P3-09 — `pickMorrowGapCandidate` 的文档注释位置错误

- 位置：`src/self-model/reflection-service.ts:629-658`。
- 行为：原 `pickMorrowGapCandidate` 的 docstring 现在紧邻 `pickOpenQuestionCandidate`，
  导致下一个维护者读到错误说明。
- 修复：把注释移回 `pickMorrowGapCandidate` 上方。

#### AUD45-P3-10 — 删除 complete 通道后遗留死代码

- 位置：`src/shared/validation.ts:262`（`parsePendingItemIdRequest`）、
  `src/shared/contracts.ts:215`（`PendingItemIdRequest`）、`src/app/ipc.ts:58` 的未使用导入。
- 行为：无调用者，仅占位；`tsc` 未报错说明未启用相关未使用检查。
- 修复：删除；或明确保留并注释用途。

#### AUD45-P3-11 — 降级 schema（< v48）下 pending 写入引用不存在的列

- 位置：`src/persistence/cognitive-context-repository.ts:148-181`（upsert 显式写 finding_id）；
  `src/persistence/database.ts:116-119` 允许以 < current 打开。
- 行为：若 v48 迁移失败但库停在 v47，`upsert`/`decide` 会因缺列报错；
  回合 finalization 的 catch 会静默丢弃 pending 草稿（`companion-service.ts:1773-1777`）。
- 影响：降级模式的核心聊天可用，但 Stage 4 待办静默缺失；属于可恢复性/降级语义缺口。
- 修复：在 repository 按 `database.schemaVersion >= 48` 选择 SQL，或让 continuity
  在 schema 不足时显式降级并记录一次审计。

#### AUD45-P3-12 — pending 决策 UI 不展示 conflict/not_found/source 状态

- 位置：`src/renderer/src/pending-ui.ts:66-69`（只判断 `result.ok`）。
- 行为：`PendingDecisionResult` 的 `conflict`/`not_found` 也返回 `ok:true`，UI 静默刷新；
  用户不知道操作未生效的原因。
- 影响：体验/可解释性；不造成错误状态。
- 修复：按 `result.data.status` 给出提示（与 goal-candidates-ui 的 `resultMessage` 一致）。

## 4. 审查域结论（A–H）

| 域 | 结论 | 关键证据 |
|---|---|---|
| A reflection producer/registry | **通过，含 P1 缺陷** | `REFLECTION_FINDING_KINDS` 单一来源；8 kinds 与 `FINDING_ROUTES` 一一对应；未知 kind 写 required `reflection.finding_unroutable`；open_question 只来自 gap 事件；finding 原文不进入 pending summary/audit；P1 见上 |
| B pending 状态机 | **通过（新记录）** | `decide()` 单事务；item+route+audit；同决策 unchanged、相反 conflict；route 缺失/不可变/更新 0 行/审计失败均回滚；旧 complete 通道移除；legacy NULL 只更新 item（P2-03） |
| C goal candidate | **通过** | `decideCandidate` 单事务；`GoalAuditSink` 必需；audit 抛错/未写入回滚；accept 幂等返回同一 goal；reject/accept 互斥；来源删除由 trigger + 事务内检查双重保护；owner 不被改写 |
| D startup composition | **通过** | `index.ts:197/367` 调用生产函数；composition 测试用真实 SQLite 且不手工补调用；无 finding 无 pending；ingest 失败无半成品（局部失败语义见 P3-08） |
| E IPC/preload/renderer 安全 | **通过** | trusted sender + schema 校验 + 不可信 frame 拒绝；renderer 只走 bridge；候选列表/决策来自持久层；按钮禁用与刷新；文案明确“确认后才会成为目标”；`textContent` 无 XSS |
| F schema v48 / migration | **实现通过，证据 P2-02/P2-03** | v48 SQL 与运行时查询一致；`CURRENT_SCHEMA_VERSION=48`；独立 v47 升级成功；CI 实际执行 persistence 7/59；文档过度声明；无 v47 fixture |
| G Stage 3/5 eval 改动 | **范围必要，无评测语义变化** | harness/real-provider 仅构造参数与空白改动；24 个结果文件 SHA 与文件名全部一致；历史结果均为新增未改写；live 结果含真实 provider 输出与 `AWAITING_MANUAL_REVIEW`；branch 元数据 P2-05 |
| H 其余文件/整体回归 | **通过** | 63 文件逐一见 file-review-matrix；helper/测试未弱化断言；无生产路径 mock 冒充；全量/定向/构建真实通过 |

## 5. 逐文件覆盖

63/63 文件全部审阅，逐项状态、结论与关联 finding 见
[`pr-40-file-review-matrix.md`](./pr-40-file-review-matrix.md)。

## 6. 合并建议

- **现在不要合并 PR #40**。
- 修复顺序：
  1. AUD45-P1-01（阻断）+ 三个回归测试；
  2. AUD45-P2-02（迁移测试与文档）；
  3. AUD45-P2-03/P2-04/P2-05 与 P3-06 至 P3-12 可在同一修复 PR 或紧随其后处理；
  4. 合并前重新跑全量 + 定向 + build + CI，并由独立审计复验修复证据。
- 建议另开一个独立修复任务（不在本审计分支实施）：上述 12 项，引用本报告 ID。
- 本审计不修改 PR #40、release 分支、main 或任何生产代码/测试。

## 7. 未执行 / 外部项

| 项 | 状态 | 原因 |
|---|---|---|
| `npm ci` 完整重装 | NOT_RUN（dry-run PASS） | `node_modules` 403 个包与 lockfile 的 version/resolved 全部一致；dry-run 无冲突。完整重装会重建 Electron 二进制，非本次代码审计所需 |
| Stage 3/4A/5 eval 重跑 | NOT_RUN（引用既有结果） | 结果文件 SHA/状态已核对；脚本未改动语义；重跑不改变代码结论 |
| Stage 5 live 重跑 | NOT_RUN | 真实 provider 调用有成本/时延；已核对结果元数据与真实回复文本，未把文件名含 live 当证据 |
| 本机 Electron smoke | NOT_RUN（CI 已跑） | 本机无法启动 Electron 环境；CI 的 ubuntu/windows smoke 均 success |
| 真机安装/升级 | PENDING_HUMAN | 外部事项，未改写 |
| 第二真实 Provider | NOT_RUN | 未提供第二 provider 凭据 |
| 真人自然度 | PENDING_HUMAN | 外部评审 |

## 8. 审计自身约束声明

- 未合并/关闭 PR #40，未修改其 head、base、release 分支或 main。
- 未修改任何 `src/**`、`tests/**`、迁移、算法、评测逻辑、历史结果或历史报告。
- 本分支只新增 `docs/audit/pr-40-*` 与 `evals/pr-40-independent-review/results/*.json`。
- 未把 PENDING_HUMAN / NOT_RUN / BLOCKED 写成 PASS。
