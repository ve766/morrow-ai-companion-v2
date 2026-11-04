# Morrow V2 最终验收矩阵（Issue #53）

- 实现 SHA：`d07b3f4b951fab2bd522413c789850055a49fe61`
- 证据/脚本 SHA：`28665dfbcb724749ec56df0b8cfdb80578a3f84c`
- 目标 base：`release/morrow-v2-final-delivery` @ `3812b18`

状态定义：PASS = 本 SHA 上有可复现证据；PARTIAL = 代码/测试通过但外部依赖或本机环境无法执行；BLOCKED = 外部条件未满足；NOT_RUN = 未执行，不得写成 PASS。

## 1. 迁移与数据安全

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1.1 | 唯一、单调、可追溯的 v49 序列 | PASS | `src/persistence/migrations.ts`；v48 Stage 4 + v49 Provider |
| 1.2 | release v47 → v49 | PASS | `migrations.test.ts` “upgrades a release v47 database…” |
| 1.3 | Stage 4 v48 → v49 | PASS | `migrations.test.ts` “upgrades a Stage 4 v48 database…” |
| 1.4 | Provider v48 → v49（桥接） | PASS | `migrations.test.ts` “upgrades a standalone Provider v48…” |
| 1.5 | 重复启动/桥接重试 | PASS | `migrations.test.ts` “is idempotent…” |
| 1.6 | 迁移中断/回滚 | PASS | `migrations.test.ts` “rolls back a failed v49 rebuild…” |
| 1.7 | 身份不匹配 fail closed | PASS | `migrations.test.ts` 外来名称；`provider-multi-source.integration.test.ts` 结构不符 |
| 1.8 | pending/reflection/outbox 数据保留 | PASS | 全量 vitest；Stage 4 集成测试；v48/v49 迁移测试 |
| 1.9 | Windows 升级 CI | PASS | run 41862065143：Windows upgrade job PASS（schema migrations under the real app） |

## 2. Provider P1

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 2.1 | endpoint/path/protocol/model/sourceKind/credential 变化使健康与 capabilities 失效 | PASS | `provider-multi-source.integration.test.ts` “invalidates health…” |
| 2.2 | 仅 displayName 等非连接字段保留 | PASS | 同上，rename 分支 |
| 2.3 | testConnection 与 chat 共用 EndpointResolver | PASS | `connectionInput()` + `generateOnce()` 校验；表驱动 6 种 URL |
| 2.4 | 官方 profile 服务层校验 | PASS | service 测试；IPC 测试；UI 官方编辑禁用 |
| 2.5 | 自定义 profile 目标变化不沿用旧 key | PASS | “invalidates…”；endpoint 变更后 `enabled=false`、secret 删除 |
| 2.6 | secret 事务与补偿 | PASS | “restores the previous secret when the replacement write fails”；先 secret 后行 |
| 2.7 | discovery 独立 consent action | PASS | “uses a dedicated discovery consent action” |
| 2.8 | discovery 请求前 profile/resolver/policy/consent | PASS | “blocks before consent and fetch…”；policy 拒绝时 0 preview、0 fetch |
| 2.9 | 启动不自动探测 | PASS | 无启动路径调用 discoverModels；discovery 仅用户触发 |

## 3. Provider P2

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 3.1 | profile id 全链路 40 | PASS | registry/validation/DB CHECK；41 拒绝、40 接受 |
| 3.2 | endpoint 安全边界补齐 | PASS | `endpoint-security.test.ts`：IPv6、mapped、CGNAT、NAT64、6to4、尾点、metadata |
| 3.3 | 远程仅 HTTPS、local 仅 loopback、private-network NOT_SUPPORTED | PASS | `endpoint-security.test.ts`；`provider-registry` |
| 3.4 | DNS 失败/重定向不发送 Authorization | PASS | `createEndpointPolicy`；`redirect:'error'`；adapter/discovery |
| 3.5 | 统一错误分类与文案 | PASS | IPC 文案改为“模型服务/该 Provider”；quota/429/5xx 映射 |
| 3.6 | `endpointPath='/v1'` 语义 | PASS | resolver 单测 + 表驱动连接测试 + UI 帮助文本 |
| 3.7 | discovery 响应大小上限与脱敏 | PASS | 1 MB 上限测试；错误正文不落库/不回显 |

