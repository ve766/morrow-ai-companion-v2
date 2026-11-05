# 自托管 CI 安装隔离加固证据索引（Issue #57）

- 基线 HEAD：`15a06e5f11367f99399efd0aa13f8f45574541a2`（parent `53acb9c`）
- 实现提交：本文件所在提交（最终 full SHA 与 parent 以 Issue #57 comment 为准）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

## 1. 文件

| 文件 | 用途 |
| --- | --- |
| `scripts/ci/self-hosted-ci-helpers.ps1` | 隔离路径、NSIS 参数、安装/卸载、进程终止、清理、证据复制、脱敏与二次扫描 |
| `scripts/ci/run-self-hosted-ci.ps1` | 完整 run 编排、安装状态机、finally 清理、manifest/README/checksums |
| `scripts/ci/test-self-hosted-install-isolation.ps1` | PS 5.1 回归探针（55 项） |
| `docs/ci/self-hosted-runner-setup-windows.md` | Runner 注册 + 6.1 安装隔离说明 |
| `docs/ci/ci-no-billing-operations.md` | 零账单操作 + 失败/清理说明 |
| `docs/reports/morrow-v2-self-hosted-ci-hardening-report.md` | 根因、实现、状态机、探针、未执行项 |
| `docs/testing/morrow-v2-self-hosted-ci-hardening-matrix.md` | 逐项验收状态 |
| `docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review.md` | 独立复审（最终 SHA） |

## 2. 命令与实测退出码

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1
# 实测：passed=55 failed=0 total=55；exit 0
```

```powershell
powershell -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/ci/self-hosted-ci-helpers.ps1"),[ref]$null,[ref]$e) > $null; if($e.Count){$e|%{$_.Message};exit 1}else{"helpers OK"}'
# 实测：helpers OK；exit 0
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha 0000000000000000000000000000000000000000
# 实测：Checkout SHA mismatch；exit 1；未创建归档、未执行 step
```

缺失 Node 探针（PATH 只保留 git/System32）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha <HEAD> -ArchiveRoot .tmp/ci-probe2
# 实测：exit 1；manifest status=FAILED、steps=0、cleanup.status=NOT_REQUIRED、无 BOM
```

全量验证（最终提交）：

```powershell
npm run typecheck
npm test
```

结果见 Issue #57 comment；本文件不预填未执行的结果。

## 3. 探针覆盖（55 项）

- 含空格 `/D=` 参数：字符串正确、无引号、子进程 `%*` 原样收到 `/S /D=<带空格路径>`、退出码传播。
- 捕获式 step：`node --version` exit 0、`exit 7` 透传、1 秒超时 `TimedOut=true`；覆盖 PS 5.1 `Start-Process -PassThru` 的 `ExitCode=null` 缺陷。
- 预存在目标：fail closed，`keep.txt` SHA256 不变。
- 路径穿越：`runDir\..\outside` 拒绝。
- junction：目标链拒绝；清理拒绝且 junction 指向的外部文件保留；dangling junction 同样拒绝。
- 旧安装 fixture：目标/清理均拒绝，`Morrow.exe` 与 sentinel 字节不变，文件数不变。
- 清理：成功删除两个子目录；第二次幂等；锁定文件返回 `CLEANUP_FAILED` 且目录保留。
- 卸载：发现 `Uninstall Morrow.exe`；多个卸载器拒绝；退出码 5 透传；1 秒超时返回 `TimedOut=true`、`ExitCode=null`。
- 脱敏：Bearer、JSON `authorization`、含空格 `apiKey`、`api_key=`、`token:`、`refresh_token=`、`client_secret=`、`password=`、`secret:`、`ghp_`、`sk-` 全部替换；普通文本保留；二次扫描 0 残留；原始文本可检出。
- 证据：只复制 `LastWriteTimeUtc >= runStart` 的文件；记录 SHA256；允许根之外拒绝；嵌套 junction 拒绝。
- 安装器：stale 拒绝；`release` 的 `Morrow-Setup-*` 与 `release-ci` 的 `Morrow-CI-Setup-*` 分别选中并记录 SHA256；CI 变体不会从 `release` 误取。
- 精确 exe：嵌套 `Morrow.exe` 不被发现；顶层存在时只返回顶层；版本不匹配拒绝。
- 静态：runner 脚本无递归 `Morrow.exe` 扫描、无 `LOCALAPPDATA ... Programs` 扫描、只安装 CI 变体、带唯一 NSIS GUID。

## 3.1 安装器归属证据（B2）

- electron-builder 26.15.3 `installSection.nsh:52` 在安装前调用 `uninstallOldVersion`。
- `include/installUtil.nsh:155-176` 读取 `UNINSTALL_REGISTRY_KEY` 的 `UninstallString`/`InstallLocation` 并执行旧卸载器。
- `out/targets/nsis/NsisTarget.js:157`：`guid = options.guid || UUID.v5(appInfo.id, ...)`。
- 因此 CI 变体使用 `-c.nsis.guid=3f2b8c1e-...`、`-c.appId=com.morrow.ai-companion.ci`、禁用快捷方式；用户安装器只归档不执行。

## 4. 真实运行

**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**：`actions/runners total_count=0`，没有真实 self-hosted run，也没有真实 NSIS 安装/卸载实测（宿主 NSIS 构建被策略阻塞）。用户注册 Runner 后，在最终 SHA 上触发一次即可产生 `installation`/`cleanup`/`evidence` 的真实 manifest。

## 5. 安装包哈希

- 本次没有新构建 NSIS 安装包；`installation.installerSha256` 在真实 run 前为 `null`。
- 现存 Issue #55 portable RC（不是本 workflow 产物）：`Morrow-2.0.0-x64-portable.exe`，100,542,249 bytes，SHA256 `e18a13a5e209c70df09f6ff3c6b657d15385bf5a9f0c23368043c47151e40c1b`。

## 6. 结论

代码、探针、静态验收与全量测试完成后，真实安装/卸载与 self-hosted run 仍为 PENDING_USER_ACTION；整体 **PARTIAL**，不是 CI PASS。
