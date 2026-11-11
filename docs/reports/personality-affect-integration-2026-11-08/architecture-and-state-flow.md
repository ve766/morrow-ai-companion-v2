# 架构与状态流

## 模块边界

```text
chat turn
  │
  ├─ CognitiveFeelingService（旧三维短期交互状态，兼容保留）
  │
  ├─ AffectLoopService（Issue #72 唯一多维情绪权威）
  │    ├─ EmotionService      emotion_events / emotion_states / emotion_revisions / emotion_regulations
  │    ├─ MorrowTraitService  morrow_trait_observations / morrow_trait_revisions / morrow_trait_events
  │    └─ IntrinsicRewardService reward_signals
  │
  ├─ PersonalityGrowthService（user_adaptation；不写 trait 表）
  ├─ InterestService / ExplorationService（兴趣与探索 gate）
  └─ InnerCognitionService（thought → evidence-gated self state）
```

## 状态流

```text
Experience (turn + analysis + explicit feedback + knowledge gap)
  → EmotionEventDraft (candidate + appraisal + evidence refs)
  → EmotionService.recordInTransaction
       event log (idempotent per turn)
       projection merge (coexist / merge same family+topic / decay)
       revision (before/after JSON)
  → MorrowTraitService.observeInTransaction
       only morrow_self_appraisal / system_evidence
       unique (trait_key, turn_id, context_tag)
       fold → candidate/active/weakened/conflict_pending
  → next turn
       EmotionService.snapshot → query-filtered prompt line
       MorrowTraitService.contextBlock(query) → query-filtered trait line
       affectAttentionBias → exploration gate (topic-specific)
       affect conflict/predictionError → inner cognition consolidation
  → verified inner-cognition promotion
       rewardForPromotedThought → reward_signals
```

## 情绪状态机

- instance：`active → fading → (decayed out)`；`active/fading → regulated|retracted`；`superseded` 仅用于显式替换（本轮未自动 supersede 同族，合并同族实例）。
- evidence：一个 turn 一条 `emotion_events`；同一 family + sourceKind + topic 以 `1-(1-a)(1-b)` 合并，不叠加到 1.0。
- low confidence（<0.45）候选仍保存在 event JSON 中，但不进入投影；这是显式的 pending/low-confidence，不是强状态。
- 用户情绪候选只允许 `sourceKind=user_context`，不能变成 Morrow 的 sadness/anger/joy。

## Trait 状态机

- `candidate → active`：S ≥ promotionThreshold，独立会话 ≥ 3，distinct context ≥ 2，观察窗口 ≥ 24h，strength ≥ 0.22。
- `active → weakened`：S < weakeningThreshold 或 strength < 0.18，或反证使 applied=false。
- `retracted`：显式 `retract`，写入 cooldown；冷却期内不会重新晋升。
- 每次 material change append 一个 revision，旧 revision 标 `superseded`；`supersedes` 指向旧行。
- `user_adaptation` 不在该状态机内；它仍由 `personality_growth_signals` 计算，只影响 baseline 之上的展示漂移。

## 数据表（v55）

| 表 | 作用 | 关键约束 |
|---|---|---|
| `emotion_events` | 唯一情绪事件日志 | PK event_id、UNIQUE idempotency_key、FK messages ON DELETE CASCADE |
| `emotion_states` | 当前投影（单行 id=1） | JSON、revision、dirty |
| `emotion_revisions` | before/after 审计 | revision PK、event_id UNIQUE |
| `emotion_regulations` | 显式 reappraise/regulate/retract | emotion_id、rationale、created_at |
| `morrow_trait_observations` | trait 证据 | UNIQUE (trait_key, turn_id, context_tag) |
| `morrow_trait_revisions` | trait 状态/revision/证据 refs | append-only、supersedes FK、cooldown |
| `morrow_trait_events` | trait 变更审计 | kind/score before-after |
| `reward_signals` | 内在奖励 | UNIQUE (kind, source_event_id)，verified=1，无用户操纵来源 |

## 迁移、兼容、回滚

- v55 是前向 migration；不删除/重置用户数据。旧数据库 v54 打开时自动备份并迁移；迁移失败由现有 `SqliteDatabase` 回滚/降级策略处理。
- 旧代码不能打开 v55（future schema fail-closed）；回退需使用 v54 备份，不能直接降级当前 DB。
- 清空：`clearCognitiveHistory` 清理 feelings + emotion + trait + reward；会话删除按 conversation 删除 emotion events/observations 并重建 projection。
- 未实现：trait 的 `superseded` 历史压缩、跨消息删除后的即时 trait 重算（startup 会重算；会话删除会重算）。

## 扩展契约

- `registerEmotionProfile`：注册/版本化新 emotion family profile（valence/arousal/half-life/traitEligible）。
- `APPRAISAL_WEIGHTS` + `APPRAISAL_WEIGHTS_VERSION`：appraisal 权重版本化；当前是代码内常量，不是运行时 UI 配置。
- `MorrowTraitKey` / `TRAIT_DEFINITIONS`：新增 trait 的注册点（需要 migration 扩展 `CHECK` 或新表版本）。
- `RewardSignal` / `MotivationSignal` / `REWARD_CONTRACT_VERSION`：未来动机/奖励扩展槽；当前只记录 verified progress。
- 未新增云调用、后台网络、外部工具或权限。
