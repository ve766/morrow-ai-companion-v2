# Morrow V2 最终收口基线审计（Issue #53）

- 仓库：`ve766/morrow-ai-companion-v2`
- 集成分支：`feat/morrow-v2-final-closure`
- 目标 base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 集成起点：`3812b185398c0442fcc0d0ba5b180713cafee1d9`（与 release 的 merge-base 相同）
- Stage 4 集成：PR #40 head `4284cb1`，合并提交 `a34d797`
- Provider 集成：PR #51 head `326e68a`，合并提交 `5091e02`
- Provider P1/P2 核心修复：`d9b28aecb47ff136bbdbda492c5be20ffc53bbd4`
- 最终收口修复：`c1f44507d911a5fa673174d126f4fe6b029a4e8c`
- 产品路径与真实运行证据：`28665dfbcb724749ec56df0b8cfdb80578a3f84c`
- 审计时间：2026-11-04

## 1. 开工时核实的事实

| 项目 | 核实结果 |
| --- | --- |
| release 分支 | `3812b18`，与集成分支的 merge-base 相同，未漂移 |
| PR #40 | Stage 4 `feat/stage-4-companion-confirmation-closure`，head `4284cb1`，已包含 Issue #47 的 12 项修复与独立复审 |
| PR #51 | Provider `feat/provider-multi-source-foundation`，head `326e68a`，交付状态 PARTIAL（外部额度/本地服务阻塞） |
| PR #52 | Provider 独立复审，R2 `PASS_WITH_NON_BLOCKING_BACKLOG`；R2 仍列出 P1/P2 待修项 |
| 共同祖先 | `3812b18`；两条交付线互不包含，必须显式合并 |
| 工作树 | 开工时 clean；`.tmp` 为未跟踪本地证据目录 |
| 测试基线 | Stage 4 线 118 文件 / 1083 测试；Provider 线 113 文件 / 1044 测试；集成后 124 文件 / 1129 测试 |

## 2. 冲突与迁移身份

两条线都声明 schema v48，但 migration 名称不同：

- Stage 4：`v48 pending-decision-terminal-state`
- Provider：`v48 provider-multi-source-profiles`

这不是可以靠改名字解决的冲突：两个 v48 的表结构变更不同，任何真实数据库都只可能应用过其中一条。最终方案：

1. 保留 Stage 4 的 v48（`pending-decision-terminal-state`），因为它是 release 之后所有 pending/reflection 数据的前置结构。
2. 把 Provider 的 v48 重编号为 **v49 `provider-multi-source-profiles-final`**，并让 v49 同时接受：
   - release/Stage 4 的旧 provider 表（无 `display_name`）；
   - Provider 分支已扩展的 v48 表（有 `display_name`）。
3. 在 `applyMigrations` 增加一次性桥接：当数据库记录为 `v48 provider-multi-source-profiles` 时，先补 Stage 4 的 v48 列、把记录名改为 `pending-decision-terminal-state`，再执行 v49。
4. 增加结构身份校验：v48 名称必须与列结构一致，否则 `SchemaIdentityError`，不打开、不写入。

## 3. 开工时已知的 Provider P1/P2

| 编号 | 问题 | 本任务处置 |
| --- | --- | --- |
| P1 | `saveProfile` 无条件保留 `lastTest` / `capabilities` | 连接语义变化即失效；见 `docs/reports/morrow-v2-final-work-log.md` |
| P1 | `testConnection` 固定拼 `/chat/completions` | 与 chat 共用 `resolveChatEndpoint`，表驱动测试 |
| P1 | 官方 profile 仅靠 UI 禁用 | service 层校验 sourceKind/endpoint/model/path，IPC/UI 测试 |
| P1 | 自定义 profile 改 endpoint 保留旧 key | 目标变化先清 secret、profile 变未配置；失败补偿 |
| P1 | discovery consent 语义与请求前检查不足 | 独立 `model-discovery` action、完整 profile 校验、统一 endpoint policy、拒绝时 0 fetch |
| P2 | profile id 上限 64 vs SecretStore 40 | 统一 40：应用、IPC、DB、OS store |
| P2 | IPv6/CGNAT/NAT64/6to4/localhost 尾点等边界 | 补齐分类与测试 |
| P2 | 错误文案含 DeepSeek 专属措辞 | 统一为模型服务/该 Provider |
| P2 | `endpointPath='/v1'` 语义含糊 | resolver 明确按路径前缀补 `/chat/completions`，UI 帮助文本 |
| P2 | discovery 响应无大小上限 | 1 MB 上限 + 脱敏错误 |

## 4. 外部依赖状态

| 依赖 | 状态 | 证据 |
| --- | --- | --- |
| `https://api.supxh.xin` | **BLOCKED_QUOTA** | run `20261104T135205Z-75b01260`；provider 403 `pre_consume_token_quota_failed`，余额低于最低预扣 |
| `https://speed26.toter.me` | **BLOCKED_QUOTA** | run `20261104T135210Z-abf69f16`；同一账户额度信号 |
| 本地 OpenAI-compatible 服务 | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | 127.0.0.1:1234/8000/8080/11434 均无兼容 `/v1/models`；8000 是非模型 Web 原型 |
| 本机 Electron 启动 | **BLOCKED_HOST_ELECTRON_CRASH** | 本机 Electron 44 在 Windows 26200 上以 0xC0000005 退出（sandbox 开关均复现）；产品路径脚本已加入 CI 双平台执行 |

## 5. 结论

集成线具备完整代码与自动化证据；真实远程 Provider 与本地模型仍被外部条件阻塞，因此最终状态不能声明 COMPLETE。最终状态在交付报告中按 Issue #53 的 PARTIAL 定义记录。
