# 认知内核升级架构与数据流

- Schema：v53 `self-model-states-and-consent-scopes`
- 代码：
  - `src/self-model/self-model-state.ts`
  - `src/providers/consent-grants.ts`
  - `src/app/startup-composition.ts`
  - `src/app/companion-service.ts`
  - `src/app/index.ts`

## 1. 自我模型数据流

```text
user message
  → ChatService.prepare / buildSelfModelContextBlock
  → post-turn outbox module `self_fact`
  → deriveSelfModelCandidates(text)
  → SelfModelStateService.propose(candidate)
      → scoreSelfModelCandidate(prior)
      → decision: activate/reinforce/weaken/revise/conflict_pending/candidate/reject
      → append new revision row
      → supersede old row (append-only)
  → next turn context: active states only
```

状态表 `self_model_states` 字段：

`id, type, proposition, stance, confidence, evidence_json, origin, scope, revision, supersedes, status, rationale, source_message_id, conversation_id, created_at, updated_at`

- `origin` 六类：`user_explicit / retrieved_memory / model_inference / system_constraint / model_proposed_candidate / unknown`。
- `user_explicit` 在上下文中明确标注为“用户陈述，不是 Morrow 自己的偏好”。
- 每次变化新增一行；旧行 `status=superseded`，`supersedes` 指向新行；历史永不覆盖。
- `source_message_id` 用于幂等：同一消息重放不会生成第二个 revision。

## 2. 授权数据流

```text
preview (action/providerId/endpoint/model/maxSensitivity)
  → consentScopeForPreview
  → sha256(canonical scope)  [不含 key、消息正文、payload hash]
  → ConsentGrantService.find(scope)
       hit + not expired/revoked → return per-request consent with current payload hash + <=5 min consent TTL
       miss → native dialog
  → allow: persist grant (24h)
  → revoke: provider delete / credential clear revokes provider's grants; grant API revoke available
```

- `ProviderConsent` 仍绑定当前 `payloadSha256`；`assessProviderRequest` 仍校验 hash、5 分钟 consent 生命周期和敏感级别。
- 持久的是 **scope grant**，不是 payload 或 key。scope 变化（endpoint/model/sensitivity/action）会重新询问。
- 普通 chat 才复用；`connection-test`/`model-discovery` 仍每次对话确认。

## 3. 与既有机制的边界

- Memory RRF、reflection、exploration、personalization 未被替换；本切片只新增 self-model 状态与 consent scope。
- 认知模块失败仍由 outbox/短路径降级，不阻断聊天。
- 未新增任何 Agent、shell、文件、网络执行能力。
