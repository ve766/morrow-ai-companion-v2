# Stage 5 最终收尾交付报告（Issue #29）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`fix/stage-5-final-closeout`
- 目标 base：`fix/stage-5-review-findings`（PR #28 的 head；stacked PR）
- 起始 SHA：`9d54c6e02dea443f5b6911810327a9fa08c5353c`
- 代码/CI SHA：`80851cf1e4bf67332496c76955ecb390cc79140d`
- 文档提交：见 PR #30 head（本报告不伪造自身所在提交的 SHA）
- 新 PR：[#30](https://github.com/ve766/morrow-ai-companion-v2/pull/30)，OPEN、未合并、无 auto-merge

## 1. 结论

| 项 | 结果 |
|---|---|
| F1 删除隐私闭环 | **FIXED / PASS** |
| F2 用户消息事务内入队 | **FIXED / PASS** |
| F3 distress 误判 | **FIXED / PASS** |
| F4 CI/证据一致性 | **FIXED / PASS** |
| F5 真人自然度 | **PENDING_HUMAN** |
| F5 第二真实 Provider | **NOT_RUN** |
| 全量测试 | 106 文件 / **993 测试通过**（基线 970 + 23） |
| scripted 12 场景 | 12/12 |
| live 12 场景 | 12/12（spark-x2.6） |
| CI（本轮 head） | **success**，3 个 job（run `41394584400`） |
| 本机 Electron smoke | BLOCKED（`0xC0000005`，环境） |
| **整体状态** | **PARTIAL**（F5 未完成真实外部验证） |

## 2. 修复前后行为

### F1 — 删除后内容清除

修复前：v44 触发器只把无证据线程降为 `candidate/strength=0`，`value`、`source_message_id`、
`conversation_id` 保留；`reconcile()` 未在启动链调用；历史孤儿无 backfill。

修复后：

- v46 重建关系表：`value` 可为空、来源/会话可空、新增 `tombstoned_at`、条件 CHECK。
- 无证据线程 → tombstone：`value=''`、`source_message_id=NULL`、`conversation_id=NULL`、
  `supersedes_thread_id=NULL`、`status='retracted'`。
- 触发器、`reconcile()`、v46 backfill 三条路径执行同一清理。
- `app/index.ts` 在 `CompanionService` 之前 `reconcile()`，失败不启动（fail-closed）。
- 备份恢复 → deletion journal replay → relaunch → 启动 backfill/reconcile。
- 测试：删除消息/会话、reconcile 幂等、v43→v46 历史孤儿 backfill。

### F2 — obligation 与用户消息同事务

修复前：关系 obligation 在 assistant `afterPersist` 才入队；Provider 失败/崩溃丢失。

修复后：

- 用户消息 `appendMessage` 的 `afterPersist` 内入队 `module='relationship'`，与消息同一事务。
- assistant 事务只入队其余模块。
- Provider 失败后行保持 pending；下一轮开始前/启动时 drain 重放；effect ledger 防重复。
- 删除消息/会话取消 pending；`observe()` 校验来源消息仍存在。
- 旧任务竞态：更早的晚到 observation 被标为 `superseded`，不能与更新决定并列 active。
- 测试：Provider 失败、重启、pending 删除、同一 turn 重放 5 次、旧任务竞态。

### F3 — distress 校准

修复前：`distressSignal` 含单字 `烦`，`麻烦你帮我检查一下代码` 误判；张力单独即触发。

修复后：`E/C/T/D` 结构化证据：

```
D = 0.55E + 0.25C + 0.20T
distress = E >= 0.85 OR (D >= 0.65 AND C >= 0.40)
```

- `烦(麻|请|琐|杂)` 排除；无完整情绪句式 E=0。
- T 只占 20%，单独张力不触发。
- 直接请求最高优先级（`answer_directly`/`brief`）。
- 10 个正/负/边界用例逐项断言 E/C/T/D、策略与 rationale。

### F4 — 证据一致性

- PR #28 三份文档统一到最终 run `41386833397` / head `9d54c6e`。
- 本轮新结果 JSON 分开记录 `codeSha`、`ciHeadSha`、`docsSha`（docsSha 在生成时明确为 null，
  由 PR/Issue 报告实际文档提交），历史结果不改。
- 本轮 CI 以 `80851cf` 自己的 run 为准。

### F5 — 外部验证

- 真人盲评包：7 个固定样本、5 维 0–2 量表、反例清单；状态 **PENDING_HUMAN**，Agent 不代填。
- 第二 Provider：无合法凭据/endpoint，**NOT_RUN**；同库 runtime 重建不等于真实切换。

## 3. 数据流与事务边界

```
[事务] user message + relationship obligation(module='relationship')
  → Provider（失败不回滚前两者）
  → [事务] assistant message + 其余 modules
  → drainCognition → observe(mutation) [savepoint 事务] → evidence/thread + event
  → outbox done / effect ledger applied
  → 下一轮 prepare 只读 active threads
删除:
  DELETE message/conversation → 触发器删证据/清指针/tombstone + outbox cancelled
启动:
  migrate → relationships.reconcile() → services → recover → drain
```

详细状态机与崩溃点见
`docs/architecture/stage-5-final-closeout-data-lifecycle.md`。

## 4. 命令、退出码、测试数

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 106 文件 / 993 测试通过 |
| `npx vitest run src/app/stage5-final-closeout.integration.test.ts src/affective-state/distress-evidence.test.ts` | 0 | 22/22 |
| `npm run eval:stage5` | 0 | 12/12 |
| `npm run eval:stage5:live` | 0 | 12/12 |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | 成功 |
| 本机 `npm run smoke` | 1 | BLOCKED（`0xC0000005`） |
| CI `41394584400` | success | ubuntu/windows typecheck、tests、build、Electron smoke；Windows 升级路径 |

环境：win32 / Node 22.23.2；本机 esbuild 不能写系统临时目录，测试/评测将 `TEMP/TMP`
指向仓库 `.tmp/es`（单文件 bundle 可复现该限制）。

## 5. 真实 Provider

| 项 | 值 |
|---|---|
| Provider/协议 | `spark` / `openai-chat-completions` |
| Model | `spark-x2.6` |
| 时间（UTC） | 2026-11-02T05:20:10Z 起 |
| 代码 SHA | `80851cf1e4bf67332496c76955ecb390cc79140d` |
| 结果 | 12/12 客观 PASS；`semanticReview=PENDING_HUMAN` |
| 文件 | `evals/stage-5/results/20261102T052010Z-80851cf-stage-5.json` |
| 凭据 | `MORROW_TEST_API_KEY` 存在；值未写入任何持久化产物 |

## 6. 提交

| 提交 | 内容 |
|---|---|
| `80851cf1e4bf67332496c76955ecb390cc79140d` | F1 v46 tombstone/backfill/启动 reconcile；F2 用户事务入队/恢复/竞态；F3 E/C/T/D；22 个测试 |
| 文档提交 | 九份固定交付物、PR #28 文档 CI 对齐、机器结果 |

## 7. 未完成 / BLOCKED / NOT_RUN

| 项 | 状态 | 说明 |
|---|---|---|
| 真人自然度 | PENDING_HUMAN | 需要独立真人按盲评表评分；Agent 自评不算 |
| 第二真实 Provider | NOT_RUN | 无第二 Provider 凭据/endpoint；不得用同 Provider 重建冒充 |
| 本机 Electron smoke | BLOCKED（环境） | `0xC0000005`；CI 的 Windows/Ubuntu 真实应用 smoke 已通过 |
| 规则计划器覆盖 | 剩余风险 | 新模式外句式落到无操作/澄清；方向保守 |
| 旧任务极端时序 | 剩余风险 | 依赖 `lastSeenAt` 与 effect ledger；已覆盖单进程竞态，多进程并发未验证 |

## 8. 回滚

1. `git revert` 代码提交 `80851cf`（及文档提交）。
2. v46 为前向兼容结构；彻底回滚需重建 v43 表并恢复 v44 触发器；已 tombstone 的内容无法恢复
   （符合删除语义）。
3. 历史结果、PR #28 结果不删除、不覆盖；回滚后在报告中标明版本。

## 9. 固定交付文件

| 文件 | 用途 |
|---|---|
| `docs/audit/stage-5-final-closeout-findings.md` | F1–F5 复审发现与证据 |
| `docs/audit/stage-5-final-closeout-root-cause-matrix.md` | 根因 → 代码 → 测试 |
| `docs/architecture/stage-5-final-closeout-data-lifecycle.md` | 删除/恢复/事务/outbox |
| `docs/algorithms/stage-5-distress-evidence-calibration.md` | E/C/T/D、阈值、对照集 |
| `docs/testing/stage-5-final-closeout-acceptance.md` | finding 与测试/命令/状态 |
| `evals/stage-5/final-closeout/results/20261102T054214Z-80851cf1e4bf67332496c76955ecb390cc79140d.json` | 机器结果 |
| `evals/stage-5/final-closeout/review/human-review-packet.md` | 真人盲评包（PENDING） |
| `docs/reports/stage-5-final-closeout-delivery.md` | 本报告 |
| `docs/reports/stage-5-final-closeout-evidence-index.md` | 单一证据索引 |

## 10. 最终状态

**PARTIAL**：F1–F4 的代码与运行证据完成（993 测试、scripted/live 12/12、CI 三 job 全绿）；
F5 的真人自然度 PENDING_HUMAN、第二 Provider NOT_RUN。未把 PENDING/NOT_RUN 写成 PASS，
未合并 PR #28/#26/#24 或本 PR，未改 main，未发布 Release。
