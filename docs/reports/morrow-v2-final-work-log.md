> 历史基线（Issue #53）：以下 SHA/CI/截图是当轮记录，不是 Issue #55 RC 最终结果。RC 状态见 `docs/reports/morrow-v2-rc-delivery-report.md`。

# Morrow V2 最终收口工作日志（Issue #53）

- 分支：`feat/morrow-v2-final-closure`
- 起始 base：`release/morrow-v2-final-delivery` @ `3812b18`
- 记录时间：2026-11-04

## 0. 基线核实

- 读取实时 release：`3812b18`，与集成分支 merge-base 相同。
- PR #40 head `4284cb1`，PR #51 head `326e68a`，PR #52 R2 `PASS_WITH_NON_BLOCKING_BACKLOG`。
- 工作树 clean；未覆盖任何已有未提交变更。
- 重新定位代码位置，不依赖旧行号。

## 1. 集成顺序

1. `git switch -c feat/morrow-v2-final-closure release/morrow-v2-final-delivery`
2. `git merge 4284cb1`（Stage 4）→ `a34d797`
3. `git merge 326e68a`（Provider）→ 冲突：`src/persistence/migrations.ts`
4. 冲突解决：
   - 保留 v48 `pending-decision-terminal-state`；
   - Provider 重编号 v49 `provider-multi-source-profiles-final`；
   - v49 同时接受旧表/Provider v48 扩展表；
   - `applyMigrations` 增加 Provider v48 桥接；
   - 增加结构身份校验。
5. 合并提交：`5091e02`。

## 2. 迁移测试

新增/更新：

- `migrations.test.ts`：release v47→v49、Stage 4 v48→v49、Provider v48→v49、重复启动、v49 回滚重试、40/41 字符 id。
- `provider-multi-source.integration.test.ts`：外来 v48 名称、已知名称结构不符。
- 修正原 v48 断言为 `CURRENT_SCHEMA_VERSION`，不弱化断言。

过程中发现并修复：

- 桥接在“列已补、名称未改”的重试场景会重复 ALTER；改为先检查列，只改名。
- v49 重建失败必须回滚并保留 v48 表；用重复 default 触发唯一索引失败验证。
- 测试 pending id 必须为 36 字符 UUID；修正测试数据，不改约束。

## 3. Provider P1/P2

### P1 健康/能力失效

- `saveProfile` 计算 `destinationChanged`（sourceKind/protocol/endpoint/path）、`modelChanged`、`credentialChanged`。
- 任一变化：`capabilities = defaultCapabilities()`，`lastTest = null`。
- 仅 displayName/enabled/isDefault 等保留。

### P1 连接 URL

- `connectionInput` 改用 `resolveChatEndpoint`。
- 表驱动测试 6 种形状；adapter 仍校验 `input.endpoint === resolveChatEndpoint(...)`。
- 修复 resolver：`endpointPath='/v1'` 在 base 无 `/v1` 时补 `/v1/chat/completions`；其他路径作为前缀补一次操作后缀；models 同步。

### P1 官方 profile

- service 层：内置 id 的 sourceKind/endpoint/model 校验；官方 id 禁止 `endpointPath`。
- IPC 测试：deepseek + `/v1` 拒绝；41 字符 id 拒绝。
- UI：官方编辑按钮禁用；服务层仍是权威。

### P1 secret 绑定

- 目标变化且未提供新 key：先删除旧 secret 并回读确认，再写 profile；远端 `enabled=false`、`apiKeyConfigured=false`。
- 提供新 key：先写 secret 并回读，再写行；任一步失败补偿旧 secret。
- UI 保存后提示“旧密钥已清除，请重新输入”，表单取消启用。
- 测试：每种连接语义字段、secret 写失败补偿。

### P1 discovery

- 新增 `ProviderAction = 'model-discovery'`；主进程 consent 文案“获取模型列表”。
- 请求前：`validateProviderConfig` + `hasProtocolAdapter` + `resolveModelsEndpoint` + `EndpointPolicy.assertAllowed` + consent。
- 拒绝时 previews=0、fetch=0。
- 1 MB 响应上限；401/403/404/429/5xx 分类；错误正文不落库。

### P2

- profile id 40：`provider-registry`、`shared/validation`、DB CHECK 一致。
- endpoint-security：IPv4 CGNAT；IPv6 解析支持 mapped（hex/dotted）、IPv4-compatible、NAT64、6to4、link-local/ULA/multicast；host 去尾点、去 IPv6 方括号。
- IPC 文案去 DeepSeek 专属。
- UI endpointPath 帮助文本。

