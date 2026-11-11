# Morrow V2 对话运行闭环独立复核

- 复核对象：`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`，分支 `feat/morrow-v2-final-closure`，工作树未提交变更
- 复核时间：2026-11-06
- 复核方式：只读代码/测试/证据；运行 `npm run typecheck`、`npm run build`、完整测试、CDP 四档视口与 DOM 边界检查；未修改任何文件
- 最终状态：**PASS WITH NOTES**

## 1. 结论

- `REAL_PROVIDER_CHAT_VERIFIED`：**YES**。证据库存在真实 Spark 自定义 Provider（`connected`，10,612ms）；真实对话产生 provider_delta、assistant 消息、持久化与 committed 状态；最终构建的取消→重试轮 `0706ff24-4ee9-4a55-8df8-a0a96a74a2a5` 为 committed，1 条 user + 1 条 assistant，15 条 trace。
- `PRODUCT_CHAT_READY`：**YES（带 notes）**。对话闭环、Provider 设置、无 Provider CTA、运行轨迹、取消/重试、会话切换、四档响应式均有代码与运行证据；剩余为环境/覆盖范围限制，不是代码 blocker。
- `PENDING_USER_CREDENTIAL`：不适用（本机已有可用凭据）；其他机器仍需用户自行配置。
- `BLOCKED`：无未解决的代码层 blocker。

## 2. 复核发现与处理

### 2.1 已解决

| 严重度 | 发现 | 处理 | 复核 |
|---|---|---|---|
| BLOCKER | `provider-profiles-ui` 测试 DOM 缺 `#provider-profile-test`，8 个测试失败 | 测试 fixture 补齐按钮 ID | 132 files / 1172 tests 全绿 |
| BLOCKER | 旧构建重试证据停留在 cancelled，未证明状态机修复 | 最终构建真实取消→重试 `0706ff24`，状态 committed，15 条 trace | 通过 |
| BLOCKER | 文档未索引新证据、schema 仍写 v49 | 新增 7 份文档/证据索引；schema 文档更新到 v52 | 通过 |
| BLOCKER | 1024/1280/390 人格面板跨行覆盖工具栏/消息 | `.personality-panel` 改为 `grid-row: 3 / -1`，≤980px 重置为 `auto` | 四档 `personalityOverlapsToolbar/Messages=false`；截图复核 |
| HIGH | 授权拒绝/冲突/存储失败无终态，恢复误判为崩溃 | 外层 catch 写 failed/cancelled；拒绝授权测试 | 通过 |
| HIGH | 重试 `failed/cancelled → received` 不允许 | 状态机允许重试转移；真实重试 committed | 通过 |
| MEDIUM | duration 是事件间隔而非阶段耗时 | started→completed 计时；`provider_delta completed 331ms` | 通过 |
| MEDIUM | 无 delta 仍记 provider_delta completed | 首个 delta 记 started；无 delta 记 skipped/no_stream_delta | 通过 |
| MEDIUM | CTA/feedback 不在输入区上方 | 移入 composer dock，CTA 在输入框上方且不重叠 | 通过（`no-provider-cta-1440x900.png`） |
| MEDIUM | trace 读失败被吞为空数组 | `getTurnTrace` 抛 `STORAGE_ERROR`；UI 显示“轨迹不完整” | 通过（临时重命名表验证） |
| MEDIUM | trace 行不随会话级联删除 | v52 触发器 + `deleteTraceForConversation` | 通过（测试 + evidence DB trigger） |
| LOW | 脱敏测试 key 断言可能同义反复 | 使用独立 canary key | 通过 |

### 2.2 保留的 notes

1. **桌面 composer 不是全窗口 `position: fixed`**：对话视图是 viewport-height，消息区滚动，composer dock 在对话区底部；移动端 dock 才是 fixed。产品语义满足“输入区固定可见”，但不是字面上的全窗口 fixed。
2. **宿主窗口最小化**：Windows 11 Build 26200 宿主会在数秒至数分钟内最小化 Morrow 窗口；本复核的 UI 证据来自 CDP/DOM 与截图，不声称人工可见窗口连续操作通过（PARTIAL）。
3. **其他环境未覆盖**：其他 Windows 版本、DPI、Provider、网络条件 NOT_RUN。
4. **测试覆盖缺口**：`getTurnTrace` 读失败的单元测试未单列；200 条上限测试在同一进程内调用私有方法；v50→v51 数据保留迁移无专门测试；Provider 表单“测试连接”按钮有 fixture 但无点击断言。均为 LOW，已有运行时/手工证据覆盖主要行为。
5. **证据 provenance**：`0706ff24` 的真实请求发生在最终 asar 前一版（服务层修复已包含）；最终 asar `cf6e478d...` 含同一修复，UI 证据在最终构建重采。旧 `3f834ae1` 的 cancelled 状态作为历史证据保留，未改写。
6. **模型回显风险**：部分真实回复出现系统提示/人格文本回显（例如 1024/1280 旧截图中的英文片段），属于 Provider/提示质量风险，不影响对话闭环与持久化；建议后续单独评估。

## 3. 复核证据

- 完整测试：132 files / 1172 tests PASS（`TMP/TEMP=<repo>/.tmp/esbuild-tmp`）
- 类型检查/构建：PASS
- 证据目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\conversation-runtime-final-1793955356`
- 证据文件：`database-evidence.json`、`chat-1440x900-trace.png`、`provider-profiles-1440x900.png`、`no-provider-cta-1440x900.png`、`responsive/responsive.json`、`responsive/*.png`、`ui-snapshot.json`
- schema：52；v52 触发器存在
- 最终 asar：`cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`

## 4. 复核边界

- 本复核不读取 V1 数据、不导入 V1、不清空既有 V2 userData。
- 不把 mock/静态截图当作真实聊天；真实聊天以 DB message/turn/trace 行和 Provider 连接测试为证据。
- 不将 PENDING/PARTIAL/NOT_RUN 标为 PASS。
