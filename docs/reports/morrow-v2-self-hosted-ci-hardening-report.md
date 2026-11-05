# Morrow V2 自托管 CI 安装隔离与证据链加固报告（Issue #57）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`15a06e5f11367f99399efd0aa13f8f45574541a2`（parent `53acb9c`）
- 实现提交：本文件所在提交（最终 full SHA 与 parent 以 Issue #57 comment 为准）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**（代码/探针/静态验收完成；Runner 未注册，真实 NSIS 安装与 self-hosted run 未执行）

## 1. 根因

基线 `run-self-hosted-ci.ps1` 的安装 smoke：

1. `Start-Process $installer /S` 未指定安装目录，electron-builder 使用默认 per-user 目录（`%LOCALAPPDATA%\Programs\...`）。
2. 安装后在 `%LOCALAPPDATA%\Programs\Morrow`、`...\morrow-ai-companion-v2` 以及整个 `%LOCALAPPDATA%` 递归搜索第一个 `Morrow.exe`。
3. 没有任何卸载或清理；安装失败/ smoke 失败会留下测试安装。
4. 这意味着测试可能覆盖、启动或读取用户已有安装，且无法证明证据来自本次 run。

## 2. 实现

### 2.1 新增 helper（可测试、PS 5.1）

`scripts/ci/self-hosted-ci-helpers.ps1`：

| 函数 | 作用 |
| --- | --- |
| `Get-NormalizedPath` / `Test-PathWithin` | 绝对化并做大小写不敏感的严格子路径判断 |
| `Test-ReparsePointChain` | 从目标向上检查到 runDir，发现 junction/symlink/reparse point 即阻断 |
| `Assert-IsolatedInstallTarget` | runDir 存在、目标是严格子目录、目标不存在、链上无 reparse point；否则 fail closed |
| `Get-NsisInstallArgument` | 返回 `/S /D=<绝对路径>`；拒绝引号/换行/相对路径；`/D=` 保持最后 |
| `Get-FreshInstaller` | 只接受 `release\Morrow-Setup-*.exe` 中 `LastWriteTimeUtc >= runStart` 的文件，记录大小与 SHA256 |
| `Get-InstalledExecutable` | 只检查 `<installDir>\Morrow.exe`，不递归；记录大小/SHA256/版本 |
| `Assert-InstalledVersion` | ProductVersion/FileVersion 必须等于 `package.json` 版本 |
| `Get-Uninstaller` | 只从本次安装目录枚举 `Uninstall*.exe`，0 个或多个都报错 |
| `Invoke-ProcessWithTimeout` | 启动安装器/卸载器，超时用 `taskkill /T /F` 终止并返回 `TimedOut`；PS 5.1 下显式 `WaitForExit()` 后再读 `ExitCode` |
| `Invoke-CapturedProcess` | 用 `System.Diagnostics.Process` 重定向 stdout/stderr；PS 5.1 下 `Start-Process -PassThru` 的 `ExitCode` 为 null，这里直接读 .NET 进程退出码 |
| `Test-NsisProcessCheckAvailable` | 安装前确认 NSIS 能走 `$INSTDIR` 路径匹配；否则 NSIS 会回退到 `taskkill /IM Morrow.exe`，此时拒绝安装 |
| `Invoke-IsolatedInstall` | 使用 `/S /D=...` 安装到隔离目录 |
| `Invoke-IsolatedUninstall` | 使用本次安装目录内的卸载器 `/S`，返回退出码/超时 |
| `Stop-ProcessesUnderPath` | 只终止 `ExecutablePath` 精确等于本次 exe 的进程；路径不可读时跳过，绝不按名字全局 kill |
| `Remove-IsolatedPaths` | 只删除 runDir 严格子路径；拒绝 reparse point、树内 reparse、路径越界；失败返回 `CLEANUP_FAILED` |
| `Copy-ArchiveEvidence` | 只复制允许根目录内、本次 run 新生成的文件；记录 source/destination/size/SHA256；拒绝 reparse、路径逃逸、同名不同内容 |
| `Redact-Text` / `Test-RedactionResidual` | 脱敏与二次 secret-pattern 扫描 |

