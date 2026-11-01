# Stage 4-A 身份与事实连续性算法

## 1. 当前事实选择

```
current(p) = { f | f.predicate = p ∧ f.status = 'active' ∧ f.valid_to IS NULL
                 ∧ (查询时态 ≠ past → f.time_state ≠ 'past') }
history(p) = { f | f.predicate = p ∧ f.status ∈ {active, superseded} }   // 过去时查询
```

- 若 `|current(p)| > 1`：事实集合视为冲突候选（Evidence Gate 标注），**不挑最高分**当当前事实；多值谓词（偏好/过敏）允许多行，单值谓词（residence/name/age/pet_name/employer/job_role/project_code）在多行时按冲突处理。
- 参数：无阈值可调；`time_state` 来自抽取器（past/present/future/unspecified），`unspecified` 不被推断为 past。

## 2. 纠正事务

```
BEGIN IMMEDIATE
  old = current single-valued fact for predicate
  old.status ← superseded ; old.valid_to ← now
  new = fact(revision' , value', source_message_id' , provenance_kind='message')
  new.supersedes_fact_id ← old.id
COMMIT
```

- 唯一性：`UNIQUE(source_memory_id, source_revision, predicate, value_normalized, polarity)` 保证重放幂等；同一记忆的 revision 递增，因此「同一 revision 两行同值」不可能。
- 并发：单连接 `BEGIN IMMEDIATE` 串行化写入；`createExplicitFromTurn` 的冲突查找与纠正写入在同一事务语义下顺序执行（SQLite 写锁）。
- 失败：整体回滚，记忆文本保持旧 revision。

## 3. 抽取（4-A 增量）

保守规则（继承 Stage 3）：
- 疑问、假设、转述、模态、双否 → 不出事实
- 未知形状 → 不出事实，原文留在记忆文本走词面检索

4-A 增量：
- 复合 pet 句：`(猫|狗|宠物)[，,]\s*(它|这只…)(现在)?(的?名字)?叫(V)` → `pet_name=V`
- 代词纠正（仅在显式请求/纠正信号下）：`它(现在)?(的?名字)?叫(V)`，且**恰好一条** active pet 事实 → 纠正该记忆；否则跳过（歧义不猜）

## 4. 身份装配与可回滚

```
P_effective = clamp(P_baseline + Δ_1, 0, 100)
Δ = fold(signals)：minEvidence=3 独立回合；半衰 45 天；单信号 step=1；clamp ±8
```

- `P_baseline` 只能由用户写（`personality_profiles`）；`Δ` 由 G1 台账折叠，`rollback(dimension)` 清空该维度证据即回到基线。
- Provider 切换、重启、模型输出都不进入基线写路径。

## 5. 失败行为

| 情形 | 行为 |
|---|---|
| 索引写失败 | `fact_index_jobs=degraded` + 脱敏事件 + 退避重试（≥5s×2^attempt，上限 15min） |
| 索引查询失败 | 有界 extractor 扫描（200 条），仍失败才零命中（并记录降级） |
| 显式创建失败 | 该轮回复不受影响；下一个生命周期写入或启动重建时重试 |
| 代词歧义 | 跳过，不写任何事实 |
| 历史数据违反单值唯一 | 读取时标冲突（Gate），不静默覆盖 |

## 6. 来源链

```
message.id → memory_revisions(memory_id, revision, source_message_id, provenance_kind)
           → fact_records(source_memory_id, source_revision, source_message_id, provenance_kind)
           → TurnEvaluation.manifest(selectedIds) / memoryUse(referencedIds)
```

旧数据（无来源）保持 `provenance_kind='legacy'` 与 `source_message_id=NULL`，不伪造回填。
