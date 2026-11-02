# PR #30 最终定点修复证据索引（Issue #31）

单一索引：结论 → 源码 → 测试 → 结果 → CI → 风险。代码 SHA `0b9071e`；文档提交以 PR #30
head 为准（本文件不记录自身提交的 SHA）。

## 1. 源码

| Finding | 位置 | 变更 |
|---|---|---|
| F1 | `src/relationship/relationship-threads.ts:260` | `observe({messageId, conversationId, at})`；写事务内读来源；缺失/错会话零写入；查询失败抛 `RelationshipSourceError` |
| F1 | `src/relationship/relationship-threads.ts:205` | `RelationshipSourceError`（code `RELATIONSHIP_SOURCE_UNVERIFIABLE`，不含用户文本） |
| F1 | `src/app/companion-service.ts:983` | 投影器只传 id，不传 `readUserMessage()` 副本 |
| F3 | `src/affective-state/expression-policy.ts:120` | `readClause()`：引号/否定前缀/转述/假设语境 |
| F3 | `src/affective-state/expression-policy.ts:137` | `assessDistressEvidence()`：E/C/T/D；C 仅独立躯体线索 |
| F3 | `src/affective-state/expression-policy.ts:93` | 边界情绪词只用于语境判定，不提高 E |
| F6 | `src/app/effect-ledger.ts:104` | 条件 claim + 60s lease + 过期接管（未改语义，本次验证） |
| F6 | `src/app/cognitive-outbox.ts:231` | drain：claim→project→complete/fail；busy/applied 分支（未改语义，本次验证） |
| F6 | `evals/stage-5/final-audit-repair/worker.ts` | 真实进程 worker：独立 SQLite、文件屏障、crash 模式 |

## 2. 测试

| 文件 | 用例 | 结果 |
|---|---|---|
| `src/relationship/relationship-threads.test.ts` | 9（含来源缺失/会话不匹配） | 9/9 PASS |
| `src/affective-state/distress-evidence.test.ts` | 22（正/负/边界/成对语境） | 22/22 PASS |
| `src/app/stage5-final-closeout.integration.test.ts` | 13（F1 8 + F2 5） | 13/13 PASS |
| `src/app/stage5-final-audit-repair.multiprocess.test.ts` | 4（真实 OS 进程） | 4/4 PASS |
| 定向合计 | 48 | 48/48 PASS |
| 全量 | 107 文件 / 1012 测试 | 1012/1012 PASS |

## 3. 结果文件

| 套件 | 文件 | SHA | 结果 |
|---|---|---|---|
| 本轮汇总 | `evals/stage-5/final-audit-repair/results/20261102T071434Z-0b9071e40dea5822ac770c3f66a4ce14e39d3b99.json` | `0b9071e` | F1/F3/F6 PASS；F5 PENDING/NOT_RUN |
| Stage 5 scripted | `evals/stage-5/results/20261102T064146Z-0b9071e.json` | `0b9071e` | 12/12 |
| Stage 5 live | `evals/stage-5/results/20261102T064306Z-0b9071e-stage-5.json` | `0b9071e` | 12/12 |
| Stage 3 scripted | `evals/stage-3/results/20261102T064209Z-0b9071e.json`（+ summary） | `0b9071e` | 15 PASS + 1 NOT_RUN / 16 |
| Stage 4-A scripted | `evals/stage-4a/results/20261102T064247Z-0b9071e.json` | `0b9071e` | 7/7 |
| 历史结果 | `evals/stage-5/results/20261101T155538Z-1b7ab9c-stage-5.json` 等 | 历史 SHA | 未修改 |

## 4. CI

| 项 | 值 |
|---|---|
| 本轮 run | [41403926328](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41403926328) |
| Head | `0b9071e40dea5822ac770c3f66a4ce14e39d3b99` |
| 结论 | **success** |
| Jobs | ubuntu typecheck/tests/build/smoke；windows typecheck/tests/build/smoke；Windows 升级路径 |

## 5. 真实 Provider

| 项 | 值 |
|---|---|
| Provider/协议 | `spark` / `openai-chat-completions` |
| Model | `spark-x2.6` |
| Stage 5 live | 2026-11-02T06:43:06Z 起；12/12 客观 PASS；PENDING_HUMAN |
| 语境 probe | 否定/转述/假设 3 句；`acknowledgeInstruction=false`；见结果 JSON `contextProbe` |
| 凭据 | `MORROW_TEST_API_KEY` 存在；值未写入代码、日志、Issue、PR、报告或结果 JSON |

## 6. 命令

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                                # 0 · 107 files / 1012 tests
npx vitest run src/relationship/relationship-threads.test.ts \
  src/affective-state/distress-evidence.test.ts \
  src/app/stage5-final-closeout.integration.test.ts \
  src/app/stage5-final-audit-repair.multiprocess.test.ts      # 0 · 48/48
npm run eval:stage5                                           # 0 · 12/12
npm run eval:stage5:live                                      # 0 · 12/12
npm run eval:stage3                                           # 0 · 15 PASS + 1 NOT_RUN / 16
npm run eval:stage4a                                          # 0 · 7/7
npm run build                                                 # 0
MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke                  # 1 · 本机 BLOCKED 0xC0000005
```

跨进程结构：`spawn(process.execPath, [bundledWorker, db, turn, clock, barrier, mode])`；
每个 worker 独立 `SqliteDatabase.open`；屏障为 `ready-<pid>` / `go` 文件；20s timeout 仅防挂死。

## 7. 真人盲评

| 项 | 值 |
|---|---|
| v1 | `evals/stage-5/final-closeout/review/human-review-packet.md`（A–G，保留） |
| v2 | `evals/stage-5/final-audit-repair/review/human-review-packet.md`（增补 H–J） |
| 状态 | **PENDING_HUMAN**；Agent 不代填 |

## 8. 风险与未完成

| 项 | 状态 | 说明 |
|---|---|---|
| 真人自然度 | PENDING_HUMAN | 需独立真人评分 |
| 第二真实 Provider | NOT_RUN | 无合法凭据/endpoint |
| 本机 Electron smoke | BLOCKED（环境） | `0xC0000005`；CI 双平台通过 |
| 跨机器一致性 | 不适用 | 单机本地 SQLite；同库多进程已验证 |
| 规则计划器覆盖 | 风险 | 模式外句式落到无操作/澄清，方向保守 |

## 9. 最小复现

1. **F1 空来源**：插入无对应 message 的 relationship outbox 行 → `drainCognition()` →
   无线程/证据，outbox done。
2. **F1 删除来源**：发送“以后叫我小林”→ 删除该消息 → 再插入 pending 行 → drain →
   证据 0，线程 tombstone。
3. **F1 会话不匹配**：真实 message A，`observe({messageId:A, conversationId:B})` →
   `source_conversation_mismatch`，零写入。
4. **F1 查询失败**：让 `prepare('...FROM messages WHERE id...')` 抛错 → `RelationshipSourceError`，
   零写入。
5. **F3**：`我不是说我现在很烦` / `你刚才说…` / `如果我很烦…` → E=0、无安慰；
   `我现在很烦` → E=1、acknowledge；`别安慰我，直接…` → answer_directly。
6. **F6**：两个 worker 同时 drain 同一 turn → 一个 done、一个 busy；证据 1。
