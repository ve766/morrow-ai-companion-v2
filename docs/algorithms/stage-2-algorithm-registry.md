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
| 开发集 | `evals/stage-2/topic-identity-devset.json`（**26 对**，人工标注，devset v2）；报告脚本 `npm run eval:topic-identity` |
| 共享串的"内容"口径 | 最长共享串只在**内容字符**上计算：剔除虚词/代词/程度副词/时间框架（`我/的/了/在/是/最/近/一/直/也/还…`），实词（`学/练/做`）**不剔**——它们出现在 `天文学/数学` 这类名词里，剔了会丢真匹配 |
| 框架碰撞防护 | `我最近在学咖啡拉花` / `我最近在学吉他` 曾因共享 5 字框架 `我最近在学` 被判同一主题（场景 G 抓到）。剔除框架后共享串降为 1，分数 0.3905 → `ambiguous`，不合并 |
| 标签 | `longestContentPhrase` 取原文中最长的**内容字符连续段**，再裁掉前导虚词（`学吉他`→`吉他`、`对天文学`→`天文学`）；只裁前导，尾部实词可能是名词的一部分（`天文学` 裁尾会变 `天文`，语义变宽） |
| 开发集指标 | precision **1.000**、recall **0.889**、FP **0**、FN **1**（`p03`）；歧义 3 对 —— **开发集结果，非总体校准** |
| 门禁语义 | `eval:topic-identity` **只以 FP 为门禁**（误合并会把错误兴趣永久写进长期层），recall 缺口只报告不判失败；脚本每次打印该行，避免把「报告」误读成「全绿」 |
| 结果溯源 | 报告 JSON 带 `headSha`（生成时 `git rev-parse HEAD`）与 `generatedAt`，与 `results/*.json` 同一约定 |
| 证据账本 | 迁移 24 `interest_evidence`（`(interest_id, evidence_ref)` 主键 + `evidence_ref` 唯一索引）为唯一真相，`interests.evidence_count/conversation_count` 降为缓存 |
| 幂等 | 一条观察只能归入一个兴趣；重放同一 `message_id` 不增加证据 |
| 撤回 | 删除消息/会话由触发器清理证据；读取时按证据折叠重算，`active` 不达标即降级，证据清零则整条删除 |
| 测试 | `topic-identity.test.ts`（12 条，含框架碰撞与标签）、`interest-evidence.test.ts`（11 条）、评测场景 B5（5 条断言）、场景 G（4 条晋升门槛） |
| 已知局限 | 短句仅共享 2 字中心词时（`我在学手冲咖啡` / `最近一直在练手冲`）判为不同，属召回损失，不是误合并；迁移前写入的历史证据无消息归属，无法按消息撤回 |

## 12. 轮次上下文保真（Stage 2 A/F 场景，本次实现）

| 项 | 值 |
|---|---|
| 位置 | `src/cognition/turn-context.ts`（字段与校验）、`src/app/companion-service.ts`（写入与最终化） |
| 新字段 | `intent.contextDependency: 'none' \| 'prior_turn' \| 'unresolved'`（可选，v2 内向后兼容；旧行无此字段仍可读） |
| 为什么单独存 | 指代是否命中与"哪个标签胜出"是两件事：`它最难的部分是什么？` 的胜出标签是 `information_query`，`reasons` 里没有 `reference_to_prior_turn`，只看 `reasons` 会漏掉它依赖上文这一事实 |
| 判定 | `reasons` 含 `reference_without_context` → `unresolved`；`dependsOnPriorTurn` → `prior_turn`；否则 `none` |
| 修掉的缺陷 1 | `cognitive_turn_contexts` 的 upsert 条件是 `status <> 'succeeded'`，成功轮次写完之后，**它自己的**最终化补丁被这条 SQL 静默丢弃 → `feeling.applied` 恒为 false、`after` 永远停在提交前的投影值。改为"禁止降级"：`status <> 'succeeded' OR excluded.status = 'succeeded'` |
| 修掉的缺陷 2 | `SqliteDatabase.transaction` 不支持嵌套：最终化在写事务里读状态，`snapshot()` 内部再开事务抛 `cannot start a transaction within a transaction`，被吞掉后返回默认值（`sourceEventId=null`）→ `applied` 判 false。改为嵌套时使用 `SAVEPOINT`，内层读能看到外层未提交写入，内层失败只回滚内层 |
| 修掉的缺陷 3 | `after` 是提交前的投影，revision 与真实状态不一致；事件落库后用已提交状态回填 |
| 测试 | `turn-context-fidelity.integration.test.ts`（3 条，真 SQLite）、`persistence.test.ts` 嵌套事务 2 条、评测场景 A（4 条）/F（5 条） |

## 13. 证据失效与反转折叠（Stage 2 P0-A / P0-B，本次实现）