## 4. 验证命令

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npx vitest run` | 0；128 文件 / 1153 测试 |
| `npm run evaluate` | 0 |
| `npm run evaluate:cognition` | 0 |
| `npm run build` | 0 |
| `npm run package:win` | 本机执行；产物在 `release/` |
| `npm run eval:provider-multi-source`（supuxh） | 结果 BLOCKED_QUOTA |
| `npm run eval:provider-multi-source`（speed26） | 结果 BLOCKED_QUOTA |

注意：本机 `TEMP` 指向不可写的系统目录会导致 esbuild 失败；测试/评估使用仓库内 `.tmp/es` 作为 `TEMP`/`TMP` 后通过。这是宿主环境问题，不是产品代码失败。

## 5. 外部/宿主阻塞

- 两个远程 Provider 账户均返回 403 quota；未伪造 PASS。
- 本地 1234/8000/8080/11434 无 OpenAI-compatible `/v1/models`；8000 是非模型 Web 原型。
- 本机 Electron 44 在 Windows 26200 启动即 0xC0000005（sandbox 开关均复现）；产品路径改在 CI Windows 执行，并增加 Windows 打包/安装/启动 smoke。

## 5.1 CI 收敛过程

| 轮次 | 失败 | 修复 |
| --- | --- | --- |
| 1 | product-path seed 顶层 await 语法错误；Windows package seed 因 `--no-sandbox` 崩溃 | seed 包 async IIFE；Windows package job 去掉 sandbox 开关 |
| 2 | Ubuntu 无 OS keyring，safeStorage 为 basic_text | product-path 仅在 Windows 执行；Ubuntu 保留 smoke |
| 3 | 重启后 listProfiles 返回 PROVIDER_CREDENTIAL_STORE_ERROR | 关闭应用改为 `window.close()` 优雅退出，等待 key 材料落盘 |
| 4 | 重启 continuity 因 feeling revision 变化 | 从 continuity 快照移除派生 feeling 状态 |
| 5 | interests 正常增长导致 hash 不等 | 改为“基线 ID/内容保留、允许增长”，不要求数组完全相同 |
| 6 | 最终 continuity 快照是未 await 的 Promise | `const continuity = await (...)` |
| 7 | 重启后立即提交表单，UI 尚未初始化 | 等待 `#provider-profile-list[aria-busy=false]` |
| 8 | **全部 PASS** | run `41859315790`：Ubuntu smoke、Windows smoke/product-path、Windows package/install、Windows upgrade 4/4 |

Windows product-path PASS run：`20261105T084141Z-45483dd6`（Electron 44.9.3，sandbox 启用，22 项检查）。

## 6. Git 记录

| 提交 | 内容 |
| --- | --- |
| `a34d797` | 合并 Stage 4 |
| `5091e02` | 合并 Provider + v49 桥接 |
| `d9b28ae` | Provider P1/P2 核心修复 |
| `c1f4450` | 产品路径/CI 修复、HTTP 状态证据 |
| `d07b3f4` | product-path 收敛（优雅退出、UI 就绪、continuity 语义） |
| `92bc4ed` | product-path 删除步骤等待面板渲染；最终 HEAD |
| `28665df` | 产品路径脚本、真实运行证据、CI |
| 后续 | 文档、独立复审、最终 PR 更新 |

## 7. 未完成/后续动作

1. 独立复审报告提交到本分支，并复审最终 HEAD。
2. 回填 PR #54 最终 head、CI 链接、复审 verdict。
3. 不合并、不发布、不修改 release/main。

## 8. 2026-11-05 收口轮（PR #54 评论）

### 8.1 基线

- 重新读取 PR #54：OPEN，head `884418b`，CI 4/4 PASS；工作树 clean。
- 复核历史问题：consent DeepSeek 文案、`response.text()` 先读后限、error hint 先读后截、continuity 只比部分字段、独立复审未覆盖本轮。
- 读取 UI 参考：`spatial.html`、`agentic-lab.html`、`designs-lab.html`、`_morrow/memory-vault.src.html`、`zcode-morrow/README.md`、`PROJECT-NOTES.md`；登记到 `docs/ui/reference-inventory.md`。

### 8.2 实现

- A：`consent-presentation.ts` + 6 组测试；`index.ts` 改用统一 presentation。
- B：`bounded-body.ts` + 10 组测试；discovery 1 MiB、error hint 4 KiB；新增无 Content-Length 超限测试。
- C：product-path 增加全字段 SQLite 快照/逐字段 diff/allowlist；CI run `20261105T084141Z-45483dd6` 三次 diff 全 0。
- UI：重写 `style.css`/`companion.css`，新增 `presence-ui.ts`（hero/轨道 canvas/主题/导航编号/设置索引）、`self-model-ui.ts`；保留全部既有 ID/IPC。
- UI 功能修正：聊天发送门禁使用默认/自定义 Provider；Provider 变更事件刷新聊天状态；官方 DeepSeek 卡不再宣称“聊天保持离线”。

### 8.3 验证

- `tsc --noEmit`: 0
- `vitest run`: 128 files / 1153 tests passed
- `npm run build`: passed
- CI run 41962719371（`019c2c2`）：4/4 PASS
- 最终 HEAD `eede520` CI run PR #54 最新 CI：4/4 PASS
- 截图：`docs/ui/evidence/20261105T084141Z-45483dd6/` 9 张真实 Electron 窗口
- 真实 Provider/本地服务：仍 BLOCKED_QUOTA / BLOCKED_LOCAL_SERVICE_NOT_RUNNING

### 8.4 已知限制

- Provider B 的受控请求由服务层测试覆盖；Electron 原生 consent 不能由 CDP 自动确认。
- 本机 Electron 宿主仍 0xC0000005，真实截图来自 CI Windows。
- 纸面主题是参考系统的第二翼；未收到单独主参考图，若后续提供需重新校准。
