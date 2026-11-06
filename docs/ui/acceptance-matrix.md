# UI 验收矩阵（对话运行闭环）

- 构建：asar `cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 证据：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\conversation-runtime-final-1793955356`
- 状态：PASS = 代码 + 测试/真实运行证据；PARTIAL = 有证据但受环境限制；NOT_RUN = 未执行

## 1. 需求 × 证据

| 需求 | 实现 | 证据 | 状态 |
|---|---|---|---|
| 用户输入 → Renderer → preload typed bridge → IPC → CompanionService | `index.html` 表单、`preload.chat.send`、`IPC_CHANNELS.chatSend`、`CompanionService.sendChat` | 真实对话 3 条成功；`src/app/turn-trace.integration.test.ts`；`src/app/ipc.test.ts` | PASS |
| 上下文/记忆/人格/认知参与 | `prepare()`、记忆检索、人格版本、认知分析 | `c16d258e` selected=1；`946ad82c` personality v2、analysis_ready | PASS |
| 真实 Provider 流式回复 | OpenAI-compatible SSE adapter、`onDelta` | `0706ff24` provider_delta started→completed 331ms；真实回复“好。” | PASS |
| 持久化与 turn ID | conversation/message/turn/trace 表 | 6 个受控 turn 的 user/assistant message ID、turn ID 见 `database-evidence.json` | PASS |
| 运行轨迹结构化事件 | `turn_trace_events`、`chat.trace` | `0706ff24` 15 条事件，含 started/completed/failed；skipped 由其他 turn 覆盖（`analysis_unavailable`/`no_stream_delta`） | PASS |
| 阶段列表 | `TurnTraceStage` + UI labels | 接收/认知/上下文/授权/请求/流式/持久化/完成/失败/取消/恢复 | PASS |
| 状态语义 | `started/completed/skipped/failed` | 真实 turn 覆盖四种；`no_stream_delta`、`analysis_unavailable`、`PROVIDER_CANCELLED`、`PROVIDER_DEADLINE` | PASS |
| 原因码与耗时 | `reason`、`durationMs` | `database-evidence.json`；UI 显示“原因/耗时” | PASS |
| 脱敏摘要 | summary 只存原因码；不存消息/prompt/key | `turn-trace.integration.test.ts` 断言 canary 文本与 canary key 不出现；DB 68+ 行无正文 | PASS |
| ≤200 事件/turn | 服务层 sequence 上限 + 仓储读取上限 | `turn-trace.integration.test.ts` 205 次调用后 DB 仅 200 行 | PASS |
| trace 失败不阻断聊天 | append 失败 catch + 内存标记；读失败抛 STORAGE_ERROR | 写失败测试聊天仍提交；临时重命名表后 UI 显示“轨迹不完整” | PASS |
| 无 Provider CTA | CTA + 禁用发送 + 可操作提示 | `no-provider-cta-1440x900.png`；禁用后发送提示 | PASS |
| Provider 保存/默认/测试 | 多源 profile + `testConnection` | 真实保存 `Spark 验收 Provider`，默认，`connected` 10,612ms | PASS |
| 真实聊天 | 系统逐次授权 + SSE | 3 条成功真实回复；1 条取消；1 条超时；1 条取消后重试成功 | PASS |
| 取消/重试 | AbortController + 同一 requestId | `0706ff24` 取消→重试→committed，无重复 user message | PASS |
| 会话切换 | `loadConversation` + `chat.trace` | 新建/切回消息与 trace 隔离 | PASS |
| 键盘发送 | Ctrl/Cmd+Enter | CDP keydown 触发提交；真实请求完成 | PASS |
| 四档响应式 | CSS grid + drawer + fixed dock | `responsive.json`：1440/1280/1024/390，无水平溢出 | PASS |
| 现有功能回归 | 记忆/人格/目标/提醒/备份 | 完整测试 132 files / 1172 tests 全绿 | PASS |
| 人工可见窗口连续操作 | 宿主窗口可见性 | 宿主会最小化；CDP/DOM 证据不依赖可见窗口 | PARTIAL |
| 其他 Windows/DPI | — | 未执行 | NOT_RUN |

## 2. 真实 Provider 路径

| 路径 | Turn ID | 关键证据 | 状态 |
|---|---|---|---|
| 普通对话 | `42f24032-44ba-4685-8365-3abcc5f4d03b` | 0 条记忆；8 条 trace；committed | PASS |
| 记忆命中 | `c16d258e-26e8-4e5c-888a-0cecc42a68bd` | retrieval selected=1；回复引用既有记忆；8 条 trace | PASS |
| 认知/人格更新 | `946ad82c-4f70-4697-ab75-06f91eeded20` | analysis_ready；personality version 2（warmth 70/directness 80/humor 10/direct）；8 条 trace | PASS |
| 取消 | `3f834ae1-a63b-4b3a-9e39-3fbc0fa39860` | 取消事件 + 后续超时；历史证据保留 | PASS（失败语义真实） |
| 取消后重试 | `0706ff24-...` | 15 条 trace；最终 committed；1 user + 1 assistant | PASS |

## 3. 不可用/未执行

- 其他 Windows 版本、其他 DPI、其他 Provider 的兼容性：NOT_RUN。
- 人工在可见窗口内连续 5 分钟操作：PARTIAL（宿主最小化；见 Issue #60）。
- 正式 NSIS 安装/卸载：本任务未执行；V1 备份与既有 V2 userData 未改动。
