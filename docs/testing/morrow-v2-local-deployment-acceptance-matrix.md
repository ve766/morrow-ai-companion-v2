# Morrow V2 本机部署验收矩阵（Issue #60 修订版）

- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 最终状态：**DEPLOYED_USER_TEST_PENDING**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 本机预检（Windows/x64/session/Node/磁盘） | PASS | Windows 10.0.26200，Session 1，Node 22.23.2 |
| 2 | 仓库/分支/HEAD 与 PR #54 一致 | PASS | `feat/morrow-v2-final-closure` @ `2ffb697`；PR OPEN |
| 3 | 部署产物 SHA 一致 | PASS | `Morrow.exe` `e89d1a36…` |
| 4 | typecheck / 全量测试 / build | PASS | typecheck 0；130 files / 1159 tests；build 0 |
| 5 | V1 数据备份已完成且可校验 | PASS | essential 备份 74 app/14 data；DB 可读；manifest/checksums |
| 6 | V1 应用已安全卸载 | PASS | 官方卸载器 exit 0；HKCU 键不存在；`F:\morrow1` 0 文件 |
| 7 | V1 profile 历史数据保留 | PASS | `%APPDATA%\morrow-ai-companion` 66 文件 |
| 8 | V2 side-by-side 部署、无 V1 身份冲突 | PASS | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356` |
| 9 | V2 userData/database 隔离 | PASS | `morrow.sqlite3` 在 V2 隔离目录；默认 profile 未变 |
| 10 | V2 窗口真实可见 | PASS | `Morrow · AI 伴侣`，PID 15068 |
| 11 | 5 分钟稳定性 | PASS | `stability.json` 300 秒，Responding=true |
| 12 | 设置页可打开、Provider 区块可见 | PASS | `ui-evidence.json` |
| 13 | 无 Provider 时明确反馈、不伪造回复 | PASS | 状态“尚未配置 Provider”，无新消息 |
| 14 | 记忆写入 + 完全重启后仍存在 | PASS | 测试记忆保存在 V2 隔离 DB，重启后可见 |
| 15 | Provider 真实 UI 配置/请求 | **PENDING_USER_ACTION** | 用户未在 UI 内配置；不读取/索取 key |
| 16 | 用户手动体验（点击/聊天/设置） | **PENDING_USER_ACTION** | 窗口已留给用户 |
| 17 | 正式 NSIS 安装器执行 | **PENDING_USER_ACTION** | V2 采用 side-by-side；未执行正式安装器 |
| 18 | 独立审计最终 SHA + 本机证据 | **PENDING** | 审计报告完成后更新 |
| 19 | 最终状态 | **DEPLOYED_USER_TEST_PENDING** | 部署/启动/UI/持久化通过；用户与 Provider 待完成 |

## 结论

V1 已安全退役并保留可校验备份；V2 在用户当前 Windows 11 Build 26200 电脑上真实打开、5 分钟稳定、设置/无 Provider/记忆重启通过。Provider 与用户手动体验为 **PENDING_USER_ACTION**。整体 **DEPLOYED_USER_TEST_PENDING**，不是 COMPLETE。
