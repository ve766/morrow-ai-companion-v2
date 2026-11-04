# Morrow V2 最终收口交付报告（Issue #53）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/morrow-v2-final-closure`
- PR：**#54** `feat/morrow-v2-final-closure` → `release/morrow-v2-final-delivery`
  - https://github.com/ve766/morrow-ai-companion-v2/pull/54
- Base：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- Stage 4 集成：PR #40 head `4284cb1` → 合并 `a34d797`
- Provider 集成：PR #51 head `326e68a` → 合并 `5091e02`
- Provider P1/P2 修复：`d9b28aecb47ff136bbdbda492c5be20ffc53bbd4`
- 产品路径与证据提交：`28665dfbcb724749ec56df0b8cfdb80578a3f84c`
- 最终状态：**PARTIAL**

## 1. 交付范围

### 1.1 集成

- 从实时 release 建立集成分支，先合并 Stage 4，再合并 Provider。
- 唯一冲突 `src/persistence/migrations.ts`：保留 Stage 4 v48，Provider 重编号 v49，增加 Provider v48 → 最终线的桥接与结构身份校验。
- 未丢弃任一侧代码；PR #40/#51 的原始审计记录未改写。

### 1.2 Provider P1/P2 修复

| 项 | 结果 |
| --- | --- |
| 配置变更后的健康/能力失效 | 已修；连接语义字段或 credential 变化清空 `lastTest` 与 verified capabilities，仅 displayName 等保留 |
| testConnection 与 chat URL 不一致 | 已修；共用 `resolveChatEndpoint`，表驱动覆盖 base、`/v1`、完整 URL、自定义 path、尾斜杠 |
| 官方 profile 服务层校验 | 已修；service/IPC/UI 三层拒绝覆盖 sourceKind/endpoint/model/path |
| 自定义 profile 密钥绑定 | 已修；目标变化先清 secret、远端 profile 置未配置；secret 先写后行，失败补偿 |
| discovery 授权路径 | 已修；独立 `model-discovery` action、完整 profile 校验、统一 EndpointPolicy、拒绝时 0 fetch、1 MB 响应上限 |
| profile id 上限 | 统一 40（registry/validation/IPC/DB/OS store）；迁移 41 字符失败回滚、40 字符接受 |
| endpoint 安全边界 | 补齐 IPv6 loopback、IPv4-mapped、CGNAT、NAT64、6to4、link-local、metadata、localhost 尾点、userinfo、redirect |
| 错误分类/文案 | 统一为“模型服务/该 Provider”；quota/429/5xx/timeout 映射；错误正文不落库 |
| endpointPath 语义 | `/v1` 作为前缀补 `/chat/completions`，完整 chat URL 不重复拼接；UI 帮助文本 |

### 1.3 迁移

- 最终版本 **49**。
- v48（Stage 4）`pending-decision-terminal-state` + v49（Provider）`provider-multi-source-profiles-final`。
- 支持 release v47、Stage 4 v48、Provider v48 三种来源；重复启动、桥接重试、v49 回滚、身份不匹配均有测试。
- 详见 `docs/architecture/morrow-v2-final-migration-and-recovery.md`。

## 2. 验证结果

| 项目 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | PASS（无输出，退出码 0） |
| `vitest run` | PASS：124 文件 / 1128 测试（5 个历史 skip 保留，无新增跳过） |
| `npm run evaluate` | PASS：M3 检索 + M4 reminders 合成评估 |
| `npm run evaluate:cognition` | PASS：cognitive/feeling/alpha/intent 四组合成评估 |
| `npm run build` | PASS：main/preload/renderer 产物生成 |
| `npm run package:win` | 本机执行；安装包产物在 `release/`（启动 smoke 受宿主阻塞，见 §3） |
| CI | 运行 [41834663403](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41834663403)；包含 Ubuntu/Windows smoke、product-path、Windows package/install、Windows upgrade |

测试新增覆盖：

