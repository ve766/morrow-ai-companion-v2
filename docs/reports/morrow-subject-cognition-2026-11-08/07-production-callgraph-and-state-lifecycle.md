# 07 · 生产调用图与状态生命周期

```text
ChatService.send
  prepare → contextBlock(content) → innerCognition.contextBlock(query)
  authorize → consent grant (normal/personal 30d; sensitive per-request)
  dispatch → identityGuardReply → guardAnswerFacts
  persist assistant
  innerCognition.observeTurn
    trigger? → morrow_thoughts → reviewThought → morrow_self_states
  scheduler → reviewDue → state revisions
```

- `identityGuardReply` 在 Provider 后、持久化前；只为显式身份问题。
- `contextBlock` 只注入 actor=morrow、相关 state。
- `observeTurn` 在 assistant durable 后；失败 catch/degradation，不阻断聊天。
- state 变更 append-only，旧行 superseded；无 retract API（backlog）。

状态：生产链路 PASS（inner/identity），personality/autonomous expression 未接。
