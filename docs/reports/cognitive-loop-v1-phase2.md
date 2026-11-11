# Cognitive Loop V1 / Phase 2 — 意图—记忆—证据—回答闭环

任务代号 CL-P2。本轮同时收口 Slice 2.2 遗留的事实语义问题，并建立意图理解、意图驱动的记忆选择、可追溯证据投递、回答后评估与回合账本。

## 1. 基线与最终状态

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 基线分支 | `feat/cognitive-loop-v1-slice2-2`（PR #11，Draft） |
| 基线 SHA | `d1d22ae`（开工前实测 CI run `40640977858` 三平台 success） |
| `main` | `8b207b7`，本轮未改动 |
| 本轮分支 | `feat/cognitive-loop-v1-phase2`（从基线新建） |
| 代码提交 | `df53b08` → `63435b6` → `4af0923` → `0c2d74b` → `c9345ce` |
| 报告提交 | 本文件所在提交（最终 SHA 见 PR #12） |
| 迁移 / 新依赖 | 无。数据库 schema 仍为 v24，未新增表、未改存储格式 |

## 2. 缺陷、根因与修复

### 2.1 工作包 A：事实语义与时间状态

| # | 输入 | 原行为 | 根因 | 新行为 |
|---|---|---|---|---|
| 1 | `我今年几岁` | `uncertain` | 只有 `多少岁` 被识别为提问 | `question` |
| 2 | `我住在杭州吗？` | `question`（值残留 `杭州吗`） | 语气判定与取值分离不彻底 | `question`，值清空 |
| 3 | `我以前对花生过敏，现在不过敏了` | 单条当前事实 | 跨分句极性未合并 | `uncertain` + `time=mixed` |
| 4 | `我以前喜欢猫，但现在不喜欢了` | `negated`（取末句） | 同上 | `uncertain` + `time=mixed` |
| 5 | `我下周的安排是去大阪出差` | `time=unspecified` | 无 future 状态 | `time=future` |
| 6 | 过去事实回答现在问题 | 视为候选证据 | 无「查询时间 vs 记忆时间」规则 | 时间不兼容，不能作为等价证据 |
| 7 | `我喜欢猫` vs `我喜欢狗` | `conflict` | 极性/取值差异一律算冲突 | `uncertain`（多值事实可同时成立） |
| 8 | `我喜欢猫` vs `我喜欢猫狗` | `uncertain` | 包含关系 | `uncertain`（保持） |

实现要点：先按标点切分句（**不**按 `不过/但` 切，避免 `不过敏` 被切断），逐句做「谓词识别 → 取值 → 语气/极性 → 时间」，再合并。合并规则：出现转述/假设/模态/双重否定 → `uncertain`；两个不同的确定时间或两种不同极性 → `mixed` + `uncertain`；同谓词同极性同值 → 保留。省略宾语的第二句（`现在不过敏了`）通过谓词标记继承兄弟句的宾语，而不是产生空值。

### 2.2 工作包 B：意图理解

新增 `src/cognition/intent-decision.ts`，成为**唯一**的意图分类器；`cognitive-turn-analyzer.ts` 不再保留第二套关键词表，只保留供提示词与自我模型使用的特征信号。

- 类别：`information_query`、`continuation`、`correction`、`preference_expression`、`emotion_expression`、`goal_or_plan`、`new_topic`、`ambiguous`，另加 `self_fact`（纯自我陈述，既非偏好也非提问）与保留的 `explanation`/`exploration`/`feedback`。
- 每个决策输出：`intent`、`confidence`（规则强度，非概率）、`confidenceLevel`、`needsMemoryRetrieval`、`dependsOnPriorTurn`、`mayProduceMemoryCandidate`、`reasons`（可审计的规则代码）、`alternatives`。
- 强度 = 该类别最强规则权重 + 最多 8 分的多规则佐证；**避免**三个弱线索加总压过一条显式标记（这正是 `为什么天空是蓝色的？` 一度被读成普通提问的原因）。
- 短指代无上下文 → `ambiguous` 且 `strategy=clarify`；有上下文 → `continuation`，且即使解释/纠正是更强类别，仍保留「依赖前文」并解析引用消息。
- `correction` / `preference_expression` / `goal_or_plan` 只产出**候选**权限（`mayProduceMemoryCandidate`），不写记忆、不改人格。
- 假设与转述（`如果…`、`听说…`）不再被读成偏好表达。

