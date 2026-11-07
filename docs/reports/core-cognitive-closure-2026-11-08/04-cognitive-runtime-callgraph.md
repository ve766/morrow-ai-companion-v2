# 04 · 认知运行时调用图

## 生产链路（真实）

```text
CompanionService.sendChat → ChatService.send
  prepare()
    → memories.assembleContext (4-channel RRF)
    → identityContract + cognitive guidance + self-model context
    → innerCognition.contextBlock(content)          [NEW v54]
    → makeRequestPayload
  authorize → requestProviderConsent
  dispatchToProvider
  identityGuardReply(request.content, config)      [NEW deterministic guard]
  guardAnswerFacts → deliveredText
  persist assistant message
  innerCognition.observeTurn({... deliveredText ...}) [NEW]
    → morrow_thoughts (only if uncertainty/correction)
    → reviewThought → morrow_self_states candidate
  drainCognition / trace / commit
```

## 下一轮

```text
prepare()
  → innerCognition.contextBlock(content)
  → SELECT morrow_self_states WHERE actor='morrow' AND status IN (active,candidate,conflict_pending)
  → system prompt line "Morrow's own unresolved thoughts..."
  → Provider payload
```

## 后台维护

`app/index.ts` 每 5 分钟调用 `innerCognition.reviewDue()`；单实例进程内 timer，`before-quit` clear；无云 Provider 调用，无工具/网络副作用。失败只记 warn，不阻断聊天。

## 缺失

- reflection finding → self-model revision 未接线；
- 语义 embedding 未接线；
- appraisal→attention 只通过 thought priority/uncertainty 间接影响，没有独立 attention 算法；
- 多 Provider 身份矩阵未跑。
