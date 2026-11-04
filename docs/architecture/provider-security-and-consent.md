# Provider 多源安全与同意策略（Issue #50）

代码 SHA：`24efc5cb60972f28b746779ca4f32ed37d295f57`

## 1. 网络分类

| sourceKind | 允许的 endpoint | 说明 |
|---|---|---|
| official | 固定 base（DeepSeek/Spark） | registry 精确匹配；不允许自定义 |
| custom-proxy | HTTPS、公开主机 | 拒绝 userinfo/query/fragment、localhost、私网、link-local、metadata；请求前 DNS 校验 |
| local | loopback（localhost/127.0.0.1/[::1]） | 仅 HTTP/HTTPS；不允许公网 |
| private-network | **NOT_SUPPORTED** | UI disabled；服务/registry 拒绝；不暗中放行 |

## 2. SSRF 防护

- `classifyEndpoint`（同步）：
  - URL 解析、禁止 userinfo/query/fragment；
  - custom 必须 `https:`；
  - 拒绝 `localhost`、`*.localhost`、`*.local`、`*.internal`、metadata 主机；
  - 字面 IP 若为 loopback/private/link-local/unique-local/multicast/unspecified → 拒绝；
  - IPv4-mapped IPv6 按内嵌 IPv4 判断。
- `createEndpointPolicy`（请求时）：
  - 对非 IP 主机做 `dns.lookup({all:true})`；
  - **任一**解析地址为私网即拒绝（防止多 A 记录绕过）；
  - 解析失败 fail-closed。
- Adapter：
  - 每次 custom-proxy 请求前调用 policy；
  - `fetch(..., redirect: 'error')`，不跟随重定向；
  - 错误映射 `PROVIDER_ENDPOINT_BLOCKED`（不暴露 DNS/内网细节）。
- **残余风险**：DNS 解析与 TCP 连接之间的 rebinding 不能由 fetch API 完全消除；本实现采用请求前解析 + 拒绝 redirect + 每次尝试重新校验。已在架构/交付报告登记，不声称完全消除。

## 3. Secret 隔离

- SecretStore key = profile id；DB 只存 `api_key_configured` 语义（运行时通过 SecretStore 读取）。
- 保存流程：
  1. 校验 profile 形状；
  2. 事务写 profile；
  3. 写 secret 并回读校验；
  4. 任一步失败：回滚 profile，并恢复旧 secret/删除新 secret。
- 删除 profile：先备份/删除 secret，再删 DB 行；DB 删除失败恢复 secret。
- 官方 profile 不允许删除（避免误删内置配置）；local/custom 可删除。
- 日志/错误/health/consent preview 不包含 key、Authorization header 或响应正文。

## 4. 同意（consent）

- `consentPreview` 包含 action、providerId、endpoint、model、payloadSha256、payloadBytes、敏感度、精确正文（仅本地对话框）。
- `assessProviderRequest` 校验：
  - providerId 匹配；
  - payload hash 匹配（hash 覆盖 endpoint + body，包含 model）；
  - approvedAt/expiresAt 有效且 ≤5 分钟；
  - sensitive 上下文必须有 includeSensitive；
  - local profile 的 endpoint 必须 loopback。
- 切换 endpoint/model → payload hash 改变 → 旧 consent 不可复用；测试覆盖。
- 测试连接同样走 consent；固定无敏感 prompt，不写聊天历史、不注入记忆、不触发认知/人格成长。

## 5. 错误与日志脱敏

- Adapter 只读取 provider 错误的数值 code、字符串 code、type（有界 4096 字节），不返回 message；quota 403 映射 `PROVIDER_QUOTA`，不误报 auth。
- `lastTest` 只存 status/latency/endpointDigest/model/httpStatus/attempts，不存响应正文。
- `discoverModels` 只返回模型 id，不存原始响应。
- 真实测试结果/transcript 不含 key、Authorization、回复文本；只记录长度/delta 数。
- `PROVIDER_ENDPOINT_BLOCKED` 文案不暴露 DNS 结果或内网地址。

## 6. 本地与私有网络

- local：仅 loopback；不产生公网 egress；本地服务可选口令存 SecretStore。
- private-network：本阶段 NOT_SUPPORTED；UI option disabled，服务拒绝。若未来开放，必须增加显式授权和网络策略，不能复用 custom-proxy 的默认放行。
- 未启动本地服务时真实测试为 `BLOCKED_LOCAL_SERVICE_NOT_RUNNING`，不用 mock 冒充。

## 7. 用户可见状态

| 状态 | 文案/含义 |
|---|---|
| connected | 连接成功 + 延迟/attempts |
| auth_failed | 认证失败 |
| model_not_found | 模型不存在 |
| quota | 额度不足（含 403 quota code） |
| timeout | 超时 |
| network | 网络错误/端点被安全策略阻止 |
| protocol | 响应协议不兼容 |
| unknown | 未知错误 |
