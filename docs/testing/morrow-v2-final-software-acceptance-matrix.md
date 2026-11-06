# Morrow V2 最终软件交付验收矩阵（Issue #59）

- 基线 HEAD：`1acd646227f7c7fa63ea041d49c52085ea0eba2f`
- 最终状态：**PARTIAL**

## 软件交付

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 正式 NSIS x64 安装器可构建、文件存在、SHA256 可复算 | PASS | `release\Morrow-Setup-2.0.0-x64.exe`，111,771,999 bytes，`5aeb4027…` |
| 2 | 安装器在隔离 Windows 环境真实安装 | **PENDING_USER_ACTION** | 本机存在同 appId 旧版 `F:\morrow1`，未执行以免卸载用户安装 |
| 3 | 安装后 `Morrow.exe` 可启动并通过 smoke | **BLOCKED_HOST_ELECTRON_RUNTIME** | 打包/未打包/最小 Electron 均 0xC0000005 或段错误 |
| 4 | 首次启动、聊天、Provider 配置/错误反馈、记忆持久化/重启 | **BLOCKED_HOST_ELECTRON_RUNTIME** | 依赖 Electron 启动；代码层 1156 tests 通过 |
| 5 | 卸载只影响本次测试安装、用户数据不受影响 | **PENDING_USER_ACTION** | 依赖安装；CI 变体已用唯一 GUID 隔离 |
| 6 | 安装说明与实际安装器/数据路径/卸载行为一致 | PASS | `docs/install/windows-installation-guide.md` |
| 7 | 故障排除指南 | PASS | `docs/install/windows-troubleshooting.md` |

## CI / 隔离

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 8 | 动态 GUID 每次 run 唯一 | PASS | 50 次身份探针；`New-CiInstallerIdentity` |
| 9 | 动态 GUID 被最终安装器实际采用 | **PENDING_USER_ACTION** | 构建参数注入与无空格 `shortcutName=MorrowCI` 已验证；本机 CI 变体构建仍被宿主拦截（exit code null） |
| 10 | Run A cleanup failure 后 Run B 不改 A 的安装/归档 | PASS（探针） | 6 文件 SHA256/length/mtime、manifest/checksums 全部不变 |
| 11 | 正式用户身份与 CI 身份不同 | PASS | appId 分离 + 唯一 GUID；本机旧版 GUID `92ffd461…` |
| 12 | 全量测试/typecheck/evaluate/build/smoke/persistence/NSIS 退出码 | PASS（smoke 除外） | typecheck 0；1156 tests；evaluate 0；build 0；smoke BLOCKED |
| 13 | 当前 runner 未注册时 PENDING_USER_ACTION | PASS（状态如实） | `actions/runners=0` |
| 14 | 无 hosted run、无新增 storage、无 secrets | PASS | 未 dispatch；未 upload；密钥未入库 |

## 交付质量

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 15 | 独立审计针对最终代码 SHA | **PENDING** | 审计报告完成后更新 |
| 16 | 审计检查安装身份/跨运行/NSIS 边界/进程树/workflow/回归/SHA | **PENDING** | 同上 |
| 17 | BLOCKER/HIGH 修复并复测 | **PENDING** | 同上 |
| 18 | 最终状态 COMPLETE/PARTIAL/BLOCKED/FAILED | **PARTIAL** | 安装器已构建；实机安装/启动/卸载未完成 |

## 结论

正式 NSIS 安装器已构建并可复核；动态安装身份与跨运行隔离通过探针；产品测试与真实 Provider 请求通过。实机安装/启动/卸载被宿主 Electron 运行时和本机旧版安装阻塞，self-hosted run 待 Runner 注册。整体 **PARTIAL**，不是 COMPLETE，不是 CI PASS。
