# Stage 5 最终收尾证据索引（Issue #29）

单一索引：结论 → 源码 → 测试 → 结果 → CI → 风险。代码 SHA `80851cf`；文档提交以 PR #30 head
为准（本文件不记录自身提交的 SHA）。

## 1. 源码

| Finding | 位置 | 变更 |
|---|---|---|
| F1 | `src/persistence/migrations.ts:2457`（v46） | 重建关系表：可空来源、`tombstoned_at`、条件 CHECK；历史 backfill；tombstone 触发器 |
| F1 | `src/relationship/relationship-threads.ts:470` | `reconcile()` 删除孤儿证据、清空悬空指针、tombstone 空线程、写计数事件 |
| F1 | `src/app/index.ts:271` | 启动时 `relationships.reconcile()`，在 `CompanionService` 之前；失败不启动 |
| F1 | `src/relationship/relationship-threads.ts:244` | `observe()` 校验来源消息仍存在 |
| F2 | `src/app/companion-service.ts:1631` | 用户消息 `afterPersist` 内入队 `modules:['relationship']` |
| F2 | `src/app/companion-service.ts:1806` | assistant 事务只入队其余模块 |
| F2 | `src/app/companion-service.ts:1569` 附近 | 每轮开始 drain 更早的 pending |
| F2 | `src/relationship/relationship-threads.ts:316` | `supersedeIfStale()`：旧任务不能与更新决定并列 active |
| F3 | `src/affective-state/expression-policy.ts:83` | `assessDistressEvidence()`：E/C/T/D |
| F3 | `src/affective-state/expression-policy.ts:131` | 策略使用结构化证据；直接请求优先 |
| F4 | `docs/testing/stage-5-remediation-acceptance.md`、`docs/reports/stage-5-remediation-delivery.md`、`docs/reports/stage-5-remediation-evidence-index.md` | 统一到 run `41386833397` / head `9d54c6e` |

## 2. 迁移

| 版本 | 名称 | 测试 |
|---|---|---|
| v46 | `relationship-deletion-tombstones` | `migrations.test.ts`（16/16）+ closeout v43→CURRENT backfill 用例 |

## 3. 测试

| 文件 | 用例 | 结果 |
|---|---|---|
| `src/app/stage5-final-closeout.integration.test.ts` | 9（F1 4 + F2 5） | 9/9 PASS |
| `src/affective-state/distress-evidence.test.ts` | 13（F3） | 13/13 PASS |
| `src/app/stage5-presence.integration.test.ts` | 既有 | PASS（张力用例按校准语义改写） |
| 全量 | 106 文件 / 993 测试 | 993/993 PASS |

机器 JSON：`.tmp/full-vitest-80851cf.json`、`.tmp/closeout-vitest-80851cf.json`（本地运行产物，
不提交；提交的是汇总结果）。

## 4. 结果文件

| 套件 | 文件 | SHA | 结果 |
|---|---|---|---|
| Closeout 汇总 | `evals/stage-5/final-closeout/results/20261102T054214Z-80851cf1e4bf67332496c76955ecb390cc79140d.json` | `80851cf` | F1–F4 PASS；F5 PENDING/NOT_RUN |
| Stage 5 scripted | `evals/stage-5/results/20261102T051855Z-80851cf.json` | `80851cf` | 12/12 |
| Stage 5 live | `evals/stage-5/results/20261102T052010Z-80851cf-stage-5.json` | `80851cf` | 12/12，PENDING_HUMAN |
| Stage 3 scripted | `evals/stage-3/results/20261102T051918Z-80851cf.json`（+ summary） | `80851cf` | 15 PASS + 1 NOT_RUN / 16 |
| Stage 4-A scripted | `evals/stage-4a/results/20261102T051952Z-80851cf.json` | `80851cf` | 7/7 |
| 历史 live（保留） | `evals/stage-5/results/20261101T155538Z-1b7ab9c-stage-5.json` | `1b7ab9c` | 未修改 |
| PR #28 修复结果（保留） | `evals/stage-5/remediation/results/20261102T034635Z-d986403…json` | `d986403` | 未修改 |

