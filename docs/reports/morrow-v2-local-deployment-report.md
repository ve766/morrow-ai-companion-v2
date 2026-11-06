> 历史记录：本文件保留 Issue #60 修订版当时的 BLOCKED 状态与证据，不随后续构建改写。当前对话运行闭环的产品状态、测试与真实 Provider 证据见 `docs/reports/morrow-v2-conversation-runtime-repair-report.md`。

# Morrow V2 本机部署与实机启动报告（Issue #60 修订版）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 代码 SHA：`07a82d5ff00c1cd0cfce450091fb7e5e1ef573ad`（parent `bb6eb8c`）
- 文档 HEAD：本文件所在提交（最终 full SHA 以 Issue #60 comment 为准）
- 最终状态：**BLOCKED**（V2 已部署并曾显示窗口/完成 UIA 验证，但宿主在数秒至数分钟内将其最小化；最终审计时不可见）

## 1. 根因（已定位并修复）

### 1.1 原仓库路径启动崩溃（宿主/路径交互，未完全归因）

- Electron 44.9.3 从原仓库 checkout 路径启动时 `--version` 失败、最小窗口 `0xC0000005`。
- 同一 Electron 44.9.3 复制到 `%LOCALAPPDATA%\et44\dist`（C:，无空格）可正常启动；Electron 35.7.5 复制到 E: 无空格、E: 短空格、C: 含空格、C: 长空格路径也均可启动。
- 因此**原仓库路径不可作为部署路径**，`%LOCALAPPDATA%\MorrowV2-LocalAcceptance` 部署可用；但具体触发因素未能用同一版本完整隔离，不能简化为“空格/驱动器/路径长度”。
- 应用 asar 从无空格部署路径仍会在强制沙箱启动时崩溃，见 1.2；这是本次真正修复的代码层原因。

### 1.2 `app.enableSandbox()` 在 Windows 26200 上强制沙箱启动

- 应用启动时无条件调用 `app.enableSandbox()`，即使传 `--no-sandbox`，仍会走 Windows 26200 的 sandbox 启动路径并崩溃。
- 最小启动探针（无 DB/服务、空白页）在 `new BrowserWindow` 后崩溃；加上验收专用 `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` + `--no-sandbox` 后，主进程执行到 `did-finish-load`，完整 UI 加载。
- Issue #59 的 `0xC0000005` 不是产品业务代码缺陷；是 Windows 26200 的强制沙箱启动路径（以及原仓库路径不可用）。

### 1.3 修复（默认行为不变）

- `src/app/index.ts`：
  ```ts
  if (process.env.MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX === '1') {
    app.commandLine.appendSwitch('no-sandbox')
  } else {
    app.enableSandbox()
  }
  ```
- 默认构建仍调用 `app.enableSandbox()`，正常用户保持沙箱。
- 本机验收仅使用显式环境变量 + `--no-sandbox`；不修改系统安全策略、不永久关闭 Defender/360。

## 2. V1 安全退役

### 2.1 备份

- 备份根：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\v1-retirement-backup\essential-20261106T090624Z\`
  - `app\`：74 个文件，386,629,322 bytes，canonical SHA256 `193784f4b981613c9f79782a9fc9dc3fe1fcc66d1e9b16b9ee18a536144be7d5`
  - `data\`：14 个文件，414,954 bytes，canonical SHA256 `015bf16ed872641271544673d24d8e08ab96df095f769816478d9afe8fbebb04`
  - `morrow.sqlite3`：存在，SQLite header 可读（未输出内容）
  - `backup-manifest.json`、`checksums.sha256`
- 另有一份完整 74 app/66 profile 的时间戳备份（Chromium 缓存文件在哈希时存在易变/被安全软件处理，完整备份保留；essential 备份为稳定校验集）。
- 未把 V1 数据导入 V2。

### 2.2 卸载

- 使用官方 `F:\morrow1\Uninstall Morrow.exe /S /currentuser`。
- 首次静默尝试 exit 0 但未生效：V2 正在运行，二者共享应用身份/互斥检查；停止本次验收 V2 后重试。
- 结果：
  - 卸载器 exit 0；
  - 旧版 HKCU 卸载键 `92ffd461-3512-54f9-8cf5-c344989830ea` 已不存在；
  - `F:\morrow1` 程序文件 0 个（目录保留为空）；
  - `%APPDATA%\morrow-ai-companion` 仍 66 个文件（历史数据未被删除）；
  - 备份保持完整。
- 证据：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\v1-retirement-result.json`。

## 3. V2 部署与启动

