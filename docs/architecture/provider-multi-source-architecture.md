# Provider 多源接入架构（Issue #50）

代码 SHA：`24efc5cb60972f28b746779ca4f32ed37d295f57`
分支：`feat/provider-multi-source-foundation`（base release `3812b18`）

## 1. 领域模型

Provider、Protocol、Endpoint、Model 四个维度独立：

```text
ProviderProfile
  id              opaque profile key (lowercase [a-z0-9-], 1..64)
  displayName     user-facing name, 1..80
  sourceKind      official | custom-proxy | local | private-network
  protocolId      openai-chat-completions | anthropic-messages | ollama-native
  providerClass   remote | local (derived from sourceKind)
  endpoint        base URL (no userinfo/query/fragment)
  endpointPath    optional path; resolver prevents duplicate /v1 or /chat/completions
  model           model id
  enabled         boolean
  isDefault       at most one default profile
  capabilities    streaming/vision/toolCalling/jsonMode/systemRole, each declared/probed/verified
  lastTest        status/latency/endpointDigest/model/httpStatus/attempts (no content)
  updatedAt
```

- `ProviderKind` 是来源，不是协议；`protocolId` 不写死在 provider id 上。
- `private-network` 类型存在但本阶段 **NOT_SUPPORTED**：UI disabled，服务/registry 拒绝。
- `anthropic-messages` / `ollama-native` 只有协议契约，当前没有 adapter；保存被拒绝，不宣称支持。
- `CredentialRef` 实际为 profile id：SecretStore 按 id 隔离，DB 只保存 `apiKeyConfigured` 布尔值。

## 2. 组件边界

```text
renderer provider-profiles-ui
  → preload providers.{listProfiles,saveProfile,deleteProfile,setDefaultProfile,discoverModels,testConnection}
  → IPC trusted sender + strict validation
  → ProviderConfigService
      ├─ validateProviderConfig (registry)
      ├─ endpoint resolver (chat/models)
      ├─ SecretStore (profile id)
      ├─ consentPreview → authorize → dispatchToProvider
      └─ OpenAICompatibleProvider
            ├─ endpoint-security policy (request-time DNS)
            ├─ fetch redirect:error
            └─ payload/SSE/retry/error classification
  → SQLite provider_profiles (v48)
```

- `dispatchToProvider` 仍是唯一真实请求出口；新 profile 不绕过 consent、payload hash 或敏感度。
- `OpenAICompatibleProvider` 不重写；仅把 `isConfigShapeValid` 和 endpoint 解析改为 profile-aware。
- `ProviderConfigService.requireConfigured()`：显式 default → 旧优先级 local > spark > deepseek → 第一个启用的自定义 profile。

## 3. Endpoint 解析

```text
base https://relay.example.com          + no path      → /chat/completions
base https://relay.example.com/v1       + no path      → /v1/chat/completions
base https://relay.example.com/v1/chat/completions     → unchanged
base https://relay.example.com/v1       + /v1/chat/completions → /v1/chat/completions (no duplicate)
base https://relay.example.com          + /api/chat/completions → /api/chat/completions
models: full chat URL → sibling /models; versioned base → /v1/models
```

- 用户可粘贴 base、`/v1` base 或完整 chat URL；UI 不拼 URL。
- `endpointPath` 必须是 `/` 开头、无 `..`/query/fragment。

## 4. 状态机

```text
profile: absent --save--> enabled/disabled --disable--> enabled=false
enabled --setDefault--> is_default=1 (all others 0)
enabled --delete(custom only)--> absent + secret deleted
enabled --test--> lastTest connected/auth_failed/model_not_found/quota/timeout/network/protocol
capabilities.streaming: declared=true → probed=true → verified=true only after real success
```

- 官方 profile（deepseek/spark）不允许删除；local 允许删除。
- 删除 profile 先删 secret，DB 删除失败时恢复 secret（补偿）。
- 切换 default 不修改人格/记忆/对话。

## 5. 迁移

v48 `provider-multi-source-profiles`：

- 重建 `provider_profiles`，复制 deepseek/spark/local 旧行；
- 旧 endpoint/model/enabled/updated_at 保留；
- displayName/sourceKind/protocol/isDefault/capabilities 补齐；
- 唯一 partial index `is_default=1`；
- 旧 secret 以原 id 继续读取。

**版本冲突**：Stage 4 PR #40 也使用 v48；本分支按 Issue #50 独立交付。若 #40 先合并，合并前把本迁移重编号为 v49（尚无已发布 v48 provider 数据库）。

## 6. 多 profile 与默认选择

- 同一服务商多个 endpoint、同一 endpoint 多模型、多个中转站可并存；id 各自独立。
- `is_default` 唯一；`setDefaultProfile` 在一个事务中清除旧 default。
- 未设置 default 时保持旧优先级（local > spark > deepseek），然后才选择自定义 profile。
- Provider/Endpoint/Model 变更只影响请求路径，不触碰 Morrow 本体表。

## 7. 协议能力矩阵

| Protocol | Adapter | 状态 |
|---|---|---|
| openai-chat-completions | `OpenAICompatibleProvider` | 完整支持（非流式/SSE/retry/timeout/取消/错误分类） |
| anthropic-messages | 无 | 契约占位；保存拒绝，不宣称支持 |
| ollama-native | 无 | 契约占位；可用 Ollama 的 OpenAI-compatible endpoint 作为本阶段兼容方式 |

## 8. 真实测试路径

`eval:provider-multi-source`：

1. 从 `MORROW_TEST_API_KEY` 读取密钥（无文件回退）；
2. 创建临时 SQLite，保存 custom profile（endpoint/model/key）；
3. 通过 IPC handlers 再 save/list/test（trusted sender、schema、service）；
4. `testConnection` 走 consent → adapter → real HTTP；
5. adapter 非流式/流式各一次，记录延迟、attempts、delta 数、text/delta 一致；
6. 写 sanitized JSON/transcript；不记录 key、Authorization 或响应文本；
7. 无 key → `BLOCKED_NO_SECRET`；provider 额度不足 → `BLOCKED_QUOTA`；local 未运行 → `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`。
