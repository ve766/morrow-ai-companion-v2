# Morrow V2 对话运行闭环修复报告

- 日期：2026-11-06
- 分支：`feat/morrow-v2-final-closure`
- 基线：`70bcb4e9c301e3f3b30f12fff5f0453bdd54d0ee`
- 部署：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356` 增量 asar
- asar SHA256：`cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 状态：`PRODUCT_CHAT_READY`、`REAL_PROVIDER_CHAT_VERIFIED`

## 1. 问题

本任务要求把“真实对话闭环”和“Claude Code 风格工作台”同时落地，并让运行轨迹来自真实调用点。修复前存在以下缺口：

1. 对话主链路能工作，但没有可观察的运行轨迹；用户无法知道本轮执行了哪些阶段、是否跳过认知、Provider 请求耗时多少。
2. 无 Provider 时发送按钮禁用，但表单提交没有可操作提示，用户不知道去哪里配置。
3. 自定义 Provider 只能保存/发现模型，没有“测试连接”按钮；测试连接只对官方/本地入口开放。
4. 布局是 2 栏管理面板，没有顶部状态栏、右侧运行轨迹、固定输入区；窄屏会隐藏 inspector 且布局冲突。
5. 取消后重试复用 requestId，但状态机只允许 `null → received`，重试的 `enter()` 被吞掉，持久化状态停留在 `cancelled`。
6. 授权拒绝、冲突、存储失败等前置错误没有终态，恢复逻辑会把“用户拒绝”误判为崩溃中断。
7. trace 读失败被 `getTurnTrace` 吞成空数组，UI 无法区分“没有事件”和“轨迹存储不可用”。

## 2. 修复

### 2.1 轨迹持久化

- v50 新建 `turn_trace_events`；v51 重建以允许 `started` 并保留旧行；v52 增加会话删除级联触发器。
- `SqliteTurnStateRepository` 增加 `appendTrace`、`listForConversation`（200 上限）、`deleteTraceForConversation`。
- `ChatService` 在真实生命周期调用点写事件：
  - `turn_received`（接收）
  - `cognition_analysis`（认知分析；不可用时 `skipped/analysis_unavailable`）
  - `context_built`（上下文/记忆）
  - `consent`（逐次授权）
  - `provider_request`（`started`）
  - `provider_delta`（首个 delta `started`；完成 `completed`；无 delta `skipped/no_stream_delta`）
  - `persistence`（assistant message 落库）
  - `turn_completed` / `turn_failed` / `turn_cancelled` / `recovery`
- 耗时：有显式 started 的阶段用 started→completed；其余用与上一事件的间隔；`turn_received` 不显示耗时。
- 每 turn 最多 200 条；写失败只在内存标记，不阻断聊天；读失败抛 `STORAGE_ERROR`，UI 显示“轨迹不完整”。

### 2.2 失败与重试语义

- 外层 catch 对未终态的 turn 写 `failed/cancelled`，覆盖拒绝授权、冲突、存储失败。
- 状态机允许 `failed/cancelled → received`，重试同一 requestId 可以继续生命周期；成功提交后状态为 `committed`，不重复 user message。
- 取消仍记录 `turn_cancelled` + `failed` 状态，原因 `PROVIDER_CANCELLED`。

### 2.3 UI 工作台

- 顶部状态栏：Provider 就绪点/文字、当前会话、轨迹条数、inspector 开关。
- 三栏布局：260px 导航 / 1fr 对话 / 300px inspector；≤1200px inspector 变抽屉。
- 对话视图 `height: calc(100vh - 52px)`，消息区独立滚动，composer dock 保持在对话区底部；移动端 dock `position: fixed`。
- 无 Provider CTA 与 feedback 移入 composer dock，位于输入框上方，不重叠。
- `Ctrl/Cmd+Enter` 发送；Escape 关闭 inspector；`aria-expanded` 同步。

### 2.4 Provider

- 自定义 Provider 表单新增“测试连接”，调用真实 `providers.testConnection`；测试会走系统逐次授权。
- 保存/设为默认后通过 `morrow:providers-changed` 刷新 readiness、CTA 和顶部状态栏。

## 3. 验证

| 项目 | 证据 | 结果 |
|---|---|---|
| 完整测试 | `TMP=<repo>/.tmp/esbuild-tmp TEMP=<repo>/.tmp/esbuild-tmp npm test` | 132 files / 1172 tests PASS |
| 类型检查/构建 | `npm run typecheck`、`npm run build` | PASS |
| 真实 Provider 连接测试 | `provider-profiles-1440x900.png`、`last_test_json` | `connected`，10,612ms |
| 普通对话 | `42f24032...` | 真实回复“收到。”，committed |
| 记忆命中 | `c16d258e...` | retrieval selected=1，回复引用既有记忆 |
| 认知/人格 | `946ad82c...` | analysis_ready，personality v2，真实回复 |
| 取消 | `3f834ae1...` | `PROVIDER_CANCELLED`，无 assistant 消息 |
| 取消后重试 | `0706ff24...` | 15 条 trace，committed，1 user + 1 assistant |
| trace 不完整 | 临时重命名表 | UI 显示“运行轨迹不可用 · 轨迹不完整”，恢复后正常 |
| 无 Provider | `no-provider-cta-1440x900.png` | CTA 可见，发送禁用，提交提示配置 |
| 响应式 | `responsive/responsive.json` | 1440/1280/1024/390 无水平溢出，composer 可见 |
| 会话切换 | CDP 新建/切回 | 消息与 trace 隔离 |

## 4. 未完成 / 限制

- 人工可见窗口连续操作：宿主在数秒至数分钟内最小化窗口；本任务以 CDP/DOM 证据为准，标记 PARTIAL。
- 其他 Windows 版本/DPI/Provider：NOT_RUN。
- 正式 NSIS 安装/卸载：本任务未执行；既有 V2 userData 未清空，V1 备份保留。
- 旧构建上的 `3f834ae1` 重试超时证据保留，未改写为成功；最终构建的 `0706ff24` 证明重试修复。

## 5. 结论

对话闭环、真实 Provider、运行轨迹、Provider 设置、取消/重试、无 Provider CTA 和四档响应式均已落地并有真实证据。代码层无 blocker；剩余为环境/人工可见性与跨环境覆盖限制。
