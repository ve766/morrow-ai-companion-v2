# 人格成长规格

## 三层来源

| 层 | 存储/服务 | 允许来源 | 不允许 |
|---|---|---|---|
| `user_adaptation` | `personality_growth_signals` / `PersonalityGrowthService` | 用户显式风格要求（“更直接/温柔/幽默”），带 turn 证据 | 用户情绪、单次称赞、纠正内容本身 |
| `morrow_trait_candidate` | `morrow_trait_revisions.status='candidate'` | Morrow-owned appraisal（curiosity/concern/regret/frustration 等）+ system evidence | 用户风格要求、用户情绪、Provider 自述 |
| `morrow_trait` | `morrow_trait_revisions.status='active'` | 通过独立会话、跨情境、时间窗口、反证 gate 的候选 | 单次事件、单次负面反馈 |

`PersonalityGrowthService` 只把偏移加在用户编辑的 baseline 上；它不写 `morrow_trait_revisions`。`MorrowTraitService` 只接受 `sourceKind` 为 `morrow_self_appraisal` 或 `system_evidence` 的 observation，用户 praise 不会进入。

## 候选形成

从已接受的 emotion candidate 映射（`traitObservationFromEmotion`）：

- curiosity → curiosity
- concern → carefulness
- frustration/regret → responsibility
- surprise/sadness → openness（sadness 只在真实 loss）
- 只接受 `traitEligible=true` 且来源合规的候选。

每条 observation 存 `trait_key, turn_id, conversation_id, source_event_id, signal, weight, quality, context_tag, created_at`；唯一键 `(trait_key, turn_id, context_tag)`，同一 turn 重复消息不重复计数。

## 证据 gate

```text
S = 0.30Q + 0.25I + 0.20X + 0.15R - 0.30K
Q = 加权来源质量
I = min(1, 独立会话数 / 3)
X = min(1, distinct context 数 / 2)
R = 按 60–120 天半衰期的近期性
K = 反证惩罚
```

- 晋升：`S >= promotionThreshold`，独立会话 ≥ 3，distinct context ≥ 2，观察窗口 ≥ 24h，strength ≥ 0.22。
- strength 是 0.12 上限的观察步长累积，单次事件不可能晋升；不是概率。
- 降级：active 且（S < weakeningThreshold 或 strength < 0.18）→ weakened。
- 反证：negative signal observation 记录在 `counter_evidence_json`，参与 K；可显式 `retract`。
- 迟滞：active 不会因一次波动立即掉回 candidate；冷却 `cooldown_hours=168` 防止 retract 后立即重升。
- 每次 material change 写新 revision，旧行 `superseded`；读取取最新非 superseded 行。

## 情绪 ↔ 人格双向

- 短期情绪影响当轮表达、探索排序、inner cognition 触发；它们不直接写 trait。
- 重复、独立、跨情境的情绪 appraisal 才可能形成 trait candidate；单次负向反馈只增加一条 observation，不晋升。
- 已 active trait 通过 `traitSensitivity` 影响 appraisal 的 G/N/L/R 权重，幅度 ±0.08；不会决定情绪结果。
- 反证到来时 trait 可 weakened/retracted；不删除历史 revision。

## 回滚

- `retract(traitKey)`：写入 retracted revision + cooldown；不删 observation。
- `clearAll()`：删除 observation/revision/event（用户清空认知历史时调用）。
- 删除会话：删除该 conversation 的 observations，`recomputeAll` 重算；消息 FK 级联删除也会留下待重算状态，startup 会 `recomputeAll`。
- 不删除用户编辑的 personality baseline；trait 永远只是 Morrow-owned 自我模型，不能覆盖 baseline。
