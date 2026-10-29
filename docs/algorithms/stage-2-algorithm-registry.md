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
| 原子性 | `apply()` 在一个 `BEGIN IMMEDIATE` 事务内完成「插入证据 + 折叠重算 + 写缓存」，异常即 ROLLBACK |
| 唯一真相 | `personalization_signals` 是证据源，`personalization_state` 只是缓存；每次读取都按证据折叠，发现不一致即修复 |
| 归一化 | signal 夹到 [-1,1]、weight 夹到 [0,1] **在写库前完成**，DB CHECK 与算式看到同一组数字；NaN/Infinity/非法时间戳直接拒绝 |
| 撤回 | `forgetTurn(turnId)` 删除该轮信号并**重算**；即使只由 SQL 触发器删了信号，下一次 `get()` 也会重算并回填缓存（已删除来源的偏好不会留在提示词里） |
| 持久化 | 迁移 22：`personalization_state`（值）+ `personalization_signals`（逐轮证据） |
| 删除边界 | `AFTER DELETE ON messages` 触发器按 `turn_id` 清理信号（迁移 22） |
| 写入时机 | `CompanionService` `onTurnCompleted`（真实轮次完成） |
| 读取时机 | `buildSelfModelContextBlock` → 下一轮 system 提示词 |
| 信号来源 | `intent ∈ {planning, exploration}` → exploration +0.5/w0.6；`explicitConstraint` → pace −0.5/w0.8；`explicitMemoryRequest` → depth +0.5/w0.6 |
| 边界声明 | 这是**未校准的启发式**，不是情绪或心理测量；提示词中明确写"rule-derived heuristic, uncalibrated" |
| 测试 | `src/personalization/personalization-service.test.ts`（6 条，含"第 1 轮写入 → 第 2 轮 payload 出现"端到端） |

## 7. 轮次状态机（Stage 2 B4，本次实现）

| 项 | 值 |
|---|---|
| 状态集 | `received / analyzed / context_ready / awaiting_consent / requesting / response_received / committed / failed / cancelled / recovery_required` |
| 位置 | `src/cognition/turn-state-machine.ts`（转换表）、`src/persistence/turn-state-repository.ts`（持久化） |
| 持久化 | 迁移 23 `turn_states(turn_id PK, conversation_id, state, updated_at, reason)`，含会话/消息删除触发器 |
| 约束 | 目标状态必须把当前状态列为前驱，否则抛 `IllegalTurnTransition` 且**不覆盖**已存状态 |
| 幂等 | 重复进入同一状态是 no-op，不刷新时间戳（恢复与重试可安全重放） |
| 已接线点 | `received`（加锁后）、`context_ready`（载荷哈希校验通过）、`requesting`（派发前）、`response_received`（派发返回）、`committed`（assistant 消息落库后）、`failed`/`cancelled`（catch 分支，reason 为错误码） |
| 未接线 | `analyzed`、`awaiting_consent`、`recovery_required`（转换表已定义，暂无写入点） |
| 失败语义 | 状态写入失败被吞掉，不影响聊天；非法转换只在测试中暴露 |
| 测试 | `src/cognition/turn-state-machine.test.ts`（6 条：合法链、跳阶段拒绝、重放幂等、终态判定、非法转换不覆盖、会话删除清理） |

## 8. 多信号意图置信度（Stage 2 B1，本次实现）

| 项 | 值 |
|---|---|
| 公式 | `s = α·r + β·c + γ·e + δ·h`（各分量先归一化到 [0,1]） |
| 权重 | `rule 0.45`、`context 0.25`、`evidence 0.15`、`history 0.15`（`INTENT_CONFIDENCE_WEIGHTS`） |
| 位置 | `src/cognition/intent-confidence.ts` → `assessIntentConfidence`；由 `cognitive-turn-analyzer.ts` 在决策时调用 |
| 缺失信号 | **按可用分量重新归一化**，不用 0 或 1 填充；`missing` 列出缺哪几项 |
| 全部缺失 | `confidence=0` 且 `needsClarification=true`（"没测到"不等于"确定错了"） |
| 澄清阈值 | `CLARIFY_THRESHOLD = 0.45`；存在备选时额外要求 `s ≥ 0.55`（`CLARIFY_MARGIN = 0.10`） |
| 校准声明 | `calibration: 'uncalibrated_rule_evidence'` —— 明确不是概率 |
| 已接线 | 决策时计算并随 `CognitiveTurnReading.assessment` 返回 |
| **未接线（诚实标注）** | **尚未覆盖 `strategy`**：把 `ambiguous` 一律改为 clarify 会移动离线认知评测基线，阈值需先用标注数据重标定，故本轮只计算不改变行为 |
| 测试 | `src/cognition/intent-confidence.test.ts`（5 条：加权/归一化、缺失重归一、全缺失必澄清、弱信号与接近候选、越界与 NaN 夹紧） |

## 9. 上下文块效用（Stage 2 B3，本次实现）

