# 第三方 OpenAI 兼容 API 接入

基线 `5871038`，本轮代码 `780fde0`…`1f78092`（provider `780fde0`、显式切换 `496da17`、评测器 `1730473`/`195ff1f`/`97f07d1`）。

## 1. 现有架构（先读再改）

| 层 | 现状 | 本轮处理 |
|---|---|---|
| Provider 抽象 | `ProviderPort` + `OpenAICompatibleProvider`（同时处理流式与非流式） | **复用**，未新建实现 |
| 配置存储 | `provider_profiles` 表，`id` 只允许 `deepseek` / `local-openai`，endpoint 有硬 CHECK | v20 重建表，加入 `third-party` 与 `timeout_ms` / `catalog_verified` |
| 凭据 | `SecretStore` 接口 + `SafeStorageSecretStore`（Electron `safeStorage`，OS 凭据后端加密后落盘） | **复用**，第三方 key 存在同一机制下，id 为 `third-party` |
| 请求门 | `assessProviderRequest`：remote 必须带 payload 哈希 + 时效的显式同意；local 强制 loopback | **未改**，第三方走同一条同意链 |
| 评测 | `context-memory-real` + 12 场景 fixture + 结构化判定 | 增加 `providerId`/`apiKey` 参数，复用同一数据集与判定 |

结论：仓库里**已经有** OpenAI-compatible Provider，只是 remote 分支被写死成 DeepSeek（`endpoint === DEEPSEEK_API_BASE_URL && model === DEEPSEEK_MODEL`）。本轮是扩展而不是重写。

## 2. 改动

| 文件 | 改动 | 理由 |
|---|---|---|
| `src/shared/companion.ts` | `THIRD_PARTY_PROVIDER_ID`、`ProviderConfigRecord.timeoutMs/catalogVerified`、`ThirdPartyProviderConfigInput` | 新 provider 需要自己的记录形状 |
| `src/security/url-gate.ts` | `isHttpsEndpoint`、`normalizeOpenAIBaseUrl`、`isValidRemoteModelId` | base URL 归一化与 https 强制 |
| `src/persistence/migrations.ts` | v20 重建 `provider_profiles`；v21 增加 `active` + 部分唯一索引 | 新 provider 行；显式切换 |
| `src/providers/openai-compatible.ts` | 第三方形状校验、`chatEndpoint` 归一化、按 provider 取超时、`listModels()` | 复用同一实现 |
| `src/app/companion-service.ts` | `saveThirdParty`、`markCatalogVerified`、`setActiveProvider`、`requireConfigured` 优先显式选择 | 保存校验与显式切换 |
| `src/evaluation/context-memory-real.ts` | `providerId`/`apiKey`、探测带鉴权、报告 `modelInCatalog` | 同一数据集跑远端 |
| `src/providers/third-party-provider.test.ts`（新） | 11 条 | 见 §5 |

### 2.1 Base URL 处理

`normalizeOpenAIBaseUrl` 只剥掉文档化的后缀：尾部 `/`，以及误贴的 `/chat/completions`。所以

- `https://host/v1/` → `https://host/v1`
- `https://host/v1/chat/completions` → `https://host/v1`

聊天端点**只在 Provider 内部**由 `${base}/chat/completions` 派生一次，调用方无法再拼一次。配置里存的就是归一化后的 base。

### 2.2 超时与错误

- 超时按 provider 存（`timeout_ms`，1s–300s），第三方默认 120s；DeepSeek 与本地仍用原来的 45s。
- 429 → `PROVIDER_RATE_LIMIT`，401/403 → `PROVIDER_AUTH`，404 → `PROVIDER_MODEL`，408/504 → `PROVIDER_TIMEOUT`，其余 → `PROVIDER_NETWORK`。
- **没有自动重试**。重试会重复消耗额度，因此一次失败就返回错误码，由调用方决定。

### 2.3 模型目录

`listModels()` 打 `GET {base}/models`，带 `Authorization` 头。`catalog_verified` **只**由 `markCatalogVerified` 写入，从不因为聊天成功而置真；换 endpoint 或 model 时自动归零。报告里 `provider.modelInCatalog` 为 `null` 表示目录读不到，`false` 表示读到但没这个 id（手工输入、未验证）。

## 3. 显式切换（不静默换服务）

原来的规则是「本地启用就用本地，否则 DeepSeek」。这条规则在引入第三个 provider 后不够用：启用第三方后聊天仍然走本地，或者反过来。

v21 增加 `active` 列与部分唯一索引（`WHERE active = 1`），数据库层面保证最多一行。

- 有显式选择 → 用它；
- 没有 → 保持原规则（本地优先）；
- **显式选择的 provider 不可用时直接 `PROVIDER_UNCONFIGURED`，不回退到别家**。静默把同一段对话发给另一个服务正是必须避免的。

## 4. 凭据与隐私边界

| 要求 | 实现 |
|---|---|
| Key 不进源码/配置/日志/报告 | Key 只进 `SecretStore`（OS 凭据后端加密），报告只写 `apiKeyConfigured: true` |
| UI 不回显 | `ProviderConfigRecord` 不含 key；测试断言 `JSON.stringify(saved)` 不含 key |
| 错误消息不含请求头 | 错误只带错误码，不带 response 头或请求头 |
| 不静默外发 | 保存必须 `acknowledgeThirdParty: true`；发送必须通过既有同意链（payload 哈希 + 时效 + 敏感上限） |
| 测试用合成数据 | 12 场景全部是 fixture 合成记忆，无真实用户数据 |
| 诊断不存完整 prompt | 报告存角色序列、条目数、匹配类型、字节数；完整 payload 只在内存 |

**本轮 key 的处理**：用户把 key 直接发在对话里。为了不落进仓库，key 只写入仓库外的临时文件 `~/.morrow-eval-key`（0600），通过 `MORROW_CONTEXT_REAL_API_KEY` 环境变量传给评测进程，**从未写入仓库、`.env`、报告或 git**。任务结束时该文件已删除。**建议轮换这个 key**：它在聊天记录里出现过。

## 5. 测试

`src/providers/third-party-provider.test.ts`（11 条，全部用 mock fetch，CI 不联网）：

1. 拒绝 http、URL 内嵌凭据、带 query 的 base URL、缺少 `acknowledgeThirdParty`
2. 未存 key 时拒绝启用
3. `.../v1/chat/completions` 与 `.../v1///` 都归一化为 `.../v1`
4. 配置记录不含 key
5. DeepSeek 默认仍被钉死在原 endpoint/model
6. 只向 `{base}/chat/completions` 发一次请求，key 在 header
7. base 与请求端点不一致时拒绝
8. 无 key 时 provider 不可用
9. `listModels` 返回目录 id（含带空格的 `入梦 Flash`）
10. 401 → `PROVIDER_AUTH`，非 JSON / 结构不对 → `PROVIDER_RESPONSE`
11. `catalogVerified` 只能显式标记，换 model 后归零

## 6. 状态

| 项 | 状态 |
|---|---|
| Provider 实现与复用 | **PASS** |
| 配置校验（https / 归一化 / 超时） | **PASS** |
| 凭据存储与不回显 | **PASS** |
| 显式切换、无静默回退 | **PASS** |
| 模型目录探测与「未验证」标记 | **PASS** |
| 错误分类、无自动重试 | **PASS** |
| 真实第三方模型评测 | **BLOCKED**（额度耗尽，见 final 报告） |
