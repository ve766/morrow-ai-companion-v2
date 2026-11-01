# 事实可寻址记忆与证据门 v3（Final Closure，P0-A/P0-B）

取代 v2 文档中"纯文本相似度检索"的部分;RRF 融合与使用层规则继续有效,本文只写增量。

## 1. 三层架构

| 层 | 载体 | 内容 |
|---|---|---|
| Episodic | `messages` + `memory_revisions` + `event_journal` | 原话、turn/message/session ID、时间、来源(既有,不变) |
| **Fact** | `fact_records`(迁移 v40,新增) | subject='user' / predicate / value + valid_from、valid_to、source_memory_id、confidence、status(active\|superseded\|retracted\|uncertain)、supersedes_fact_id、sensitivity、time_state |
| Index | fact_records 上的谓词索引 | 按 (predicate, status, valid_to) 直接寻址 |

**单一事实源**:`fact_records` 由 `readFactSlot`(与检索器同一规则)从 memories 派生,UNIQUE(source_memory_id, predicate, value) 幂等;memory 删除经 FK CASCADE 同步;retract→retracted、correct→旧值 superseded(带 supersedes 链)+新值 active、restore→重算。启动时 `reindexAll()` 全量重建(幂等),运行期由 MemoryService 生命周期钩子逐条更新。消息级溯源留在记忆修订链与创建事件(事实行持 source_memory_id 引用)。

谓词集:residence/employer/job_role/study/preference/goal/name/age/project_code/**pet_name**/**object_location**/health/schedule(后两类为 final-closure 新增——"我的猫叫什么/护照放在哪里"是真实回访问法)。

## 2. 检索:事实通道并入既有融合

```
个人事实查询 → 并行:
  ① 属性寻址: lookupActive(predicate, {queryTime, includeSuperseded})
       — status=active AND valid_to IS NULL AND time_state 兼容问句时态
       — 过去时问句可读 superseded 历史(审计层)
  ② lexical + slot + value 通道(既有)
  ③ 融合: RRF(k=60), 事实通道排首位(属性命中即"问的就是这个事实")
融合后: contextUtility(conflict/stale/freshness) 有界重排(既有)
```

**有效时间准入规则**:问句带确定时态(现在)时,与其不相容(以前)的**单值事实**(居住地/姓名/年龄等)不进候选——一个当前居住地,不是两个;多值事实(偏好/过敏)不受此限;无时间限定的记忆仍可命中。被质疑事实(contested)与属性命中(factAddressed)无视 requireContentOverlap——模型无法核对它看不见的主张。

## 3. Evidence Gate(P0-B)

每成功轮在 TurnEvaluation 记录 `evidenceGate`:

```
classification(互斥,按严重度):
  answer_conflict  — fact guard 改写过回复(回答与证据冲突)
  retrieval_miss   — 个人事实问句但候选为空
  model_unused     — 有投递但回复零值级引用
  evidence_delivered — 其余
answerConfidence = 100×(0.5×coverage + 0.3×sourceReliability + 0.2×delivered) × (1−conflictPenalty 0.2)
                   — 有界启发式/策略输入,非校准概率
manifest = { selectedIds, conflictIds, omitted }   ← 每轮留痕(审计清单)
```

四类故障区分:`检索失败`(retrieval_miss)/`注入失败`(serialized payload 由 assembler 保证与 selected 一致,预算截断记 omitted)/`模型未使用`(memoryUse.referencedIds=0)/`回答与证据冲突`(guard=rewrite)。manifest 不含原文(ids+计数),原文只在 prompt;不得以模型自述为使用证据——referenced 是值级包含标签。

## 4. 验收

`eval:stage3:final-closure`:58 场景(同义/代词/长间隔/多会话/更新/撤回/冲突/噪音/时限/无证据),extraction=1.0、recall@2=1.0、MRR=0.946、误注入=0,含真实失败同型重放(过敏跨会话=原轮31、居住地纠正=原轮13);gate 分类逐 case 记录。模型使用层:live final-closure + 真人复核。
