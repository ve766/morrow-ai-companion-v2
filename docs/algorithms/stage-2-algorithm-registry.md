# Stage 2 算法登记表（v1）

登记范围：已经存在于源码、并且位于真实聊天调用链上的算法。
未实现的算法在文末单列，不在此表中冒充"已登记实现"。

参数值只在能从代码中直接读到的情况下填写；无法确认的一律写"见源码"，不估算。

---

## 1. 意图判断（规则层）

| 项 | 值 |
|---|---|
| 版本标识 | `INTENT_DECISION_VERSION = 'intent-rules-v1'` |
| 位置 | `src/cognition/intent-decision.ts` → `decideIntent` |
| 输入 | 当前轮文本（已去引号/转述）、是否有上轮、上轮用户文本 |
| 输出 | `IntentDecision { intent, alternatives, confidence(0–100), confidenceLevel, reasons, dependsOnPriorTurn, needsMemoryRetrieval }` |
| 标签集 | 12 个 `IntentLabel`（information_query / continuation / correction / preference_expression / emotion_expression / goal_or_plan / new_topic / ambiguous / self_fact / explanation / exploration / feedback） |
| 置信度性质 | **未校准的规则强度，不是概率**。代码注释与 `confidenceBasis: 'unvalidated_rule_strength'` 均标明 |
| 分级阈值 | `confidence >= 80 → high`；`>= 55 → medium`；否则 `low` |
| 强制降级 | `ambiguous` 置信度上限 74；无法解析指代时上限 62 |
| 调用方 | `analyzeCognitiveTurnDetailed` → `ChatService.prepare` |
| 失败模式 | 无匹配规则 → 低置信度 + 保守策略；不自动执行高影响操作 |

## 2. 轮次分析（信号与策略）

| 项 | 值 |
|---|---|
| 版本标识 | `COGNITIVE_ANALYZER_VERSION` |
| 位置 | `src/cognition/cognitive-turn-analyzer.ts` |
| 历史预算 | 最近 12 条消息，合计 6000 字符（`COGNITIVE_HISTORY_LIMIT_*`） |
| 输出信号 | correction / negation / changedMind / explicitGoal / explicitConstraint / explicitMemoryRequest / explicitMemorySaveRequest / explicitSelfFact / topicSwitch |
| 不确定性 | `low / medium / high`；`confidence < 50` 或反讽标记 → high，`< 72` 或存在备选 → medium |
| 策略 | `clarify` / `retrieve_memory` / `answer`；仅"无法解析的指代"与"过短的纠正"触发 clarify |
| 话题来源 | `current` / `previous_user_message` / `none` |
| 调用方 | `ChatService.prepare`；结果随用户消息落库（`cognitiveObservations`） |

## 3. 记忆检索与上下文装配

| 项 | 值 |
|---|---|
| 位置 | `src/memory/retrieval-policy.ts`、`src/memory/memory-context-assembler.ts`、`src/cognition/retrieval-attention.ts` |
| 输入 | 意图策略、查询文本、记忆库、内在状态探索优先级 |
| 输出 | 选中记忆（含 id/来源/敏感度/修订/分数）、冲突披露、省略计数、`baseMax`/`effectiveMax`/`adjustment` |
| 硬约束 | 撤回/删除/失效/超权限记忆不进入上下文；纠正后的新版本优先；预算上限不可被挤占 |
| 单轮上限 | `MAX_SELECTED = 25`（写入轮次上下文时截断） |
| 端口上限 | 由 `retrieval-attention` 按探索优先级做**有界**调整，`adjustment` 记录原因 |
| 调用方 | `ChatService.prepare` → 序列化请求 |

## 4. 自我模型事实派生（Stage 2 新增）

| 项 | 值 |
|---|---|
| 位置 | `src/self-model/self-fact-statement.ts` → `deriveSelfFactStatement` |
| 输入 | 一轮用户原文 |
| 输出 | `「谓词：值」` 或 `null` |
| 参数 | 语句上限 80 字符；值上限 40 字符；仅接受 `assertion` |
| 依赖 | `readFactSlot`（`src/memory/fact-slot.ts`），谓词集 11 类 |
| 行为 | `null` 时**不写库**，记录降级事件 `self_model_fact_unstructured` |
| 调用方 | `CompanionService` 的 `onTurnCompleted`（真实轮次结束） |

