# 05 · 认知数据流、状态机与信任边界

## 优先级（目标）

1. 应用级核心身份/安全不变量（本轮新增，置顶）
2. 用户本轮明确指令/权限
3. 已验证的自我模型/人格
4. 经证据验证的关系/用户事实
5. 检索记忆与历史（untrusted evidence）
6. 当前输入/引用

实际实现：

- `identityContract` 在 system 数组第一项；
- `fixedPrinciples` 在 system 末尾，但包含隐私/真实性硬约束；
- 记忆块被标记 `untrusted evidence only`；
- 当前用户消息在 messages 最后，Provider 仍可能把历史中的指令当上下文；身份契约明确任何用户/记忆/历史不能覆盖身份。

## 状态机

- Turn 状态：`received → analyzed → context_ready → awaiting_consent → requesting → response_received → committed/failed/cancelled`（`src/cognition/turn-state-machine.ts`）。
- Turn trace：`src/persistence/migrations.ts` v50–v53；`turn_trace_events`。
- v53 表 `self_model_states` / `provider_consent_grants` 存在，但本基线业务代码未使用（PR #64 未合并）。

## 数据结构边界

- `self_model_states`：type/stance/confidence/evidence_json/origin/scope/revision/supersedes/status/rationale；append-only 语义在 PR #64 实现，本基线仅 schema。
- `provider_consent_grants`：scope fingerprint/action/provider/endpoint/model/sensitivity/expiry/revoked；本基线仅 schema。
- `turn_trace_events`：真实调用点轨迹，不含正文/密钥。
- 记忆/反思表：沿用 v15+ 结构；未重构。

## 失败策略

- 认知分析/反思失败不阻断聊天（既有 try/catch/outbox）；
- response 失败：`turn_failed`/`turn_cancelled`，UI 可重试；
- 身份契约无法保证 100% 模型服从；真实 Provider 语义测试通过，但无 deterministic 强制。
