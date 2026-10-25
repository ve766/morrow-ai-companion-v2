# 内在状态算法（Affective State）

引擎版本：`evidence-weighted-rules-v1`（继承自旧仓库认知核心 Alpha，经审计后保留；维度定义如下并说明与任务建议五维的映射）。

## 维度定义

| 维度 | 范围 | 含义 | 半衰期 |
|---|---|---|---|
| valence | [-1, 1] | 交互正负效价（被认可 ↔ 被纠正） | 6 h |
| activation | [0, 1] | 交互唤起水平 | 0.75 h |
| tension | [0, 1] | 未解决的紧张（被纠正后待复核感） | 24 h |
| attention.explorationPriority | [0, 1] | 探索优先级（≈任务建议中的 curiosity） | 36 h |

未采纳 social engagement 为独立维度：当前事件识别器没有可靠的"社交投入"信号源，宁可少一个维度也不引入随机噪声（任务允许按审计调整维度，理由记录于此）。

## 事件类型与预设增量（FEELING_EVENT_PROFILES）

| 事件 | 判定（本地规则，输入为轮次分析+文本） | Δvalence | Δactivation | Δtension | Δattention |
|---|---|---|---|---|---|
| positive_feedback | 意图=feedback + 正向词表命中且未被否定词抵消 | +0.16 | 0 | −0.06 | 0 |
| negative_feedback | 意图=feedback + 负向词表 | −0.18 | +0.10 | +0.18 | 0 |
| system_correction | 用户指出的回答错误 | −0.10 | +0.08 | +0.20 | 0 |
| exploration_request | 意图=exploration | 0 | +0.04 | 0 | +0.14 |
| user_context | 意图=venting | 0 | 0 | 0 | 0 |
| preference_change | 信号 changedMind | 0 | 0 | 0 | 0 |

判定防护：引用/转述文本剥离（`stripQuotedAndReportedText`）、讽刺标记排除、否定式帮助性（"not helpful"）不误判为正向、纯客套拒绝（"不用了，谢谢"）不算反馈。

## 更新规则

```
weight = clamp((confidence−50)/50 × uncertaintyWeight × importance/100, 0, 1)
       # uncertainty: low=1, medium=0.5, high=0.2；confidence<50 → weight=0
Δ_dim  = clamp(proposedΔ × deltaScale, −limit, limit) × weight   # limit: 0.16–0.22
state' = clamp(decayed + Δ, 维度下限, 1)
attention' = clamp(decayedAttention + clamp(proposedAttentionΔ, ±0.16)×weight, 0, 1)
```

- **先衰减后施加**：每次应用前按各维度半衰期做指数衰减回基线（valence 基线 0，其余 0）；elapsed ≤ 0 时不变。
- **衰减确定性**：`2^(−elapsedHours/halfLife)`，四舍五入到 1e-4（同输入同输出，负零归零）。
- **重放/重建**：cognitive_feeling_events 存事件 JSON（幂等键 UNIQUE），revisions 存前后状态；state.dirty 置位后由快照请求从事务重放重建。

## 幂等与跨会话

- 幂等键 = 请求 requestId（UUID）；重放时若事件语义不一致 → CONFLICT（拒绝），一致 → 返回 false 不再累计。
- 状态持久化于 cognitive_feeling_state（单行 + revision 号）；重启后按 evaluatedAt 与当前时间差重放衰减，无需记录重放时钟。

## 对行为的影响（有界）

`feelingPromptGuidance` 生成状态引导行，全部带限定措辞：
- 始终声明"这是有界的本地交互状态信号，不是主观体验，不是关于用户的证据，绝不能覆盖事实、指令、安全、权限或用户控制的人格，不得描述为人类情绪，不得透露数值"。
- 正反馈 → 仅视为对该次交互的证据，不做持久人格改变。
- 负反馈/纠正 → 复核争议点、承认具体错误，不推断用户整体情绪。
- exploration 信号 → 至多一个相关延展，不跑题。
- 静息态（全维度 |v|<0.01 且无先前信号）→ 输出空串，不给提示注入噪声。

瞬时状态与稳定人格的隔离：人格只存于 personality_profiles（仅用户编辑可变），状态引擎对其无写路径；纠正后的长期判断修正走 memory/self-model 的显式纠错链，不走情绪通道。

## 失败安全

状态计算/持久化任何异常：ChatService 捕获并降级（无状态引导，聊天继续）；`CognitiveSettingsService` 关闭时事件根本不产生（opt-in）。
