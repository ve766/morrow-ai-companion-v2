# Stage 3 运行时与数据链路审查（独立审计）

- 审查对象 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`（与其余五份审计文档相同）。
- 方法：审查者精读主链关键段 + 全仓消费者 grep + 只读探查代理全图扫描；所有行号在审查 SHA 上逐一验证。本文只写有行号证据的结论。

## 1. 消息主链（renderer → provider）

```
companion-ui.ts:553-556   requestId = crypto.randomUUID()（重试复用 retry.requestId）
  → preload/index.ts:102  invoke('morrow:chat:send')（通道定义 shared/contracts.ts:41-43）
  → register-ipc.ts:6-31 → ipc.ts:279-283  companion.sendChat(request, onDelta)
  → companion-service.ts:1171 → 1410 ChatService.send()
      1411-1415  会话锁 + normalizedUuid 校验
      1419-1446  幂等重放：同 turnId 已有 assistant 消息 → 直接返回存储回复
      1457       prepare() 第一次（预览载荷）；consentPreview 1464
                 （hashProviderInput = sha256(stableJson({endpoint, body}))，provider-policy.ts:149-172/84-87）
      1475       同意后 prepare() 第二次；1476 比对 payloadSha256，不一致 → CONFLICT
                 —— 两次 prepare 是"同意前后载荷未变"的验证；requestId 即 turnId 兼 feeling 幂等键（1838）
      1509-1515  intent reading 与消息同事务写入（v38 intent_readings，UNIQUE(message_id)）
      1521       markExplorationAttempted(requestId)（dispatch 前）
      1522       dispatchToProvider → openai-compatible.ts（45s 超时、有界重试、流式）
      1567       fact guard；1591 prepareFinalization（中断恢复意图先落库）
      1603-1659  afterPersist（assistant 消息同事务）：feeling 事件 1609-1619、outbox.enqueue 1643、knowledge gap 1655-1657
      1661       appendMessage('assistant', ..., requestId, { messageId, afterPersist })
      1674       settleExploration('succeeded', deliveredText)（assistant 消息持久化之后）
      1676-1683  outbox 存在 → drainCognition(requestId)（按模块隔离重试）
      1684-1699  else 分支 onTurnCompleted —— 见 §2：不可达
      1710       evaluateTurn 台账
