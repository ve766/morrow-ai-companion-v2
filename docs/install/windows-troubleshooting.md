# Morrow V2 Windows 故障排除

## 1. 启动时 0xC0000005（3221225477）

### 现象

- 双击 `Morrow.exe` 无窗口，进程退出码 `3221225477`（十六进制 `0xC0000005`）。
- `scripts/smoke.mjs` 报 `Built application exited during launch (3221225477)`。
- 打包后的 `release\win-unpacked\Morrow.exe` 与未打包的 `node_modules\electron\dist\electron.exe` 都可能出现。

### 已定位的 Morrow 根因（2026-11-06）

- **路径含空格**：同一 Electron 44.9.3 从 `%LOCALAPPDATA%\et44\dist` 启动正常（`--version` v44.9.3、最小窗口可见）；从仓库路径 `E:\...\morrow v2\...` 启动则 `0xC0000005`。部署必须使用无空格路径。
- **强制沙箱**：应用无条件调用 `app.enableSandbox()`，即使传 `--no-sandbox` 仍走 Windows 26200 的 sandbox 启动路径并崩溃。应用 asar 在最小启动（空页面、无 DB）时仍在 `new BrowserWindow` 后崩溃；加上验收专用 `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 后主进程到达 `did-finish-load`，完整 UI 加载。
- 修复：仅验收模式跳过 `enableSandbox` 并追加 `no-sandbox`；默认构建仍启用沙箱。V1 已安全退役并备份，V2 已在本机真实打开并稳定运行。

### Windows 11 build 26200 已知问题

Windows 11 build 26200（25H2/Insider 系列）已有公开的 Electron/Chromium 启动或退出崩溃报告：

- electron/electron#55011：Windows 11 25H2 build 26200，Electron 43/44 在 `app.exit` 时偶发 `0xC0000005` / `0x80000003`。
- MicrosoftEdge/WebView2Feedback#5777：build 26200 上 Chromium GPU/Audio utility 进程崩溃循环。
- OpenAI Codex Desktop #29425：build 26200 上 Electron 启动即 `0xC0000005`，含 `chrome.dll`/sandbox 初始化失败。

这些是宿主层面的兼容性背景；Morrow 侧可通过“无空格部署 + 验收模式跳过强制沙箱”稳定启动。

### 本机隔离验收启动方式

```powershell
$root = Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance'
$run = 'final-1793955356'
$data = Join-Path $root "user-data\$run"
$env:MORROW_LOCAL_ACCEPTANCE_USER_DATA = $data
$env:MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX = '1'
& (Join-Path $root "app\$run\Morrow.exe") --no-sandbox --disable-gpu "--user-data-dir=$data"
```

`MORROW_LOCAL_ACCEPTANCE_USER_DATA` 只接受绝对路径；未设置时使用正式用户 profile。`MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 仅用于本机验收，默认构建仍带沙箱；不要把它作为正式发布默认值。V1 已退役，备份在 `v1-retirement-backup\essential-20261106T090624Z`。

### 用户侧诊断步骤

1. 确认系统为 Windows 10/11 x64，且已安装最新 VC++ 2015–2022 x64 运行库。
2. 更新显卡驱动；笔记本双显卡可尝试在 NVIDIA/AMD 控制面板中为 `Morrow.exe` 指定集成显卡或独显。
3. 以普通用户（非管理员、非兼容模式）运行；不要在 Windows Sandbox/远程会话/无桌面会话中运行。
4. 尝试禁用 GPU：
   ```powershell
   .\Morrow.exe --disable-gpu --no-sandbox
   ```
5. 查看事件查看器 → Windows 日志 → 应用程序，筛选 `Morrow.exe` / `electron.exe` 的 Application Error，记录 faulting module。
6. 若以上均失败，在一台标准桌面 Windows 10/11 上重试；本机运行时不具备可修复的仓库代码路径。

## 2. NSIS 安装器构建失败（electron-builder）

### 现象

`npm run package:win` 在 `building target=nsis` 后报：

```
ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
Command failed: ...\Morrow-Setup-2.0.0-x64.exe
Exit code: null
```

### 已确认的原因

- electron-builder 26.15.3 在构建 NSIS 时会先执行中间安装器以提取 uninstaller。
- 在本机，只要对构建配置做**任何 CLI 覆盖**（包括 `-c.nsis.oneClick=false` 这类与 package.json 相同的值），或改变输出目录/产物名，该中间安装器就会被宿主以 exit code null 终止；无覆盖的默认构建可以成功。
- 关闭快捷方式的 `-c.nsis.createDesktopShortcut=false` 也能单独复现。
- 这是宿主执行策略/安全软件对新建可执行文件的拦截与 electron-builder 中间步骤的组合问题，不是 Morrow 的 NSIS 脚本语法错误。

### 处理

- 正式用户安装器使用默认配置构建：`npm run package:win`。
- CI 测试安装器使用唯一 GUID，并把快捷方式改名为 `MorrowCI`（不再关闭快捷方式）；仍需在可执行新构建产物的 Runner/桌面上运行。
- 若在用户 Runner 上仍失败，先在该机器手动运行一次 `release\Morrow-Setup-2.0.0-x64.exe` 并在 SmartScreen/杀软中允许，再重试；不要关闭系统安全策略作为默认方案。

## 3. 安装器会卸载已有 Morrow 1.x

- 正式安装器使用 appId `com.morrow.ai-companion` 派生的固定 GUID；NSIS 会在安装前卸载同 GUID 的旧版。
- 升级前先导出备份，并记录 `%APPDATA%\morrow-ai-companion`。
- CI 测试安装器使用每次运行随机 GUID + appId `com.morrow.ai-companion.ci`，不会匹配正式安装。

## 4. 安装后无数据/旧数据不见

- 卸载默认不删除用户数据；重装后仍使用 `%APPDATA%\morrow-ai-companion`。
- 如果使用了不同的 Windows 用户或不同的 `--user-data-dir`，数据目录会不同。
- 不要手工删除 `secrets\`，否则已保存的 Provider 密钥无法解密。

## 5. Provider 请求失败

- 401/403：检查 API Key、模型权限与 quota；本任务真实请求已记录 200 成功与 400 invalid-model 错误路径。
- 400 `no category route found`：模型名不被该 endpoint 接受，换用服务商给出的模型 ID。
- 连接超时：检查 Base URL、代理、TLS 证书；应用不会在 consent 之前发出请求。
- 本地服务：确认 `http://127.0.0.1:<port>/v1/models` 可访问，再在设置中测试连接。

## 6. 自托管 CI 未运行

- 若 GitHub Actions 没有 self-hosted runner，workflow 会保持 queued；先按 `docs/ci/self-hosted-runner-setup-windows.md` 注册 Runner。
- 不要反复点击 Run workflow；不要切回 GitHub-hosted runner。
- 结果在 `%LOCALAPPDATA%\Morrow\CI\<timestamp>-<sha>-<runId>\run-manifest.json`。
