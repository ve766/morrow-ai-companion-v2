# Morrow V2 运行轨迹证据索引

- 证据根目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\conversation-runtime-final-1793955356`
- 数据库：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\user-data\final-1793955356\morrow.sqlite3`
- schema：`52`（`schema_migrations` max）
- 部署 asar SHA256：`cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 采集时间：2026-11-06（UTC 13:28–14:50；最终快照 14:5x）
- 数据文件：`database-evidence.json`（含数据库 hash、profile、人格、turn/message/trace 行）

## 1. 受控真实对话

| 路径 | Turn ID | User message | Assistant message | 状态 | trace |
|---|---|---|---|---|---|
| 记忆命中（selected=1） | `c16d258e-26e8-4e5c-888a-0cecc42a68bd` | `dabb1c16-0f43-45c1-b6cc-6cc8628aaf20` | `59369a19-21ae-48f6-acbb-e3a4757ab7bb` | committed | 8 |
| 普通对话（selected=0） | `42f24032-44ba-4685-8365-3abcc5f4d03b` | `fc7d2464-64bb-45ed-b30a-c71aa363937b` | `85c1d48f-789e-4431-9006-c92c7a7dfa2a` | committed | 8 |
| 认知/人格（analysis_ready, personality v2） | `946ad82c-4f70-4697-ab75-06f91eeded20` | `772051e9-5b63-4bb9-95c9-7b49f624a426` | `4e9fdbdd-4874-42ab-94ba-87415e14067e` | committed | 8 |
| 取消 + 旧构建超时（历史证据） | `3f834ae1-a63b-4b3a-9e39-3fbc0fa39860` | `fdcc9e8e-1e8d-4df6-a4de-88d19f4656c3` | — | cancelled | 12 |
| 键盘发送真实请求 | `31d8c593-bcc0-48b6-bc02-2230f2375504` | `a394f959-a5bb-4fe7-977a-2d9e3694e535` | `9325f398-70c9-4c0d-b987-597d076f1a3f` | committed | 8 |
| 取消后重试（最终构建） | `0706ff24-4ee9-4a55-8df8-a0a96a74a2a5` | `4d2fe43a-2b72-48a9-9088-2a861169ebc4` | `132d951c-bba1-43b5-9b59-ce9a1fcce5a4` | committed | 15 |

## 2. 最终构建重试轨迹（`0706ff24...`）

| seq | stage | status | reason | duration |
|---|---|---|---|---|
| 1 | turn_received | completed | — | — |
| 2 | cognition_analysis | completed | analysis_ready | 362ms |
| 3 | context_built | completed | — | 132ms |
| 4 | consent | completed | — | 16ms |
| 5 | provider_request | started | — | — |
| 6 | turn_cancelled | failed | PROVIDER_CANCELLED | 419ms |
| 7 | turn_received | completed | — | — |
| 8 | cognition_analysis | completed | analysis_ready | 146ms |
| 9 | context_built | completed | — | 32ms |
| 10 | consent | completed | — | 17ms |
| 11 | provider_request | started | — | — |
| 12 | provider_delta | started | — | — |
| 13 | provider_delta | completed | — | 331ms |
| 14 | persistence | completed | assistant_message_saved | 43ms |
| 15 | turn_completed | completed | — | 8ms |

说明：该轮只产生 1 条 user + 1 条 assistant，重试复用同一 requestId；最终 `turn_states.state='committed'`。

## 3. 状态覆盖

- `completed`：接收、上下文、授权、流式完成、持久化、完成。
- `started`：Provider 请求、首个流式 delta。
- `skipped`：认知关闭时的 `analysis_unavailable`；无 delta 时的 `no_stream_delta`。
- `failed`：取消 `PROVIDER_CANCELLED`、超时 `PROVIDER_DEADLINE`、拒绝授权 `FORBIDDEN`（测试）。
- `recovery`：仅用于 trace 写失败的合成标记 `TRACE_WRITE_FAILED`。

## 4. 脱敏与边界

- `summary` 只保存原因码（如 `assistant_message_saved`），不保存消息正文、prompt、记忆原文、API Key 或 Authorization。
- 集成测试使用 canary 用户文本与 canary key，断言两者都不出现在 trace JSON。
- 每 turn 服务层上限 200 条；仓储读取上限 200 条；测试用 205 次调用验证 DB 只保留 200 行。
- trace 写失败：聊天仍提交；`getTurnTrace` 返回合成 `recovery/failed/TRACE_WRITE_FAILED` 事件，UI 显示“轨迹不完整”。
- trace 读失败：`getTurnTrace` 抛 `STORAGE_ERROR`；UI 显示“运行轨迹不可用 · 轨迹不完整”。已用临时重命名 `turn_trace_events` 表验证，随后恢复。
- 会话删除：v52 触发器级联删除 trace；`deleteConversation` 同时清理内存映射。
- 备份恢复：备份服务直接删除 conversations 时，v52 触发器同样级联。

## 5. 旧构建与最终构建的差异

- `c16d258e`、`42f24032`、`946ad82c`、`3f834ae1`、`31d8c593` 产生于最终 UI/时序修复前的构建；其 `durationMs` 仍是“距上一事件间隔”，例如 `provider_request started 5021ms` 表示等待授权的时间，不是请求耗时。
- 最终构建 `0706ff24` 已使用阶段 started→completed 计时：`provider_request started` 为 `—`，`provider_delta completed 331ms` 为真实流式阶段。
- 旧构建的 `3f834ae1` 重试超时保留了 `cancelled` 状态，未改写；最终构建 `0706ff24` 证明重试状态机修复。

## 6. 截图与响应式

- `chat-1440x900-trace.png`
- `provider-profiles-1440x900.png`
- `no-provider-cta-1440x900.png`
- `responsive/1440x900.png`、`responsive/1280x800.png`、`responsive/1024x768.png`、`responsive/390x844.png`
- `responsive/responsive.json`：四档视口的列宽、inspector 显示、composer 边界、scrollWidth。
- `ui-snapshot.json`：最终 UI 文本快照（不含密钥）。

## 7. 复现命令（只读）

```powershell
$run='final-1793955356'
$base=Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance'
$db=Join-Path $base ('user-data\'+$run+'\morrow.sqlite3')
# 只读打开，避免影响运行中的 WAL
python -c "import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(c.execute('select max(version) from schema_migrations').fetchone()); print(c.execute('select turn_id,stage,status,reason,duration_ms from turn_trace_events order by occurred_at desc limit 20').fetchall())" $db
```

## 8. 证据边界

- 仅本机 `final-1793955356` 实例；不代表其他机器/Provider/Windows 版本。
- 截图只包含 Morrow 应用内容；未读取或上传 V1 数据。
- 真实 Provider 的密钥从未写入本索引、数据库证据或截图。
