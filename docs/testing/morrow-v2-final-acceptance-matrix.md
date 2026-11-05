# Morrow V2 最终验收矩阵（Issue #53）

- 实现 SHA：`df8f8020d3a9f90b17ed43796a72b99cc497a512`
- 最终 HEAD：PR #54 head（含本复审）
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
| 1.9 | Windows 升级 CI | PASS | 父代码 CI 41995422882：Windows upgrade job PASS（schema migrations under the real app） |

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
| 4.1 | renderer 创建两个 custom profile，不同 fake key，隔离 | PASS | CI Windows run `20261105T084141Z-45483dd6`：真实 renderer 表单创建 A/B，OS 密文文件摘要不同 |
| 4.2 | 真实 OS SafeStorage 保存/回读/更新/删除/重启 | PASS | 同上：保存、重启回读、endpoint 变更清除 A、rekey 轮换、删除 B 仅删 B；密文摘要见 JSON |
| 4.3 | 拒绝 consent 时 fetch=0；切换 endpoint/model 后旧 consent 无效 | PASS（服务层） | `provider-multi-source.integration.test.ts`；`provider-manual-chat.integration.test.ts`；原生对话框无法由 CDP 驱动，已在脚本 limitation 记录 |
| 4.4 | A→重启→B→A 连续性 | PASS | 同上 run：完整 SQLite 快照逐字段比较 personality、self-model、interests、memory、goals、relationship、conversation/messages；removed=0 changed=0；仅时间戳/兴趣聚合/关系强度重算列入显式 allowlist |
| 4.5 | 连接测试不进入聊天/记忆/成长 | PASS（服务层） | `provider-manual-chat.integration.test.ts` 固定 prompt、无聊天/记忆写入 |
| 4.6 | quota/401/403/404/429/5xx/timeout/cancel/DNS/SSRF 错误状态 | PASS（服务层） | `openai-compatible.test.ts`、`provider-retry.test.ts`、`endpoint-security.test.ts`、health 分类测试 |
| 4.7 | Windows 打包/安装/启动 smoke | PASS | CI `windows-package-smoke` 安装 NSIS 并用 `--verify-upgrade` 启动已安装程序；本机启动仍受宿主 0xC0000005 阻塞，已如实记录 |

## 5. Stage 4 回归与 Issue #47

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 5.1 | confirmation / pending / reflection / outbox / restart | PASS | 全量 vitest（128 文件 / 1153 测试） |
| 5.2 | Issue #47 12 项 findings 不回退 | PASS | 原修复测试与 `stage4-*` 集成测试全部通过 |
| 5.3 | personality/self-model/memory/interest/goal/relationship/conversation 连续性 | PASS | `provider-continuity.integration.test.ts`；产品路径 run `20261105T084141Z-45483dd6` 完整快照逐字段 diff |
| 5.4 | 不删除、不跳过、不弱化测试 | PASS | 测试数由 1083/1044 增至 1153；全量运行 0 skipped |

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
- 本机 Electron 启动：BLOCKED_HOST_ELECTRON_CRASH；同一脚本在最终 HEAD CI Windows run `20261105T084141Z-45483dd6` PASS。
- 因此整体状态为 **PARTIAL**，不是 COMPLETE；不得发布 Release 或合并 PR。

## 8. 2026-11-05 追加验收（PR #54 收口）

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| A1 | consent 展示按官方/自定义/本地区分 | PASS | `src/providers/consent-presentation.ts`；6 组单测 |
| A2 | 自定义/本地绝不出现 DeepSeek 厂商或价格 | PASS | `consent-presentation.test.ts` |
| A3 | endpoint 展示剔除 userinfo/query/fragment | PASS | `sanitizeConsentEndpoint` 测试 |
| A4 | 未知价格显示“计费信息未验证” | PASS | 官方 profile 测试 |
| A5 | consent 目标/模型/payload 来自同一 preview | PASS | `requestProviderConsent` 只消费 `ProviderConsentPreview` |
| B1 | discovery 1 MiB（1,048,576 bytes）按真实字节流式限制 | PASS | `bounded-body.ts` + 10 组单测；无 Content-Length 超限测试 |
| B2 | error hint 4 KiB 流式限制 | PASS | `readBoundedText(response, 4096)`；4 KiB 边界测试 |
| B3 | 超限取消 reader/body，不继续读取 | PASS | `ProviderBodyLimitError` + cancel 测试 |
| B4 | Content-Length 缺失/偏小/偏大 | PASS | `bounded-body.test.ts` |
| B5 | UTF-8 跨 chunk/读取错误/无 body | PASS | `bounded-body.test.ts` |
| C1 | A→重启→B→重启→A 真实产品路径 | PASS | `scripts/product-path-smoke.mjs` 多轮重启 |
| C2 | 人格版本/systemRules、自我模型、兴趣、记忆、目标、关系、会话/消息全字段 diff | PASS | `snapshotFullDatabase` + `diffFullSnapshots` |
| C3 | 允许变化显式 allowlist（时间戳/派生感受状态/兴趣增长） | PASS | `TIMESTAMP_FIELDS`/`ALLOWED_ADDITION_TABLES` |
| C4 | JSON diff + transcript | PASS | product-path result `continuity.fullField` + transcript |
| UI1 | 主对话页空间 hero + 对话中心 | PASS | `presence-ui.ts`、`style.css`、截图 |
| UI2 | Provider/人格/记忆/兴趣/目标/状态入口 | PASS | 现有视图 + `self-model-ui.ts` |
| UI3 | 1280/1440/390 响应式 | PASS | product-path `uiEvidence` 9 张 |
| UI4 | 键盘/焦点/aria/减弱动效 | PASS | `docs/ui/design-system.md` + 代码 |
| UI5 | 真实 Electron 截图 | PASS | `docs/ui/evidence/<run-id>/` |
| D1 | 最新完整 SHA 独立复审 | PARTIAL（待本轮冻结后执行） | 复审文档将覆盖本轮 HEAD |
