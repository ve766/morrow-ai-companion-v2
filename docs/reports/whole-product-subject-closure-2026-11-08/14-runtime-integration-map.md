# 运行时集成地图（第三轮）

```text
renderer #chat-form
 → preload chat.send
 → IPC chatSend
 → CompanionService.sendChat → ChatService.send
     prepare:
       analysis / memory / feeling
       feeling snapshot + createCognitiveFeelingEvent
       affect preview:
         EmotionService.snapshot
         MorrowTraitService.activeStrengths → traitSensitivity
         MoodService.snapshot
         appraiseTurn → candidates
         describeMood + describeAffect
       expression policy (emotion families + mood)
       explorationLine (affect bias + mood bias)
       system prompt
     authorize: requestProviderConsent
       (packaged: real native dialog; acceptance-only bypass disabled)
     provider → SSE
     afterPersist (assistant transaction):
       feelings.recordCompletedTurnInTransaction
       affect.recordCompletedTurnInTransaction:
         EmotionService.recordInTransaction
         MoodService.applyEvent
         MorrowTraitService.observeInTransaction
         counter observations for active traits
       innerCognition.observeTurn(conflict/predictionError)
     scheduler:
       innerCognition.synthesizeFromContext(interests, reflection findings, mood)
       innerCognition.reviewDue(mood-adjusted limit)
       affect.observeThoughtReviews(active states) → reward + progress affect atomically
```

## Reflection → next turn

```text
reflection producer → reflection_findings
 → ReflectionFindingRouter.ingestRun
    → route (context_hint/pending_user/audit_only)
    → stateGate.ingestInTransaction
       eligible kinds + confidence
       rootSourceId/correlationGroupId from finding evidence
       distinct correlation cluster count (not run count)
       candidate/active/weakened
       morrow_self_states append revision + supersede
       reflection.state_decision event
 → InnerCognitionService.contextBlock(query)
 → system prompt next turn
```

## 生产决策点（bounded）

1. Attention/interest：`attentionBias` = emotion bias + mood valence/arousal；只重排已合格 interest。
2. Reflection/consolidation：affect conflict/predictionError triggers; mood arousal <0.2 reduces review limit to 1; mood adds ≤0.08 to synthesized question priority.
3. Expression：expression policy reads relevant emotion families + mood; direct request still wins.
4. Autonomous exploration：mood bounded boost to priority; ownership/evidence gate unchanged.

Mood never changes ownership, evidence reliability, belief threshold, permissions or safety.

## 数据/SHA 边界

- v55 emotion/trait/reward; v56 mood; v57 not added.
- Report `11-machine-results.json` records source/tested commit; final docs HEAD is in the Issue comment/PR because a file cannot contain the hash of the commit that adds it.