映射到持久化：`continuation → information_query`、`preference_expression → sharing`、`emotion_expression → venting`、`goal_or_plan → planning`、`ambiguous → uncertain`、`self_fact → sharing`、`new_topic → information_query`。`new_topic` 刻意**不**映射为 `exploration`：affect 引擎把 `exploration` 当作「用户邀请头脑风暴」，映射过去会凭空产生探索事件（本轮实测发现并修正）。

### 2.3 工作包 C：意图驱动的记忆选择

新增 `src/memory/retrieval-policy.ts`。评分公式保持不变：

```
score(q,m) = 1.00·S_slot + 1.00·min(1, contentOverlap/2) + 0.25·S_temporal + 0.20·S_source
```

策略只做**收窄**：

| 意图 | 上限 | 谓词过滤 | 准入 | 冲突证据 |
|---|---|---|---|---|
| information_query / continuation / correction | 25 | 无 | 短语/内容词/槽位 | 允许 |
| preference_expression | 10 | preference | 需内容重合 | 允许 |
| emotion_expression | 3 | 无 | 需内容重合 | 拒绝 |
| goal_or_plan | 10 | goal / schedule | 短语/内容词/槽位 | 允许 |
| new_topic | 10 | 无 | 需内容重合 | 拒绝 |
| ambiguous | 3 | 无 | 需内容重合 | 拒绝 |
| self_fact | 5 | 无 | 需内容重合 | 允许（便于暴露矛盾） |
| feedback | 0 | 无 | — | — |

边界：策略无法越过 `status=active`、敏感度上限、撤回状态；测试逐条覆盖「换任何策略都不放宽敏感度」「撤回记录任何策略都进不来」。

### 2.4 工作包 D：可追溯证据与回答评估

投递条目（`Saved memories` JSON）每条携带：`id`、`content`、`sourceCategory`、`confidence`、`status`、`sensitivity`、`updatedAt`、`revision`、`time`、`predicate`，冲突时附 `conflictWith`。块内 instruction 保持短句（与证据共用 3000 字符预算）；行为规则放在提示词指引中，且**仅在确有证据投递时**出现（避免无关回合浪费预算，也让 alpha 的 1200 字符上限继续成立）。

回答后评估（`src/cognition/answer-evidence-evaluation.ts`）输出六类之一：`used_correctly`、`delivered_not_used`、`used_wrong_or_stale`、`contradicts_evidence`、`reasonable_unknown`、`not_scorable`，并记录匹配/被反驳的证据 ID 与稳定原因码。

本轮修掉一个评测器自身的 false pass：极性只检查取值之前，导致「好的，花生不引起过敏反应」被判成正确使用。现在检查取值两侧，并检查每一处出现；任一处为肯定即视为肯定。

### 2.5 工作包 E：反馈账本

`TurnEvaluation` 关联：意图决策 → 选中记忆 ID / 冲突 ID / 省略数 / 敏感度上限 → payload sha256 与字符数 → Provider 结果 → 回答评估。三条通道：

1. 返回给调用方（`ChatResult.evaluation`，可选字段）；
2. 追加写入事件日志（`cognition.turn.evaluated`，payload 有界、不含回答文本与记忆正文）；
3. `CompanionService` 新增可选 `ledger` 观察者（只读记录）。

边界：账本不写记忆、不改人格、不改准入；单次回答评分不触发任何长期更新。集成测试验证「偏好/情绪各一轮后人格版本不变、记忆条数不变、无候选产生」。

### 2.6 工作包 F：评测

- `evaluate:cognition` 新增第 4 个确定性评测：`intent-decision-v1.json`（25 例，覆盖 8 个必需类别 + 3 个保留类别），逐类召回与路由门禁，0 次 Provider / 0 次网络调用。
- 新增真实模型基准 `scripts/cognitive-phase2-benchmark.ts`，覆盖 14 个场景类，逐轮用回答评估计分。

## 3. 完整闭环调用链

```
ChatService.send
  └─ prepare()
       ├─ analyzeCognitiveTurnDetailed()        // 唯一意图决策
       │     ├─ decideIntent(content, hasPrior, priorBody)
       │     └─ featurePatterns → signals（提示词/自我模型用）
       ├─ buildRetrievalQuery()                 // 当前话语 + 解析到的引用 + 必要时上一条用户消息
       ├─ MemoryService.assembleContext(q, ceiling, policyForIntent(intent))
       │     ├─ 过滤 status/sensitivity
       │     ├─ readFactSlot() 逐条 → 槽位/时间/冲突
       │     ├─ 评分 → 策略准入 → 3000 字符贪心装入
       │     └─ 冲突标记 unresolved + conflictWith
       ├─ withCognitiveContextEvidence()        // 记忆修订号进入证据信封
       └─ 组装 system：人格 + 意图指引 + 证据规则(仅当有证据) + affect 指引 + 自我模型 + 记忆块 + 固定原则
  ├─ consentPreview → authorize → 二次 prepare → payload sha 比对
  ├─ 持久化用户消息（含认知观测）
  ├─ dispatchToProvider
  │     └─ 失败/取消 → evaluateTurn(outcome=failed|cancelled) → 记录 → 抛出
  └─ evaluateAnswerEvidence(reply, selected)
       └─ buildTurnEvaluation → ChatResult.evaluation + 事件日志
```