## 5. 内在状态

| 项 | 值 |
|---|---|
| 位置 | `src/affective-state/cognitive-feeling-engine.ts`、`cognitive-feeling-service.ts` |
| 维度 | valence / activation / tension / explorationPriority |
| 更新 | 事件驱动 + 幂等键（requestId）+ 半衰期衰减 |
| 参数 | 见源码常量；本表不重复抄写，避免与实现漂移 |
| 调用方 | `send` 成功/重放路径；状态修订号写入轮次上下文 |

## 6. 渐进式个性化（Stage 2 B2，本次实现）

| 项 | 值 |
|---|---|
| 公式 | `p' = clip(p + η·w·e, 0, 1)` |
| 参数 | `η = PERSONALIZATION_ETA = 0.05`；`w ∈ [0,1]` 证据可靠性；`e ∈ [-1,1]` 有符号信号；上下界 0/1 |
| 位置 | `src/personalization/personalization-service.ts` → `boundedUpdate` / `apply` |
| 维度 | `exploration` / `depth` / `pace`（`PERSONALIZATION_DIMENSIONS`） |
| 默认值 | 0.5（中立中点）；**证据数为 0 时不进入提示词**，默认值不被表述为"结论" |
| 单轮上限 | 每轮每个维度最多移动 `η·w ≤ 0.05` —— 单条消息无法改写人格 |
| 幂等 | `personalization_signals(dimension, turn_id)` 主键；重复 turn 不叠加 |
| 撤回 | `forgetTurn(turnId)` 删除该轮信号并按剩余信号**重算**，回到 0.5 而非"略低于 0.5" |
| 持久化 | 迁移 22：`personalization_state`（值）+ `personalization_signals`（逐轮证据） |
| 删除边界 | `AFTER DELETE ON messages` 触发器按 `turn_id` 清理信号（迁移 22） |
| 写入时机 | `CompanionService` `onTurnCompleted`（真实轮次完成） |
| 读取时机 | `buildSelfModelContextBlock` → 下一轮 system 提示词 |
| 信号来源 | `intent ∈ {planning, exploration}` → exploration +0.5/w0.6；`explicitConstraint` → pace −0.5/w0.8；`explicitMemoryRequest` → depth +0.5/w0.6 |
| 边界声明 | 这是**未校准的启发式**，不是情绪或心理测量；提示词中明确写"rule-derived heuristic, uncalibrated" |
| 测试 | `src/personalization/personalization-service.test.ts`（6 条，含"第 1 轮写入 → 第 2 轮 payload 出现"端到端） |

## 7. 长期层（兴趣 / 反思）

| 项 | 值 |
|---|---|
| 位置 | `src/self-model/interest-service.ts`、`reflection-service.ts` |
| 触发 | 轮次完成后 `interests.observe` + `archiveStale`；`reflection.run('post_conversation')` |
| 限流 | 反思每小时硬限额 + 每轮候选上限（见源码） |
| 失败隔离 | 异常被捕获并记录降级事件，不阻塞聊天 |

---

## 未实现（不得计入已登记）

| 算法 | 状态 |
|---|---|
| 多信号意图置信度 `s = αr + βc + γe + δh` | **未实现**。当前只有单一规则强度 |
| ~~渐进式个性化~~ | **已实现**（见 §6；参数与写入/读取位置已登记） |
| 上下文块效用 `U(c)` | **未实现**。装配器按相关度/新近度/预算截断，非该公式 |
| 持久化轮次状态机（created→…→committed） | **未实现**。只有 `succeeded/failed/cancelled` 终态 |
| 记忆置信度更新 `c' = clip(c + ηe·E − ηk·K − ηu·U)` | **未实现** |

以上五项在 `docs/reports/stage-2-final-delivery.md` 中同时标记为未完成，不因本表存在而变化。