### 2.2 安装器归属：用户安装器只构建、不执行

独立复审发现 electron-builder 26.15.3 的 NSIS 模板在安装前无条件调用 `uninstallOldVersion`，按 `appId` 派生的 GUID 读取 HKCU 卸载键；`/D=` 只改安装目录，不能阻止它卸载同 appId 的既有安装（`installSection.nsh:52`、`installUtil.nsh:142-176`、`NsisTarget.js:157`）。

因此脚本改为：

1. `npm run package:win` 构建**用户安装器** `release\Morrow-Setup-*.exe`，记录名称/大小/SHA256，**只归档、不执行**。
2. 再用 `npx electron-builder` 构建 **CI 专用安装器** `release-ci\Morrow-CI-Setup-*.exe`：
   - `-c.appId=com.morrow.ai-companion.ci`
   - `-c.nsis.guid=3f2b8c1e-7d4a-4f6b-9c2e-8a1d5e7f9b3c`（唯一 GUID，卸载键/互斥量/安装键均隔离）
   - `-c.win.artifactName=Morrow-CI-Setup-${version}-${arch}.${ext}`（必须用 `win.artifactName`；`package.json` 的 `build.win.artifactName` 会覆盖顶层 `-c.artifactName`，否则 CI 变体仍叫 `Morrow-Setup-*`，`Get-FreshInstaller` 会 fail closed）
   - `-c.nsis.createDesktopShortcut=false`、`-c.nsis.createStartMenuShortcut=false`、`-c.nsis.runAfterFinish=false`
3. 只有 CI 专用安装器会被 `/S /D=<runDir>\installed-app` 安装；安装前 `Test-NsisProcessCheckAvailable` 确认 NSIS 的进程检查可用，否则拒绝安装，避免回退到按进程名 `taskkill`。
4. manifest 同时记录 `installer`（CI 变体，被安装）与 `releaseInstaller`（用户安装器，未执行）及各自 SHA256。

这保证即使用户电脑上已有 Morrow，CI 也不会匹配其卸载键、创建/删除快捷方式或按名字终止其进程。真实 NSIS 安装/卸载仍需 Runner 实机执行，属 PENDING_USER_ACTION。

### 2.3 安装与清理状态机

`scripts/ci/run-self-hosted-ci.ps1` 现在：

1. `windows-nsis-package` 后取 `Get-FreshInstaller`，记录 installer 名称/大小/SHA256。
2. `Assert-IsolatedInstallTarget` 校验 `<runDir>\installed-app`。
3. `Invoke-IsolatedInstall` 执行 `/S /D=<runDir>\installed-app`。
4. `Get-InstalledExecutable` 精确取 `<runDir>\installed-app\Morrow.exe`，`Assert-InstalledVersion` 对齐 `package.json` 版本。
5. `MORROW_SMOKE_EXECUTABLE` 指向该 exe，`MORROW_SMOKE_PROFILE` 指向 `<runDir>\smoke-profile`。
6. finally：
   - `Stop-ProcessesUnderPath` 只终止本次 exe 的进程；
   - `Invoke-IsolatedUninstall` 用本次安装目录内的卸载器静默卸载；
   - 卸载成功才删除 `installed-app`；无论卸载结果都删除 `smoke-profile`；
   - 卸载失败/文件锁定 → 保留 `installed-app`，`cleanup.status=CLEANUP_FAILED`；
   - 从未安装 → `cleanup.status=NOT_REQUIRED`；
   - 清理失败会写入 `failure` 并使整体 `status=FAILED`、退出码 1。

manifest 新增：