- Run ID：`final-1793955356`
- App：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356\`
- 数据：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\user-data\final-1793955356\`
- 日志/证据：`...\logs\final-1793955356\`、`...\evidence\final-1793955356\`
- `Morrow.exe`：246,820,352 bytes，SHA256 `e89d1a36a5744a89d0ef1f21db5b6e27038deabeb7c932763ee696f8ca96daef`
- 启动参数：`--no-sandbox --disable-gpu --force-renderer-accessibility --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --user-data-dir=<隔离目录>`；环境变量：
  - `MORROW_LOCAL_ACCEPTANCE_USER_DATA=<隔离目录>`
  - `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1`
- 窗口：`Morrow · AI 伴侣`，PID 20732；历史 `window-state.json` / `stability-steady.json` 记录 `iconic=false`、`visible=true`、`responding=true`、rect `410,160,1510,920`。
- 5 分钟可见稳定性（历史区间）：300 秒无交互采样，窗口保持可见/非最小化，Responding=true；证据 `stability-steady.json`。
- **最终可见性失败**：独立审计两次 60 秒轮询（60/60 样本）均为 `IsIconic=True`、rect `-32000,-32000,-31840,-31972`；topmost、`CalculateNativeWinOcclusion`/backgrounding 关闭、窗口 keeper 均未能保持可见。历史采样只证明“曾可见”，不能作为最终可见 PASS。
- 隔离证明：`morrow.sqlite3` 位于 V2 隔离 user-data；默认 `%APPDATA%\morrow-ai-companion` 未被 V2 写入（仍 66 个 V1 文件，含 V1 的 `morrow.sqlite3`，未删除）。

## 4. 真实 UI 验证

- 设置页：可打开，显示模型接入配置、官方 DeepSeek、本地模型、本地认知、备份恢复等区块；密钥只进入 OS 安全存储。
- 无 Provider 发送：状态显示“尚未配置 Provider”，未新增消息、未伪造 AI 回复。
- 记忆：写入非敏感测试记忆“验收测试记忆：Morrow V2 在本机 Build 26200 已启动”，保存成功；完全重启应用后仍存在。
- Provider 真实请求：用户尚未在 UI 内配置；`PENDING_USER_ACTION`。此前协议级 200/400 证据见 Issue #59，不代表本机 UI 验收。
- 证据：`ui-uia-final.json`（设置/记忆，11:06:11Z）与 `ui-chat-final.json`（无 Provider，11:06:46Z），PID 20732（不含聊天隐私/密钥）。

## 5. 测试与构建

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 130 files / 1159 tests passed / 0 failed / 0 skipped（176.86s） |
| `npm run build` | 0 | main/preload/renderer 成功 |
| `electron-builder --win dir --x64 --publish never -c.electronDist=node_modules/electron/dist` | 0 | unpacked app 生成 |
| 本机窗口启动 + 5 分钟可见稳定性（历史） | PASS（历史） | PID 20732，曾连续 300 秒可见/非最小化/Responding |
| 最终窗口可见性 | **FAIL** | 独立审计 60/60 样本 IsIconic=True、rect -32000 |
| 设置/无 Provider/记忆重启 | PASS | `ui-uia-final.json` |

## 6. 未完成项

- 用户手动体验（真实点击、聊天、设置浏览）尚未由用户本人确认：**PENDING_USER_ACTION**。
- Provider 真实配置/请求需用户在 UI 内自行授权：**PENDING_USER_ACTION**；Agent 不读取/索取 API key。
- V1 历史数据未迁移；备份保留，迁移需用户另行授权。
- 正式 NSIS 安装器未在本机执行（V1 已退役但 V2 采用 side-by-side 部署；安装器执行需用户明确确认）。

## 7. 用户操作

V2 窗口已打开并保持运行。请直接在窗口中：

1. 浏览对话、记忆与来源、目标与提醒、设置与备份。
2. 在设置中自行配置 Provider（如需要），或在无 Provider 状态下确认错误反馈是否清楚。
3. 体验完成后告知结果；如需重启，关闭窗口后重新运行：

```powershell
$root = Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance'
$run = 'final-1793955356'
$env:MORROW_LOCAL_ACCEPTANCE_USER_DATA = Join-Path $root "user-data\$run"
$env:MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX = '1'
& (Join-Path $root "app\$run\Morrow.exe") --no-sandbox --disable-gpu "--user-data-dir=$($env:MORROW_LOCAL_ACCEPTANCE_USER_DATA)"
```

## 8. 状态

**BLOCKED**：V1 已安全退役并备份；V2 已部署，窗口曾真实显示，UIA/记忆/设置/无 Provider 验证通过，历史上也有 300 秒可见采样。但宿主会在约 5–90 秒内把窗口最小化；topmost、`CalculateNativeWinOcclusion`/backgrounding 关闭、窗口 keeper 均未能保持可见，独立审计 60/60 样本 `IsIconic=True`、rect `-32000,-32000,-31840,-31972`。因此最终可见窗口验收 **BLOCKED**，不能标记 DEPLOYED_USER_TEST_PENDING 或 COMPLETE。用户可点击任务栏 Morrow 图标临时恢复窗口。
