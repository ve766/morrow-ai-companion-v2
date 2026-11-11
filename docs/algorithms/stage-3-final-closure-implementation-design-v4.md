# Final Closure 实现设计 v4(收口轮)

v3 文档(事实层+证据门)继续有效;本文登记收口轮的增量与修正。

## 1. 多事实抽取(v41)

```
extractFactSlots(text): FactCandidate[]
  for clause in splitClauses(NFKC(text)):
    skip if 转述/假设/双重否定/mixed 时间
    for extractor in [核心谓词...] + [pet_name, object_location](多事实专用):
      value = clean(match 后文);跳过疑问/空值/>60 字/疑问代词开头
      yield { predicate, value, valueNormalized=comparable(value), polarity(±), time }
  dedupe by (predicate, valueNormalized, polarity, time)
```

保守性:疑问、假设、转述、模态、双否不出事实;未知形状返回空(原文留在记忆文本走词面检索)。`readFactSlot`(主谓词读法)行为不变——pet/object 标记太贪,只进多事实抽取器。

## 2. 事实账本(v41 fact_records)

`{id, subject, predicate, value_display, value_normalized, polarity, status(active|superseded|retracted), source_memory_id, source_revision, source_message_id|null, provenance_kind(message|legacy), valid_from, valid_to, confidence, supersedes_fact_id, sensitivity, time_state, extraction_version}`

- UNIQUE(memory, revision, predicate, value_normalized, polarity)——重放幂等
- valid_from=revision 生效时间(updated_at);valid_to 仅在 supersede/retract 关闭
- status 迁移:create→active;correct→旧值 superseded+新值 active(仅同 memory+predicate 建 supersedes 链);retract→retracted(绝不插入 active);restore→re-open;delete→CASCADE
- **R2 守卫**:非 active memory 永不产生 active fact;reindex 事务化(BEGIN IMMEDIATE),失败 throw(调用方 degradation+下次重试)
- 跨 memory 同谓词不同值=冲突候选(evidence gate 澄清),不自动覆盖

## 3. 查询计划(R3)

裸属性断言识别:`我(现在)?(在|住在|搬到|搬去|搬进了?)+汉字值`,活动动词(学/做/看/写…)排除 → 单值属性(residence/age/name/employer/job_role/project_code)的事实全部置为 addressed(在视)。与既有通道并行:谓词寻址/lexical/slot/value → RRF 融合 → contextUtility 重排 → 有效时间与敏感度硬过滤不可被分数抵消。

## 4. 证据门(P0-C)

分类(互斥):`answer_conflict`(guard rewrite)/`retrieval_miss`(个人事实问句零候选)/`model_unused`(投递未引用)/`evidence_delivered`。
`AnswerConfidence = 100×(0.5×coverage + 0.3×sourceReliability + 0.2×delivered) × (1−conflictPenalty)`——启发式/策略输入,非概率;fail-closed:敏感度上限、撤回事实、策略收窄不受分数影响。
manifest:selected/conflict/omitted ids 每轮入 TurnEvaluation;原文不出 prompt/日志。

## 5. 消费 trace(R5)

`observeConsumption(turnId, reply)`:对注入该轮的 hints 做确定性词元重叠判定 → `used_observed` / `not_observed`(status 迁移,幂等);过期/拒绝不复活;模型自述无效。注入(哪轮)、使用(什么证据)、可观察效果(哪类)分开记录。

## 6. 失败行为

fact 检索失败→退化词面通道;reindex 失败→degradation 事件+下次重试;provider 瞬时错误→有界重试(3 次);鉴权/协议/服务端错误→场景 FAIL+分类,不吞不冒充。
