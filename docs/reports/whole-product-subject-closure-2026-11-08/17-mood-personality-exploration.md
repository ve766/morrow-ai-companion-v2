# Mood、人格与探索（Issue #78）

## Mood 数学模型

- 四轴 `valence/arousal/dominance/tension`，每维独立均值回归：
  `m(t)=B+(m0-B)*exp(-ln2*Δt/T_half)`
- 半衰期：valence 6h、arousal 1h、dominance/tension 24h；参数版本 `mood-ou-v1`。
- 确定性模型，无随机项；不是人类心理定律。

## 时间语义（本轮修复）

- `applyEvent`：先推进到 `effectiveAt=max(current.evaluatedAt,input)`，再应用 impulse；paused 时完全抑制自动事件、不写 revision。
- `pause(t)`：先 `advanceMood` 到 `max(current,t)`，再冻结。
- `resume(t)`：保持冻结值，不补算暂停区间；evaluatedAt/lastAdvancedAt 单调。
- `snapshot`：只读推进/返回，不写事件。
- 测试：pre-pause decay、pause frozen、paused event suppressed、resume then decay、repeated pause、clock rollback persisted monotonic。
- 仍缺：per-source mood contributions + conversation deletion rebuild；DB rollback fault injection。

## G1/G2

- G2 `user_interaction_signals` 与 G1 `personality_growth_signals` 仍由同一 `deriveGrowthSignals` 双写。
- G1 仍可被用户 style 请求影响 → 未满足 Issue #78 P1-B；标 PARTIAL，未伪称修复。
- Morrow-owned trait 走 `MorrowTraitService` 独立账本与 evidence gate。

## Exploration

- `synthesizeFromContext` 只接受 origin=morrow，生成 thought；reflection findings 可作种子；X1 shared 已排除。
- 优先级：0.30 informationGap + 0.20 goalStall + 0.20 interestRelevance + 0.15 reflectionNovelty − 0.25 repeatPenalty − 0.02 + moodBoost（≤±0.08）。
- 未接真实 goal stall；未实现完整 investigation 状态机。PARTIAL。
