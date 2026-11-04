# PR #40 测试与 CI 证据核验（Issue #45）

审计基线：`052bcaa9c0320ef5e726c7bf66df85a49055628d`
所有命令均在干净工作区（`git status --porcelain` 为空）对该 SHA 执行。

## 1. 环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.26200 x64 |
| Node | v22.23.2 |
| npm | 10.9.8 |
| vitest | 5.0.5 |
| electron | 44.9.3（package.json） |
| 安装状态 | `node_modules` 已存在；403 个安装包的 version/resolved 与 `package-lock.json` 全部一致；`npm ci --dry-run --ignore-scripts` 通过 |
| lockfile | `package-lock.json` lockfileVersion 3，404 entries |
| 工作树 | clean（审计开始时 `git status --porcelain` 无输出） |

## 2. 独立执行的命令与结果

| # | 命令 | 退出码 | 结果 | 日志 |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | 0 | 无错误 | `.tmp/audit/tsc.log` |
| 2 | `npx vitest run` | 0 | **111 files / 1042 tests passed**，150.89s | `.tmp/audit/vitest-full.log` |
| 3 | `npx vitest run`（8 个 Stage 4 文件） | 0 | **8 files / 96 tests passed**，19.82s | `.tmp/audit/vitest-targeted.log` |
| 4 | `npx vitest run`（PR 声称的 7 文件集合） | 0 | **7 files / 85 tests passed** | `.tmp/audit/vitest-targeted7.log` |
| 5 | `npx vitest run src/persistence` | 0 | **7 files / 59 tests passed**，30.36s | `.tmp/audit/vitest-persistence.log` |
| 6 | `npm run build` | 0 | electron-vite build 成功 | `.tmp/audit/build.log` |
| 7 | `npm ci --dry-run --ignore-scripts --no-audit --no-fund` | 0 | lockfile 与 package.json 一致 | 终端输出 |
| 8 | `npm ci`（完整重装） | **NOT_RUN** | 见 §7 | — |

### 2.1 8 文件定向明细（命令 3）

| 文件 | 用例数 |
|---|---|
| `src/cognition/reflection-routing.test.ts` | 14 |
| `src/cognition/pending-items.test.ts` | 19 |
| `src/motivation/goal-lifecycle.test.ts` | 33 |
| `src/app/ipc.test.ts` | 21 |
| `tests/goal-candidates-ui.test.ts` | 2 |
| `src/app/stage4-reflection-producer.integration.test.ts` | 2 |
| `src/app/stage4-goal-candidate-e2e.test.ts` | 2 |
| `src/app/stage4-startup-composition.integration.test.ts` | 3 |
| **合计** | **96** |

### 2.2 PR 声称的“定向 7 文件 85/85”复现（命令 4）

集合 = 命令 3 去掉 `pending-items.test.ts`(19) 与 `stage4-reflection-producer`(2)，
加入 `src/motivation/companion-goal.test.ts`(10)：
14 + 33 + 21 + 2 + 2 + 3 + 10 = **85**，实测 85/85。该声明可复现。

### 2.3 全量口径核对

| 声明 | 实测 | 结论 |
|---|---|---|
| 111 文件 / 1042 测试（代码 SHA `294dcd5`） | 111 / 1042（基线 `052bcaa`，与 `294dcd5` 仅差文档提交） | 一致 |
| `2.3` 定向 85/85 | 85/85 | 一致 |
| A 组 5 个 test case | `goal-lifecycle.test.ts` 中 5 个 `it`（第 291–341 行） | 一致 |
| B 组 3 个 test case | `stage4-startup-composition.integration.test.ts` 3 个 `it` | 一致 |

文件数、test case 数、断言数未混用。

## 3. CI 核验

### 3.1 Run

| 项 | 值 |
|---|---|
| Run | [41675813211](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41675813211) |
| Workflow | CI（`.github/workflows/ci.yml`） |
| Event | pull_request |
| head SHA | `052bcaa9c0320ef5e726c7bf66df85a49055628d`（= 审计基线 = PR head） |
| 结论 | **success** |
| 创建 | 2026-11-03T16:35:47Z |
| 更早的 run | 41667548702 @ `9384eb9`（success，PR 文档引用）；41580711704 @ `75a3d55`（success） |

### 3.2 Jobs（全部 success）

| Job | ID | 关键步骤 | 结果 |
|---|---|---|---|
| Typecheck, tests, build and smoke (ubuntu-latest) | 126055986559 | Typecheck；Unit and integration tests；Offline evaluations；Build；Install Electron；Install xvfb；Electron smoke | 全 success |
| Typecheck, tests, build and smoke (windows-latest) | 126055986851 | Typecheck；Tests；Offline evaluations；Build；Electron smoke | 全 success；`Install xvfb` 按 `if: runner.os == 'Linux'` 跳过（预期） |
| Windows upgrade path (schema migrations under the real app) | 126055986219 | Install deps；Rebuild better-sqlite3；`Migration and persistence test pass (includes v1→v15 upgrade paths)` → `npx vitest run src/persistence` | success |

### 3.3 迁移覆盖的实际证据（G6 关键项）

- workflow 第 75 行步骤名仍是 `includes v1→v15 upgrade paths`，**但命令是
  `npx vitest run src/persistence`**（脚本阅读 + run 日志）。
