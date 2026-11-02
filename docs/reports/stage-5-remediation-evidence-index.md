# Stage 5 修复证据索引（Issue #27）

单一索引：每个结论对应源码位置、测试、结果文件与命令。最终代码 SHA
`d9864031221b3e7df238cb87ea50a29a7c4aaf59`；文档/结果提交见 PR 提交列表。

## 1. 源码

| 模块 | 位置 | 变更 |
|---|---|---|
| 关系 mutation 模型 | `src/relationship/relationship-threads.ts:62` | 判别联合 `support/replace/retract/retract_kind/retract_all/clarify` |
| 计划器 | `src/relationship/relationship-threads.ts:99` | 全局意图必须显式；约定撤回唯一目标；称呼否定/纠正；目标不明→clarify |
| 观察 + 应用 | `src/relationship/relationship-threads.ts:244`、`:288` | savepoint 事务；证据 `ON CONFLICT DO NOTHING`；`relationship.mutated` 事件 |
| 重放安全 | `src/relationship/relationship-threads.ts:352` | 全状态查重；`lastSeenAt >= at` 视为重放；不复活撤回/替代 |
| 聚合/状态 | `src/relationship/relationship-threads.ts:384` | 有界分数、半衰期、TTL、MIN_GROUPS；终态不重算 |
| 对账 | `src/relationship/relationship-threads.ts:441` | 删除孤儿证据并重算 |
| 删除传播 | `src/persistence/migrations.ts:2392`（v44） | 消息删除→证据删除→无证据线程降级 |
| outbox 模块 | `src/persistence/migrations.ts:2414`（v45） | module CHECK 增加 `relationship`，保留旧行 |
| 关系投影器 | `src/app/companion-service.ts:975` | 关系观察进入 durable outbox |
| 问候/记忆原则 | `src/app/companion-service.ts:183` | 点名失败形态；自然使用记忆 |
| 事实批次事务 | `src/memory/memory-service.ts:468` | 创建+逐项验证同事务；`rolled_back`/`recovery_required` |
| 索引降级标记 | `src/memory/memory-service.ts:125`、`src/memory/fact-memory.ts:101` | durable `fact_index_jobs` |
| 表达信号 | `src/affective-state/expression-policy.ts:39` | `text` 输入；否定≠distress；直接请求优先 |
| 结果状态类型 | `src/memory/memory-operation-planner.ts:231` | `rolled_back`/`recovery_required` |
| 装配接线 | `src/app/index.ts:264`、`evals/stage-3/runner/harness.ts:164`、`evals/stage-3/shared/real-provider.ts:297` | 事件日志注入关系服务 |

## 2. 迁移

| 版本 | 名称 | 测试 |
|---|---|---|
| v44 | `relationship-evidence-deletion-propagation` | `src/persistence/migrations.test.ts`（干净库/升级），测试 7/8/9/9b |
| v45 | `cognitive-outbox-relationship-module` | 同上；`src/app/cognitive-outbox.test.ts`（模块数动态） |

## 3. 测试

| 文件 | 用例数 | 结果 |
|---|---|---|
| `src/app/stage5-remediation.integration.test.ts` | 19 | 19/19 PASS |
| 全量 | 104 文件 / 970 测试 | 970/970 PASS |
| `src/app/stage5-presence.integration.test.ts` | 既有（1 条断言纠正） | PASS |
| `src/memory/fact-index-faults.test.ts` | 既有退避/恢复 | PASS |

机器 JSON：`.tmp/remediation-vitest-d986403.json`、`.tmp/full-vitest-d986403.json`
（本地运行产物，不提交；提交的是汇总结果 JSON）。

## 4. 结果文件

| 套件 | 文件 | 绑定 SHA | 结果 |
|---|---|---|---|
| 18 项验收汇总 | `evals/stage-5/remediation/results/20261102T034635Z-d9864031221b3e7df238cb87ea50a29a7c4aaf59.json` | `d986403` | 18 项 / 19 用例，19 PASS |
| Stage 5 scripted | `evals/stage-5/results/20261102T032728Z-d986403.json` | `d986403` | 12/12 |
| Stage 5 live | `evals/stage-5/results/20261102T032842Z-d986403-stage-5.json` | `d986403` | 12/12，`PENDING_HUMAN` |
| Stage 3 scripted | `evals/stage-3/results/20261102T032750Z-d986403.json`（+ summary） | `d986403` | 15 PASS + 1 NOT_RUN / 16 |
| Stage 4-A scripted | `evals/stage-4a/results/20261102T032825Z-d986403.json` | `d986403` | 7/7 |
| 历史 live（保留） | `evals/stage-5/results/20261101T155538Z-1b7ab9c-stage-5.json` | `1b7ab9c` | 12/12（修复前，未覆盖） |

