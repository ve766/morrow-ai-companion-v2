# Morrow V2 本机部署与实机启动报告（Issue #60）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`2ffb697cff3491a0f67080a35bb163f87603ca4b`（parent `463dd99`）
- 代码 SHA：本文件所在提交（最终 full SHA 以 Issue #60 comment 为准）
- 最终状态：**BLOCKED**（隔离部署与数据隔离完成；Electron 窗口在本机 Windows 26200 上无法启动）

## 1. 本机预检

| 项 | 值 |
| --- | --- |
| Windows | Microsoft Windows NT 10.0.26200.0，x64 |
| 会话 | Session 1，交互式 console；explorer 与 notepad 可正常启动 |
| 用户 | `DESKTOP-UOJAHMG\Hasee`（非管理员提权） |
| Node / npm | v22.23.2 / 10.9.8 |
| 磁盘 | C: 29.5 GB 可用 |
| 仓库 | 分支 `feat/morrow-v2-final-closure`，HEAD `2ffb697`，工作区有本次部署改动 |
| 旧版 | `F:\morrow1`，Morrow 1.0.0，74 个文件，386,629,322 bytes；HKCU 卸载键 `92ffd461-3512-54f9-8cf5-c344989830ea` |
| 默认用户数据 | `%APPDATA%\morrow-ai-companion`，66 个文件，最新 mtime 2026-10-29T07:59:02Z |

## 2. 数据隔离实现

新增 `MORROW_LOCAL_ACCEPTANCE_USER_DATA`（绝对路径）：

- `src/app/acceptance-data-path.ts`：只接受绝对路径；空/未设置返回 null；相对路径抛错，绝不回退到正式 profile。
- `src/app/index.ts`：在 `app.whenReady()` 之前调用 `app.setPath('userData', ...)` 与 `app.setPath('sessionData', ...)`。
- 启动参数同时传 `--user-data-dir=<隔离目录>`，双保险。
- 测试：`tests/acceptance-data-path.test.ts` 3 项；全量 **130 files / 1159 tests passed / 0 failed / 0 skipped**（182.32s）；typecheck exit 0。

## 3. 隔离部署

- Run ID：`8d94195efd014ae49d0fa224a9022294`
- App 目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\8d94195efd014ae49d0fa224a9022294`
- 数据目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\user-data\8d94195efd014ae49d0fa224a9022294`
- 日志目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\logs\8d94195efd014ae49d0fa224a9022294`
- 证据目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\8d94195efd014ae49d0fa224a9022294`
- 来源：`release-local\win-unpacked`（`npx electron-builder --win dir --x64 --publish never`，exit 0）
- 部署后 `Morrow.exe`：246,819,840 bytes，SHA256 `42749ba5833aa6c8d371135002705931ebaa013a424d8613575a4b1268862b98`，与构建产物一致。
- 未运行正式 NSIS 安装器；未触碰 `F:\morrow1` 与旧版注册表。

## 4. 启动结果

启动参数：`--user-data-dir=<隔离目录> --no-sandbox --disable-gpu`，环境变量 `MORROW_LOCAL_ACCEPTANCE_USER_DATA=<隔离目录>`。

- 15 秒等待：进程已退出，exit code `-1073741819` / `0xC0000005`。
- 无窗口（`MainWindowTitle` 为空）。
- WER：APPCRASH `Morrow.exe 2.0.0.0`，异常 `0xc0000005`，faulting module `Morrow.exe`，offset `0x357db3a`。
- 追加 6 组启动参数（`--in-process-gpu`、`--disable-gpu-compositing`、`--single-process`、`--no-zygote`、`--disable-features=VizDisplayCompositor,AudioServiceOutOfProcess,UseSkiaRenderer`、`--use-angle=swiftshader`）全部失败：5 次 `0xC0000005`、1 次 `0x80000003`，均无窗口。
- 独立最小 Electron 验证：44.9.3 / 44.10.2 / 45.2.3 的 `--version` 均 exit 3 / `0x80000003`；无 Morrow 代码的最小窗口应用 15 秒内 `0xC0000005`。
- 结论：本机 Windows 11 build 26200 的 Electron/Chromium 运行时无法启动，与 Morrow 产品代码、数据库、Provider 无关。该 build 的 Electron 启动/退出崩溃已有公开报告（electron#55011、WebView2Feedback#5777 等），不是仓库可在 24h 内安全修复的问题；任务禁止关闭系统安全策略绕过。

## 5. 数据隔离与旧版保护证据

尽管窗口未启动，主进程已执行到创建数据库：

- 隔离 user-data 目录包含 **60 个文件**，包括 `morrow.sqlite3`、`morrow.sqlite3-shm`、`morrow.sqlite3-wal`、`Local State`、`Local Storage`、`Cache`、`GPUCache` 等。
- 默认 `%APPDATA%\morrow-ai-companion` 仍为 **66 个文件**，最新 mtime 未变（`2026-10-29T07:59:02Z`）。
- `F:\morrow1` 部署前后均为 **74 个文件**，文件清单 SHA256 canonical hash 均为 `206f9a593ee5032f68145372556cf89ef7b0a15f67b224410479b97c191dac91`。
- HKCU 卸载键 `92ffd461-...` 部署前后 DisplayName/Version/InstallLocation/UninstallString 完全一致，快照 SHA256 均为 `d0c7c12f2e74903a48e6cfc0c45a80508fd1851471c3ff9ac895cad6144a6bb8`。
- 因此：新版数据确实写入隔离目录，旧版安装目录、注册表、默认用户数据均未被读取/修改/删除。

## 6. 未完成项

- Electron 窗口可见、60 秒稳定性、用户手动交互：**BLOCKED_HOST_ELECTRON_RUNTIME**（本机 26200）。
- 聊天、Provider UI、记忆写入/重启连续性、设置页面：依赖窗口，**PENDING_USER_ACTION**。
- 真实 Provider：本任务未在 UI 内授权配置；Issue #59 的协议级 200/400 证据仍有效，但不能替代本机 UI 验收。
- 卸载/清理：本次为 side-by-side 目录部署，未执行卸载；隔离目录可作为证据保留，用户可在标准 Windows 上删除该唯一 run 目录。

## 7. 用户侧下一步

在一台可正常启动 Electron 的标准 Windows 10/11 x64（建议 26100 稳定版，而非 26200 Insider）上：

1. 将 `%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\<runId>` 整个目录复制到目标机（或在目标机用同一脚本部署）。
2. 设置隔离数据目录并启动：
   ```powershell
   $root = Join-Path $env:LOCALAPPDATA 'MorrowV2-LocalAcceptance'
   $run = '<runId>'
   $env:MORROW_LOCAL_ACCEPTANCE_USER_DATA = Join-Path $root "user-data\$run"
   & (Join-Path $root "app\$run\Morrow.exe") "--user-data-dir=$($env:MORROW_LOCAL_ACCEPTANCE_USER_DATA)"
   ```
3. 若仍出现 0xC0000005，按 `docs/install/windows-troubleshooting.md` 收集 WER 模块/偏移，并优先尝试非 26200 的 Windows 版本。
4. 不要在本机运行 `release\Morrow-Setup-2.0.0-x64.exe`：它会按设计卸载 `F:\morrow1`。

## 8. 结论

隔离部署、显式数据根、旧版保护均已真实验证；应用窗口因本机 Windows 26200 的 Electron 运行时崩溃无法启动。最终状态 **BLOCKED**，不是 DEPLOYED_AND_RUNNING，也不是本机实机验收完成。
