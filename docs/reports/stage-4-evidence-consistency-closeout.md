# Stage 4 交付证据一致性收口（Issue #44）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4-companion-confirmation-closure`
- PR：[#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40)，OPEN、未合并，base `release/morrow-v2-final-delivery`
- 代码 SHA：`294dcd50c64ee5af2d99cca47dd8a0e6669539b8`
- 证据/文档 HEAD（本次开工基线）：`9384eb9781341c8434605f2e15bd1a3cbb2ef615`
- 本任务性质：**只修正交付证据，不修改生产代码、测试、schema 或算法**。

## 1. 三项差异与修正

### E1 — Machine result 的 CI 状态滞后

- 旧文件（保持原样）：
  `evals/stage-4-companion-confirmation/results/20261103T154342Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8.json`
  其中 `ci.status=PENDING` 是**生成时**的事实（CI 尚未结束），不篡改。
- 新增补充结果：
  `evals/stage-4-companion-confirmation/results/20261103T162520Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8-ci-closure.json`
  - `codeSha = 294dcd50…`（被测代码）
  - `evidenceHeadSha = 9384eb97…`（文档/证据 HEAD，CI 实际 head）
  - CI：run `41667548702`，conclusion success，三个 job：
    - Typecheck, tests, build and smoke (ubuntu-latest) — success
    - Typecheck, tests, build and smoke (windows-latest) — success
    - Windows upgrade path (schema migrations under the real app) — success
  - `collectedAt` 与 `generatedAt` 记录 UTC 时间。
- 旧结果与新结果并存；报告与索引同时链接两者，明确“历史 PENDING → 后续 CI 成功”。

### E2 — Evidence index 的 A 组测试数量

- 按当前代码 `src/motivation/goal-lifecycle.test.ts` 的
  `describe('goal candidate audit is a required dependency')` 逐项核对：
  1. rolls accept back when the audit write throws
  2. rolls reject and source-unavailable back when the audit write throws
  3. treats a duplicate audit result as written only when the event exists
  4. writes exactly one audit event per terminal decision, not one per replay
  5. cannot be constructed without the audit sink (compile-time contract)
- 实际 test case 数为 **5**（不是 6）；已修正 evidence index。
- B 组 `stage4-startup-composition.integration.test.ts` 实际 3 个 test case：
  1. runs the production startup reflection and routes its finding to SQLite
  2. does not create a pending item when startup produces no finding
  3. leaves no route/pending/audit partial state when startup ingestion fails
- 测试口径：全量 111 个测试文件 / 1042 个 test case（代码 SHA `294dcd5`）；
  定向 85/85（7 个文件）。文件数、case 数、断言数不混用。

### E3 — Acceptance matrix 轮次边界

- 保留 §1–§8 的 Issue #42 历史记录（`1ab1f64`、110 文件 / 1034 测试、定向 88/88）原样。
- 文件顶部新增“版本/轮次说明”和“当前最终基线快照”：代码 `294dcd5`、
  evidence HEAD `9384eb9`、PR #40、CI run、当前测试数据。
- §9（Issue #43 A/B）独立于历史章节，不与旧数字混算。

## 2. SHA 对应关系

| 角色 | SHA | 说明 |
|---|---|---|
| 代码（Issue #43 修复） | `294dcd50c64ee5af2d99cca47dd8a0e6669539b8` | 全量/定向测试、Stage 5/3/4-A eval 的执行基线 |
| 证据/文档 HEAD（CI head） | `9384eb9781341c8434605f2e15bd1a3cbb2ef615` | 在代码之上仅追加证据/文档；CI run 41667548702 在此 head |
| Issue #42 历史代码 | `1ab1f64d561ab241e3a9321167f7dbc6c607f1b4` | §1–§8 历史记录，未被覆盖 |

## 3. 历史记录保留

- 旧 machine result JSON 原样保留，包括其生成时的 `ci.status=PENDING`。
- Issue #42 的历史验收矩阵与证据索引章节未删除、未改写数字。
- 本任务未修改 `src/**`、`tests/**`、migrations、算法或测试断言。
- PR #35/#38/#41、main、release 基线未改动；PR #40 保持 OPEN。

## 4. 验证

| 项 | 命令/方式 | 结果 |
|---|---|---|
| JSON 可解析 | `node -e "require(...ci-closure.json)"` | PASS |
| 新结果字段 | codeSha/evidenceHeadSha/ci.jobs 检查 | PASS |
| A/B test case 计数 | 按源码 `it(...)` 清单核对 | A=5，B=3 |
| 文档一致性 | 对照索引/矩阵/报告中的 SHA、数字、CI | PASS |
| 生产代码改动 | `git diff --stat`（仅 docs/evals） | 无 |
| 全量/定向测试 | 本任务不修改代码，引用代码 SHA `294dcd5` 的运行结果；未重新运行，标为引用而非新执行 | 引用 |
| 新 CI | 本次文档提交触发 PR #40 CI（见 Issue #44/PR 评论） | 记录实际 run |

## 5. 未完成 / 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED_ENV（CI smoke 成功另行记录） |
| AUD-04/AUD-08 | 不在本任务范围 |

本任务没有修改生产代码；Issue #43 的代码修复结论由原报告与测试保留，不被文档任务替代。
