# Morrow V2 最终软件交付证据索引（Issue #59）

- 基线 HEAD：`1acd646227f7c7fa63ea041d49c52085ea0eba2f`
- 代码 SHA：本文件所在提交（最终 full SHA 以 Issue #59 comment 为准）
- 最终状态：**PARTIAL**

## 1. 交付物

| 文件 | 大小 | SHA256 | 位置 |
| --- | --- | --- | --- |
| `Morrow-Setup-2.0.0-x64.exe`（正式 NSIS） | 111,771,999 | `5aeb40276def2323babe7c9e32ec2946f9ae44e29ef0cc8d13f0e0082b3e5977` | `release\`（本机构建，未提交；超过 GitHub 100 MiB） |
| `Morrow-2.0.0-x64-portable.exe` | 100,542,249 | `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b` | `evals/morrow-v2-rc/installers/2.0.0/` |

复现正式安装器：`npm run package:win`（当前宿主 exit 0）。

## 2. 命令与退出码（当前 SHA）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 无错误 |
| `npm test` | 0 | 129 files / 1156 tests passed / 0 failed / 0 skipped（170.75s） |
| `npm run evaluate` | 0 | M3 11 + M4 19 cases，passed=true |
| `npm run evaluate:cognition` | 0 | 26/34/28/25 cases，gate 全 pass；0 provider/network calls |
| `npm run build` | 0 | main/preload/renderer 构建成功 |
| `test-self-hosted-install-isolation.ps1` | 0 | **passed=107 failed=0 total=107** |
| `run-self-hosted-ci.ps1 -ExpectedSha 000…` | 1 | SHA mismatch；未创建 runDir |
| `npm run smoke`（`MORROW_SMOKE_DISABLE_SANDBOX=1`） | 1 | `3221225477` / 0xC0000005 |
| 打包 app smoke | 1 | `3221225477` / 0xC0000005 |
| `electron.exe --version` | 3 | 无输出 |
| 最小 Electron app | 段错误 | 仅 `app.whenReady()` 即崩溃 |

## 3. 动态 GUID / 跨运行证据（107 项探针）

新增/覆盖：

- `ci-identity-guid-unique`：50 次身份，GUID 全部唯一。
- `ci-identity-guid-valid`：全部可被 `[guid]::TryParse`。
- `ci-identity-appid-separated`：CI appId `com.morrow.ai-companion.ci` ≠ 用户 `com.morrow.ai-companion`。
- `ci-args-dynamic-guid` / `ci-args-no-fixed-guid`：构建参数包含本次 GUID，不含旧固定 GUID。
- `cross-run-a-cleanup-failed`：Run A 归档 `CLEANUP_FAILED`，保留安装目录。
- `cross-run-b-pass`：Run B 新 GUID 归档 PASS 并清理自己的 installed-app。
- `cross-run-guid-differs`。
- `cross-run-a-inventory-immutable`：Run A 6 个文件（含 hidden）SHA256/length/LastWriteTimeUtc 逐项不变。
- `cross-run-a-manifest-immutable` / `cross-run-a-checksums-immutable`。
- `cross-run-a-install-retained` / `cross-run-b-install-removed`。
- `runner-dynamic-nsis-guid`：runner 使用 `New-CiInstallerIdentity` + `Get-CiInstallerArguments`，无固定 GUID。

## 4. NSIS 构建诊断证据

- 默认 `npm run package:win`：exit 0，生成 111,771,999 bytes 安装器。
- 带任意 CLI 覆盖（含 `-c.nsis.oneClick=false` 与 package.json 相同）：exit 1，`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`，中间安装器 exit code null。
- 仅 `-c.nsis.createDesktopShortcut=false`：同样 exit 1。
- 不同输出目录/产物名：同样 exit 1。
- 配置文件方式（`--config`）覆盖 appId/GUID/artifactName：同样 exit 1。
- 结论：宿主执行策略/安全软件拦截新构建中间安装器；不是 Morrow 的 NSIS 脚本语法错误。代码已移除会复现失败的快捷方式禁用选项，改用 `shortcutName=Morrow CI`。

## 5. Provider 真实请求证据（脱敏）

| 请求 | HTTP | 证据 |
| --- | --- | --- |
| `spark-x2.6`，max_tokens=64 | 200 | `finish_reason=stop`，content=`OK`，usage 67 tokens |
| `invalid-model-xyz` | 400 | `invalid_request_error`，code 10404，`no category route found` |

- 密钥只从 `.tmp/spark.key` 读入请求头，未出现在仓库、日志、报告或本索引。
- endpoint：`https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions`。
- 这是真实网络请求，不是 mock；产品内 Provider UI 流程仍受 Electron 启动阻塞。

## 6. 宿主 Electron 崩溃证据

- `release\win-unpacked\Morrow.exe` + `MORROW_SMOKE_PROFILE` 隔离 profile + `MORROW_SMOKE_DISABLE_SANDBOX=1`：`Built application exited during launch (3221225477)`。
- `node_modules\electron\dist\electron.exe` + `scripts/smoke.mjs`：同样 `3221225477`。
- 最小 Electron 应用（无 Morrow 代码）：段错误。
- `electron.exe --version`：exit 3。
- 结论：宿主 Electron/Chromium 运行时初始化失败，与产品代码/安装器无关；需在标准 Windows 10/11 桌面复验。

## 7. 未执行/阻塞

- 正式安装器实机安装/卸载：PENDING_USER_ACTION（本机 `F:\morrow1` 为同 appId 旧版，未执行以免卸载用户安装）。
- 安装后启动、聊天、Provider UI、记忆重启连续性：BLOCKED_HOST_ELECTRON_RUNTIME。
- self-hosted workflow：PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED（0 runners）。
- 独立审计：见 `docs/audit/morrow-v2-final-software-independent-review.md`。

## 8. 结论

NSIS 安装器、动态安装身份、跨运行不可变性、产品测试和真实 Provider 请求均有可复核证据；实机安装/启动/卸载因宿主 Electron 运行时与旧版安装冲突未完成。整体 **PARTIAL**，不是 COMPLETE，不是 CI PASS。
