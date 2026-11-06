# Morrow V2 本机部署验收矩阵（Issue #60）

- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`
- 最终状态：**BLOCKED**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 本机预检（Windows/x64/session/Node/磁盘） | PASS | `host.txt`；Windows 10.0.26200，session 1，C: 29.5 GB |
| 2 | 仓库/分支/HEAD 与 PR #54 一致 | PASS | `feat/morrow-v2-final-closure` @ `2ffb697`；PR OPEN |
| 3 | 代码 SHA/产物 SHA 一致 | PASS | 部署 `Morrow.exe` `42749ba5…` = 构建产物 |
| 4 | typecheck/tests/build | PASS | typecheck 0；130 files / 1159 tests；build 0 |
| 5 | 隔离部署目录唯一、新建、路径受控 | PASS | `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\<runId>` |
| 6 | 显式 userData/sessionData 隔离 | PASS | `MORROW_LOCAL_ACCEPTANCE_USER_DATA` + `--user-data-dir`；`morrow.sqlite3` 在隔离目录 |
| 7 | 默认用户 profile 不被写入 | PASS | `%APPDATA%\morrow-ai-companion` 66 文件、mtime 未变 |
| 8 | 旧版 Morrow 1.0.0 目录不被修改 | PASS | 74 文件 canonical hash 前后一致 |
| 9 | 旧版注册表卸载项不被修改 | PASS | 快照 SHA256 前后一致 |
| 10 | Electron 窗口真实可见 | **BLOCKED** | `0xC0000005`，无窗口；最小 Electron 亦崩溃 |
| 11 | 60 秒稳定性 | **BLOCKED** | 启动即退出，无法进入稳定期 |
| 12 | 用户手动交互（聊天/设置/Provider） | **PENDING_USER_ACTION** | 依赖窗口；本机无法启动 |
| 13 | Provider 真实链路（UI 内授权） | **PENDING_USER_ACTION** | 本任务未在 UI 配置；Issue #59 协议级 200/400 仅作历史证据 |
| 14 | 记忆写入/重启连续性 | **BLOCKED** | DB 已创建，但无窗口无法完成 UI 写入/重启验收 |
| 15 | 卸载/清理安全 | N/A（side-by-side） | 未安装、未卸载；仅部署唯一 run 目录，可安全删除 |
| 16 | 独立审计最终 SHA + 本机证据 | PASS（无 BLOCKER/HIGH） | `docs/audit/morrow-v2-local-deployment-independent-review.md`；审计确认旧版保护、隔离、版本/哈希与 BLOCKED 结论 |
| 17 | 最终状态 | **BLOCKED** | 部署/隔离 PASS；窗口启动被宿主 Electron 阻塞 |

## 结论

隔离部署与数据保护真实通过；Electron 窗口启动因本机 Windows 26200 运行时崩溃无法完成。最终 **BLOCKED**，不是 DEPLOYED_AND_RUNNING，也不是本机实机验收完成。
