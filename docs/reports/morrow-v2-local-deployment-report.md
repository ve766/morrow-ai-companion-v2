# Morrow V2 本机部署与实机启动报告（Issue #60 修订版）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 代码 SHA：本文件所在提交（最终 full SHA 以 Issue #60 comment 为准）
- 最终状态：**DEPLOYED_USER_TEST_PENDING**（V2 窗口已真实打开并稳定运行；用户手动体验与 Provider 配置待用户完成）

## 1. 根因（已定位并修复）

### 1.1 路径中的空格导致 Electron/Chromium 启动崩溃

- 同一份 Electron 44.9.3：
  - 从 `E:\Hasee\Documents\morrow v2\...\repo\.tmp\...` 启动：`--version` 失败、最小窗口 `0xC0000005`。
  - 从 `%LOCALAPPDATA%\et44\dist\electron.exe` 启动：`--version` 返回 `v44.9.3`，最小窗口正常显示。
- 因此仓库路径中的空格（`morrow v2`）是崩溃触发条件之一；部署必须使用无空格路径。

### 1.2 `app.enableSandbox()` 在 Windows 26200 上强制沙箱启动

- 应用启动时无条件调用 `app.enableSandbox()`，即使传 `--no-sandbox`，仍会走 Windows 26200 的 sandbox 启动路径并崩溃。
- 最小启动探针（无 DB/服务、空白页）在 `new BrowserWindow` 后崩溃；加上验收专用 `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` + `--no-sandbox` 后，主进程执行到 `did-finish-load`，完整 UI 加载。
- Issue #59 的 `0xC0000005` 不是产品业务代码缺陷；是宿主沙箱路径 + 路径空格。

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
- 启动参数：`--no-sandbox --disable-gpu --user-data-dir=<隔离目录>`；环境变量：
  - `MORROW_LOCAL_ACCEPTANCE_USER_DATA=<隔离目录>`
  - `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1`
- 窗口：`Morrow · AI 伴侣`，主窗口可见、Responding=true。
- 5 分钟稳定性（V1 退役后重新启动）：PID 15068，300 秒采样，窗口存活、响应正常；证据 `stability.json`。
- 隔离证明：`morrow.sqlite3` 位于 V2 隔离 user-data；默认 `%APPDATA%\morrow-ai-companion` 未变化。

## 4. 真实 UI 验证

- 设置页：可打开，显示模型接入配置、官方 DeepSeek、本地模型、本地认知、备份恢复等区块；密钥只进入 OS 安全存储。
- 无 Provider 发送：状态显示“尚未配置 Provider”，未新增消息、未伪造 AI 回复。
- 记忆：写入非敏感测试记忆“验收测试记忆：Morrow V2 在本机 Build 26200 已启动”，保存成功；完全重启应用后仍存在。
- Provider 真实请求：用户尚未在 UI 内配置；`PENDING_USER_ACTION`。此前协议级 200/400 证据见 Issue #59，不代表本机 UI 验收。
- 证据：`ui-evidence.json`（不含聊天隐私/密钥）。

## 5. 测试与构建

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 130 files / 1159 tests passed / 0 failed / 0 skipped（176.86s） |
| `npm run build` | 0 | main/preload/renderer 成功 |
| `electron-builder --win dir --x64 --publish never -c.electronDist=node_modules/electron/dist` | 0 | unpacked app 生成 |
| 本机窗口启动 + 5 分钟稳定性 | PASS | PID 15068，窗口可见，Responding=true |
| 设置/无 Provider/记忆重启 | PASS | `ui-evidence.json` |

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

**DEPLOYED_USER_TEST_PENDING**：V1 已安全退役并备份；V2 在用户当前 Windows 11 Build 26200 电脑上真实打开、5 分钟稳定、UI 与记忆重启通过；用户手动体验与 Provider 配置待完成。不是 COMPLETE。
