# 情绪、人格、奖励闭环

## 已落地

- 18 emotion families（basic/compound），同一 state 可共存；逐族半衰期、regulationState、evidenceRefs、appraisal、schema/algorithm version。
- `EmotionService`：单一 `emotion_events` 日志 + `emotion_states` 投影 + revisions + regulations；按 turn 幂等；重建保留 retracted。
- `appraisal-engine`：G/C/N/A/S/R/L/E，`APPRAISAL_WEIGHTS` v1，`P_e` + `I_e=clip(sigmoid(P_e)*Q*D)` 只缩放候选强度；用户情绪只允许 user-context concern。
- `AffectLoopService` 生产接线：当前回合 affect 进入 system prompt/expression/exploration；assistant 消息事务内持久化；下一轮 query 相关性过滤。
- Morrow trait：observation/revision、独立会话/跨情境/24h/反证/迟滞/冷却；用户风格要求只进入 `personality_growth`。
- Reward：只接受 verified progress 等；user praise/retention/dependency/self-praise 拒绝。
- UI：设置页展示当前情绪/活跃 trait；每情绪“缓解/撤销”；清除情绪/人格/奖励记录；授权 grant 列表与撤销。

## 本轮修复

1. **所有权**：用户探索 → shared_interaction，traitEligible=false；只有 Morrow 自己的 appraisal 可成为 trait 证据。
2. **生产反证**：对已 active trait，纠错/regret/concern 产生 negative observation；active→weakened，保留 counter refs。
3. **Reward/Affect 原子性**：promoted thought 的 reward + progress affect 在一个 transaction；失败两者都不写。
4. **Trait freshness**：消息删除级联 observation 后，下一次读取立即 recompute，不依赖 startup。
5. **UI**：`affect-ui.ts` 真实调用 `affectStateGet/regulate/affectClear` 与 `consentGrantsList/revoke`。

## 验证

- `personality-affect.integration.test.ts`：
  - loopback provider payload 含 `Morrow's current internal affect projection` + joy；DB emotion event 写入；无关下一轮不注入。
  - 6 个独立纠正回合→responsibility active；下一轮 payload 含 `Morrow's evidence-gated traits`；再一轮失败→counter evidence，trait weakened，下一轮不再注入 active trait。
- `morrow-trait-service.test.ts`：单事件不晋升、3 会话/2 情境/24h 晋升、重复不计数、反证 weaken、删除证据立即 recompute、重启一致、用户风格隔离。
- `intrinsic-reward.test.ts`：verified progress 幂等、用户操纵类来源拒绝、真实 message FK 的 reward 写入、清除。
- 全量测试见 `results/issue74-tests2.log`。

## 未完成

- **continuous mood**：没有独立 mood 表；三维 `feeling.ts` 仍承担短期 mood 投影。事件情绪与 trait 已分离，但“mood 按真实 elapsed time 回归”只在 feeling 的 3D 半衰期上部分成立。
- **sadness/loneliness 自动 loss**：只有显式 `recordMorrowLoss`；生产只接 knowledge gap→concern。
- **anger/fear 生产场景**：UNIT_ONLY；不声称已稳定触发。
- **情绪暂停**：没有持久化 pause 开关；只有缓解/撤销/清除。
- **真实 7 天人格数据**：测试时钟模拟，不是真实 7 天。
- **真实模型表达 A/B**：没有 cloud provider 对照，只有 prompt/策略对象与 loopback E2E。
- **single-message delete**：trait 读时重算已修；emotion projection 依赖 FK/dirty rebuild，测试覆盖 conversation delete 而非 UI 单消息删除。
- **Beta/fractional evidence**：trait 使用 bounded score，不是 Beta 后验。
