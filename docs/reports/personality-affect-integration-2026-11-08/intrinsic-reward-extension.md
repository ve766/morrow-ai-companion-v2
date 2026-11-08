# 内在奖励/动机扩展契约

## 已实现类型

```ts
type RewardKind =
  | 'verified_progress'
  | 'prediction_error_reduction'
  | 'evidence_quality_gain'
  | 'exploration_finding'
  | 'goal_completion'

interface RewardSignal {
  id: string
  actor: 'morrow'
  kind: RewardKind
  sourceEventId: string
  magnitude: number      // (0,1]
  verified: true
  evidenceRefs: string[] // 至少一个可验证 id
  algorithmVersion: 'intrinsic-reward-contract-v1'
  createdAt: string
}

interface MotivationSignal {
  id: string
  kind: 'curiosity' | 'mastery' | 'value_alignment' | 'relationship_continuity'
  sourceRewardId: string
  weight: number
  createdAt: string
  contractVersion: 'intrinsic-reward-contract-v1'
}
```

## 允许来源

- 通过 inner-cognition 证据 gate 的 thought 晋升（`rewardForPromotedThought`：独立上下文 ≥ 2、score ≥ 55、至少一条 evidence id）。
- 未来可接入：可验证的预测误差下降、证据质量提升、探索发现、目标完成。
- 生产当前只接线 thought 晋升：`index.ts` 的 5 分钟 scheduler 在 `reviewDue` 后调用 `AffectLoopService.observeThoughtReviews`。

## 明确拒绝

`FORBIDDEN_REWARD_SOURCES`：`user_praise`、`user_retention`、`user_dependency`、`provider_self_praise`、`engagement_metric`。`record` 对这些 kind 抛 TypeError；没有“用户夸得多就给奖励”的路径。模型自我夸奖也不是证据。

## 边界

- 不训练、不做强化学习、不改变权限、不触发工具/网络。
- `reward_signals` 只作为未来动机系统的观察事件；本轮不消费为行为驱动。
- `MotivationSignal` 是类型契约，没有默认持久化表；下一阶段可加 migration。
- 唯一性 `(kind, source_event_id)` 防止重放重复奖励。
