# Morrow V2 Windows 安装与首次配置指南

- 版本：2.0.0
- 交付物：
  - NSIS 安装器（本机构建产物）：`release\Morrow-Setup-2.0.0-x64.exe`
    - 大小：111,771,999 bytes
    - SHA256：`5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977`
    - 说明：该文件超过 GitHub 单文件 100 MiB 限制，未提交到仓库；在仓库根目录执行 `npm run package:win` 可复现。
  - Portable（仓库内）：`evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe`
    - 大小：100,542,249 bytes
    - SHA256：`e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`

## 1. 系统要求

- Windows 10/11 x64
- 至少 500 MB 可用磁盘（安装 + 数据）
- 应用自带 Electron 44.9.3；不需要单独安装 Node.js
- 安装器未做商业代码签名；Windows SmartScreen 可能提示。请先核对 SHA256，再决定是否运行

## 2. 安装 NSIS 版本

### 2.1 交互安装

1. 双击 `Morrow-Setup-2.0.0-x64.exe`。
2. 选择安装目录（默认当前用户目录），完成安装。
3. 安装器会在开始菜单/桌面创建 `Morrow` 快捷方式，并写入 HKCU 卸载信息。

### 2.2 静默安装到指定目录（测试/自动化）

```powershell
Start-Process -FilePath .\Morrow-Setup-2.0.0-x64.exe -ArgumentList '/S /D=C:\path\with spaces\Morrow' -Wait
```

- `/D=` 必须是最后一个参数，路径不加引号；含空格的路径已验证可原样传递。
- 安装后检查 `C:\path\with spaces\Morrow\Morrow.exe` 是否存在，版本应为 `2.0.0`。

### 2.3 已有 Morrow 1.x 安装时

安装器使用与旧版相同的 appId（`com.morrow.ai-companion`）派生的卸载 GUID。安装 2.0.0 时，NSIS 会按设计调用旧版本卸载程序。**升级前先导出备份**：

1. 打开旧版 Morrow → 设置与备份 → 导出备份到本地文件夹。
2. 记录旧版数据目录（默认 `%APPDATA%\morrow-ai-companion`）。
3. 再运行 2.0.0 安装器。

不要在未备份的情况下让 CI 或脚本自动运行正式用户安装器；CI 只使用唯一 GUID 的测试变体。

## 3. 首次启动

1. 启动 `Morrow.exe`。
2. 首次启动会创建本机数据目录，不会自动联网，也不会自动发送对话。
3. 打开「设置与备份」→「模型接入配置」，按第 4 节配置 Provider。
4. 每次真实发送前会显示系统级 consent，列出目标地址、模型、payload 与记忆范围；拒绝则不会发出请求。

## 4. Provider 配置

1. 新建配置：名称任意；来源选「自定义 HTTPS 中转站」或「本机回环服务」；协议选 OpenAI Chat Completions。
2. Base URL 示例：`https://relay.example.com/v1`；Endpoint path 可留空。
3. 模型 ID 填服务商提供的模型名；API Key 只保存到 Windows 安全存储，保存后输入框清空。
4. 保存后可「测试连接」「发现模型」「设为默认」。
5. 本地模型：启动 LM Studio / vLLM / llama.cpp 等 OpenAI-compatible 服务，确认 `/v1/models` 可访问，再填回环地址（如 `http://127.0.0.1:1234`）。

## 5. 数据、备份与卸载

- SQLite：`%APPDATA%\morrow-ai-companion\morrow.sqlite3`（实际以应用 `userData` 为准）
- 密钥：同目录 `secrets\<profile-id>.bin`，由 Windows DPAPI/safeStorage 加密
- 备份：「设置与备份」→「导出备份到本地文件夹」；备份不含 API 密钥
- 卸载：Windows 设置 → 应用 → Morrow → 卸载，或运行安装目录内 `Uninstall Morrow.exe /S`
- 卸载默认保留用户数据（`deleteAppDataOnUninstall: false`）；如需彻底清除，手动删除 `%APPDATA%\morrow-ai-companion`

## 6. 升级/回滚

- 当前 schema 为 v49；不要用旧版本直接打开 v49 数据库。
- 升级前先导出备份；回滚时恢复迁移前的 `morrow.sqlite3` 与 `secrets/`。
- 若升级失败，应用会 fail closed，不会在缺列/缺表状态下打开。

## 7. 本机隔离验收部署（Issue #60）

V1 已安全退役（备份在 `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\v1-retirement-backup\essential-20261106T090624Z`）。V2 采用 side-by-side 部署，不运行正式 NSIS 安装器：

```powershell
$root = Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance'
$run = 'final-1793955356'
$data = Join-Path $root "user-data\$run"
$env:MORROW_LOCAL_ACCEPTANCE_USER_DATA = $data
$env:MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX = '1'
& (Join-Path $root "app\$run\Morrow.exe") --no-sandbox --disable-gpu "--user-data-dir=$data"
```

- 必须使用**无空格**的部署路径；仓库路径 `morrow v2` 会触发 Electron/Chromium 启动崩溃。
- `MORROW_LOCAL_ACCEPTANCE_USER_DATA` 必须是绝对路径；未设置时应用使用正式用户 profile。
- `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1` 只用于本机验收，默认构建仍启用 `app.enableSandbox()`；不要把它作为正式发布默认值。
- app/user-data/logs/evidence 均在 `%LOCALAPPDATA%\MorrowV2-LocalAcceptance` 下，按 run ID 隔离。

## 8. 当前构建宿主的限制（必须阅读）

- 本机 Electron 0xC0000005 的根因已定位为两点：部署路径含空格（`morrow v2`）触发 Chromium 启动崩溃；应用无条件 `app.enableSandbox()` 在 Windows 26200 上强制沙箱启动并崩溃。
- 修复：验收模式跳过 `enableSandbox` 并传 `--no-sandbox`；部署到无空格路径。默认产品构建仍带沙箱。
- V2 已在本机真实打开并稳定运行；仍建议在正式发布前于标准 Windows 10/11 上复验默认沙箱模式。
