# Stage 4 产品闭环证据索引（Issue #37）

- 分支：`feat/stage-4-companion-confirmation-closure`
- 基线：`3812b185398c0442fcc0d0ba5b180713cafee1d9`（PR #35 head）
- 代码 SHA：`7b83fea8aa9ec7847bf47541e49dde073137059f`
- PR：[#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40) → base `release/morrow-v2-final-delivery`
- 文档/最终 HEAD：本分支 head（见 PR；本文件不记录自身提交 SHA）

## 1. 源码

| 项 | 位置 |
|---|---|
| 规范 finding kinds + open_question 路由 | `src/cognition/reflection-routing.ts` |
| pending 决策事务/终态/审计 | `src/persistence/cognitive-context-repository.ts`（`decide`） |
| pending 类型/结果 | `src/cognition/pending-items.ts` |
| v48 迁移 | `src/persistence/migrations.ts` |
| 目标候选决策/审计/来源失效 | `src/motivation/companion-goal.ts`（`decideCandidate`） |
| IPC 契约/校验/处理器 | `src/shared/contracts.ts`、`src/shared/validation.ts`、`src/app/ipc.ts` |
| preload bridge | `src/preload/index.ts` |
| UI 面板 | `src/renderer/index.html`、`src/renderer/src/goal-candidates-ui.ts`、`src/renderer/src/main.ts` |

## 2. 测试

| 文件 | 用例 | 结果 |
|---|---|---|
| `src/cognition/reflection-routing.test.ts` | 10 | PASS |
| `src/motivation/goal-lifecycle.test.ts` | 28 | PASS |
| `src/app/ipc.test.ts` | 20 | PASS（含候选 list/accept/reject + 校验） |
| `src/cognition/pending-items.test.ts` | 19 | PASS |
| `tests/goal-candidates-ui.test.ts` | 2 | PASS（真实 bridge，DOM stub） |
| 定向合计 | 79 | 79/79 |
| 全量 | 108 文件 / 1025 | 1025/1025 |

## 3. 结果文件

| 套件 | 文件 | SHA | 结果 |
|---|---|---|---|
| Stage 4 收口机器结果 | `evals/stage-4-companion-confirmation/results/20261102T155319Z-7b83fea8aa9ec7847bf47541e49dde073137059f.json` | `7b83fea` | BL-01/02 + 候选服务/UI PASS |
| Stage 5 scripted | `evals/stage-5/results/20261102T153443Z-7b83fea.json` | `7b83fea` | 12/12 |
| Stage 5 live | `evals/stage-5/results/20261102T153557Z-7b83fea-stage-5.json` | `7b83fea` | 12/12（spark-x2.6） |
| Stage 3 | `evals/stage-3/results/20261102T153506Z-7b83fea*` | `7b83fea` | 15+1NOT_RUN/16 |
| Stage 4-A | `evals/stage-4a/results/20261102T153540Z-7b83fea.json` | `7b83fea` | 7/7 |

## 4. 命令

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                                # 0 · 108 files / 1025 tests
npx vitest run routing/goal/ipc/pending/ui                    # 0 · 79/79
npm run eval:stage5 / :live                                   # 0 · 12/12 / 12/12
npm run eval:stage3 / :stage4a                                # 0 · 15+1NOT_RUN/16 / 7/7
npm run build                                                 # 0
```

## 5. CI

PR #40 head 上的 Actions run 链接见 PR #40 与 Issue #37 最终评论；
三个 job = ubuntu typecheck/tests/build/smoke、windows 同、Windows 升级路径。

## 6. 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED（环境；CI 另列） |

## 7. 固定交付文件

- `docs/reports/stage-4-companion-confirmation-closure-report.md`
- `docs/reports/stage-4-companion-confirmation-evidence-index.md`（本文件）
- `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md`
- `evals/stage-4-companion-confirmation/results/20261102T155319Z-7b83fea8aa9ec7847bf47541e49dde073137059f.json`
- `docs/architecture/database-schema.md`（v48 更新）
