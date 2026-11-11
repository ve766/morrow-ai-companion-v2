# 自托管 CI 安装隔离加固验收矩阵（Issue #57）

- 基线 HEAD：`15a06e5f11367f99399efd0aa13f8f45574541a2`
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 安装目标只能是本次 runDir 的新建子目录 | PASS | `Assert-IsolatedInstallTarget`；探针 `existing-target-fails-closed` |
| 2 | 不再递归扫描 `%LOCALAPPDATA%`/磁盘找 `Morrow.exe` | PASS | `Get-InstalledExecutable` 只查精确路径；静态探针 `runner-no-recursive-morrow-scan` |
| 3 | 预存在目录 fail closed 且内容逐字节不变 | PASS | 探针 `existing-target-unchanged` |
| 4 | 路径越界/穿越拒绝 | PASS | 探针 `path-traversal-rejected` |
| 5 | 目标或父链 reparse point/junction 阻断 | PASS | 探针 `junction-target-rejected`、`dangling-junction-target-rejected` |
| 6 | 旧安装 fixture 不被读取/启动/覆盖/卸载/删除 | PASS | 探针 `old-install-*`（4 项） |
| 7 | NSIS `/S /D=` 顺序、无引号、含空格路径真实传递 | PASS | 探针 `nsis-argument-*`、`raw-argument-*` |
| 7b | 用户安装器只构建不执行；CI 变体唯一 GUID/appId/无快捷方式 | PASS（静态）/ PENDING（真实构建） | `windows-nsis-ci-package` 参数；探针 `runner-builds-ci-installer`、`runner-unique-nsis-guid` |
| 7b2 | CI 变体产物名用 `win.artifactName` 覆盖 `build.win.artifactName` | PASS | 探针 `runner-ci-artifact-name-wins`；复审 N1 |
| 7c | 安装前确认 NSIS 走 `$INSTDIR` 路径匹配，避免按名字 taskkill | PASS | `Test-NsisProcessCheckAvailable`；探针 `nsis-process-check-available` |
| 8 | 安装后只取精确 exe 并校验版本 | PASS（探针）/ PENDING（真实安装） | `Get-InstalledExecutable`、`Assert-InstalledVersion`；`installed-version-mismatch-rejected` |
| 9 | 卸载器按真实文件名发现，歧义拒绝 | PASS | 探针 `uninstaller-discovered`、`uninstaller-ambiguous-rejected` |
| 10 | 成功后卸载并清理两个子目录 | PASS（探针）/ PENDING（真实安装） | `cleanup-success`、`cleanup-removed-targets` |
| 11 | 清理幂等 | PASS | `cleanup-idempotent` |
| 12 | 卸载失败/锁定文件保留目录并标 `CLEANUP_FAILED` | PASS | `cleanup-locked-file-fails`、`cleanup-locked-file-kept` |
| 13 | 安装/卸载超时被记录并终止进程树 | PASS | `uninstall-timeout-surfaced`；`Invoke-ProcessWithTimeout` |
| 13b | step 退出码在 PS 5.1 下真实可用（非 null） | PASS | `Invoke-CapturedProcess`；探针 `captured-process-exit-code`、`captured-process-nonzero`、`captured-process-timeout` |
| 14 | finally 在主流程失败时仍执行清理 | PASS（代码审查 + 缺失 Node 探针） | `finally` 清理块；`cleanup.status=NOT_REQUIRED` |
| 15 | manifest 记录 installation/cleanup/evidence/redactionResidual/status | PASS | 缺失 Node 探针 manifest 字段 |
| 16 | 日志脱敏 + 二次扫描，残留则 fail closed | PASS | 探针 `redaction-*`（6 项）；覆盖 `client_secret`/`password`/`secret` |
| 17 | 证据只收本次新文件并记录 source/destination/size/SHA256 | PASS | `evidence-fresh-only`、`evidence-hash-recorded` |
| 18 | 证据来源越界/reparse/同名冲突拒绝 | PASS | `evidence-outside-root-rejected`、`evidence-nested-junction-rejected`；代码审查 |
| 19 | checksums 覆盖归档全部文件 | PASS（代码审查） | `checksums.sha256` 生成逻辑 |
| 20 | 无证据时 manifest 为空数组 | PASS | 缺失 Node 探针 `evidence` 全 0 |
| 21 | PowerShell 5.1 解析与运行 | PASS | Parser `helpers OK`、`run OK`；56 项探针 exit 0 |
| 22 | 全量测试与 typecheck | PASS | `npm run typecheck` exit 0；`npm test` 129 files / 1156 tests passed / 0 failed / 0 skipped |
| 23 | 不修改产品运行时/schema/测试语义 | PASS | diff 仅 CI/scripts/docs |
| 24 | 无 hosted run、无 artifact upload、无付费操作 | PASS | 0 runners；无 dispatch；无 upload-artifact |
| 25 | 真实 NSIS 安装/卸载实测 | **PENDING_USER_ACTION** | 宿主 NSIS 构建被策略阻塞；Runner 未注册 |
| 26 | 真实 self-hosted run（最终 SHA） | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** | `actions/runners=0` |
| 27 | 独立复审最终 SHA | PASS（无剩余 blocker） | R3 复审 `ea5f9ab`（HEAD `4428477` 仅文档）：`docs/audit/morrow-v2-self-hosted-ci-hardening-independent-review-r3.md` |
| 28 | workflow 级超时可能跳过 finally | 残余限制 | 安装/卸载有 180s 超时；job 180min 强杀无法保证 finally |
| 29 | 探针未覆盖真实 NSIS 编排/step 主循环 | 残余限制 | step 循环由 R3 独立探针 9/9 验证；真实安装/卸载 PENDING |
| 30 | CI 变体 HKCU 唯一 GUID 键 | 残余（可接受） | 卸载器删除；清理失败可能残留 CI-only 键；不影响用户原安装 |

## 结论

安装隔离、旧安装保护、清理状态机、脱敏与证据边界均通过本机 PS 5.1 探针；真实安装/卸载与 self-hosted run 仍为 PENDING_USER_ACTION。整体 **PARTIAL**，不是 COMPLETE，不是 CI PASS。
