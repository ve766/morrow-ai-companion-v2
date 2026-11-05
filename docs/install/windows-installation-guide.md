# Morrow V2 Windows 安装与首次配置指南

- 版本：2.0.0
- RC 类型：Windows x64 portable（NSIS 安装包在当前构建宿主被阻断）
- Portable 文件：`evals/morrow-v2-rc/installers/2.0.0/Morrow-2.0.0-x64-portable.exe`
- SHA256：`fd584ffd53f74ffb3d7c93804a8d92a308a84c7ffb2d04b9da7532f73e8ab1da`
- 大小：100,541,544 bytes

## 1. 系统要求

- Windows 10/11 x64
- 至少 400 MB 可用磁盘（portable 解压与数据）
- 本机需要可用的 WebView/Electron 运行环境；应用自带 Electron 44.9.3
- 当前 RC 未在本机完成安装后启动验证；若双击无窗口，请记录错误并等待下一 RC

## 2. 运行 portable RC

1. 将 `Morrow-2.0.0-x64-portable.exe` 复制到一个可写目录。
2. 双击运行。portable 会解压到临时目录并启动 Morrow。
3. 首次启动会创建本机数据目录；不会自动联网，也不会自动发送任何对话。
4. 若 Windows SmartScreen 提示，请先核对 SHA256 再决定是否运行。

## 3. 首次配置

1. 打开「设置与备份」→「模型接入配置」。
2. 新建配置：
   - 名称：任意
   - 来源：自定义 HTTPS 中转站 或 本机回环服务
   - 协议：OpenAI Chat Completions
   - Base URL：例如 `https://relay.example.com/v1`
   - Endpoint path：可留空；`/v1` 或 `/v1/chat/completions` 均可
   - 模型 ID：服务商提供的模型名
   - API Key：仅保存到 Windows 安全存储；保存后输入框清空
3. 保存后可「测试连接」「发现模型」「设为默认」。
4. 每次真实发送前仍会弹出系统级 consent，显示实际目标、模型、payload 与记忆；拒绝则不会发出请求。

## 4. 本地模型

1. 启动 LM Studio / vLLM / llama.cpp 等 OpenAI-compatible 服务，确认 `/v1/models` 可访问。
2. 在「本地模型（OpenAI 兼容）」填写回环地址（如 `http://127.0.0.1:1234`）和模型名。
3. 本机服务不需要 API Key；若设置了访问口令，可填入可选口令。
4. 没有显式默认 Provider 时，本地模型优先于 DeepSeek；有显式默认 Provider 时以默认为准。

## 5. 数据与密钥位置

- SQLite：`%APPDATA%\morrow-ai-companion\morrow.sqlite3`（实际以应用 `userData` 为准）
- 密钥：同目录 `secrets\<profile-id>.bin`，由 Windows DPAPI/safeStorage 加密
- 应用不会把密钥写入 SQLite、日志、consent 正文或导出备份
- 备份：「设置与备份」→「导出备份到本地文件夹」；备份不含 API 密钥

## 6. 升级/回滚

- 当前 RC schema 为 v49；不要用旧版本直接打开 v49 数据库。
- 升级前先导出备份；回滚时恢复迁移前备份的 `morrow.sqlite3` 与 `secrets/`。
- 若从旧版升级失败，应用会 fail closed，不会在缺列/缺表状态下打开。

## 7. 已知限制

- NSIS 安装包在当前宿主未产出；portable RC 是当前可运行产物。
- 本机 Electron 宿主 0xC0000005，未完成安装后启动/截图验证。
- 真实 Provider 额度为 BLOCKED_QUOTA；本地模型服务未运行。
- 最终 RC SHA 的 GitHub Actions 为 0-step 基础设施失败；父代码 CI 4/4 PASS。
- 详细状态见 `docs/reports/morrow-v2-rc-delivery-report.md` 与 `docs/testing/morrow-v2-rc-acceptance-matrix.md`。
