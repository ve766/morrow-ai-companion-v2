# 自主认知生命周期（第三轮）

## 当前实现（代码事实）

- `InnerCognitionService.observeTurn`：从 assistant uncertainty/correction/predictionError 生成 thought。
- `InnerCognitionService.synthesizeFromContext`：从 **Morrow 自有** active interest、reflection finding、可选 goal stall 生成候选问题；Shared/User origin 不会生成 actor=morrow 的 thought。
- `morrow_thoughts` 持久化 question/hypothesis/evidence/counter/uncertainty/priority/status/nextReviewAt/algorithmVersion。
- 5 分钟 scheduler 调用 synthesize + reviewDue；有界 1 个新问题/次、最多 3 个 review。
- `reviewThought` 做 conversation 独立计数、去重、证据 score、candidate/active/weakened；state 写 `morrow_self_states` revision。

## 与任务状态机的差距

任务要求 `discovered → selected → hypothesized → investigating → reviewing → concluded | inconclusive | rejected | suspended` 的完整持久化状态机。当前 `morrow_thoughts.status` 只有 `open/reviewed/candidate/promoted/dormant/closed`，没有独立的 investigation steps、alternative hypotheses、conclusion kind、lastOutcome、attemptCount、cooldown 字段，也没有单独的 exploration revision 表。

因此本轮 **没有**把这一项标为 PASS。现有实现是可运行的候选问题 + review 闭环，但不是完整 investigation ledger。报告 `10` 标 PARTIAL。

## 已修复的缺陷

- Shared interest 不再直接生成 Morrow-owned thought（`synthesizeFromContext` 只接受 origin=morrow）。
- 合成 thought 的 evidence refs 不再把随机 ID 当真实 turn 来源：它使用 `kind=reflection` 的候选 ref，并明确 sourceRef；它不是对用户事实的断言。
- review 的 independent contexts 按 conversation 去重；lineage 的 summary/paraphrase/duplicate 不增加独立 context。
- scheduler 不在用户未发起时联网或执行工具。

## 未完成

- goal stall 未从真实 CompanionGoal 的进展时间计算（`goalStalls` 参数存在但 scheduler 未接）。
- 没有完整 hypothesis/investigation/conclusion 状态迁移和持久化。
- 没有独立 rejection/suspension UI/API。
- 没有真实 ChatService 从 experience→exploration→investigation→conclusion 的 live 集成测试。

下一轮若继续，最小改动应是新增 exploration record + transition 表，并复用现有 thought review，而不是另造第三套兴趣/反思账本。
