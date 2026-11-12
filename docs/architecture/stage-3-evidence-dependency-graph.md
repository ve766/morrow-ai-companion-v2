# Stage 3 证据依赖图（只写真实调用链）

> 本文件只记录**代码里存在**的边。没有生产者的推理不画成节点，只列在 §4「不存在的能力」。
> C1 相关边以 2026-10-31 的 `feat/stage-3-long-term-companion` 为准；其余模块沿用既有结构。

---

## 1. 一轮对话：从输入到持久化

```
user text
  │
  ├─ stripQuotedAndReportedText ──────────────► 去引用/转述后的正文
  │        │
  │        ├─► analyzeSpeechAct            (speech-act.ts)
  │        │       act / attributedTo / binds / action / negation.scope
  │        │
  │        ├─► readLocalContext            (context-window.ts)
  │        │       priorUser, priorAssistant, assistantOffer,
  │        │       assistantAskedQuestion, continuationTarget, sequencing
  │        │
  │        └─► decideIntent + scoreIntentCandidates   (intent-decision.ts)
  │                collectSignals → 按 (label, source) 折叠 → 候选分数
  │
  ├─► assessIntentConfidence               (intent-confidence.ts)
  │       z_i（5 特征）→ margin → directionChanging
  │
  ├─► readTurn → IntentReading             (intent-reading.ts)
  │       ｜ 组合上述三者 + 槽位抽取 + 状态 + responseMode + mayExecute
  │       └─► analyzeCognitiveTurnDetailed (cognitive-turn-analyzer.ts)
  │                ├─ CognitiveTurnAnalysis（legacy，投影自 reading）
  │                └─ IntentDecision（legacy 形状，字段来自同一次计算）
  │
  ├─► policyForIntent(primaryIntent)        (memory/retrieval-policy.ts)
  │       └─► MemoryService.assembleContext → 选中记忆（status/sensitivity 边界在内部）
  │
  ├─► cognitivePromptGuidance(analysis, decision, …, reading)
  │       └─► system prompt（只含结论文本，不含槽位日志）
  │
  └─► sendChat 事务
          ├─ messages（user）
          ├─ cognitive_turn_observations（legacy 观测）
          ├─ intent_readings（C1 读法，UNIQUE(message_id)）
          └─ 失败时 recordDegradation，不回滚消息
```

## 2. 证据引用边

| 边 | 载体 | 说明 |
|---|---|---|
| reading → 当前消息 | `evidenceRefs[0]` / `messageId` | 恒存在 |
| reading → 前序用户消息 | `evidenceRefs`（承接/解析到引用时） | 只在真的用到时 |
| reading → 槽位 | `entitiesAndSlots[].evidenceMessageId` | `stated` 指向本轮；`inferred` 为 `null` |
| reading → 反证 | `contradictingSignals[]` | 引用/假设/否定/冲突读法 |
| reading → 修订 | `supersedesMessageId` → 旧行 `superseded_by_message_id` | 形成可审计的链 |
| 观测 envelope → 记忆 | `CognitiveEvidenceEnvelope.evidenceRefs`（memory_revision） | 沿用既有 `withCognitiveContextEvidence` |

**不允许的边**：reading 不写记忆、不写人格、不创建目标、不晋升兴趣。C1 只产出「用户表达了什么/是否确认」，写入权仍在各自模块。

## 3. 删除与撤回传播

```
DELETE messages(row)
  ├─► cognitive_turn_observations  (FK ON DELETE CASCADE)
  └─► intent_readings              (FK ON DELETE CASCADE)

responseMode = stop_previous
  ├─► 旧 reading: retracted_at + superseded_by_message_id
  └─► cognitive_pending_items(source='open_question'): status='done'

act = correction / intentStatus = changed
  └─► 旧的同会话 reading: retracted_at + superseded_by_message_id
```

## 4. 不存在的能力（不得画进图里）

| 声称 | 实际 |
|---|---|
| 「分析结果驱动人格」 | 无写路径；人格只由用户编辑改变 |
| 「意图决定记忆晋升」 | 无写路径；`MemoryService` 独立决定 |
| 「模型自我修正意图」 | 无；规则是确定性的，没有反馈回路 |
| 「跨会话意图延续」 | 只在同一会话内 supersede；跨会话没有意图继承 |
| 「意图校准概率」 | 无校准集，`scoreKind` 恒为 `heuristic_score` |
