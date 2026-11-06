# Morrow V2 对话运行验收测试矩阵

- 日期：2026-11-06
- 构建 asar：`cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 完整测试结果：`132` 个测试文件、`1172` 个测试全部通过
- 运行环境：Windows 11 Build 26200、Node 22.23.2、Electron 44.9.3

## 1. 完整回归

```bash
cd zcode/stage3-audit/repo
mkdir -p .tmp/esbuild-tmp
TMP="$(pwd)/.tmp/esbuild-tmp" TEMP="$(pwd)/.tmp/esbuild-tmp" npm test
```

结果：

```text
Test Files  132 passed (132)
Tests       1172 passed (1172)
```

说明：默认 `%TEMP%` 在本机对 esbuild 临时文件返回 `Access is denied`；将 `TMP/TEMP` 指向仓库内 `.tmp/esbuild-tmp` 后全部通过。这不是测试跳过或弱化，测试内容未改动。

类型检查与构建：

```bash
npm run typecheck   # exit 0
npm run build       # exit 0
```

## 2. 新增/更新的针对性测试

| 文件 | 覆盖 | 结果 |
|---|---|---|
| `src/app/turn-trace.integration.test.ts` | 真实阶段序列；started/completed/skipped；流式 delta；trace 写失败仍聊天；拒绝授权终态；取消后重试；会话删除；级联删除；200 条上限 | 8 passed |
| `src/persistence/turn-trace-repository.test.ts` | 状态读写（completed/started/failed/skipped）、200 条读取上限、删除 | 2 passed |
| `src/app/ipc.test.ts` | `chat.trace` 可信 frame 路由、非法 conversationId、外部 frame 拒绝 | 24 passed（含新增 2） |
| `src/cognition/turn-state-machine.test.ts` | `failed/cancelled → received` 重试转移；原有合法/非法转移 | passed |
| `tests/provider-profiles-ui.test.ts` | 新增“测试连接”按钮 DOM fixture；原有保存/测试/删除/默认 | 8 passed |
| `src/persistence/migrations.test.ts` | schema v52；既有迁移链 | passed |
| `src/providers/openai-compatible.test.ts` | SSE 边界、空响应、超时、取消 | passed（既有） |
| `src/providers/provider-retry.test.ts` | 重试/超时策略 | passed（既有） |
| 记忆/人格/目标/提醒/备份相关测试 | 回归 | 全部 passed |

## 3. 真实运行验收（本机）

| 场景 | 方法 | 证据 | 结果 |
|---|---|---|---|
| Provider 保存 | UI 表单 + 密钥注入（env → UI，未打印） | `provider-profiles-1440x900.png`；profile 默认/启用 | PASS |
| Provider 测试连接 | UI“测试连接”+ 系统授权 | `last_test_json` connected 10,612ms | PASS |
| 普通对话 | UI 输入 → 系统授权 → SSE | `42f24032...` 回复“收到。” | PASS |
| 记忆命中 | 同上，检索 selected=1 | `c16d258e...` 回复引用既有记忆 | PASS |
| 认知/人格 | 启用认知 + 保存人格 v2 + 对话 | `946ad82c...` analysis_ready，personality v2 | PASS |
| 取消 | 发送后立即取消 | `3f834ae1...` 取消事件，无 assistant；`0706ff24...` 取消后重试成功，最终有 1 条 assistant | PASS |
| 超时 | 旧构建重试长回答 | `3f834ae1...` `PROVIDER_DEADLINE` | PASS（真实失败） |
| 取消后重试 | 同 requestId 重试 | `0706ff24...` committed，1 user + 1 assistant | PASS |
| 会话切换 | 新建 → 切回 | 消息/trace 隔离 | PASS |
| 无 Provider CTA | 禁用 profile → 聊天 | CTA 显示、发送禁用、提交提示 | PASS |
| 键盘发送 | Ctrl+Enter | 真实请求完成 | PASS |
| trace 不完整 | 临时重命名 trace 表 → 切换会话 | UI “轨迹不完整”；恢复后正常 | PASS |
| 四档响应式 | CDP 1440/1280/1024/390 | `responsive/responsive.json` | PASS |

## 4. 未执行 / 外部限制

| 项目 | 原因 | 状态 |
|---|---|---|
| 人工在可见窗口连续操作 5 分钟 | 宿主自动最小化窗口（Issue #60） | PARTIAL |
| 其他 Windows 版本/DPI | 无设备 | NOT_RUN |
| 其他 Provider/网络环境 | 仅验证本机用户提供的 Provider | NOT_RUN |
| 正式 NSIS 安装/卸载 | 本任务要求增量更新，不重装 | NOT_RUN |
| V1 数据读取/导入 | 安全约束禁止 | NOT_RUN（有意不执行） |

## 5. 断言与证据边界

- 不把 mock/静态截图当作真实聊天；真实聊天以 DB message 行、turn 状态、trace 事件和 Provider 连接测试为证据。
- 失败/取消/超时保留原始状态，不改写为 PASS。
- API Key 只从 `.tmp` 通过 `MORROW_TEST_API_KEY` 注入；未出现在代码、日志、截图、报告或证据 JSON。
