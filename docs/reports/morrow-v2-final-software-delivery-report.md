# Morrow V2 最终软件交付报告（Issue #59）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`1acd646227f7c7fa63ea041d49c52085ea0eba2f`（parent `2c21155`）
- 代码 SHA：本文件所在提交（最终 full SHA 以 Issue #59 comment 为准）
- 最终状态：**PARTIAL**（NSIS 安装器已构建；本机 Electron 运行时无法启动，安装/启动/卸载实机验收 PENDING_USER_ACTION；self-hosted run PENDING_USER_ACTION）

## 1. 本任务实际完成

### 1.1 正式 NSIS 安装器已构建

- 路径：`release\Morrow-Setup-2.0.0-x64.exe`
- 大小：111,771,999 bytes
- SHA256：`5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977`
- 构建命令：`npm run package:win`（exit 0）
- 该文件超过 GitHub 单文件 100 MiB 限制，未提交到仓库；可在仓库根目录复现。

历史“NSIS 被宿主执行策略阻断”在本轮已不再成立：默认配置的正式安装器构建成功。失败只出现在带配置覆盖/不同产物名/不同输出目录的 CI 变体构建上，根因见 1.2。

### 1.2 CI 变体构建失败根因（已定位）

- electron-builder 26.15.3 构建 NSIS 时会先执行中间安装器以提取 uninstaller（`NsisTarget.js` `WineVmManager.exec(installerPath)`）。
- 在本机：
  - 无覆盖、输出到 `release`、默认名 `Morrow-Setup-*`：**成功**；
  - 任意 CLI 覆盖（即使 `-c.nsis.oneClick=false` 与 package.json 相同）、不同输出目录、不同产物名：中间安装器被宿主以 exit code null 终止（`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`）；
  - 仅 `-c.nsis.createDesktopShortcut=false` 也能复现。
- 结论：这是宿主执行策略/安全软件对新构建可执行文件的拦截与 electron-builder 中间步骤的组合，不是 Morrow 的 NSIS 脚本语法错误。
- 代码修复：CI 变体不再关闭快捷方式（该选项可复现构建失败），改用无空格的 `-c.nsis.shortcutName=MorrowCI`，保留唯一 GUID/appId，避免覆盖用户 `Morrow` 快捷方式。首次复审还发现 `Morrow CI` 带空格会被 argv 拆分，已一并改为 `MorrowCI`。
- 注意：改为 `MorrowCI` 后，本机 CI 变体构建仍在 electron-builder 中间安装器执行阶段失败（exit code null）；宿主拦截问题未因该改动消失。动态 GUID 的**真实 NSIS 采用**仍是 PENDING_USER_ACTION。

### 1.3 动态 NSIS 身份（每次 run 唯一）

- `New-CiInstallerIdentity`：每次 run 生成 `NsisGuid = [guid]::NewGuid()`，`AppId = com.morrow.ai-companion.ci`。
- `Get-CiInstallerArguments`：把动态 GUID 和 CI appId 传入 electron-builder；正式用户 appId/GUID 不受影响。
- manifest/`run-identity.json` 记录 `runId`、`ciAppId`、`nsisGuid`、`installerSha256`。
- 旧固定 GUID `3f2b8c1e-...` 已移除。

跨运行回归（探针，107 项）：

- 50 次身份生成：GUID 全部合法且唯一；CI appId 与用户 appId 不同。
- 构建参数包含本次 GUID，且不包含旧固定 GUID。
- Run A 模拟 cleanup failure（`CLEANUP_FAILED`，保留 installed-app/manifest/checksums），Run B 使用另一 GUID 归档并清理；Run A 全部 6 个文件（含 hidden）的 SHA256、length、LastWriteTimeUtc 逐项不变；Run A manifest/checksums 哈希不变；Run B 只删除自己的 installed-app。
- 真实 NSIS 跨运行卸载测试受 1.2 与本机 Electron 限制，标记 PENDING_USER_ACTION。

### 1.4 Electron 0xC0000005 根因（宿主运行时）

- 打包后 `release\win-unpacked\Morrow.exe` smoke：`Built application exited during launch (3221225477)`。
- 未打包 `node_modules\electron\dist\electron.exe` smoke：同样 `3221225477`。
- 最小 Electron 应用（仅 `app.whenReady()` 后打印并退出，`--no-sandbox --disable-gpu`）：段错误退出。
- `electron.exe --version`：exit 3，无输出。
- 结论：崩溃发生在 Electron/Chromium 运行时初始化，与 Morrow 产品代码、数据库、Provider 配置、安装器无关；本机 GPU 为 Intel UHD + RTX 3060，驱动状态正常，但宿主 Windows 11 26200 与 Electron 44.9.3 组合无法启动。
- 这是当前 Agent 环境不可修复的宿主问题；用户侧诊断步骤见 `docs/install/windows-troubleshooting.md`。

