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

- **continuous mood**：第二轮已新增 v56 `morrow_mood_state` 与确定性 elapsed-time 回归；完整随机 OU/真实模型 A/B 仍未做。
- **sadness/loneliness 自动 loss**：只有显式 `recordMorrowLoss`；生产只接 knowledge gap→concern。
- **anger/fear 生产场景**：UNIT_ONLY；不声称已稳定触发。
- **情绪暂停**：第二轮已实现 v56 mood pause/resume（event emotion 仍记录，只暂停 mood dynamics）；见下方第二轮补充。
- **真实 7 天人格数据**：测试时钟模拟，不是真实 7 天。
- **真实模型表达 A/B**：没有 cloud provider 对照，只有 prompt/策略对象与 loopback E2E。
- **single-message delete**：trait 读时重算已修；emotion projection 依赖 FK/dirty rebuild，测试覆盖 conversation delete 而非 UI 单消息删除。
- **Beta/fractional evidence**：trait 使用 bounded score，不是 Beta 后验。

## 第二轮补充（代码已实现）

### 独立 continuous mood（v56）

新增 `src/affective-state/mood-service.ts` 与 v56 `morrow_mood_state` 表：

- 四轴 `valence/arousal/dominance/tension`，独立 revision、`lastAdvancedAt`、`paused`。
- 确定性均值回归（半衰期：valence 6h、arousal 1h、dominance/tension 24h），按真实 elapsed time；不使用随机项，报告不称 OU 概率过程。
- `pause`/`resume` 持久化；resume 默认不补算暂停区间，避免静默跳变。
- `applyEvent` 由 AffectLoop 在 assistant 消息事务内调用；mood 进入 affect prompt、attention bias、expression strategy。
- 测试：`mood-service.test.ts` 3 tests（impulse/decay、pause/resume、reopen/clear）。
- UI：设置页增加 mood 数值、暂停/恢复按钮；IPC `affectMoodPause/Resume`；control contract 已登记。
- 仍未完成：mood 的 A/B 行为差异只在策略对象/prompt 层，不是独立真实模型对照；sadness/loneliness 自动 loss、anger/fear 仍 PARTIAL/UNIT_ONLY。

### 情绪影响三个决策点（更新）

1. 注意力/兴趣排序：`AffectLoop.attentionBias` = emotion bias + mood valence/arousal，传入 exploration gate；只重排已合格兴趣。
2. 反思/巩固：affect conflict/predictionError 进入 inner cognition；reflection finding gate 另走 self-state。
3. 表达：expression policy 读取 query-relevant emotion families + mood；direct request 仍优先。

仍缺真实模型 A/B 行为差异证据，标 PARTIAL。

## 第三轮（最终）Mood 修正

- `MoodService.setPaused` 在暂停前先按真实 elapsed time 推进到 `now`，再冻结；resume 保持冻结值、不补算暂停区间；重复 pause 保持冻结。
- 测试替换了“pause 后等于 pause 前旧值”的错误断言：12:00→12:10 先衰减，pause 后冻结，暂停 2 天不变，resume 后 10 分钟继续衰减；另加重复 pause/resume 与时钟回拨。
- Mood 已参与 prompt、attention bias、expression、synthesis priority、review limit；仍缺真实模型 A/B 行为对照。