## 5. 真实 Provider

| 项 | 值 |
|---|---|
| Provider / 协议 | `spark` / `openai-chat-completions` |
| Model | `spark-x2.6` |
| 运行时间（UTC） | 2026-11-02T03:28:42Z 起 |
| SHA | `d9864031221b3e7df238cb87ea50a29a7c4aaf59` |
| 凭据 | `MORROW_TEST_API_KEY` 存在；值未写入任何持久化产物 |
| 转写 | `evals/stage-5/remediation/review/transcript-remediation.md` |

## 6. 命令

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                                # 0 · 104 files / 970 tests
npx vitest run src/app/stage5-remediation.integration.test.ts # 0 · 19/19
npm run eval:stage5                                           # 0 · 12/12
npm run eval:stage5:live                                      # 0 · 12/12（需 MORROW_TEST_API_KEY）
npm run eval:stage3                                           # 0 · 15 PASS + 1 NOT_RUN / 16
npm run eval:stage4a                                          # 0 · 7/7
npm run build                                                 # 0
MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke                  # 1 · BLOCKED 0xC0000005
```

环境说明：本机 esbuild 无法写系统临时目录；运行测试/评测时把 `TEMP/TMP` 指向
`<repo>/.tmp/es`。该限制用单文件 esbuild bundle 可独立复现。

## 7. CI

| 项 | 值 |
|---|---|
| Workflow | `.github/workflows/ci.yml` |
| Run | [41385531397](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41385531397) |
| Head | `e29365683bd49af5804281ffce8012a040bc66b7` |
| 结论 | **success**（ubuntu-latest、windows-latest 的 typecheck/tests/build/Electron smoke；Windows 升级路径 job） |
| 说明 | CI 中的 Windows/Ubuntu 真实应用 smoke 为应用级验证；本机单独运行 `0xC0000005` 仅作环境证据 |

## 8. 风险与未完成

| 项 | 状态 | 说明 |
|---|---|---|
| Electron / Windows 冒烟 | PASS（CI） | CI `41385531397` 的 windows-latest/ubuntu-latest 真实应用 smoke 通过；本机单独运行 BLOCKED（`0xC0000005`，环境证据） |
| 第二真实 Provider | NOT_RUN | 无凭据；S12/测试 14 仅验证同库重建 |
| 真人自然度 | PENDING | agent rubric 已完成，真人评分未做 |
| 规则计划器覆盖 | 风险 | 新句式可能落到“无操作/澄清”；方向保守，不会越权撤回 |
| outbox 投影失败上限 | 风险 | 连续 5 次失败后 `failed`，需人工检查；聊天不受影响 |

## 9. 最小复现

1. **P0-A**：会话内“以后叫我小林”→“我们下次聊项目时间线”×2→“那个约定就算了”；
   修复后称呼/节奏 active、话题 retracted（测试 2）。
2. **P0-B**：发送称呼后 `DELETE FROM messages WHERE turn_id=?`；
   证据应为 0、线程非 active（测试 7）。真实恢复路径见测试 9b。
3. **P1-C**：“以后叫我小林”→“别再叫我小林，叫我阿林”→新会话问候；
   system 只含 `"阿林"`（测试 5）。
4. **P1-D**：注入 `observe` 抛错→发送称呼→outbox `relationship` pending→
   `drainCognition()`→线程 active、证据 1（测试 10）。
5. **P1-E**：注入 `lookupActive` 第二次返回空→发送多事实→`memories` 无部分结果（测试 11）；
   注入 `reindexMemory` 抛错→主记录保留、job degraded→`retryDue()`→indexed（测试 12）。
6. **P1-F**：“我不喜欢这个方案”策略非 `user_tension_unresolved`；
   “别安慰我，直接说……”=`explicit_direct_request`（测试 15）。