| 项 | 值 |
|---|---|
| 位置 | 迁移 25（`src/persistence/migrations.ts`）、`src/self-model/interest-service.ts`（`fold` / `evaluate` / `derivedStatus`） |
| 记忆证据失效 | `interest_evidence.evidence_revision` 记录被观察的修订号；`DELETE ON memories` 删证据；`status` 变非 `active` 删证据；`revision` 增大**且 `current_text` 变化**只删旧修订证据 |
| 为什么比较文本 | `confirm` 也升 revision 但措辞不变；只看 revision 会让一次确认误删有效证据 |
| 折叠顺序 | 按 `(created_at, evidence_ref)` 升序；`latestPolarity` 取末行，`recentCounters` = 末次支持之后的 counter 数 |
| 净支持 | `effectiveSupport = max(0, support − recentCounters)`；驱动状态、强度、置信度 |
| 状态规则 | ① `dropped`/`archived` 不被证据覆盖；② `latestPolarity='counter'` → `candidate`（立即暂停，保留历史）；③ 否则 `conversationCount ≥ 2 且 effectiveSupport ≥ 3` → `active` |
| 为什么只扣"末次支持之后"的 counter | 否则 `喜欢→不喜欢→又喜欢` 永远无法恢复；反过来，新 counter 也不会被旧 support 永久压过 |
| 显示口径 | `evidence_count` 存 raw support（"依据 N 次"是发生过的事实）；`effectiveSupport` 与 `support`/`counter`/`recentCounters` 一并写入 `interest.observed` / `interest.recomputed` 事件 |
| 删除来源后重算 | 证据行由触发器在同一事务删除；`list()` / `activeForContext()` 经 `reconcile` 重折叠并写回缓存 |
| 测试 | `interest-invalidation.test.ts`（9 条）、`interest-payload-invalidation.integration.test.ts`（2 条，读最终序列化 payload）、`migrations.test.ts`（v24→v25） |

## 14. B1–B4 接线现状（本轮核实，逐项给出代码位置与行为证据）

| 项 | 状态 | 代码位置 | 行为证据 / 缺口 |
|---|---|---|---|
| B1 意图置信度 | **PARTIAL（未接线，两个具体阻塞点）** | `intent-confidence.ts` 计算；`cognitive-turn-analyzer.ts` 只记录 `assessment`，策略仍由 `reference_without_context` / `correctionNeedsDetail` / `needsMemoryRetrieval` 决定 | 试接 `intent === 'uncertain' → clarify`：标注语料 strategyAccuracy 从 **1.000 降到 0.885（23/26）**，因为语料把这些轮次标为 `answer`。按数据回退；`cognitive-turn-analyzer.test.ts` 新增两条把该测量与"低置信度不强制追问"钉住。缺口有三个，都实测过：①**分数主要由"有没有上文"驱动，不由请求模糊度驱动**——同一句 `我住在哪里？`，首轮 0.780、有上文 0.947，差 0.167 全来自缺失的 `history` 分量（`cognitive-turn-analyzer.test.ts` 已钉住）；用它调检索宽度会在每个会话第一轮误伤清晰问句，实测接入后 `我住在哪里？` 首轮被收窄、探索请求被收窄到 3 条；②**接线方向与标注数据冲突**——`uncertain→clarify` 让语料准确率 1.000→0.885；③**没有落地字段**——评估值不在 `CognitiveTurnAnalysis`（`exactKeys` 严格校验），要持久化须加字段并升 schema 版本 |

接入检索宽度这条试过并回退了：规则是"弱读少召回"，但探索型请求天然低分（0.79 左右），会把用户明确要求广度的轮次收窄——第一次实现让 `cognitive-continuity-phase24` 的探索加宽测试从 5 条掉到 3 条。改为排除探索意图后仍不成立：首轮清晰问句照样被收窄。**结论：在分数具备区分度之前，B1 不接线。** |
| B2 人格稳定 | **PASS（已接线）** | `personalization-service.ts`、迁移 22；`savePersonality` 只有用户编辑才升版本 | 场景 E 4 条断言：4 轮情绪/反馈后版本与数值不变、无静默修订、载荷文案逐轮一致；`personalization-service.test.ts` 13 条含撤回重算与 `personalizationFit` 2 条 |
| B3 上下文效用 | **PASS（P/X/D 全部接线）** | `memory-context-assembler.ts` `rankScore`；`MemoryService.conflictedIds` | **X**：候选集内措辞重叠 → 冲突记录排到同分记录之后（`memory-context-assembler.test.ts` 3 条排序断言：X、D、P 各一条）。**D**：`STALE_UNCONFIRMED_DAYS = 120`（源码同值），未确认且超过该天数的陈旧度按 `(age−120)/120` 线性计入，上限 1。**P 已接线**：`PersonalizationService.personalizationFit` 把"记忆是否在讲某个交互维度"（depth/pace/exploration 的关键词）与"该维度被用户推离 0.5 的距离"结合，得到 [0,1] 的偏好吻合度；没提到任何维度的记忆恒为 0，没有证据的维度也恒为 0（未动的 0.5 不是偏好） |
| B4 轮次状态机 | **PASS（9 个状态全部有真实写入点）** | `companion-service.ts` `recordTurnState`；`turn-state-machine.ts` 转换表 | 见下方逐状态表。`turn-state-sequence.integration.test.ts` 用记录型端口断言成功轮次 7 步序列、失败轮次止于 `failed`，并钉住 `recovery_required` 两条入边 |

### 14.1 B4 逐状态写入点（源码 `companion-service.ts`）

| 状态 | 写入位置 | 触发条件 |
|---|---|---|
| `received` | `sendChat` 取得会话锁后 | 每轮第一条 |
| `analyzed` | 第一次 `prepare()` 之后 | 分析完成（`reason` 区分 `analysis_ready` / `analysis_unavailable`） |
| `context_ready` | 同上之后 | 载荷已组装 |
| `awaiting_consent` | `authorize(preview)` 之前 | 等待用户授权 |
| `requesting` | `dispatchToProvider` 之前 | 请求已发出 |
| `response_received` | provider 返回后 | 收到回答 |
| `committed` | 写库成功后 | 回答已持久化 |
| `failed` | provider/存储异常分支 | 带错误码 |
| `cancelled` | 取消或 `PROVIDER_CANCELLED` | 用户中止 |
| `recovery_required` | `recoverInterruptedTurns` | 有最终化意图但回答未投递 |

约束：`turn_states` 每轮一行（只存最新状态），因此"序列"由测试侧包装端口观测，不是从库回读。

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