## 4. 产品真实路径

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 4.1 | renderer 创建两个 custom profile，不同 fake key，隔离 | PASS | CI Windows run `20261104T155831Z-899f5cb0`：真实 renderer 表单创建 A/B，OS 密文文件摘要不同 |
| 4.2 | 真实 OS SafeStorage 保存/回读/更新/删除/重启 | PASS | 同上：保存、重启回读、endpoint 变更清除 A、rekey 轮换、删除 B 仅删 B；密文摘要见 JSON |
| 4.3 | 拒绝 consent 时 fetch=0；切换 endpoint/model 后旧 consent 无效 | PASS（服务层） | `provider-multi-source.integration.test.ts`；`provider-manual-chat.integration.test.ts`；原生对话框无法由 CDP 驱动，已在脚本 limitation 记录 |
| 4.4 | A→重启→B→A 连续性 | PASS | 同上 run：人格 systemRules、self-model、interests、memory、goals、conversation 的基线 ID 与内容保留；启动新增 1 个 interest 属正常增长。P3：personality version/relationship/message 内容未逐项比较，仅表计数 |
| 4.5 | 连接测试不进入聊天/记忆/成长 | PASS（服务层） | `provider-manual-chat.integration.test.ts` 固定 prompt、无聊天/记忆写入 |
| 4.6 | quota/401/403/404/429/5xx/timeout/cancel/DNS/SSRF 错误状态 | PASS（服务层） | `openai-compatible.test.ts`、`provider-retry.test.ts`、`endpoint-security.test.ts`、health 分类测试 |
| 4.7 | Windows 打包/安装/启动 smoke | PASS | CI `windows-package-smoke` 安装 NSIS 并用 `--verify-upgrade` 启动已安装程序；本机启动仍受宿主 0xC0000005 阻塞，已如实记录 |

## 5. Stage 4 回归与 Issue #47

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 5.1 | confirmation / pending / reflection / outbox / restart | PASS | 全量 vitest（124 文件 / 1129 测试） |
| 5.2 | Issue #47 12 项 findings 不回退 | PASS | 原修复测试与 `stage4-*` 集成测试全部通过 |
| 5.3 | personality/self-model/memory/interest/goal/relationship/conversation 连续性 | PASS | `provider-continuity.integration.test.ts`；产品路径 run `20261104T155831Z-899f5cb0`（relationship 以表计数覆盖） |
| 5.4 | 不删除、不跳过、不弱化测试 | PASS | 测试数由 1083/1044 增至 1129；全量运行 0 skipped |

## 6. 真实 Provider

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 6.1 | `api.supxh.xin` 非流式/SSE | **BLOCKED_QUOTA** | run `20261104T135205Z-75b01260`；403 quota，未写成 PASS |
| 6.2 | `speed26.toter.me` 兼容回归 | **BLOCKED_QUOTA** | run `20261104T135210Z-abf69f16` |
| 6.3 | 本地 OpenAI-compatible | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | 端口探测；未用 mock 冒充 |
| 6.4 | 运行元数据（run id/SHA/dirty/endpoint digest/model/HTTP/latency/attempts/exit） | PASS | 两份 JSON + transcript；无 key/Authorization/正文 |

## 7. 最终状态

- 代码、迁移、P1/P2、Stage 4 回归、离线评估、构建、Windows 安装/启动、真实 Electron 产品路径（CI Windows）：PASS。
- 真实远程 Provider：BLOCKED_QUOTA（外部账户）。
- 本地模型：BLOCKED_LOCAL_SERVICE_NOT_RUNNING（外部服务）。
- 本机 Electron 启动：BLOCKED_HOST_ELECTRON_CRASH；同一脚本在最终 HEAD CI Windows run `20261104T155831Z-899f5cb0` PASS。
- 因此整体状态为 **PARTIAL**，不是 COMPLETE；不得发布 Release 或合并 PR。