### 1.5 未执行正式安装器

本机存在 Morrow 1.0.0：`F:\morrow1`，HKCU 卸载键 `92ffd461-3512-54f9-8cf5-c344989830ea`，与正式安装器 appId 派生 GUID 相同。运行正式安装器会按 NSIS `uninstallOldVersion` 卸载旧版，属于用户数据风险，因此**未执行**。安装/卸载实机验收必须在备份旧数据后的用户机器或干净 VM 上完成。

## 2. 产品回归（当前 SHA）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 129 files / 1156 tests passed / 0 failed / 0 skipped（170.75s） |
| `npm run evaluate` | 0 | M3 11 + M4 19 cases，passed=true |
| `npm run evaluate:cognition` | 0 | cognitive 26 / feeling 34 / alpha 28 / intent 25，全部 gate pass，0 provider/network calls |
| `npm run build`（package:win 内） | 0 | `out/main`、`out/preload`、`out/renderer` 构建成功 |
| `npm run smoke` | 1 | BLOCKED_HOST_ELECTRON_RUNTIME：`3221225477` |
| `node scripts/smoke.mjs`（打包 app） | 1 | 同上，`3221225477` |
| `test-self-hosted-install-isolation.ps1` | 0 | 107/107 PASS |

首次启动、聊天、Provider 配置、记忆/重启连续性等 UI 路径依赖 Electron 启动，本机无法执行；代码/测试层由 1156 项测试覆盖，但不能替代实机 smoke。

## 3. Provider 真实验证（已执行）

使用用户授权的测试 endpoint（`https://maas-api.cn-huabei-1.xf-yun.com`，模型 `spark-x2.6`），密钥仅从 `.tmp/spark.key` 读入环境/请求头，未写入仓库、日志或报告：

| 请求 | HTTP | 结果 |
| --- | --- | --- |
| 正常 chat，max_tokens=64 | 200 | `finish_reason=stop`，content `OK`，usage 67 tokens |
| 非法模型 `invalid-model-xyz` | 400 | error code 10404，`invalid_request_error`，`no category route found` |

这证明真实网络、鉴权、请求/响应解析和错误路径可用；产品内 Provider UI 流程仍受 Electron 启动阻塞（PENDING_USER_ACTION）。

## 4. 自托管 CI 状态

- workflow guard/ref/actor、唯一 GUID、无 hosted fallback、无 artifact upload、无 `pull_request_target` 静态检查通过。
- `actions/runners total_count=0`；没有真实 self-hosted run。
- 状态：**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**，不是 GitHub CI PASS。

## 5. 未完成与交付结论

| 项目 | 状态 |
| --- | --- |
| 正式 NSIS 安装器构建 + SHA256 | PASS |
| 正式安装器实机安装 | PENDING_USER_ACTION（本机旧版同 GUID，未执行） |
| 安装后启动 / 核心 smoke | BLOCKED_HOST_ELECTRON_RUNTIME（最小 Electron 亦崩溃） |
| 卸载与残留检查 | PENDING_USER_ACTION（依赖安装） |
| 动态 GUID / 跨运行不可变性 | PASS（探针） |
| 产品测试/typecheck/evaluate/build | PASS |
| Provider 真实请求 200/400 | PASS |
| 自托管 workflow 真实运行 | PENDING_USER_ACTION |
| 独立审计 | 见 `docs/audit/morrow-v2-final-software-independent-review.md` |

最终状态 **PARTIAL**。已交付可复现的 NSIS 安装器、动态安装身份、跨运行隔离、完整产品测试和真实 Provider 证据；但“安装→启动→交互→卸载”的实机验收因宿主 Electron 运行时与旧版安装冲突未能完成，不能称为完整 Windows 安装版交付。

## 6. 用户下一步

1. 在可正常启动 Electron 的标准 Windows 10/11 x64 桌面（或干净 VM）上：
   - 先导出旧版 Morrow 备份；
   - 运行 `release\Morrow-Setup-2.0.0-x64.exe`，核对 SHA256；
   - 启动 `Morrow.exe`，完成首次启动、聊天、Provider 配置/错误反馈、记忆重启连续性检查；
   - 卸载并确认用户数据/旧安装边界。
2. 注册 self-hosted Runner 后，在最终 SHA 上运行一次 workflow，归档真实 `run-manifest.json`。
3. 不得把本报告当作安装/启动 PASS；未执行项已如实标记。
