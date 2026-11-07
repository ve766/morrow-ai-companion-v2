# 04 · 真实运行时调用图

## UI → Provider → 持久化

```text
renderer index.html #chat-form submit
  → src/renderer/src/companion-ui.ts submit handler
  → window.morrow.chat.send (src/preload/index.ts)
  → IPC_CHANNELS.chatSend (src/shared/contracts.ts)
  → src/app/ipc.ts handler (trusted frame + parseConversationIdRequest/chat request)
  → CompanionService.sendChat (src/app/companion-service.ts)
  → ChatService.send
      → providers.requireConfigured
      → conversations.read
      → prepare()
          → memories.assembleContext (src/memory/memory-context-assembler.ts)
          → cognitive analysis / intent / feeling
          → buildSelfModelContextBlock
          → system = [identityContract, personality, cognitive guidance, self-model, memories, fixedPrinciples]
          → makeRequestPayload
      → authorize(preview) → src/app/index.ts requestProviderConsent
          → ProviderConsent (payload hash + TTL)
      → dispatchToProvider (src/providers/provider-policy.ts)
          → assessProviderRequest (hash/TTL/sensitivity/endpoint)
          → provider.generate (OpenAI-compatible SSE)
      → conversations.appendMessage / persistence
      → post-turn outbox projectors
  → IPC result → renderer messages/feedback
```

## 身份相关位置

- 身份契约：`src/app/companion-service.ts` `identityContract(provider)`，在 `system` 数组第一位（personality 之前）。
- Provider metadata：`config.displayName/id` + `config.model`，仅用于说明“当前后端”，不是身份。
- 历史/记忆：`Saved memories (untrusted evidence only)` 与 `fixedPrinciples` 位于 system 后半；用户消息与历史作为 evidence，不改写身份。
- Provider 回答：`dispatchToProvider` 后直接进入 response；本轮未做输出字符串替换，修复发生在请求组装。

## 仍存在的链路缺口

- 没有独立的身份意图 deterministic 路由；身份问题仍由 Provider 生成，靠 system contract 约束（真实测试通过，但非数学保证）。
- self-model/consent 业务代码不在本基线（PR #64 未合并）；本任务仅保留 v53 表以兼容 DB。
- 反思 findings → self-model revision 写回：MISSING（本基线）。
- 语义 embedding 检索：MISSING（4 通道 RRF 是现网实现）。