- v49 迁移 6 组（release/Stage4/Provider/重复/回滚/id 边界）
- 身份不匹配 2 组（外来名称、结构不符）
- Provider 配置语义失效 4 组
- 连接 URL 表驱动 6 种形状
- discovery 3 组（action、policy 拒绝 0 fetch、超大响应）
- IPC 官方覆盖与 41 字符 id 拒绝
- UI 旧密钥清除提示

## 3. 真实 Provider 与外部阻塞

| 依赖 | 状态 | run / 证据 |
| --- | --- | --- |
| `https://api.supxh.xin` | **BLOCKED_QUOTA** | `evals/provider-multi-source/results/20261104T123748Z-5fc34109.json`；403 `pre_consume_token_quota_failed`，余额低于最低预扣；未写成 PASS |
| `https://speed26.toter.me` | **BLOCKED_QUOTA** | `evals/provider-multi-source/results/20261104T123809Z-02e942cb.json` |
| 本地 OpenAI-compatible | **BLOCKED_LOCAL_SERVICE_NOT_RUNNING** | 127.0.0.1:1234/8000/8080/11434 无兼容 `/v1/models`；未用 mock 冒充 |
| 本机 Electron 启动 | **BLOCKED_HOST_ELECTRON_CRASH** | Electron 44 在 Windows 26200 以 0xC0000005 退出；`scripts/product-path-smoke.mjs` 已加入 CI 双平台 |

运行记录包含 run id、commit SHA、branch、workingTree、endpoint digest、model、HTTP/错误分类、latency/attempts、exit code；不包含 key、Authorization 或响应正文。

## 4. 产品真实路径

`scripts/product-path-smoke.mjs` 覆盖：

1. 真实 renderer 表单创建两个 custom profile（不同 fake key）。
2. OS SafeStorage 密文文件按 profile id 隔离；保存、重启回读、endpoint 变更清除、重新输入 key 轮换、删除仅影响目标 profile。
3. A → 重启 → B → A 的连续性：人格、self-model、interests、memory、goals、relationship、conversation 的 bridge 快照与 SQLite 全表哈希一致。
4. 删除/默认切换只通过 typed bridge/UI。
5. 不触发原生 consent 对话框；脚本明确记录该限制。consent 拒绝 0 fetch 与连接测试不进入聊天/记忆由同 SHA 的服务层集成测试证明。

本机因宿主 Electron 崩溃未完成 UI 执行；CI 的 Ubuntu（xvfb）与 Windows 步骤会执行并上传 `evals/morrow-v2-final/` artifact。

## 5. Stage 4 回归

- 全量 vitest 包含 Stage 4 的 pending decision、reflection/outbox、restart、SQLite close/reopen 测试。
- Issue #47 的 12 项修复测试全部通过；未回退。
- 连续性由 `provider-continuity.integration.test.ts` 与产品路径脚本共同覆盖。

## 6. 独立复审

独立复审在最终集成 SHA 上由不同 Agent 执行，报告：

- `docs/audit/morrow-v2-final-independent-review.md`
- `docs/audit/morrow-v2-final-file-review-matrix.md`

复审结论与逐文件矩阵见上述文件；实现者未自批。

## 7. 回滚方案

1. 关闭应用，备份 `morrow.sqlite3` 与 `secrets/`。
2. v49 失败时数据库自动回滚到 v48 形状；应用不会打开半迁移数据库。
3. 若需回退到 release 构建：恢复备份后启动 release 版本；v49 记录高于 release 的 schema，release 会 fail closed，因此必须使用迁移前备份，不能直接降级打开。
4. Provider profile 的旧 secret 在目标变化时已删除；回滚不会恢复旧 key，需要用户重新输入。
5. 集成分支不合并、不发布；回滚只需关闭 PR，不修改 release/main。

## 8. 最终状态

**PARTIAL**。代码、迁移、P1/P2、Stage 4 回归、离线评估与构建均通过；真实远程 Provider 额度、本地模型服务与真实 Electron 产品路径仍受外部/宿主条件限制。V2 不进入发布决策，等待用户审阅 PR #54。
