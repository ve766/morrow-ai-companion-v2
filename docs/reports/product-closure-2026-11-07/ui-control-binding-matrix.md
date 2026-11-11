# UI 控件绑定矩阵（Issue #61）

- 契约源文件：`docs/ui/control-contract.json`
- 自动校验：`tests/ui-control-contract.test.ts`
- 产物：30 个关键控件，逐项记录 selector、页面、用户可见名称、事件、Renderer、Preload、IPC、Service、持久化、反馈、测试映射。
- 原则：控件存在 ≠ 接线完成；矩阵中的 IPC 通道同时在校验 `shared/contracts.ts`、`preload/index.ts`、`app/ipc.ts` 中存在。

## 1. 覆盖范围

| 区域 | 控件 | 真实后端 |
|---|---|---|
| 全局导航 | `nav-chat` / `nav-memory` / `nav-goals` / `nav-settings` | 视图切换；不伪造数据 |
| 会话 | 选择 / 新建 / 删除 | `conversations.read/create/delete` → `ConversationService` / `ChatService` → SQLite |
| 对话 | 输入框 / 发送 / 取消 | `chat.send/cancel` → `ChatService` → Provider → messages/trace |
| 轨迹 | 运行轨迹开关 | `chat.turn-trace` → `getTurnTrace` → `turn_trace_events` |
| 人格 | 保存新版本 | `personality.save` → `PersonalityService` → revisions |
| 记忆 | 保存 / 搜索 / 刷新 | `memory.create/search/list` → `MemoryService` → memories/revisions |
| Provider | 保存 / 默认 / 启用 / 测试 / 发现 | `provider.profiles:save/list`、`provider:test-connection`、`discover-models` → `ProviderConfigService` + OS secret store |
| 备份 | 导出 / 预览 | `backup.export/preview` → `BackupService` |
| 主题 | 原生 / 透视 / 全息 / 粗野 / 拼贴 / 等离子 | 仅 `visual-effects.ts` + localStorage；不触碰 IPC/数据 |

## 2. 已验证的真实行为

| 控件 | 验证 | 结果 |
|---|---|---|
| 发送 | 新界面真实输入 → 系统授权 → Provider SSE → 持久化 | turn `02918746-4cfc-4140-aaad-5425dd4d6423` committed；user/assistant 各 1；9 条 trace；assistant “收到。” |
| 取消 | 前序 turn `0706ff24...` 取消后重试 | 取消 `PROVIDER_CANCELLED`，重试 committed；1 user + 1 assistant |
| 新建/切换 | CDP 新建 → 切回 | 消息与 trace 按会话隔离 |
| Provider 保存/默认/启用 | 产品路径 smoke 通过 renderer 表单创建 A/B profile；UI 默认/启用状态更新 | 2 个 profile，OS secret 文件不同 |
| Provider 测试连接 | 前序真实连接 `connected` 10,612ms（Spark） | PASS（真实 Provider） |
| 无 Provider CTA | 禁用 profile → 聊天 | CTA 显示、发送禁用、提交提示配置；重新启用后恢复 |
| 人格保存 | `personality.save` 既有集成测试 + UI 版本号更新 | PASS |
| 记忆创建/搜索/刷新 | 既有 MemoryService/IPC 测试；UI selector 契约 | PASS（结构）；本轮未新建真实用户记忆 |
| 主题切换 | CDP 点击 5 个主题，`body[data-effect]` 与 localStorage 更新 | PASS |

## 3. 关键代码位置

- `src/renderer/index.html`：所有静态控件与 `data-testid`。
- `src/renderer/src/companion-ui.ts`：会话/发送/取消/轨迹/人格/Provider 状态。
- `src/renderer/src/provider-profiles-ui.ts`：保存/默认/启用/测试/发现。
- `src/renderer/src/visual-effects.ts`：五种主题，仅本地展示。
- `src/shared/contracts.ts`、`src/preload/index.ts`、`src/app/ipc.ts`：通道与 trusted-frame 白名单。
- `src/app/companion-service.ts`、`ConversationService`、`MemoryService`、`PersonalityService`、`ProviderConfigService`、`BackupService`：真实业务与持久化。

## 4. 未覆盖 / 限制

- 所有控件未逐一做“真实鼠标点击 + 数据库变化”的 E2E；部分动态列表（记忆卡、自我模型条目、提醒）通过既有 service/IPC 测试覆盖，未伪造点击 PASS。
- Provider 测试连接会弹原生授权对话框，无法由 CDP 自动点击；本任务用真实 UI 手动/脚本辅助验证，并在矩阵中单独标注。
- 主题只改变外观；没有新增 Agent Runtime、文件执行、shell 或网络控制。
