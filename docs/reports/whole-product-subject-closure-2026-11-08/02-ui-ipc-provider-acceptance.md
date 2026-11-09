# UI、IPC、Provider 与 E2E 验收

## 1. 真实 Windows Electron 结果

### `npm run smoke:chat-ui`（新增，Issue #74 P0）

- 结果：**PASS**
- 脚本：`scripts/chat-ui-smoke.mjs`
- 路径：真实 built Electron → renderer `#chat-content` / `#chat-form` → preload → IPC → `ChatService` → loopback HTTP SSE Provider → renderer 渲染 → SQLite。
- 证据：`results/issue74-chat-smoke7.log`
- 观察：`{"status":"PASS","checks":["renderer input -> submit -> streamed assistant reply -> persisted conversation"],"requests":1,"messages":["user","assistant"]}`
- 说明：loopback Provider 是真实 HTTP/SSE 服务，不是 mock 内部函数；consent 仅在该脚本用 acceptance 环境变量自动批准，产品默认仍弹原生对话框。assistant 回复 `UI stream reply` 被逐段渲染并持久化。

### `npm run smoke:product-path`

- 结果：**PASS**
- 证据：`results/issue74-product-smoke2.log`，runId `20261108T094904Z-a38f8648`。
- 覆盖：renderer 创建/编辑/删除 Provider profile、OS 安全存储密钥隔离、重启恢复、endpoint 变更清旧密钥、continuity 表不变、1440×900/1280×800/390×844 截图。
- 与 `chat-ui` 的区别：product-path 不发真实 model 请求；chat-ui 发 loopback SSE 请求。

## 2. 控件矩阵（可见按钮 → handler → IPC）

| 控件 | 渲染器 handler | preload / IPC | 服务/持久化 | 证据 |
|---|---|---|---|---|
| `#conversation-new` | `companion-ui.ts` | `conversations.create` | conversation 行 | product-path / UI contract |
| `#conversation-select` | `companion-ui.ts` | `conversations.read` | messages 读取 | chat-ui（持久化） |
| `#conversation-delete` | `companion-ui.ts` | `conversations.delete` | 级联删除 | 既有 conversation 测试 |
| `#chat-send` / `#chat-form` | `companion-ui.ts` | `chat.send` | ChatService + Provider + messages | chat-ui PASS |
| `#chat-cancel` | `companion-ui.ts` | `chat.cancel` | AbortController、turn canceled | service cancel test + trace tests |
| Provider profile form/save/test/discover | `provider-profiles-ui.ts` | `providers.*` | provider_profiles + OS secret | product-path PASS |
| `#affect-refresh` | `affect-ui.ts` | `affectStateGet` | emotion_states/traits read | UI contract + typecheck |
| 情绪“缓解/撤销” | `affect-ui.ts` 动态按钮 | `affectRegulate` | emotion_regulations + state revision | unit/emotion service test |
| `#affect-clear` | `affect-ui.ts` | `affectClear` | emotion/trait/reward delete | emotion service clear test |
| `#consent-refresh` | `affect-ui.ts` | `consentGrantsList` | provider_consent_grants read | UI contract |
| 授权“撤销” | `affect-ui.ts` 动态按钮 | `consentGrantRevoke` | revoked_at | consent-grants service test |

## 3. Consent 行为

- 原生对话框三种选择：`取消` / `仅本次` / `记住 30 天`（chat 且非 sensitive）。
- sensitive：只有 `取消` / `允许本次发送`，且 `ConsentGrantService.grant()` 对 sensitive 返回 null。
- 记住：scope 仅 action/provider/endpoint/model/sensitivity；不含 key、正文或 payload hash。
- 每次发送仍校验当前 payload hash；批准后复用 prepared snapshot；配置/会话变化 CONFLICT。
- 设置页可查看有效 grant 并撤销；撤销即时影响下一次发送。
- 未自动化：原生 OS 对话框本身不能通过 CDP 点击；`chat-ui` 用 acceptance-only 自动同意变量，产品默认路径仍是对话框。E2E 对话框按钮点击为 **PENDING_HUMAN**（见 `10-acceptance-matrix.json`）。

## 4. Provider 配置

- 支持 OpenAI-compatible 自定义中转、本地 loopback、DeepSeek/Spark 既有配置。
- `provider-profiles-ui.ts` 表单包含名称、来源类型、协议、Base URL、path、模型、API key、启用/默认；key 输入保存后清空，不进入 renderer 日志。
- 未配置时 `#chat-provider-cta` 显示明确引导；配置后 `chat-ui` 真实发送成功。
- 密钥不进入 IPC 返回体、SQLite、报告或日志；product-path 检查 `distinct ciphertext digests` 和 `noCredentialInIpc`。

## 5. 未覆盖

- 真实 cloud Provider 的非流式/SSE 人工 A–K 行为：**NOT_RUN**。
- UI 取消/重试的端到端自动化：service 层测试通过，但本轮没有新增真实 Electron 点击取消脚本 → **PARTIAL**。
- 原生 consent 三按钮的自动化点击：**PENDING_HUMAN**。
- 打包后的 installer UI smoke：见 `08`。
