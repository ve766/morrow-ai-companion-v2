# 记忆检索与使用 v2（D-5 修复后）

取代 `stage-3-algorithm-registry.md` 中"检索按单一加权分"的描述。

## 1. 查询理解（读时，无持久化）

1. **词项**：`queryTermsOf` 把查询拆成 content / weak（框架词、时间词）两档（`memory-context-assembler.ts`）。
2. **事实槽**：`readFactSlot`（`fact-slot.ts`）按谓词提取 {predicate, value, kind(assertion/question/negated/uncertain), time}。D-5 扩展：疑问与口语形 `住哪/搬去/住在哪里`、裸 `哪` 进入 residence 提取器与三处疑问词表（intent-decision / intent-confidence / speech-act），使 `"我现在住哪？"` 与 `"我住在杭州。"` 命中同一谓词通道。
3. **行级槽位**：组合查询（本轮+指涉上下文）可能把断言与疑问混成 `uncertain`，检索器另取**每行**的确定槽位作为冲突通道候选。

## 2. 三通道召回 + RRF 融合

三个通道各自排序（rank），融合用 Reciprocal Rank Fusion，**不做未校准分数相加**：

```
RRF(m) = Σ_channel 1/(k + rank_channel(m))，k = 60
relevance(m) = RRF(m) / (3/(k+1))    ∈ [0,1]   → contextUtility 的 relevance 项
```

| 通道 | 排序依据 | 捕捉 |
|---|---|---|
| lexical | content 词重叠（饱和 2）+ 短语 + 时间 + 来源可靠度 | 词面同述 |
| slot | `querySlot.kind='question'` 且同谓词（按时间相容） | 同一事实的**不同问法** |
| value | 查询文本本身包含某存储事实的 value | 被**点名的争议事实** |

**准入**（先于排序，策略只能收窄）：`lexical || slotMatch || contested`，其中
`contested = value 命中 ∨ (查询断言与存储单值事实 slotsConflict)`。
被质疑的事实**不被任何策略隐藏**——模型无法承认或反驳它看不见的主张；冲突以 `conflictWith` 标注呈现，从不静默消解。`predicateFilter`（隐私收窄）与敏感度上限仍然绝对。

## 3. 排序与装箱

`rankScore = contextUtility(relevance=RRF, freshness(30d 半衰), quality(置信×来源), preference, −conflict, −stale) + 0.2×importance`；
importance 由 `memory_evidence` 的 DISTINCT independence_group 折叠（`memory-importance.ts`，半衰按类型 365/180/90 天）。装箱沿用 25 条 / 3000 字符预算，按融合序逐条试编码。

## 4. 使用层（D-5）

- **固定原则**（`companion-service.ts` fixedPrinciples）：`未检索 ≠ 没说过`（既有 P0-4）+ 新增 `检索到的个人事实优先核对并作答；证据缺失/含糊/冲突时说明并询问，不得自信否认或编造`。
- **Use trace**：每轮 TurnEvaluation 新增 `memoryUse = { referencedIds, deliveredCount }`——referenced = 回复文本包含该记忆 fact-slot value（值级包含标签，如实声明"非理解证明"）。
- **评测**：`eval:stage3:memory`（10 个跨会话复述场景：居住地/过敏/口语/代词/冲突/撤回/零命中校准/排序，报告 recall@1/@2、MRR——本数据集上均为 1.0）；真实模型使用层由 live runner 逐轮转写供人工复核（manualReview=PENDING 直到真人执行）。

## 5. 已知边界

- 无标记的价值断言（"我在北京"无住/搬标记）不进 value 通道，语义向量召回未接入（接口位保留）；此类零命中记为已知边界而非通过。
- 情绪/探索等窄策略的 `requireContentOverlap` 保持，防止隐私事实被无关轮次拖入。
