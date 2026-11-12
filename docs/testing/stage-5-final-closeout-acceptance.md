# Stage 5 最终收尾验收矩阵（Issue #29）

- 分支：`fix/stage-5-final-closeout`
- 代码 SHA：`80851cf1e4bf67332496c76955ecb390cc79140d`
- 基线：PR #28 head `9d54c6e02dea443f5b6911810327a9fa08c5353c`
- 机器结果：`evals/stage-5/final-closeout/results/<UTC>-<full-sha>.json`
- 每条 finding 的证据链：源码改动 → 针对性测试 → 集成/运行证据 → 最终 SHA。

## 1. F1 删除隐私闭环

| 用例 | 断言 | 结果 |
|---|---|---|
| 删除来源消息 | 线程 tombstone：`value=''`、`source_message_id=NULL`、`conversation_id=NULL`、`tombstoned_at` 非空、status=retracted；证据 0；下一轮 prompt 不含旧称呼 | PASS |
| 删除整个会话 | 所有线程 tombstone；证据 0；关系表无个人内容 | PASS |
| `reconcile()` 孤儿证据 | 删除孤儿证据、tombstone 线程；第二次调用返回 0（幂等）；写 `relationship.reconciled` 事件（仅计数） | PASS |
| v43→v46 历史 backfill | 在 v43 库插入“消息已删除但线程/证据仍在”的旧数据，升级到 CURRENT 后内容被清除、证据 0 | PASS |
| 启动顺序 | `app/index.ts` 在构造 `CompanionService` 前调用 `relationships.reconcile()`；失败 fail-closed | 源码核对 PASS（应用级由 CI smoke 覆盖） |
| 备份恢复 | 恢复 → journal replay → relaunch → 启动 backfill/reconcile（现有备份恢复测试 + v46） | PASS（remediation 测试 9b + 迁移测试） |

## 2. F2 用户消息事务内入队

| 用例 | 断言 | 结果 |
|---|---|---|
| Provider 失败 | 用户消息存在、assistant 不存在、outbox `relationship` 行 pending 且 `user_message_id` 正确；无线程 | PASS |
| 失败后 drain | 线程 active、证据 1；再次 drain 仍为 1 | PASS |
| 重启 | 关闭/重开同一数据库后 pending 仍在；drain 恰好投影一次 | PASS |
| pending 时删除会话 | outbox 行 cancelled；drain 后无线程/证据 | PASS |
| 同一 turn 重放 5 次 | outbox 1 行、证据 1 行 | PASS |
| 旧任务竞态 | 更新决定落地后重放更早消息：只有新值 active，旧值 superseded | PASS |
| 状态机 | pending / running+lease / done+applied / failed+terminal（复用 outbox + effect ledger） | 源码核对 PASS |

## 3. F3 Distress 校准

`src/affective-state/distress-evidence.test.ts` 10 个用例：

| 类型 | 输入 | 期望 | 结果 |
|---|---|---|---|
| 正例 | 我现在很烦 | E=1、D≈0.75、distress、acknowledge_first | PASS |
| 正例 | 今天真的很难受 | E=1、distress | PASS |
| 正例 | 我撑不住了 | E=1、D≈0.65、distress | PASS |
| 正例 | 这事让我很烦 | E=1、distress | PASS |
| 负例 | 麻烦你帮我检查一下代码 | E=0、C=0、no distress | PASS |
| 负例 | 这个操作很麻烦 | E=0、no distress | PASS |
| 负例 | 我不喜欢这个方案 | E=0、no distress | PASS |
| 负例 | 麻烦把日志发我 | E=0、no distress | PASS |
| 边界 | 你刚才没有回答我的问题（T=0.2） | T 记录、distress=false、unresolved_tension_only | PASS |
| 覆盖 | 我现在很烦，别安慰我，直接给修复方法 | answer_directly、brief、rationale=explicit_direct_request | PASS |

普通否定不再触发 `acknowledge_first`；直接请求仍最高优先级。
既有 `stage5-presence` 的张力用例已按校准语义改写（张力单独不触发；显式陈述触发），
不是降低断言。

## 4. F4 证据一致性

- PR #28 的三份文档统一到最终 run `41386833397` / head `9d54c6e`（逐文件 grep 核对）。
- 本轮新结果 JSON 分别记录：
  - `codeSha`：`80851cf…`
  - `ciHeadSha`：`80851cf…`（本轮 CI head）
  - `docsSha`：文档提交（报告说明；结果文件本身不伪装成文档 SHA）
- 历史结果 JSON 不修改、不覆盖。

## 5. F5 外部验证

| 项 | 状态 | 证据/前置条件 |
|---|---|---|
| 真人自然度 | **PENDING_HUMAN** | `evals/stage-5/final-closeout/review/human-review-packet.md`，7 个固定样本 + 盲评表 |
| 第二真实 Provider | **NOT_RUN** | 无第二 Provider 合法凭据/endpoint；同库重建不等于真实切换 |
| Agent rubric | 已完成 | 只能作为 agent 判定，不冒充真人 |

## 6. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无类型错误 |
| `npx vitest run` | 0 | 106 文件 / 993 测试通过（基线 970 + 23） |
| `npx vitest run src/app/stage5-final-closeout.integration.test.ts src/affective-state/distress-evidence.test.ts` | 0 | 22/22 |
| `npm run eval:stage5` | 0 | 12/12 scripted |
| `npm run eval:stage5:live` | 0 | 12/12 live（spark-x2.6） |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | 成功 |
| 本机 `npm run smoke` | 1 | BLOCKED（`0xC0000005`，环境） |
| CI（本轮 head） | 见证据索引 | 新提交自己的 run；不引用旧 run |

## 7. 状态汇总

| Finding | 状态 |
|---|---|
| F1 | **FIXED / PASS** |
| F2 | **FIXED / PASS** |
| F3 | **FIXED / PASS** |
| F4 | **FIXED / PASS**（文档一致性；新结果区分 SHA） |
| F5 | 真人 **PENDING_HUMAN**；第二 Provider **NOT_RUN** |

代码收尾项满足 F1–F4 的代码与运行证据；整体交付状态仍为 **PARTIAL**，原因是 F5 的外部
验证未完成，不把 PENDING/NOT_RUN 改写为 PASS。