## 4. 算法与边界条件

- 时间：`effectiveTime(unspecified) = present`，仅在**比较**时生效；槽位本身保留 `unspecified`，payload 如实告诉模型「用户从未说过何时为真」。`mixed` 永远不参与等价判定。
- 等价：去地点后缀、去 `的了`、NFKC、小写后完全相等；包含关系不是等价。
- 冲突：同值反极性，或单值事实（住址/年龄/姓名/雇主/职位/项目代号）取不同值。多值事实（偏好/目标/过敏/日程/学习）取不同值 → `uncertain`。
- 检索：`S_slot` 要求同谓词 + 时间兼容 + （查询是疑问 或 值等价）；`uncertain` 槽位不作为准入依据。
- 回答评估：`scored=false` 的样本不计入任何「通过」分子。

## 5. 执行的命令与真实结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过，无输出 |
| `npx vitest run --maxWorkers=2` | **376 passed / 50 files**，0 failed |
| `npm run evaluate:cognition` | `passed: true`；cognitive 26 例（intent 1.0 / strategy 1.0）、feeling 34 例、alpha 28 例（19 例安全关键，全部检查通过）、intent 25 例（intent 1.0 / routing 1.0） |
| `npm run build` | 成功（electron-vite，renderer 79.73 kB） |
| 真实模型基准（`qwen2.5:0.5b`，loopback `127.0.0.1:11434`） | 14 类 × 3 轮 = 42 次调用，见 §6 |

`--maxWorkers` 默认并发下曾出现 15 条 DB 用例 5s 超时；降并发后全绿，判为运行器拥塞，未删改任何断言。

## 6. 真实模型结果（主运行 `00c5c8`）

| 指标 | 数值 | 口径 |
|---|---|---|
| 总调用 | 42 | 14 类 × 3 轮 |
| Provider 成功 / 失败 | 39 / 3 | 3 次失败全部来自「故意失败的 Provider」场景 |
| 记忆选择准确 | **24 / 24** | 期望记忆出现在最终 payload |
| 最终 payload 正确 | **42 / 42** | 无 call/evidence/payload 层失败 |
| 证据使用正确 | 6 / 27 | `used_correctly` / 可评分 |
| 证据已送达未使用 | 18 | `delivered_not_used` |
| 冲突中静默选边 | 3 | `used_wrong_or_stale`，全部来自 explicit_conflict |
| 回答与证据矛盾 | 0 | `contradicts_evidence` |
| 合理承认不知道 | 0 / 12 | 无证据且未承认，记为不可评分 |
| 无证据编造 | **0 / 6** | 车牌探测 3 次 + 撤回/敏感场景 3 次 |
| 误召回（禁用内容进入 payload） | 0 | |
| 漏召回（期望记忆未选中） | 0 | |
| 撤回/敏感泄漏（payload / 回答） | **0 / 0** | |
| 可评分 / 不可评分 | 27 / 15 | 未评分不计作成功 |
| 存储记忆被改写 | 0 | |
| 人格被单轮改写 | 0 | |
| 冲突未声明 | 3 / 3 | 0.5B 每次都直接选了一边 |

### 重复运行差异（`8f3d5f`，同日同模型）

42 次调用中 38 次成功、4 次失败（3 次为故意失败场景，**1 次为本地模型真实失败**）；`used_correctly` 7、`delivered_not_used` 16、`used_wrong_or_stale` 3、`contradicts_evidence` 1、`reasonable_unknown` 1。其中：

- 极性场景出现过一次「你对花生没有任何过敏反应，请放心阅读。」——把已存过敏事实反转，评估器判为 `contradicts_evidence`（正是本轮修掉 false pass 后新增的检出）。
- 撤回/敏感场景出现过一次编造：「您想查询的猫的名字是 "喵星猫"」——被撤回的记忆没有泄漏，但模型自行发明了一个名字。本轮因此给该场景加了编造探测。
- 两次运行中「合理承认不知道」分别为 0/12 与 1/11，说明该行为不稳定。

