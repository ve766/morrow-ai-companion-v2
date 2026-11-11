# 源码审计（父 PR #70 HEAD 起点）

基线：`fix/chat-consent-latency-20261108` @ `b998886`。以下位置以实际符号为准，行号会随提交变化，因此同时给符号名。

| 文件 | 函数/调用点 | 审计时行为 | 缺陷/边界 | 本轮修改 | 测试 |
|---|---|---|---|---|---|
| `src/affective-state/feeling.ts` | `FEELING_EVENT_TYPES` / `FEELING_DIMENSIONS` / `FEELING_EVENT_PROFILES` | 仅 6 种事件、valence/activation/tension 三维；规则强度作为 confidenceBasis | 无法表达 joy/anger/sadness/concern 等可区分情绪，也无法共存 | 保留为兼容短期投影；新增独立多维模型，不破坏旧 API | `cognitive-feeling-*.test.ts` 全量保留 |
| `src/affective-state/cognitive-feeling-engine.ts` | `detectEventType` / `createCognitiveFeelingEvent` / `feelingPromptGuidance` | 关键词 + intent 的显式反馈识别；local_rules | 单次关键词不能决定复杂情绪；旧 prompt guidance 只是短提示 | 新 appraisal 读取已识别事件，不复制第二套关键词解析；新增多维候选与表达策略 | `appraisal-engine.test.ts` |
| `src/affective-state/cognitive-feeling-service.ts` | `snapshot` / `recordCompletedTurnInTransaction` / `clearHistory` | 事务、幂等、revision、rebuild、clear | 只覆盖三维交互状态 | 保留；新增 `EmotionService` 作为唯一多维情绪权威 | `cognitive-feeling-service.test.ts`、`emotion-service.test.ts` |
| `src/affective-state/expression-policy.ts` | `deriveExpressionPolicy` / `describeExpressionPolicy` | 用 tension + 用户 distress 证据决定 advice/clarify/brevity | 没有 Morrow 自身多维 affect 策略 | 新增可选 `affectFamilies` 与 `affectStrategy`；明确 direct request 优先 | `affect-attention.test.ts`、既有 `distress-evidence.test.ts` |
| `src/personalization/personality-growth.ts` | `deriveGrowthSignals` / `foldGrowth` / `applyGrowth` | 用户显式风格要求的适配漂移；G1/G2 分离 | 不是 Morrow-owned trait，不能当人格形成 | 不改语义；新增 trait 服务明确隔离；测试证明风格请求不产生 Morrow trait | `morrow-trait-service.test.ts`、既有 growth tests |
| `src/self-model/interest-service.ts` | `observe` / `deriveInterestLabel` / `activeForContext` | 主题兴趣证据与衰减 | 没有情绪排序输入 | 通过 exploration gate 的 topic-specific affect bias 影响已合格兴趣排序，不创建兴趣 | `affect-attention.test.ts`、既有 interest tests |
| `src/self-model/reflection-service.ts` | `run` / findings | 有界反思与 finding | 没有情绪强度输入 | 未直接改 reflection；affect conflict/prediction-error 进入 inner cognition 巩固触发（现有 reflection 路由仍消费其状态） | 既有 reflection tests |
| `src/self-model/inner-cognition.ts` | `observeTurn` / `reviewDue` | 从不确定/纠错/prediction error 生成 thought，证据 gate 产生 state | 没有 affect 触发 | `ChatService` 把 affect conflict/predictionError 传入 `observeTurn`；scheduler 把 active state 转为 reward | `inner-cognition.test.ts`、`intrinsic-reward.test.ts` |
| `src/app/companion-service.ts` | `ChatService.send` / `prepare` / `afterPersist` / `deleteConversation` / `clearCognitiveHistory` | 聊天、feelings、expression、exploration、self-model | 无多维 affect；删除/清理未覆盖新账本 | preview 进入 prompt；assistant 事务内持久化；恢复路径幂等；删除/清理传播 | `personality-affect.integration.test.ts` |
| `src/persistence/migrations.ts` | `version: 55` `personality-affect-integration` | 最新 v54 | 无 emotion/trait/reward 表 | 新增 v55 8 张表、FK、triggers、索引；不删除/重置旧数据 | `migrations.test.ts`、`emotion-service.test.ts` |
| `src/app/index.ts` | startup composition / `innerCognitionTimer` | 创建 feelings、interests、inner cognition 等 | 未创建 affect 服务 | 创建 `AffectLoopService`；启动重算 trait；scheduler 记录 reward | 生产集成测试 |
| `src/self-model/exploration-policy.ts` | `decideExploration` / `decide` | 已有证据门槛、冷却、日上限 | 没有情绪排序输入 | 可选 `affectBias`，只按 topic 相关性重排已合格兴趣；不绕过门槛 | `affect-attention.test.ts` |
| `src/self-model/morrow-trait-service.ts` | 新增 | — | — | trait observation/revision/证据 gate/反证/冷却/重建 | `morrow-trait-service.test.ts` |
| `src/self-model/intrinsic-reward.ts` | 新增 | — | — | 版本化 RewardSignal/MotivationSignal 契约；拒绝用户操纵类奖励 | `intrinsic-reward.test.ts` |

## 调用链（生产）

```text
ChatService.send
  → prepare
      analyzeCognitiveTurn
      feelings.snapshot / createCognitiveFeelingEvent / preview
      AffectLoopService.preview
        EmotionService.snapshot(prior)
        MorrowTraitService.activeStrengths → traitSensitivity
        appraiseTurn → candidates → preview state
      deriveExpressionPolicy(affectFamilies)
      explorationLine(affectBias: topic tags + bias)
      system prompt: affect line + trait line + existing self-model/inner-cognition
  → provider
  → assistant appendMessage(afterPersist)
      feelings.recordCompletedTurnInTransaction
      AffectLoopService.recordCompletedTurnInTransaction
        EmotionService.recordInTransaction (event + revision + projection)
        MorrowTraitService.observeInTransaction (same transaction)
  → innerCognition.observeTurn(conflict/predictionError)
  → drain outbox / next turn contextBlock(query)
```

## 发现但未合并的历史分支

- `feature/algorithm-v2-phase-a`：ONNX runtime/113MB 模型缺失，语义消融 BLOCKED；不合并。
- `fix/memory-reliability-v0.1`、`fix/phase-2.2.10-memory-trust-hardening`：timestamp-trust 未回到当前线，NOT_RESTORED。
- `feat/stage-6-appraisal-engine`：保留现有 affective-state，不整体 cherry-pick；appraisal 采用当前代码的确定性规则。
- PR #64/#66/#68/#70：只堆叠在 #70 之上，不合并、不重写。