```

结论：主链完整、幂等键统一（requestId 贯穿 turn/exploration/feeling/ledger）、同意前后双 prepare + 哈希时序安全比对成立。

## 2. G1/G2 双链路真相（本审查最重要的更正）

存在两套并行实现，共享同一数学（`foldGrowth`，±8 上限、45 天半衰、minEvidence=3）：

| | G1 `PersonalityGrowthService`（`personality-growth.ts`，表 `personality_growth_signals/_state`） | G2 `UserInteractionProfileService`（`interaction-profile.ts`，表 `user_interaction_signals/_profile`） |
|---|---|---|
| 写入 | `apply()` `personality-growth.ts:305-346`；唯一调用点 `companion-service.ts:1080`，位于 `onTurnCompleted`（`:1045-1109`） | outbox `growth` 模块投影器 `companion-service.ts:782-795` → `interaction.apply`（`:793`） |
| 生产可达性 | **不可达**：`onTurnCompleted` 唯一调用点 `:1687` 在 `if (this.outbox && this.projectors.length>0)…else if (this.selfModel)` 的 else 分支（`:1676/1684`）；outbox 只要传入 selfModelLoop 就在构造器内创建（`:1131`），投影器恒非空 → else 永不执行（生产与评测均如此） | 可达：每轮经 outbox drain 执行 |
| 读取 | `describeGrowth :281`、`forgetTurn/rollback/recomputeAll :357-416` 全部无生产调用点（仅测试） | `effectiveProfile :996-1013` 读 `interaction.offsets()`（`:1001`）叠加基线（调用点 prepare `:1791`）；`interaction.describe()` 进 context block（`:712-721`） |
| 进 payload | 否 | 是（人格行 `:1867` 数值来自 effectiveProfile；context block `:720-721`） |
| 生命周期 | 无 | L4 正负证据、L12 删除级联重算、restart 跨进程连续，全部 PASS（审查 SHA 复跑） |

运行时旁证：纵向评测 `20261031T064131Z-b0e719a.json` 的 dayLog 由 `stack.growth.list()` 读出，十日三维恒 `{0,0,0}`（`list()` 对无信号维度合成零值，`personality-growth.ts:352-354`）。代码注释 `:717-720`（"Stage 3 G1: the drift is described…"）与 `:1787-1789` 把 G2 的输出标注为 G1，属注释级误标。

**判定：G1 台账 = 无生产写入 + 无生产读取的休眠代码；文档"生产者存在、每轮运行"的表述与执行事实不符。人格成长的活链路是 G2。**

## 3. 探索状态机（X1）

- 状态全集 `exploration-policy.ts:126-142`；DB CHECK `migrations.ts:1918-1921`（v35 重建补 `eligible`/`model_attempted`）。
- 链路：`decide()`（`:397-421`，transition `eligible :412` → `reserve :414` → `permitted :419` / 预算拒绝 `not_raised :416`）在 prepare 内经 `explorationLine` 钩子触发（`:940-964`，调用点 `:1861-1865`）；`markSelected :957`；`model_attempted` 在 dispatch 前（`:1521`）；`settle` 在 assistant 消息持久化后（`:1674`→`:974-991`→`settle :329-352`）。
- 幂等：`transition()` `INSERT … ON CONFLICT(turn_id, state) DO NOTHING`（`:297-303`）+ 唯一索引 `exploration_events_turn_state_uq`（v30 首建 `:1275`、v34 重建 `:1582`、v35 补 `:1930`）；预算表 PK `(scope, turn_id)`（`:1588-1595`），`reserve` 在 `BEGIN IMMEDIATE` 内读自身行防重（`:238-263`）。重复 prepare（同意前后两次）不重复计数，`exploration-policy.test.ts:204` 直接覆盖。
- `actually_raised` 判定 `evaluateRaise :191-199`：话题词完全未现→`not_raised`；命中第一人称关注/提问句式→`raised`；仅裸提及→`uncertain`（独立状态、释放预算 `:346-350`，不冒充成败）。失败/取消→`provider_failed` + 释放（`:337-341`）。
- 消息删除级联清空该轮探索事件（trigger `:1931-1935`）。
- **缺口**：`markUserRejected :355-358` 无任何生产调用点——`user_rejected` 状态在生产中不可能出现（F2 要求的状态之一没有写入路径）。

## 4. 兴趣归属（user / morrow / shared）

- origin 枚举 `self-model-domain.ts:12-13`；证据行级 origin（`interest-service.ts:56-57`）。
- user 侧：turn 投影器 `observe`（`companion-service.ts:752-760`，默认 origin `user`，`interest-service.ts:138/601`）；晋升 `interestPromotionEligible`（domain `:177-178`，≥2 独立会话且 ≥3 有效支持，`derivedStatus :819`）。
- morrow 侧：唯一入口 `observeMorrow :429-439` / `observeMorrowEvidence :452-480`，调用者仅 `reflection-service.ts:662-686`（`morrow_interest` effect），候选来自 `knowledge_gap_evidence`（≥2 独立会话，`pickMorrowGapCandidate :609-625`；gap 在 assistant 事务内写入，幂等键 `knowledge-gap:{turnId}:{label}`，`companion-service.ts:1016-1044`）。
- 归并规则防冒名：morrow 证据落 user 主题→`shared`，反之亦然（`:649-651`）；morrow 侧晋升只计 `morrowSupport/morrowNet`（`:777-780`）；shared 需 userSupport>0 否则降回 candidate（`:785-790`）；探索门只放行 `morrow|shared`（`exploration-policy.ts:71`）。
- 反证：counter 证据 `:516-559`，最新极性为 counter 强制 candidate（`:810-821`）；支持清零删行（`reconcile :695-703`）；30 天未见归档（`:832-845`）。
- 判定：机制层 PASS；真实运行中 Morrow 兴趣从未形成（三次 live 运行 morrowInterests=0，缺口 1<3），"模型提问→候选"生产者不存在（acceptance-matrix P0-3 FAIL 与代码一致）。

## 5. 目标双系统

- 任务执行型 `GoalService`：`app/index.ts:314` 构造，仅走 IPC（`ipc.ts:223-231`），**不被 CompanionService 持有**——与 Stage 2 相同，未入主链。
- 陪伴型 `CompanionGoalService`（`motivation/companion-goal.ts`）：`app/index.ts:235` 构造、`:252` 注入 selfModelLoop；'goal' 投影器（`companion-service.ts:815-825`）→ `detectFromTurn`（幂等键 `goal:turn:{sourceMessageId}:{titleHash}` `:234` + `goal_creation_keys` 表 `:1893-1898`）；无日期承诺落 `goal_candidates` 待确认（`:252-267`，acceptCandidate 事务 `:296-345`）；`activeForContext` 每轮先 `expireOverdue`（`:446-474`）并过滤源消息已删者（trigger `:2007-2017`）；payload 按 owner 三行渲染（`describeGoals :539-552`，进 `:722-731`）。
- 判定：任务 §2D 的"长期目标跨会话闭环"由陪伴型目标实现且经 L10 验证（对话创建→下轮 payload→完成后消失→含糊意愿仅成候选）；"GoalService 接入主链"的字面要求实际以新服务承担，审查认定满足意图、记录差异。

## 6. 反思闭环

- 增量消费：`reflection_cursors`（consumer='reflection'，`:223-225`）+ `events.listAfter(seq,200)`（`:287-298`），游标整批事务后推进（`:580-583`）。
- 预算：MAX_RUNS_PER_HOUR=6（`:211`）、每批 200×≤5 批、≤8 findings、每 run ≤1 候选。
- 恰好一次：`applyWithLedger :485-500` 经 `CognitiveEffectLedger.begin/complete/fail`（`effect-ledger.ts:104-182`）。
- **消费缺口**：自动路径（post_conversation/startup）的 findings 只落库（`:506-549`）；`pendingItems.absorbReflection`（`pending-items.ts:257-272`）仅挂在**手动** `runReflection` IPC（`app/index.ts:428-440`）；`buildSelfModelContextBlock :684-736` 不读 reflection_findings。**findings 进 payload 的唯一路径是兴趣候选**（`morrow_interest`/`interest_evidence` effect 写证据行 → interests → context block，即 L5 验证的链）。
- 撤回级联：memory 撤回 trigger 删 interest_evidence 并置 stale（`:1722-1752`），读时 reconcile 修复/降级。

## 7. 内在状态（计算性）

- 更新：`createCognitiveFeelingEvent`（`:1832-1841`，幂等键=requestId）→ `recordCompletedTurnInTransaction`（`cognitive-feeling-service.ts:92-161`，事务内、幂等/语义冲突检测 `:97-113`）；状态机 `applyFeelingEvent`（`feeling.ts:376-419`，单事件上限、半衰）；崩溃恢复重放 `:1430-1440`。
- **真实消费点**：(1) 检索放宽 `adjustPolicyForState`（`retrieval-attention.ts:52-67`：`explorationPriority ≥0.08 → maxMemories+2`，天花板 25），且取**轮开始前**状态（`:1817-1823` 注释：本回合事件不得决定本回合证据）；(2) `feelingPromptGuidance` 进 system（`:1870`）；(3) 反思 bias_hint 读 `feeling.event_applied` 事件（`:338-354`）；(4) renderer 快照 IPC。
- 不消费：探索候选排序（仅 strength/recency）、重要性、人格数值。
- 判定：满足"至少一个以上真实环节"（检索优先级 + 回复引导 + 反思证据），且从未向模型透露数值。

## 8. 记忆生命周期

- 重要性：`memory-importance.ts:82-130` `scoreMemory`（w_src .30/w_user .25/w_rep .15/w_goal .10/w_corr .10/w_rec .10，`:38`）；重复项来自 `memory_evidence` DISTINCT independence_group（`:196-200`）；按类型半衰（boundary 365d/goal 180d/默认 90d，`:168-173`）。**头注释称 R 来自 revision history，实现已改为 evidence ledger（注释漂移）**。
- 巩固 `consolidate() :300-327` 与归档 `archiveBelow(0.35, 180d) :263-285`（保护类豁免 `:279-280`）：**调用点仅启动时**（`app/index.ts:205-206`，注释自认"本构建无调度器"）——启动真实运行，长驻进程不衰减。
- 冲突：`detectConflicts :144-163`（保守词项启发）、组装期 `conflictedIds :170-185` → assembler 标 `conflictWith`（`memory-context-assembler.ts:326-345`）→ prompt 冲突行（`:128-130`）+ fact guard 输入（`:1570-1577`）。不区分事实冲突/偏好变化/情境差异（登记表自认）。
- 撤回/删除级联：撤回 → retraction 证据 + 重复项归零 + trigger 删 interest_evidence（`:1722-1752`）；删除 → deletion_journal + FK 级联删 importance/evidence（v31/v34）+ 按消息/会话 trigger（`:1677-1770`）+ outbox 取消（`:1844-1849`）。L12 以非空前置验证"删除→重算不保留幽灵值"。

## 9. Outbox / Effect Ledger / 崩溃恢复

- v34 `cognitive_outbox`（含 'memory' 模块重建 `:1824-1849`）；v35 `cognitive_effect_ledger` 唯一索引 `(turn_id, module, handler_version, effect_key)`、state CHECK（`:1854-1869`）；v36 claim 原子化：`claim_owner`+`lease_until` 条件 UPDATE、60s lease、精确 lease 值抢占、complete/fail 带 owner 谓词（`effect-ledger.ts:104-182`）。
- outbox 行与 assistant 消息同事务 enqueue（`:1642-1650`）；drain 于回合后（`:1677`）与启动（`app/index.ts:284`）；"ledger 先、outbox 后"完成顺序（`cognitive-outbox.ts:271-272`）保证已提交效果不重放；`applied` 短路（`:247-251`）。
- 中断轮恢复走 finalization 意图（`:2022-2207`，启动调用 `app/index.ts:264`）。
- 注记：`requeueInterrupted`（`effect-ledger.ts:222-230`）无生产调用点——运行中行的恢复实际依赖 begin() 的过期 lease 接管（语义等价，路径单一）。
- v38 `intent_readings`：UNIQUE(message_id)、FK ON DELETE CASCADE、supersede/retract 列（`:2109-2158`）。

## 10. 迁移谱系与语音

- 迁移 v1–v38 连续（`migrations.ts` 最大 version=38 `:2109`）；升级路径由 CI 的 windows-install-path job（v1→v15 真实 app 下）与 `migrations.test.ts` 覆盖。
- **语音：src/ 中无任何 ASR/TTS/录音/音频代码**（探查代理以 20 个关键词全量 grep，唯一命中为 `speech-act.ts` 这类文本语言学模块与注释）。preload 暴露面无媒体 API。语音闭环 NOT_IMPLEMENTED，与 PR 描述一致。
