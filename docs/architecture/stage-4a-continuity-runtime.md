# Stage 4-A 连续运行时架构

## 1. 纵向链路（实现后）

```
用户消息（会话 A）
  → ChatService.prepare：人格基线 + G1 漂移 + 认知分析（含 explicitMemorySaveRequest/correction）
  → 模型回复 → assistant 消息事务
  → outbox 'memory' 投影器：
        observeUtterance（重复提及）
       + 若 explicitMemorySaveRequest|explicitMemoryRequest|correction：
            MemoryService.createExplicitFromTurn(text, messageId, conversationId)
              → extractFactSlots（保守：疑问/假设/转述/模态不出事实）
              → 与 active 单值记忆冲突 → correct(memory, 模板文本, messageId, {sourceMessageId, kind:'message'})
              → 否则 create(模板文本, {provenance:{sourceMessageId, kind:'message'}})
              → 每条记忆 reindexFact → fact_records（source_revision + revision 的 provenance）
会话 B（新会话，或重启后）
  问“我的猫叫什么？” → 查询计划（pet_name 谓词 + 词面）→ fact ledger current 行 → RRF → prompt 证据块 → 模型
会话 C 纠正
  “我说错了，它现在叫豆豆。” → correction 信号 → createExplicitFromTurn
      → 直接抽取为空 → 代词纠正规则：唯一 active pet 事实 → correct → 旧行 superseded(valid_to) + 新行 active(新 revision)
会话 D
  当前问句 → 只读 active → 豆豆；历史问句（过去时）→ 允许 superseded 咪咪
```

## 2. 关键不变量

| 不变量 | 实现点 | 测试 |
|---|---|---|
| 当前事实 = active 且 valid_to IS NULL（且非 past 时态） | `FactMemoryService.lookupActive` | 验收 3/5 |
| 纠正原子性：旧 superseded + 新 active 同事务 | `MemoryService.transition` → repository 事务 + `reindexMemory` BEGIN IMMEDIATE | 验收 3/8 |
| 单值谓词最多一个 current | UNIQUE(memory, revision, predicate, value, polarity) + 冲突检测 | 验收 8 |
| 来源链 message→revision→fact | `memory_revisions.source_message_id` → `fact_records.source_message_id` | 验收 1 |
| 撤回不复活 | reindexMemory 非 active 守卫 | 验收 6 |
| 索引降级不伪装零命中 | 失败 → degraded 任务 + 降级扫描 | 验收 9 |
| 人格基线 Provider 无关 | `personality_profiles` 单写路径；provider 配置独立表 | 验收 7 |

## 3. 身份装配

```
identity_context = compose(
  user_authored_baseline   ← personality_profiles（唯一写路径：用户编辑/恢复）
  approved_persistent_preferences  ← personalization（规则派生，有界）
  bounded_runtime_state    ← G1 offset（±8，45 天半衰，≥3 独立回合）+ 内在状态（有界措辞）
)
```

装配点：`ChatService.prepare` → `effectiveProfile` → prompt 头部一行（版本 + 三维数值 + disagreement style + 可回滚声明）。Provider 切换不触及这三层中的任何一层。

## 4. 每轮 Manifest

`TurnEvaluation.evidenceGate = { classification, answerConfidence, manifest{selectedIds, conflictIds, omitted} }` + `memoryUse{referencedIds, deliveredCount}`。原文不出日志；manifest 只证明投递，不声称理解。

## 5. 故障与降级

- 索引写失败 → `fact_index_jobs`(degraded) + `memory.fact_index.degraded` 事件（脱敏）+ 有界退避重试
- 索引查询失败 → bounded extractor 扫描（200 条上限）
- 显式创建失败 → 不影响本轮回复；消息保留在历史
- 歧义代词（多个 active pet 事实）→ 不纠正、不猜测
