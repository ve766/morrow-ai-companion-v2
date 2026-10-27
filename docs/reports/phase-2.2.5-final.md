# Phase 2.2.5 — 最终报告

## 1. 基线

| 项 | 值 |
|---|---|
| 起点 | `8ddec1f`（Phase 2.2.4 最终），工作区 clean |
| 本轮最终 HEAD | `cfa6f25` |
| 分支 | `feat/phase-2.2-memory-reliability` |
| PR | [#4](https://github.com/ve766/morrow-ai-companion-v2/pull/4)，**OPEN**，base `feat/phase-2-companion-core`（PR #3，未合并） |
| CI @ `cfa6f25`（代码+证据+三份报告） | [40505885872](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40505885872) **success** |
| CI @ `f93ac2a`（最终报告） | [40506396179](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40506396179) **success** |
| 数据库 | v18 → **v19** |
| main | 未修改；未合并任何 PR |

## 2. 提交与变更（25 文件，+1396/−109）

| 提交 | 内容 |
|---|---|
| `42cc5bd` | 删除日志 v19（覆盖 message/evidence/candidate）+ 恢复重放 + 分节上下文 + 诊断链 |
| `03dc89b` | 评测器接受 `您` 作为第二人称 |
| `576260e` | 撤回值缺失不再算检索失败 |
| `5b65f6d` | 「我不记得」不再被判成否认 |
| `b55ba7b` | git status 超时 2s → 15s（避免把 clean 记成 unknown） |
| `e637899` / `203d4bb` | 两组运行证据 |
| `cfa6f25` | 三份报告 |

关键文件：

| 文件 | 原因 |
|---|---|
| `src/persistence/migrations.ts` | v19：放宽 `deletion_journal` 的实体与 id 约束，加 `operation_id` |
| `src/persistence/deletion-journal.ts` | 新实体、操作 id、证据键构造函数 |
| `src/self-model/feedback-candidate-service.ts` | 撤回证据/候选时写日志 |
| `src/persistence/conversation-repository.ts` | 删除消息时写日志 |
| `src/persistence/backup-service.ts` | 重放五种实体；删会话前先撤回其证据；重放后重算支持数 |
| `src/memory/memory-context-assembler.ts` | 分节块 + `flattenMemoryBlock` |
| `src/memory/memory-service.ts`、`memory-repository.ts` | 纠正历史查询，只投递「被改过」的事实标记 |
| `src/evaluation/context-memory-real.ts` | 每 case 的诊断链与失败分类 |
| `src/evaluation/semantic-judgement.ts` | 否认 vs 承认不知道的区分 |
| `evaluation/fixtures/phase-2.2.5-behaviors.json`（新） | 12 场景固定行为集 |

## 3. 测试与验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | **57 文件 / 567 用例通过**（基线 562） |
| 新增：恢复闭环 | 2 条（备份→删除→恢复→查库→检索） |
| 新增：真实 SIGKILL | 1 条（子进程被强杀，重开库验证） |
| 新增：判定器 | 28 条（含 3 条本轮修掉的假失败） |
| 五个离线评估 + `build` | 全部通过 |
| 迁移 v19 | 旧数据升级测试通过（v17/v18 升级路径） |
| 失败的测试 | **无** |

## 4. 真实数据库删除与恢复验证

见 `phase-2.2.5-data-recovery.md` §4。核心结论：

- 删除消息后：证据 `withdrawn`、候选 `pending`、派生记忆 `retracted`、检索不再返回；
- 恢复旧备份后：**同样的状态**，不是备份里的旧状态；
- 无关候选与无关记忆不受影响；
- 连续恢复两次结果相同（幂等）。

## 5. 真实进程强制终止

见 §5。子进程在 `BEGIN IMMEDIATE` 内被 `SIGKILL`，重开后 `integrity_check=ok`、人格版本未变、无 `applying` 残留。**不是异常注入。**

## 6. 固定行为集结果（5 次，`e637899`，clean）

| 场景 | pass | fail | uncertain |
|---|---|---|---|
| recall-in-session | 0 | 5 | 0 |
| recall-cross-session | 3 | 2 | 0 |
| correction-new-value | 3 | 2 | 0 |
| correction-twice | 2 | 3 | 0 |
| conflict-disclosure | 0 | 4 | 1 |
| subject-attribution | 2 | 1 | 2 |
| message-deleted-fact-gone | 0 | 1 | 4 |
| retracted-not-used | 0 | 0 | 5 |
| stale-fact-caution | 3 | 2 | 0 |
| no-evidence-admits | 0 | 0 | 5 |
| conflict-then-correction | 1 | 4 | 0 |
| allergen-safety-useful | 0 | 0 | 5 |

**没有一个场景 5/5。** 长对话 26 轮：角色混淆 0/5，召回 3/5，过敏原 3 pass / 2 uncertain / 0 违规。

## 7. 归因（先诊断，再判断是否换模型）

60 次判定的失败分类：

| 分类 | 次数 |
|---|---|
| `MODEL_MISINTERPRETATION` | 20 |
| `MODEL_IGNORED_INSTRUCTION` | 4 |
| `INSUFFICIENT_EVIDENCE` | 36 |
| `CONTEXT_NOT_RETRIEVED` | 0 |
| `CONTEXT_NOT_SERIALIZED` | 0 |
| `CONTEXT_CONTRADICTORY` | 0 |

**检索、序列化、冲突标注全部正确。** 冲突场景两条记忆都带 `conflictGroup` 进入请求，模型仍然只答一个城市。

分节上下文 vs 扁平的 A/B（各 3 次）没有显示分节变差；2.2.4→2.2.5 的召回波动是同一模型的采样波动，不是格式回归。

**结论：当前 `qwen2.5:0.5b` 不适合承担冲突披露、纠正遵循与「承认不知道」这三项能力。** 继续堆提示词不会解决，本轮也没有这么做。

## 8. 假通过 / 假失败

| 类型 | 数量 | 处理 |
|---|---|---|
| 假失败：`您` | 1 | 已修 |
| 假失败：「我不记得」 | 2 | 已修 |
| 假失败：撤回值缺失被当成检索失败 | 10 | 已修 |
| 假通过 | **0** | 60 次判定逐条核对原始回复，未发现 |

三次修正都只减少假失败，**没有把任何 fail 变成 pass**。

## 9. 逐项验收

| 工作包 | 状态 | 依据 |
|---|---|---|
| A1 生命周期清单 | **PASS** | 按调用路径列出 8 类数据 |
| A2 恢复不复活已撤回数据 | **PASS** | v19 + 重放 + 查库断言 |
| A3 真实恢复测试 | **PASS** | 备份→删除→恢复→检索全链路 |
| A3 强制终止 | **PASS** | 子进程 SIGKILL |
| B 诊断链 | **PASS** | 每 case 五阶段 + 失败分类 |
| C1 事实表达 | **PASS** | 主体/内容/来源/时间/状态/冲突关系 |
| C2 纠正更新有效事实 | **PASS** | 旧值不进检索、不回传 |
| C3 结构化上下文 | **PASS** | 四段结构 + 明确指令 |
| D 固定行为集 | **PASS** | 12 场景版本化，失败样本保留 |
| D 假通过统计 | **PASS** | 0 例 |
| E 归因 | **PASS** | `CONTEXT_*` 全为 0 |
| E 模型能力结论 | **FAIL（能力）** | 冲突 0/5、同会话召回 0/5 |
| 备份文件与 live 库跨文件事务 | **NEEDS_REVIEW** | 不存在，已说明边界 |
| 编造值识别 | **NEEDS_REVIEW** | 仍只能判 uncertain |
| 过期事实的表达 | **NEEDS_REVIEW** | 投递正确，表达未验证 |
| 已应用人格随证据撤回回滚 | **BLOCKED** | 未设计 |
| 独立人工复核 | **未完成** | 自动证据不等于人工 |

## 10. 剩余风险

1. **模型能力是硬约束**：冲突披露 0/5、同会话召回 0/5。要改善必须换模型（本轮不允许新增云端费用，本地无更强模型可用）。
2. **v19 迁移不可逆**：回滚代码会让 v19 库在旧代码下 fail-closed，需要恢复备份。升级本身有 `createMigrationBackup` 保护。
3. **恢复重放不覆盖已应用人格**：证据撤回不会回滚已生效的人格版本，只保留审计。
4. **编造值**（如「你住在北京」）无法机械识别，只能 `uncertain`。
5. **`no-evidence-admits` 5 次全 uncertain**：模型从不承认不知道，但也从未编造出生日——不判 fail 是诚实的，不代表合格。
6. **无人工复核**。

## 11. 已验证 vs 推断

**测试证明**：v19 迁移、删除日志写入、恢复重放与幂等、支持数重算、SIGKILL 后一致性、分节上下文结构、纠正历史不回传、567 用例、CI 三平台。

**真实运行证明**：60 次判定的分项结果、失败分类分布、A/B 对比、长对话 5 次指标。

**仅为推断**：更强模型能否解决冲突披露（未测）、过期事实表达是否合格（未判）、已应用人格与撤回的交互（未实现）。

## 12. 回滚

| 目标 | 命令 | 影响 |
|---|---|---|
| 全部回滚 | `git revert cfa6f25 203d4bb e637899 b55ba7b 5b65f6d 576260e 03dc89b 42cc5bd` | v19 库需恢复备份 |
| 只回滚上下文格式 | `git revert 42cc5bd` 的 memory 部分 | 会同时丢掉日志改动，不建议单独回滚 |
| 只回滚评测器修正 | `git revert 03dc89b 576260e 5b65f6d` | 假失败重新出现 |

## 13. 结论

**工程层可以进入审查**：删除与恢复闭环、强制终止一致性、纠正语义、诊断可还原性都有可复现证据。

**行为层未达合并门槛**：12 个场景没有一个 5/5，冲突披露 0/5，同会话召回 0/5，而失败全部归因于模型能力，不是存储或序列化。

**不建议合并 PR #4。** PR 保持 OPEN，等待独立复核。
