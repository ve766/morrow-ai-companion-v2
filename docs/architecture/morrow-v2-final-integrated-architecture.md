# Morrow V2 最终集成架构

- 分支：`feat/morrow-v2-final-closure`
- 实现 SHA：`d07b3f4b951fab2bd522413c789850055a49fe61`
- 目标 base：`release/morrow-v2-final-delivery` @ `3812b18`

## 1. 一条产品线

最终分支按依赖顺序合并两条交付线：

1. Stage 4 `feat/stage-4-companion-confirmation-closure` @ `4284cb1`：确认、pending decision、reflection、outbox、重启恢复与 12 项审计修复。
2. Provider `feat/provider-multi-source-foundation` @ `326e68a`：多源 Provider、EndpointResolver、SSRF 边界、consent、secret 隔离与 UI。
3. 本任务在合并结果上修复 Provider P1/P2，并加入 v49 迁移与桥接。

合并没有丢弃任一侧：Stage 4 的 pending/reflection/outbox 代码保留，Provider 的 profile/endpoint/security/UI 代码保留；冲突只发生在 `src/persistence/migrations.ts`，通过“保留 Stage 4 v48 + Provider 重编号 v49 + 桥接”解决。

## 2. 运行时分层

```
renderer (provider-profiles-ui / pending-ui)
  → preload typed bridge
  → IPC schema validation (src/shared/validation.ts)
  → CompanionService / ProviderConfigService
  → ProviderProfile (SQLite) + SecretStore (OS SafeStorage)
  → consent authorizer (main process native dialog)
  → ProviderRouter / dispatchToProvider
  → EndpointResolver
  → EndpointPolicy (HTTPS/DNS/private-address checks)
  → OpenAICompatibleProvider
  → HTTP
```

### Provider 身份

`provider_profiles` 现在分离四个概念：

- `id`：不透明 profile key，同时是 OS secret key；上限 40，字符集 `[a-z0-9-]`，首字符必须是字母或数字。
- `source_kind`：`official | custom-proxy | local | private-network`；本阶段 `private-network` 明确 NOT_SUPPORTED。
- `protocol_id`：只有 `openai-chat-completions` 有适配器；其余在保存与发现前拒绝。
- `endpoint` / `endpoint_path` / `model`：地址与模型名，不再由 id 推导。

官方内置 id（`deepseek`、`spark`、`local-openai`）由 service 层锁定语义：官方 id 只能使用对应 sourceKind、固定 endpoint、合法 model，且不得设置 `endpointPath`。UI 禁用只是第二道防线。

### 连接测试与聊天共用解析器

`connectionInput()` 与 chat 准备路径都调用 `resolveChatEndpoint(config.endpoint, config.endpointPath)`；`OpenAICompatibleProvider.generateOnce` 再次校验 `input.endpoint` 必须等于该解析结果。因此 base URL、`/v1`、完整 chat URL、自定义 path 在测试与真实请求中一致。

`endpointPath` 语义：

- 以 `/chat/completions` 结尾：视为完整操作路径。
- `/v1`：若 base 已以 `/v1` 结尾则不重复；否则补 `/v1/chat/completions`。
- 其他路径：视为 base 下的前缀，补一次 `/chat/completions`。
- discovery 使用同一规则把操作后缀换成 `/models`。

### 配置变更与凭据生命周期

`saveProfile` 在目标变化（sourceKind、protocol、endpoint、endpointPath）时：

1. 读取旧 secret（如存在）。
2. 若本次没有提供新 key：先删除旧 secret，并验证删除成功。
3. 远端 profile 强制 `enabled=false`，返回 `apiKeyConfigured=false`，UI 提示“旧密钥已清除，请重新输入”。
4. 写入 profile 行；行写入失败时恢复旧 secret。
5. 若提供了新 key：先写 secret 并回读校验，再写行；失败同样补偿。

连接语义变化（上述目标字段、model、credential）都会把 `lastTest` 置空并把 `capabilities` 重置为 `defaultCapabilities()`；只有 `displayName`、`enabled`、`isDefault` 等非连接字段允许保留健康状态。

### Consent 与网络边界

- `chat`、`connection-test`、`model-discovery`、`memory-proposal` 是四个独立 action。
- discovery 在发送认证 GET 前依次执行：profile 形状校验 → `resolveModelsEndpoint` → `EndpointPolicy.assertAllowed` → consent preview/authorize。拒绝时 HTTP fetch 次数为 0。
- 自定义远程只允许 HTTPS；local 只允许 loopback；`private-network` 保持 NOT_SUPPORTED。
- EndpointPolicy 覆盖 IPv4 私网/CGNAT、IPv6 loopback/ULA/link-local/multicast、IPv4-mapped、NAT64、6to4、metadata host、localhost 尾点；DNS 解析失败即拒绝。
- 适配器与 discovery 都使用 `redirect: 'error'`，不跟随重定向。
- discovery 响应体上限 1 MB；错误正文不进入日志、健康记录或 IPC 错误。

### Stage 4 保留能力

- pending decision 终态机：open → done/dropped；route consumed/rejected/dismissed；legacy route 收敛。
- reflection concern identity（`concern:v1|kind|normalize` SHA-256）、re-observation archive、`recoverUnrouted`。
- outbox 投影失败不标记完成；启动状态区分 ran/skipped/failed/degraded。
- schema gate：缺少 v48 列时返回 `SCHEMA_UPGRADE_REQUIRED`，不误报 STORAGE_ERROR。

## 3. 数据与迁移

最终 schema 为 **49**：

- v48（Stage 4）`pending-decision-terminal-state`
- v49（Provider 最终）`provider-multi-source-profiles-final`

v49 重建 `provider_profiles`，统一 id 上限 40，并接受两种来源表。详见 `docs/architecture/morrow-v2-final-migration-and-recovery.md`。

## 4. 明确不在 V2 范围

Agent Runtime、浏览器/文件工具、自主执行、模型训练、高级情绪系统、新协议适配器（anthropic-messages/ollama-native）不在本次交付；`private-network` 不开放。V2 之后停止基础架构阶段。
