# UI 实施与回归报告（对话运行闭环）

- 分支：`feat/morrow-v2-final-closure`
- 基线：`70bcb4e9c301e3f3b30f12fff5f0453bdd54d0ee`
- 构建：`npm run build` + `electron-builder --win dir`，部署 asar SHA256 `cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 测试：`132` 个测试文件、`1172` 个测试全部通过（完整命令见 `docs/testing/morrow-v2-conversation-runtime-acceptance-matrix.md`）
- 状态：`PRODUCT_CHAT_READY` + `REAL_PROVIDER_CHAT_VERIFIED`（本机、用户提供的 Provider；见 §4）

## 1. 改动清单

### 1.1 运行轨迹（主进程）

- `src/persistence/migrations.ts`
  - v50 `turn-trace-events`：新增 `turn_trace_events` 表与索引。
  - v51 `turn-trace-started-status`：重建表，状态允许 `started`，保留已有行。
  - v52 `turn-trace-cascade`：会话删除时级联删除 trace 事件。
- `src/persistence/turn-state-repository.ts`
  - `appendTrace`、`listForConversation`（最多 200 条）、`deleteTraceForConversation`。
- `src/cognition/turn-state-machine.ts`
  - `TurnTraceRecord` 状态扩展为 `started | completed | skipped | failed`；`deleteTraceForConversation` 端口；允许 `failed/cancelled → received` 的重试转移。
- `src/app/companion-service.ts`
  - 每个生命周期状态写入 trace；`provider_request` 记为 `started`，首个 delta 记 `provider_delta started`，响应完成记 `completed`，无 delta 记 `skipped/no_stream_delta`。
  - 耗时：有显式 started 的阶段用 started→completed；其余用与上一事件的间隔；`turn_received` 无耗时。
  - 每 turn 最多 200 条；trace 写失败只记录内存标记，不阻断对话；`getTurnTrace` 读失败抛出 `STORAGE_ERROR`，UI 显示“轨迹不完整”。
  - 前置失败（拒绝授权、冲突、存储错误）在外层 catch 中写入 `failed/cancelled` 终态，避免恢复逻辑误判为崩溃。
  - 删除会话时清理 trace 与内存映射。
- `src/shared/contracts.ts`、`src/preload/index.ts`、`src/app/ipc.ts`
  - 新增 `morrow:chat:turn-trace` 通道、typed preload `chat.trace`、IPC 路由与 `CompanionActions.getTurnTrace`。

### 1.2 运行轨迹（渲染进程）

- `src/renderer/index.html`
  - 顶部状态栏；右侧 `#runtime-inspector`；`#runtime-trace-skipped`（本轮未执行的算法）；composer dock 包含 CTA、feedback、form。
- `src/renderer/src/companion-ui.ts`
  - `renderRuntimeTrace`：显示阶段、状态、耗时、模块、原因码；列出 skipped 与未触发阶段；轨迹读写失败显示“轨迹不完整”。
  - inspector 开关、Escape、`aria-expanded`；`Ctrl/Cmd+Enter` 发送；Provider 状态同步到顶部状态栏。
  - 无 Provider 发送不再静默返回：显示 CTA 与可操作提示。
- `src/renderer/src/provider-profiles-ui.ts`
  - 自定义 Provider 新增“测试连接”按钮，调用真实 `providers.testConnection`。
- `src/renderer/src/style.css`
  - 三栏布局、inspector 抽屉、顶部状态栏、composer dock、viewport-height 对话区、四档响应式、CTA/feedback 布局。

### 1.3 测试

- 新增 `src/app/turn-trace.integration.test.ts`（8 个用例）：真实阶段序列、流式 started/completed、trace 写失败仍可聊天、拒绝授权终态、取消后重试、会话删除、200 条上限、级联删除。
- 新增 `src/persistence/turn-trace-repository.test.ts`（2 个用例）：状态读写、200 条读取上限、删除。
- `src/app/ipc.test.ts`：trace 通道可信 frame 路由、非法 conversationId、外部 frame 拒绝。
- `tests/provider-profiles-ui.test.ts`：补齐新按钮 DOM fixture。
- 更新 schema 断言到 v52。