## 5. CI

| 项 | 值 |
|---|---|
| 本轮 run | [41394584400](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41394584400) |
| Head | `80851cf1e4bf67332496c76955ecb390cc79140d` |
| 结论 | **success** |
| Jobs | ubuntu typecheck/tests/build/smoke；windows typecheck/tests/build/smoke；Windows 升级路径 |
| PR #28 最终 run（历史） | [41386833397](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41386833397)，head `9d54c6e`，success |

## 6. 真实 Provider

| 项 | 值 |
|---|---|
| Provider/协议 | `spark` / `openai-chat-completions` |
| Model | `spark-x2.6` |
| 时间（UTC） | 2026-11-02T05:20:10Z 起 |
| 代码 SHA | `80851cf1e4bf67332496c76955ecb390cc79140d` |
| 结果 | 12/12 客观 PASS；`semanticReview=PENDING_HUMAN` |
| 文件 | `evals/stage-5/results/20261102T052010Z-80851cf-stage-5.json` |
| 凭据 | `MORROW_TEST_API_KEY` 存在；值未写入代码、日志、Issue、PR、报告或结果 JSON |

## 7. 命令

```bash
npx tsc --noEmit                                             # 0
npx vitest run                                                # 0 · 106 files / 993 tests
npx vitest run src/app/stage5-final-closeout.integration.test.ts src/affective-state/distress-evidence.test.ts  # 0 · 22/22
npm run eval:stage5                                           # 0 · 12/12
npm run eval:stage5:live                                      # 0 · 12/12（需 MORROW_TEST_API_KEY）
npm run eval:stage3                                           # 0 · 15 PASS + 1 NOT_RUN / 16
npm run eval:stage4a                                          # 0 · 7/7
npm run build                                                 # 0
MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke                  # 1 · 本机 BLOCKED 0xC0000005
```

## 8. 真人盲评

| 项 | 值 |
|---|---|
| 文件 | `evals/stage-5/final-closeout/review/human-review-packet.md` |
| 样本 | 7 个固定回复（A–G），含必要前序上下文 |
| 评分 | 5 维 0–2，取最低分；反例清单 |
| 状态 | **PENDING_HUMAN**（Agent 不代填） |

## 9. 风险与未完成

| 项 | 状态 | 说明 |
|---|---|---|
| 真人自然度 | PENDING_HUMAN | 需独立审阅者提交评分 |
| 第二真实 Provider | NOT_RUN | 无合法凭据/endpoint；不得以同 Provider 重建冒充 |
| 本机 Electron smoke | BLOCKED（环境） | `0xC0000005`；CI 双平台 smoke 通过 |
| 多进程并发 | 未验证 | effect ledger 有 lease/claim；单进程路径有测试 |
| 规则计划器覆盖 | 风险 | 新模式外句式落到无操作/澄清，方向保守 |

## 10. 最小复现

1. **F1**：发送“以后叫我小林。”→ `DELETE FROM messages WHERE turn_id=?` →
   `relationship_threads` 该行 `value=''`、source/conversation 为 NULL、`tombstoned_at` 非空；
   证据 0；新会话 prompt 不含“小林”。
2. **F1 历史**：v43 库插入消息+线程+证据 → 删除消息 → 升级到 CURRENT → 同上。
3. **F2**：`stack.provider.failure='upstream timeout'` → 发送 → 拒绝；outbox relationship 行
   pending；清 failure → `drainCognition()` → 线程 active、证据 1；再 drain 仍为 1。
4. **F2 删除**：失败后 `deleteConversation` → outbox cancelled；drain 后无线程/证据。
5. **F3**：`麻烦你帮我检查一下代码` → E=0、无 distress；
   `我现在很烦` → E=1、D≈0.75、acknowledge_first；
   `我现在很烦，别安慰我，直接给修复方法` → answer_directly。