| 项 | 值 |
|---|---|
| 公式 | `U(c) = wr·R + wf·F + wq·Q + wp·P − wx·X − wd·D` |
| 权重 | `relevance 0.40`、`freshness 0.25`、`quality 0.20`、`preference 0.10`、`conflict 0.15`、`stale 0.05`（`CONTEXT_UTILITY_WEIGHTS`） |
| 位置 | `src/cognition/context-utility.ts`；被 `memory-context-assembler.ts` 的 `rankScore` 调用 |
| 归一化 | 每个分量先夹到 [0,1]，非有限值按 0 处理；结果范围 `−(wx+wd) … wr+wf+wq+wp` |
| 新近度 | `F = 2^(−Δt/30天)`（`FRESHNESS_HALF_LIFE_DAYS = 30`） |
| 质量 | `Q = confidence/100 × 来源可靠性`（用户明说 1.0，其余 0.5） |
| 硬排除 | 撤回/被取代/越权记录在**打分之前**已过滤；负权重不是隐私控制，排除才是 |
| 审计 | 每次打分返回 `reason` 码（relevant/high_quality/fresh/conflict/stale/low_signal） |
| 已接线 | `rankScore` 全量替换（记忆排序） |
| **未接线** | `P`（preference）当前恒为 0 —— 个性化信号尚未进入排序；`X`/`D` 也为 0，因为冲突披露与过期判定在其它层。这三项在注册表里明确标为未接线，不计为完成 |
| 测试 | `src/cognition/context-utility.test.ts`（5 条：单调性/上下界、惩罚项、越界与 NaN 夹紧、reason 码、半衰期） |

## 10. 长期层（兴趣 / 反思）

| 项 | 值 |
|---|---|
| 位置 | `src/self-model/interest-service.ts`、`reflection-service.ts` |
| 触发 | 轮次完成后 `interests.observe` + `archiveStale`；`reflection.run('post_conversation')` |
| 限流 | 反思每小时硬限额 + 每轮候选上限（见源码） |
| 失败隔离 | 异常被捕获并记录降级事件，不阻塞聊天 |

## 11. 主题同一性匹配（Stage 2 B5 根因修复，本次实现）

| 项 | 值 |
|---|---|
| 位置 | `src/self-model/topic-identity.ts` → `scoreTopicProfiles`；由 `InterestService.observeInner` 调用 |
| 公式 | `score = 0.30·Jbigram + 0.10·Junigram + 0.45·Containment(preferred) + 0.15·[sharedPreferred≥2] + runBonus` |
| `runBonus` | 最长共享串：Han ≥4 字 或 latin ≥3 词 → +0.30；Han =3 字 或 latin =2 词 → +0.20；更短不加分 |
| 阈值 | `TOPIC_SAME_THRESHOLD = 0.45`；`TOPIC_AMBIGUOUS_THRESHOLD = 0.35`（歧义带内**不合并**，保留独立候选并记录 `ambiguous`） |
| 归一化 | NFKC → 小写 → 去标点/全角符号 → 合并空白；Han 按字、latin 按词（不按字母） |
| 否定 | 命中 `不/没/别/未/无/非/not/never/n't/dislike/hate`，且先剔除 `特别/别的/不错/没错/无论…` 等非否定词 |
| 硬约束 1 | 上位词：较短一侧内容单元 ≤1 且较长 ≥2 → `hypernym_or_too_short`，直接 `different` |
| 硬约束 2 | 同槽替换：单元集对称差 ≤2 且 Jaccard∈[0.5,1) → `object_substitution_suspected`，降为 `ambiguous`（永不合并） |
| 硬约束 3 | 极性冲突 → `polarity_conflict`，记**反证**而非支持证据 |
| 可审计 | 返回 `signals`（五项分量 + `sharedRun`）与 `reason` 码；事件 `interest.observed` 带 `nearestScore/nearestReason/ambiguous` |
| 开发集 | `evals/stage-2/topic-identity-devset.json`（23 对，人工标注）；报告脚本 `npm run eval:topic-identity` |
| 开发集指标 | precision **1.000**、recall **0.875**、FP **0**、FN **1**（`p03`）；歧义 3 对 —— **开发集结果，非总体校准** |
| 证据账本 | 迁移 24 `interest_evidence`（`(interest_id, evidence_ref)` 主键 + `evidence_ref` 唯一索引）为唯一真相，`interests.evidence_count/conversation_count` 降为缓存 |
| 幂等 | 一条观察只能归入一个兴趣；重放同一 `message_id` 不增加证据 |
| 撤回 | 删除消息/会话由触发器清理证据；读取时按证据折叠重算，`active` 不达标即降级，证据清零则整条删除 |
| 测试 | `topic-identity.test.ts`（10 条）、`interest-evidence.test.ts`（11 条）、评测场景 B5（5 条断言） |
| 已知局限 | 短句仅共享 2 字中心词时（`我在学手冲咖啡` / `最近一直在练手冲`）判为不同，属召回损失，不是误合并；迁移前写入的历史证据无消息归属，无法按消息撤回 |

---

## 未实现（不得计入已登记）

| 算法 | 状态 |
|---|---|
| ~~多信号意图置信度~~ | **已实现**（见 §8）；仅计算并暴露，尚未覆盖 strategy |
| ~~渐进式个性化~~ | **已实现**（见 §6；参数与写入/读取位置已登记） |
| ~~上下文块效用 `U(c)`~~ | **已实现并用于记忆排序**（见 §8）；`P/X/D` 三项未接线 |
| ~~持久化轮次状态机~~ | **已实现并接线**（见 §7；`analyzed`/`awaiting_consent`/`recovery_required` 尚未有写入点） |
| ~~兴趣主题同一性匹配~~ | **已实现**（见 §11；阈值与开发集指标已登记） |
| 记忆置信度更新 `c' = clip(c + ηe·E − ηk·K − ηu·U)` | **未实现** |

以上五项在 `docs/reports/stage-2-final-delivery.md` 中同时标记为未完成，不因本表存在而变化。
