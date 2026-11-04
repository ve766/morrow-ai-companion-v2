# Provider 多源接入基线审计（Issue #50）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/provider-multi-source-foundation`
- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 审计时间：2026-11-04
- 当前代码 SHA：`24efc5cb60972f28b746779ca4f32ed37d295f57`

## 1. 原实现（基线）

| 组件 | 文件 | 事实 |
|---|---|---|
| Provider 类型 | `src/shared/companion.ts` | `ProviderId = deepseek \| local-openai \| spark`；`ProviderConfigRecord` 只有 id/class/endpoint/model/enabled/keyConfigured |
| Registry | `src/providers/provider-registry.ts` | `REMOTE_PROVIDER_SPECS` 仅 DeepSeek/Spark；`isRemoteConfigValid` 要求 endpoint 与服务商 baseUrl **完全相等**；模型用固定正则 |
| 持久化 | `src/persistence/migrations.ts` | `provider_profiles` 在 v37 重建，`id` CHECK 仅三个值，endpoint 与 id 绑定 CHECK，model 与 id 绑定 |
| Adapter | `src/providers/openai-compatible.ts` | 已有 OpenAI payload、SSE、重试、超时、错误映射；校验依赖 registry 和 `${endpoint}/chat/completions` |
| Policy | `src/providers/provider-policy.ts` | `ProviderPort`、consent preview/hash、敏感度、local loopback gate |
| 服务 | `src/app/companion-service.ts` | `ProviderConfigService` 固定三种 save 分支；`requireConfigured` 按 local > spark > deepseek 选择 |
| UI | `src/renderer/index.html`、`companion-ui.ts` | 只有 DeepSeek 与本地 OpenAI 两个固定面板；无 profile 列表/新增/发现模型 |
| IPC | `src/app/ipc.ts`、`preload`、`contracts`、`validation` | provider get/save/clear/test 四个通道，profile id 仅三值 |
| 真实测试 | `evals/stage-3/shared/real-provider.ts` | `selectProvider` 仅 deepseek/spark；spark 对 contract URL 做相等校验 |

## 2. 确认的问题

1. 任意自定义中转站无法通过正式产品配置：id 和 endpoint 被固定表约束；`isRemoteConfigValid` 拒绝非白名单 endpoint。
2. Provider、Protocol、Endpoint、Model 没有独立建模；UI 和 registry 把 provider 当作 endpoint。
3. 多 profile 不存在：同一服务商第二个 endpoint、同一 endpoint 多模型、多个中转站无法同时保存。
4. 模型目录只能手动输入，没有可选发现；能力/健康状态没有持久化。
5. 安全边界只覆盖 local loopback；没有对自定义远程的 HTTPS-only、私网/DNS SSRF、redirect 策略。
6. 真实测试选择器无法指向用户配置 profile；Issue #47 的协议测试不能等同于产品路径。

## 3. 复用与替换

| 保留/复用 | 原因 |
|---|---|
| `OpenAICompatibleProvider` 的 payload/SSE/retry/timeout/error 分类 | 已验证，不重写；只把 endpoint 解析和 profile 校验抽象 |
| `dispatchToProvider`、`assessProviderRequest`、`consentPreview` | 统一真实请求出口、consent hash、敏感度 |
| `SecretStore` / `MemorySecretStore` | 按 profile id 隔离；不引入新密钥存储 |
| `provider_profiles` 表 | 通过 v48 重建扩展，保留旧行 |
| 旧 DeepSeek/Spark/local 面板 | 保持兼容；新增多源面板并列，不移除旧路径 |

| 替换/新增 | 内容 |
|---|---|
| `ProviderConfigRecord` | 增加 displayName/sourceKind/protocolId/endpointPath/isDefault/capabilities/lastTest；id 变为 opaque string |
| Registry | 内置官方 spec + `validateProviderConfig`；自定义 profile 走 endpoint/协议校验 |
| Endpoint resolver | base / versioned base / full path / custom path 统一解析，避免重复 `/v1` |
| Endpoint security | HTTPS-only、URL shape、私网/loopback/metadata 拒绝、DNS 解析校验、redirect:error |
| 服务 | list/save/delete/setDefault/discover/test；secret 隔离；health 持久化 |
| IPC/UI | 五个新通道 + 多源配置面板 |
| Eval | `eval:provider-multi-source`，key 只从 `MORROW_TEST_API_KEY` 读取 |

## 4. 迁移与版本风险

- 当前 release 基线为 v47；本分支新增 v48 `provider-multi-source-profiles`。
- **集成注意**：PR #40 的 Stage 4 分支也使用 v48（`pending-decision-terminal-state`）。本任务按 Issue #50 要求从 release 独立分支交付；若 PR #40 先合并，本迁移必须在合并前重编号为 v49（本分支尚无已发布数据库使用 v48 provider 行）。已在迁移注释和交付报告中登记。
- v48 重建 `provider_profiles`：复制旧行，displayName/sourceKind/protocol/isDefault/capabilities 补齐；旧 secret 仍按原 id 读取，不丢失。

## 5. 风险

- 自定义远程的 SSRF 防护是请求前 DNS 解析 + redirect:error；DNS rebinding 在解析与连接之间的残余风险已在安全文档登记，未声称完全消除。
- 私有网络（RFC1918 远程）本阶段显式 NOT_SUPPORTED，UI disabled；不暗中放行。
- Anthropic Messages / Ollama native 只有协议契约，没有 adapter；保存时拒绝，不宣称支持。
- 真实第二 Provider 账号额度不足（`PROVIDER_QUOTA`），因此真实 remote 完成态为 BLOCKED_QUOTA，而不是 PASS。