## 2. 回归结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | PASS |
| 生产构建 | `npm run build` | PASS |
| 完整测试 | `TMP=<repo>/.tmp/esbuild-tmp TEMP=<repo>/.tmp/esbuild-tmp npm test` | 132 files / 1172 tests PASS |
| 增量部署 | 复制 asar 到既有 `final-1793955356`，保留 userData | PASS |
| 数据库迁移 | 既有 DB 从 51 → 52，行保留 | PASS（`schema_migrations` max=52；trigger 存在） |
| 真实 Provider 连接测试 | UI“测试连接” + 系统授权 | PASS：`connected`，10,612ms |
| 真实聊天 | 3 条成功、1 条取消、1 条超时、1 条取消后重试成功 | PASS/部分失败（超时为真实失败，未伪装成功） |
| 会话切换 | 新建 → 切回 | PASS：消息与 trace 按会话隔离 |
| 无 Provider CTA | 禁用 Provider → 聊天 | PASS：CTA 显示，发送禁用，提交提示配置 |
| 轨迹不完整 | 临时重命名 trace 表 → 切换会话 | PASS：显示“运行轨迹不可用 · 轨迹不完整”，恢复后正常 |
| 四档响应式 | CDP 1440/1280/1024/390 | PASS：无水平溢出，composer 可见，inspector 抽屉可用 |

## 3. 真实 Provider 证据（不含密钥）

- Provider：`Spark 验收 Provider`，自定义 HTTPS OpenAI-compatible，模型 `spark-x2.6`，默认、已启用；密钥只在本机 Windows 安全存储。
- 连接测试：`last_test_json` 状态 `connected`，10,612ms，端点摘要 `717272dc9bde89eb`。
- 成功对话：
  - `c16d258e-26e8-4e5c-888a-0cecc42a68bd`：记忆命中 1 条，8 条 trace，`committed`。
  - `42f24032-44ba-4685-8365-3abcc5f4d03b`：0 条记忆，8 条 trace，`committed`。
  - `946ad82c-4f70-4697-ab75-06f91eeded20`：认知分析 `analysis_ready`，人格版本 2，8 条 trace，`committed`。
  - `0706ff24-...`：取消 → 重试同一 requestId，最终 `committed`，只有 1 条 user + 1 条 assistant，15 条 trace。
- 失败/取消：
  - `3f834ae1-a63b-4b3a-9e39-3fbc0fa39860`：取消后重试超时（`PROVIDER_DEADLINE`），保留失败证据；该轮重试发生在重试状态机修复前的构建，状态仍为 `cancelled`，作为历史证据保留，不覆盖。
- 具体 message/trace ID、耗时、状态见 `database-evidence.json` 与 `docs/reports/morrow-v2-runtime-trace-evidence-index.md`。

## 4. 状态声明

- `PRODUCT_CHAT_READY`：界面、无 Provider CTA、Provider 保存/默认/测试、真实聊天闭环、取消/重试、会话切换、trace 显示均已验证。
- `REAL_PROVIDER_CHAT_VERIFIED`：本机使用用户提供的真实 Provider 凭据完成连接测试与多条真实对话；凭据未写入代码、日志、截图或本报告。
- `PENDING_USER_CREDENTIAL`：不适用（本机已有可用凭据）；其他机器仍需用户自行配置。
- `BLOCKED`：无代码层 blocker。宿主窗口自动最小化是环境限制；本次 UI 证据通过 CDP/DOM 获取，未把“窗口长时间可见”当作 PASS。

## 5. 残余风险

1. 真实 Provider 的延迟/限流不可控；一次重试在旧构建上超时，已如实保留。
2. 桌面 composer 是“对话区底部固定”，不是全窗口 `position: fixed`；移动端为 fixed。
3. 宿主窗口最小化仍可能影响人工目视验收；CDP 证据不依赖窗口可见。
4. 其他 Windows 版本/DPI 未验证。
