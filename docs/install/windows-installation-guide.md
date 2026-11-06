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

## 7. 当前构建宿主的限制（必须阅读）

- NSIS 安装器已成功构建并记录 SHA256，但**未在本机执行安装**：本机已存在 Morrow 1.0.0（`F:\morrow1`，同一用户 appId/GUID），运行正式安装器会按设计卸载旧版，属于用户数据风险。
- 本机 Electron 运行时无法启动：最小 Electron 应用与打包后的 `Morrow.exe` 都在启动阶段以 `0xC0000005`（3221225477）退出，`electron.exe --version` 也以 exit 3 失败。这是宿主运行时/驱动/系统策略问题，不是 Morrow 产品代码或安装器构建失败。
- 因此“安装 → 启动 → 核心 smoke → 卸载”的真实验收必须在一台可正常启动 Electron 的标准 Windows 10/11 x64 桌面上完成；诊断步骤见 `docs/install/windows-troubleshooting.md`。
- 在完成该实机验收前，交付状态为 **PARTIAL / PENDING_USER_ACTION**，不是完整 Windows 安装版 PASS。