```json
{
  "installation": {
    "target": "<runDir>\\installed-app",
    "installer": "Morrow-Setup-2.0.0-x64.exe",
    "installerSha256": "...",
    "installExitCode": 0,
    "installedExe": "<runDir>\\installed-app\\Morrow.exe",
    "installedExeSha256": "...",
    "installedVersion": "...",
    "smokeProfile": "<runDir>\\smoke-profile"
  },
  "cleanup": {
    "status": "PASS | CLEANUP_FAILED | NOT_REQUIRED",
    "uninstaller": "...",
    "uninstallerExitCode": 0,
    "removedPaths": ["..."],
    "errors": []
  },
  "evidence": { "screenshots": [], "results": [], "transcripts": [] },
  "redactionResidual": false
}
```

### 2.4 日志与证据

- 每个 step 用 `Invoke-CapturedProcess`（.NET `Process` + 重定向）执行，等待完成或超时；退出码来自真实子进程。PS 5.1 的 `Start-Process -PassThru` 在重定向时 `ExitCode` 为 null，已由该实现规避并用真实 `node --version` / `exit 7` / 超时探针验证。
- 输出先 `Redact-Text`，再 `Test-RedactionResidual`；发现残留时抑制输出、写占位日志、阻止归档并整体 FAILED。
- 归档只接受 `docs/ui/evidence`、`evals/morrow-v2-final/results`、`evals/morrow-v2-final/transcripts` 下本次 run 新生成的文件；每个文件记录 source/destination/size/SHA256；无证据时 manifest 为空数组。
- checksums 覆盖归档内除 `checksums.sha256` 外的所有文件。

### 2.5 超时

- 安装/卸载 180 秒；typecheck 600；全量测试 1800；evaluate 600；build 900；smoke 900；product-path 1200；persistence 600；package 1800。
- 超时会终止进程树、记录 `timedOut=true` 并进入 finally 清理。
- workflow 级 180 分钟超时仍可能直接杀掉 job；此时 finally 不保证执行，已在矩阵中记录为残余限制。

## 3. 探针结果

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1`

- 56 项全部 PASS，0 FAIL，exit 0。
- 覆盖：含空格 `/D=` 原样传递、`Invoke-CapturedProcess` 的 0/7/超时退出码、预存在目标 fail closed 且字节不变、路径穿越拒绝、junction 与 dangling junction 目标/清理拒绝、旧安装 fixture 未被读取/修改/删除、清理成功与幂等、锁定文件 `CLEANUP_FAILED` 且保留目录、卸载器发现/歧义/退出码/超时、脱敏正反向与二次扫描（含 `client_secret`/`password`/`secret`）、证据只收新文件且嵌套 junction 拒绝、stale installer 拒绝、CI 变体安装器选择、精确 exe 查找、版本不匹配拒绝、脚本无递归扫描且只安装 CI 变体。
- 旧安装 fixture 仅位于临时目录，不涉及真实用户安装。

## 4. 未执行

- 本机无法构建 NSIS（宿主执行策略阻塞），因此**没有真实安装/卸载实测**；该验收只能由用户 Runner 执行。CI 变体安装器的实际构建/安装同样未在本机发生。
- `actions/runners` 仍为 0，没有真实 self-hosted run。
- 全量测试/typecheck 在本提交上重跑：`npm run typecheck` exit 0；`npm test` 129 files / 1156 tests passed / 0 failed / 0 skipped。
- 状态：**PARTIAL / PENDING_USER_ACTION**，不是 COMPLETE，不是 CI PASS。

## 5. 风险与回滚

- 残余风险：workflow 级超时可能跳过 finally，留下 `<runDir>\installed-app`；该目录只在本 run 归档内，下一次 run 使用新目录，不会复用。
- 卸载器退出码可能受 NSIS/宿主影响；失败时保留目录并标 `CLEANUP_FAILED`，不强行删除。
- 回滚：删除 `ci-self-hosted-*` tag；停止/卸载 Runner；删除 `%LOCALAPPDATA%\Morrow\CI` 下本任务生成的归档；不修改 main/release，不合并 PR #54，不发布 Release。
