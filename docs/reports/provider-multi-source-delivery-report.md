# Provider 多源接入交付报告（Issue #50）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/provider-multi-source-foundation`
- base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 代码 SHA：`24efc5cb60972f28b746779ca4f32ed37d295f57`
- 最终状态：**PARTIAL**（代码/迁移/UI/安全完成；真实 remote 额度阻塞、local 未运行、独立复审待完成）

## 1. 实施范围

### 领域模型与迁移

- `provider_profiles` v48 重建：id/display_name/source_kind/protocol_id/provider_class/endpoint/endpoint_path/model/enabled/is_default/capabilities_json/last_test_json/created_at/updated_at。
- 旧 DeepSeek/Spark/local 行原样迁移；旧 secret 仍按原 id 读取。
- `is_default` 唯一 partial index。
- 版本冲突说明：PR #40 也使用 v48；本分支独立交付，若 #40 先合并，合并前重编号为 v49。

### Registry / Endpoint / Adapter

- `provider-registry.ts`：内置官方 spec + `validateProviderConfig`；自定义 profile 不依赖服务商白名单。
- `endpoint-resolver.ts`：base、`/v1` base、完整 chat URL、自定义 path；避免重复 `/v1`/`/chat/completions`。
- `endpoint-security.ts`：HTTPS-only、URL shape、loopback/私网/metadata 拒绝、DNS 解析校验、`redirect:error`。
- `OpenAICompatibleProvider`：保留 payload/SSE/retry/timeout/error 分类；profile-aware 校验/endpoint；custom 请求前 policy；403 quota code → `PROVIDER_QUOTA`。

### 服务 / IPC / UI

- `ProviderConfigService`：`listProfiles/get/getDefault/saveProfile/deleteProfile/setDefaultProfile/testConnection/discoverModels/requireConfigured`；secret 隔离与补偿回滚；health 持久化；default 选择。
- 新 IPC：`providerProfilesList/Save/Delete/SetDefault/DiscoverModels`；trusted sender + strict validation。
- preload bridge + `provider-profiles-ui.ts`：列表、创建/编辑、测试、发现模型、设默认、删除；显示 endpoint 脱敏、模型、状态、延迟、健康。
- 旧 DeepSeek/Spark/local 面板保留，不回归。

### 真实测试

- `eval:provider-multi-source`：key 只从 `MORROW_TEST_API_KEY`；临时 SQLite + custom profile + IPC save/list/test + consent + adapter 非流式/流式；sanitized JSON/transcript。
- 本次运行：`20261104T100603Z-b3b82e61`，`BLOCKED_QUOTA`（provider 余额 $0.04775 < 最低预扣 $0.05）；IPC save/list 通过、真实请求到达 provider、错误分类为 `PROVIDER_QUOTA`。
- local：`BLOCKED_LOCAL_SERVICE_NOT_RUNNING`（无服务，不用 mock）。

## 2. 测试

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx vitest run` | 见 evidence index（最终运行） |
| `npm run build` | 成功 |
| `npm run eval:provider-multi-source` | BLOCKED_QUOTA（外部额度） |
| Provider 定向 | 10 files / 65 tests（含 endpoint/security/adapter/retry/registry/UI/IPC/continuity） |

新增测试：

- `src/app/provider-multi-source.integration.test.ts`：迁移兼容、两个 profile 隔离、非法 endpoint、connection/health/quota、discovery、consent 绑定、DNS 私网拒绝。
- `src/app/provider-multi-source-ipc.integration.test.ts`：IPC save/list/test、不可信 frame、危险 endpoint。
- `src/app/provider-continuity.integration.test.ts`：A→reopen→B→A 状态不变。
- `tests/provider-profiles-ui.test.ts`：列表/编辑/保存/测试/删除/默认。
- `src/providers/endpoint-resolver.test.ts`、`endpoint-security.test.ts`。

## 3. 兼容性

- 旧 `saveProvider` 三种输入仍可用，写入新表；旧 secret id 不变。
- `requireConfigured`：显式 default → 旧 local>spark>deepseek → 第一个启用 custom；旧安装行为保持。
- `OpenAICompatibleProvider` 既有官方/本地测试全部通过。
- `provider-manual-chat` 连接结果新增 status/latency/attempts，测试已按新契约断言。

## 4. 回滚

- v48 为表重建迁移；升级前 `SqliteDatabase.open` 已有备份机制。回滚到旧代码需要恢复备份或重建旧表（旧表 CHECK 限制会丢弃 custom profile；官方/local 行可保留）。
- 删除 custom profile 会删除其 secret；官方 profile 不允许删除。
- 本分支未合并 release/main；回滚只需关闭 PR。

## 5. 限制与风险

- 真实第二 Provider 额度不足：`BLOCKED_QUOTA`；不能宣称 real provider pass。
- 本地真实服务未运行：`BLOCKED_LOCAL_SERVICE_NOT_RUNNING`。
- Anthropic/Ollama native 只有契约，无 adapter；保存拒绝。
- private-network 明确 NOT_SUPPORTED；未开放。
- DNS rebinding 残余风险：请求前解析 + redirect:error + 每次尝试校验；未声称完全消除。
- v48 与 Stage 4 v48 版本冲突：合并顺序需协调，已在迁移注释登记。
- 独立复审待独立上下文提交。

## 6. 结论

产品代码、迁移、UI、安全与自动化测试已交付；真实 remote 因外部账号额度阻塞，local 因无服务阻塞，独立复审未完成。因此 **PARTIAL**，不是 COMPLETE。
