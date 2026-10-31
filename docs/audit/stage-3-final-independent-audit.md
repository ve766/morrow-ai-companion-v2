# Stage 3 最终独立复核

## 0. 审查者与角色说明（必须诚实）

- **审查者**：本轮复核由同一模型的「复核流程」执行，**不是人类审查者，也不是第三方团队**。
- 它与实现流程的分离方式只有三点：只读代码与机器结果、独立重跑、独立写测试注入失败。它无法提供真正的利益无关性，这一点必须在验收时由人来补。
- 复核基准 SHA：`b0e719ad116db5607295da9f5ccddc6e2f4589b4`
- 对照基线 SHA：`b72c5141a591b193782d6358877b62306ecab984`（本轮开工前）
- 方法：① 逐项读码核对声称与实现；② 对迁移后的真实数据库做结构自查；③ 独立重跑全部本地可执行项；④ 用负向注入证明断言可失败；⑤ 核对结果文件的溯源字段。

## 1. 结构自查（对真实数据库）

在临时目录建库并跑完全部迁移后，直接查 `sqlite_master` 与 `pragma_table_info`：

| 检查 | 实测 |
|---|---|
| schema 版本 | `35`（`effect-ledger-reflection-cursor-and-evidence-origin`） |
| 新增表 | `cognitive_effect_ledger`、`reflection_cursors`、`knowledge_gap_evidence`、`goal_creation_keys` 均存在 |
| effect 幂等唯一索引 | `cognitive_effect_ledger_key_uq` 存在 |
| `interest_evidence` 归属列 | `evidence_origin`、`source_finding_id`、`event_ref`、`topic_label` 均存在 |
| `memory_evidence` 词表 | 含 `restatement`、`confirmation`、`retraction`、`model_reference` |
| `goal_candidates` | `due_at`、`due_expression`、`source_state` 均存在 |
| `exploration_events` 状态 | 含 `eligible`、`model_attempted` |
| 触发器总数 | 23；其中 `knowledge_gap_evidence_delete_with_turn`、`interaction_signals_delete_with_turn`、`goal_candidates_source_deleted`、`memory_evidence_delete_with_message`、`memory_evidence_delete_with_conversation` 均在 |

结论：**声称的数据模型就是数据库里真实存在的模型**，不是文档里写的模型。

## 2. 逐项复核结论

| 项 | 复核方式 | 结论 |
|---|---|---|
| P0-1 | 读 `observeMorrowEvidence` / `fold` / `evaluate`；跑 6 条测试；核 L5 的 `actually_raised` 采集点 | 通过。证据逐条、归属分离、晋升只用 Morrow 侧 |
| P0-2 | 读 `run()` 的分批与事务边界；500 事件实测；失败批次实测 | 通过。游标不前进即不丢失 |
| P0-3 | 7 个崩溃点注入；`replayed` 计数；`terminal_failed` 可见性 | 通过。承认 at-least-once，用幂等与 ledger 换恰好一次的业务结果 |
| P0-4 | 读 `recordKnowledgeGap` 无 try/catch；注入 journal 失败 | 通过。消息与认知记录同生共死 |
| P0-5 | 读拒绝门；读 `confirm()`/`retract()` 证据写入；`actor:'morrow'` 判 `model_text` | 通过。模型复述不进入用户重复计数 |
| P1-6 | 读 `goal-time` 解析与 `acceptCandidate` 事务；14 条测试；删除来源传播 | 通过。期限不丢、重试不重复、孤儿候选不可接受 |
| P1-7 | 跑 `eval-assertions.test.ts`（3 条要求 FAIL）；核对结果文件溯源字段 | 通过。断言能失败，且不把 NOT_RUN/uncertain 计为通过 |
| P1-8 | 查 Actions run 与 check-run 注解、查凭据可用性 | **BLOCKED**。注解原文："The job was not started because recent account payments have failed or your spending limit needs to be increased."（run `41178081914`）——外部计费阻断，可复核 |

## 3. 我未能证明的事

- 真实模型是否理解、是否自然提出话题、是否长期陪伴得好：**没有证据**。scripted provider 与 `unmeasured` 字段都写明了这一点。
- Electron 渲染层与 Windows 安装升级：**没有证据**。
- 跨天/跨周的真实时间跨度：纵向运行器是压缩时钟，不是真实等待。
- 我作为审查者的独立性有限（见 §0）。

## 4. 复核结论

- 没有发现「声称已修但代码未修」的项。
- 没有发现 P0 级别的隐私、数据完整性、撤回或重复 effect 缺陷残留。
- 发现并已修复一处未申报泄漏：`user_interaction_signals` 原先没有任何删除传播，删除消息后风格证据仍留在库中，偏移投影会继续沿用被删除那句话的结论。
- 整体判定：**PARTIAL**。八项中七项 PASS，P1-8 BLOCKED。**不得**据此宣称 Stage 3 完成。