### 已知的评估器局限（必须一并阅读）

1. 只在取值被明确说出时才判定矛盾。「很好！那么你知道有什么美味的花生吗？」不含极性翻转，被判 `used_correctly`，实际是答非所问。
2. 「你过去说对花生过敏」把当前事实说成过去，未检出（时间改写不在文本级判定范围内）。
3. `delivered_not_used` 只说明证据文本未出现，不区分「换了一种正确说法」与「完全忽略」。
4. 无证据且不承认不知道的样本记为 `not_scorable`，不计通过，也不计入编造（编造需要可检验的具体事实）。

## 7. 与 Slice 1 / 2 / 2.2 的可比指标

| 指标 | Slice 2.2（60 次） | Phase 2（42 次） | 说明 |
|---|---|---|---|
| payload 正确 | 60/60 | 42/42 | 分母不同，仅方向可比 |
| 记忆选择 | 15/15 | 24/24 | 本轮期望记忆的场景更多 |
| 模型使用证据 | 5/10 | 6/27 | 本轮首次对每一轮做六类评估，分母扩大且含大量「证据已投递但模型未用」 |
| 无证据编造 | 0/5 | 0/6 | 探测口径不同（新增撤回/敏感场景） |
| 撤回/敏感泄漏 | 0/0 | 0/0 | |
| Provider 失败 | 0/60 | 3/42（全部为故意失败场景） | 本轮新增失败路径验证 |
| 冲突声明 | 未测 | 0/3 | 新增指标 |

不能据上表断言「模型能力提升」：分母、场景与评估口径都变了。可断言的是：**工程层与语义层没有回归，且新增的冲突声明与失败记录是被测量而非被假设的。**

## 8. 未解决 / 未完成

1. **真实模型能力不足。** 0.5B 模型 27 次可评分中只有 6 次真正使用投递证据，冲突场景 3/3 静默选边。这是模型行为，不是工程缺陷；换更大模型需要重新跑基准，本轮未做。
2. **无人工标注一致率。** 本轮人工通读了全部 42 条回答（42/42），但没有独立的第二标注者，因此不报告评测器与人工的一致率。
3. **时间仅字面标记。** 无相对时间解析（`下周三` 不换算成日期），`mixed` 只按同句多时间词判定。
4. **无语义向量检索。** 检索仍是 CJK 二元组 + 槽位 + 时间 + 来源的启发式。
5. **账本未做长期聚合。** 事件日志已写入，但没有跨回合的统计视图或离线分析脚本。
6. **评估器的三类局限**见 §6 末尾，尚未解决。

## 9. 回滚

- 整体：`git revert --no-commit d1d22ae..HEAD` 或直接不合并 PR #12。
- 分模块：本轮无迁移、无新依赖、无存储格式变更，删除新增文件（`intent-decision.ts`、`retrieval-policy.ts`、`answer-evidence-evaluation.ts`、`turn-evaluation.ts`）并还原 `fact-slot.ts` / `memory-context-assembler.ts` / `companion-service.ts` 即可回到 Slice 2.2 行为；数据库无需回滚。
- 评测：`evaluate:cognition` 的第四个输出与 fixture 可单独移除，不影响其余三个评测。

## 10. 结论

**A. 工程质量：通过。** 类型检查、构建、376 条测试、四个离线评测门禁全过；payload 42/42，撤回/敏感泄漏 0，存储记忆改写 0，人格改写 0，Provider 失败被记录而非丢弃。

**B. 事实语义：通过（文本级）。** A1/A2/A3 全部用例在固定测试中成立：语气与取值分离、健康否定绑定谓词、跨分句双状态降级、future 显式化、时间不兼容不作等价、多值事实不误判冲突。限制是仅字面时间、无相对时间换算。

**C. 意图—记忆—证据—回答闭环：通过（工程层）。** 单一意图决策器、意图驱动策略、逐条可追溯证据、六类回答评估、可核对账本均已实现并测试；策略无法越过状态/敏感度/撤回边界。限制是策略粒度仍按意图类别，未按单条记忆的证据质量动态调整。

**D. 真实模型的伴侣连续性：未达到本阶段目标。** 42 次调用工程层无缺陷，但 27 次可评分里 21 次没有使用已投递证据，冲突场景 3/3 静默选边，1 次运行出现事实反转、1 次出现编造名字。以 0.5B 本地模型为证据，**不能**判定伴侣连续性达标；需要更大模型与人工复核才能重新评估。测试全绿不改变这一判断。
