# Phase 2.2.4 — 最终报告

## 1. 基线与最终状态

| 项 | 值 |
|---|---|
| 起点（Phase 2.2.3 最终） | `bf4da91`，工作区 clean |
| 本轮最终 HEAD | `c1495df`（代码 `0e5b251`，证据 `c1495df`） |
| 分支 | `feat/phase-2.2-memory-reliability` |
| PR | [#4](https://github.com/ve766/morrow-ai-companion-v2/pull/4)，**OPEN**，base `feat/phase-2-companion-core`（PR #3，未合并） |
| CI @ `c1495df` | [40484555247](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40484555247) **success** |
| 数据库版本 | v18（本轮**无迁移**） |
| main | 未修改，未合并任何 PR |

## 2. 提交与变更

| 提交 | 内容 |
|---|---|
| `b1c7195` | 事务可重入 + 会话/消息删除原子化 + 人格应用单事务 + 结构化语义判定 |
| `0e5b251` | 评测器补上「用户的值被第一人称陈述」的主体失败 |
| `c1495df` | 5 次长对话 + 5 次场景运行证据 |

变更文件（11 个，+853/−53）：

| 文件 | 原因 |
|---|---|
| `src/persistence/database.ts` | `transaction()` 用 SAVEPOINT 支持嵌套，否则删除与撤回无法同事务 |
| `src/app/companion-service.ts` | 删除会话不再吞异常；新增 `deleteMessage` 并撤回派生记忆 |
| `src/conversation/conversation-service.ts` | 暴露 `deleteMessage` |
| `src/persistence/conversation-repository.ts` | 新增 `deleteMessage`（单行、限定 conversation） |
| `src/self-model/feedback-candidate-service.ts` | `apply()` 改为单事务 + 写入时校验 baseVersion + 失败不覆盖 `applying` |
| `src/evaluation/semantic-judgement.ts`（新） | 7 维结构化判定 + 失败归因分类 |
| `src/evaluation/context-memory-real.ts` | fixture 声明 `judge` 时由维度判定决定 verdict |
| `src/evaluation/context-memory-evaluation.ts` | 数据集 schema 接受并校验 `judge` 字段 |
| `evaluation/fixtures/phase-2.2.3-scenarios.json` | 三个场景补上 judge 维度 |
| 两个测试文件 | 新增 10 条生命周期/一致性用例、27 条判定用例 |

## 3. 每个缺陷的修复方式

### A. 会话删除吞掉撤回失败

**原因**：`transaction()` 不可重入，撤回和删除无法同事务，于是用 `try/catch` 静默跳过。
**修复**：SAVEPOINT 支持嵌套后，`withdrawForConversation` 与 `deleteConversation` 放进一个事务。撤回抛错 → 整体回滚 → 会话保留、异常上抛。

### B. 消息级删除未接线

**原因**：`withdrawEvidenceForMessage()` 存在但无调用者。
**修复**：`CompanionService.deleteMessage` 串起「撤回证据 → 撤回由该消息采纳的记忆 → 删除消息行」，同一事务。派生行由复合外键 `ON DELETE CASCADE` 清理。

### C. 人格应用跨事务

**原因**：`PersonalityService.save()` 自带事务，`apply()` 在它外面又开一个事务，中间存在「人格已改、状态未改」的窗口。
**修复**：同库同连接，事务可重入后合并为单事务；`baseVersion` 在写入时用 `version === baseVersion + 1` 复核；失败回滚人格，只在没有既有应用记录时写 `failed`。

### D. 评测器假通过

**原因**：召回/冲突/纠正/撤回全部是字符串规则；主体判定只认过敏谓词。
**修复**：新增 7 维结构化判定（subject / polarity / content / conflict / correction / retraction / answers_question），任一 fail 即 fail，任何 uncertain 不得计为 pass。**真实运行发现「我住在杭州」被判 pass，随后修复并补测。**

### E. 把模型问题误诊为数据库问题

**结论**：15 个场景的 `memoryEntries` 全部符合期望（2/2、1/1、0/0），失败一律是 `delivered_but_not_used`。本轮 `CONTEXT_NOT_RETRIEVED` 与 `CONTEXT_NOT_SERIALIZED` **零出现**。

## 4. 测试与验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | **55 文件 / 562 用例通过**（基线 529） |
| 新增生命周期/一致性用例 | 10 条，全部直接查库 |
| 新增判定器用例 | 27 条 |
| `evaluate` / `:cognition` / `:companion` / `:context` / `:retrieval-context` | 全部通过 |
| `build` | 通过 |
| 数据库迁移 | 本轮无新迁移；v18 升级测试仍通过 |
| 备份与恢复 | **未针对证据表验证**（见 §7） |
| 并发应用 | 通过（唯一索引 + 事务内重读） |
| 崩溃恢复 | 通过（异常注入级）；kill -9 级**未做** |

失败的测试：**无**。未运行项：备份/恢复证据状态、kill -9 故障注入、过期记忆场景。

## 5. 真实模型结果（`qwen2.5:0.5b`，本地，5+5 次）

### 长对话 26 轮

| 指标 | 2.2.3 | 2.2.4 |
|---|---|---|
| 角色混淆 | 0/5 | **0/5** |
| 事实召回 | 4/5 | **5/5** |
| 含花生食物推荐 | 0/5 | 0/5 |
| 整轮 verdict | 0 pass / 4 uncertain | **3 pass / 2 uncertain** |

### 场景

| 场景 | 结果 | 状态 |
|---|---|---|
| 冲突披露 | 0 pass / 4 fail / 1 uncertain | **FAIL** |
| 用户纠正 | 2 pass / 3 fail | **FAIL** |
| 撤回不复用 | 5 uncertain（0 次复用，但全部编造替代值） | **NEEDS_REVIEW** |

失败原文（保留，未删除）：「你住在上海。」「你住在中国。」「你：我住在杭州。」「你住在哪里呢？」「你需要提供更具体的地理位置信息来找到答案。」「你住在北京。」

## 6. 逐项验收状态

| 工作包 | 状态 | 依据 |
|---|---|---|
| A 会话删除一致性 | **PASS** | 撤回失败时会话保留（查库） |
| B 消息删除接线 | **PASS** | 证据撤回、支持重算、派生记忆撤回、行删除（查库） |
| C 人格应用一致性 | **PASS**（单事务） | 保存后抛错 → 人格回滚（查库） |
| C 崩溃恢复 | **NEEDS_REVIEW** | 只有异常注入，无 kill -9 |
| D 评测器分层 | **PASS** | 27 条用例 + 真实运行发现的假通过已修 |
| D 编造值识别 | **NEEDS_REVIEW** | 编造「北京」只能判 uncertain |
| E 归因 | **PASS** | 送达 15/15，失败全为 `delivered_but_not_used` |
| F 主体归属 | **PASS** | 0/5 混淆；召回 5/5 |
| F 冲突披露 | **FAIL** | 0/5 |
| F 用户纠正 | **FAIL** | 2/5 |
| F 撤回 | **NEEDS_REVIEW** | 不复用，但编造替代值 |
| F 过期记忆 | **BLOCKED** | 未构造场景 |
| 备份/恢复 | **NEEDS_REVIEW** | 未验证 |
| 独立人工复核 | **未完成** | 自动化证据不等同人工 |

## 7. 已知风险与未完成

1. **冲突披露与纠正遵循稳定失败**，根因是 0.5B 模型能力，不是存储。本轮未通过改 prompt 或删样本掩盖。
2. **备份恢复可能复活证据**。`deletion_journal` 只覆盖 `conversation` / `memory`，证据表无 tombstone。
3. **证据行仍保留 conversation/message UUID 与哈希**（审计用），原文已替换为 `[withdrawn]`。
4. **kill -9 级崩溃未注入**，只验证了「抛错 → 回滚」。
5. **已应用人格不随证据撤回回滚**，只留审计。
6. **无独立人工复核**。所有 `pass` 都是自动判定。
7. 撤回场景模型编造地点，评测器只能判 `uncertain`——需要人看。

## 8. 回滚方案

| 目标 | 命令 | 影响 |
|---|---|---|
| 撤销本轮全部 | `git revert c1495df 0e5b251 b1c7195` | 无迁移，库结构不变 |
| 只撤销事务改动 | `git revert b1c7195` | 会话删除退回吞异常行为 |
| 只撤销评测器 | `git revert 0e5b251` | 「我住在杭州」重新被判 pass |

本轮**无 schema 迁移**，回滚不需要恢复备份，这是相比 2.2.2 的改进。

## 9. 哪些结论由测试证明，哪些只是推断

**测试证明**：事务可重入、删除原子性、消息删除链路、派生记忆撤回、支持数重算、人格单事务回滚、baseVersion 写入校验、27 条判定规则、562 用例、CI 三平台通过。

**真实运行证明**：送达率、角色混淆 0/5、召回 5/5、安全 3 pass/0 违规、冲突 0/5、纠正 2/5、撤回 5 uncertain。

**仅为推断**（未验证）：备份恢复后的证据状态、kill -9 行为、过期记忆处理、已应用人格的撤回策略。

## 10. 结论

工程层可以进入审查：删除、撤回、应用三处的「假成功」和「跨事务窗口」都已在代码和测试里关闭。

行为层**未达合并门槛**：冲突披露 0/5、纠正 2/5，且这是模型能力问题，不是本轮能修的存储缺陷。

**不建议现在合并 PR #4。** PR 保持 OPEN，等待独立复核。