- 该 job 日志（`gh run view 41675813211 --log --job 126055986219`）末尾：
  ```
  Test Files  7 passed (7)
       Tests  59 passed (59)
  ```
  实际运行的文件（日志中逐一出现）：
  `backup-service.test.ts`、`deletion-journal.test.ts`、
  `derived-deletion-boundary.test.ts`、`event-log.test.ts`、`migrations.test.ts`、
  `persistence.test.ts`、`reminder-repository.test.ts`。
- `migrations.test.ts` 多处调用 `applyMigrations(connection)`，默认 target =
  `CURRENT_SCHEMA_VERSION` = 48（`migrations.ts:2579`），因此 v48 的三条 SQL
  **在 CI 中被执行**；起点 fixture 包括 fresh、v1、v7、v8、v9、v17、v24、v25、v26、v38。
- **但没有从 v47 起升级的 fixture，也没有“已有 pending 行”的升级断言**。
  我用独立 v47 真实库验证升级成功（trace §6），这是审计复现，不是仓库证据。
- 因此：不能用该 job 的绿色或步骤名单独证明“v48 真实升级验收”；能证明的是
  “v48 SQL 在 multiple older fixtures 上升级到 48 后，persistence 全套 59 用例通过”。
- 结论见主报告 AUD45-P2-02。

### 3.4 与 CI 使用版本一致性

- CI `actions/setup-node@v4` 指定 `node-version: 22`，本机 v22.23.2，一致；
- CI `npm ci --ignore-scripts --no-audit --no-fund`，本机安装树与 lockfile 一致；
- CI 未设置额外环境变量来改变测试包含范围（`npm test` = `vitest run`）。

## 4. SHA 对应表

| 角色 | SHA |
|---|---|
| PR base | `3812b185398c0442fcc0d0ba5b180713cafee1d9` |
| 审计基线 / PR head / 本审计父提交 | `052bcaa9c0320ef5e726c7bf66df85a49055628d` |
| 代码 SHA（Issue #43 修复） | `294dcd50c64ee5af2d99cca47dd8a0e6669539b8` |
| 证据 HEAD（run 41667548702） | `9384eb9781341c8434605f2e15bd1a3cbb2ef615` |
| PR 第一轮代码 | `7b83fea8aa9ec7847bf47541e49dde073137059f` |
| Issue #42 代码 | `1ab1f64d561ab241e3a9321167f7dbc6c607f1b4` |

`052bcaa` 与 `294dcd5` 只差一个 docs 提交（证据一致性收口），源码/测试无差异，
因此全量 111/1042 在本审计基线仍成立。

## 5. Eval 结果文件核验（G7）

- PR 新增 24 个 JSON（stage-3 8、stage-4-companion-confirmation 4、stage-4a 4、
  stage-5 8），全部为 **新增（A）**，没有历史结果被修改或删除。
- 24/24 文件名包含其 `codeCommit`/`codeSha` 前 7 位；逐一解析无坏 JSON。
- 结果状态：
  - Stage 5 scripted：12/12 PASS，`provider: scripted-offline (not a model)`；
  - Stage 5 live：12/12 PASS，`provider: spark (live)`，`providerModelId: spark-x2.6`，
    `status: AWAITING_MANUAL_REVIEW`，含真实模型回复文本（不是 scripted 占位）；
  - Stage 4-A：7/7；
  - Stage 3：15 PASS + 1 NOT_RUN（L15，longitudinal 由独立运行器执行，reason 已记录）；
  - Stage 4：审计项 PASS；CI closure 文件区分 `codeSha` 与 `evidenceHeadSha`。
- **未把 PENDING_HUMAN / NOT_RUN / AWAITING_MANUAL_REVIEW 写成 PASS**。
- 发现：Stage 5 live/scripted 与 Stage 4-A 的 `branch` 字段由生成器硬编码为其他分支
  （AUD45-P2-05）；`codeCommit` 正确。
- Stage 3 harness/real-provider 的改动仅为构造参数（补 EventLogService）与空白字符，
  未改变 provider 解析、重试、超时、错误归类或评测断言（diff 已逐行核对）。

## 6. 与环境相关的限制

- 本机 Electron smoke 未运行：宿主环境无法安全启动 Electron 图形进程；
  CI 的 ubuntu/windows smoke 均为 success（记录在 §3）。
- Stage 5 live 未重跑：真实 Provider 调用有费用/时延；审计只核对结果元数据与回复文本，
  **不把 live 文件名当真实调用证据**。CI 也不跑 live。
- Stage 3/4A/5 的离线/真实结果未重跑：代码 SHA、状态与计数已核对；重跑不改变代码结论。

## 7. NOT_RUN / BLOCKED 清单

| 项 | 状态 | 原因 / 影响 |
|---|---|---|
| `npm ci` 完整重装 | NOT_RUN | dry-run 通过；安装树 403 包与 lock 一致。影响：未验证全新目录安装（CI 已做） |
| 本机 Electron smoke | NOT_RUN | 宿主图形环境；CI 已覆盖双平台 smoke |
| Stage 5 live 重跑 | NOT_RUN | 成本/时延；只做证据审查 |
| 真机安装/升级 | PENDING_HUMAN | 外部事项，保持 |
| 第二真实 Provider | NOT_RUN | 无第二 provider 凭据 |
| 真人自然度 | PENDING_HUMAN | 外部评审，保持 |
| `migrations.test.ts` v47→v48 专项 | **NOT COVERED**（仓库缺口） | AUD45-P2-02；审计用独立脚本复现成功 |
| candidate/pending 进程级重启 | **NOT COVERED**（仓库缺口） | AUD45-P2-04；审计用代码/持久化事实判定 |
