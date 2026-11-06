# 自托管 CI 最终正确性证据索引（Issue #58）

- 基线 HEAD：`60a445e2a7aecf300816b8941ad4611c561aebe0`（parent `4428477`）
- 代码 SHA：本文件所在提交（最终 full SHA 以 Issue #58 comment 为准）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

## 1. 文件

| 文件 | 用途 |
| --- | --- |
| `scripts/ci/self-hosted-ci-helpers.ps1` | `New-UniqueRunDirectory`、`Complete-RunArchive`、`Get-OwnedProcesses`、`Test-ProcessRecordOwned`、`Stop-OwnedProcessTree` |
| `scripts/ci/run-self-hosted-ci.ps1` | GUID runId、终态状态机、进程树门控卸载/删除 |
| `scripts/ci/test-self-hosted-install-isolation.ps1` | PS 5.1 探针，92 项 |
| `docs/reports/morrow-v2-self-hosted-ci-final-correctness-closeout.md` | 根因/实现/状态机/进程归属/测试 |
| `docs/reports/morrow-v2-self-hosted-ci-final-correctness-acceptance-matrix.md` | 逐项验收 |
| `docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review.md` | 独立复审（最终代码 SHA） |

## 2. 命令与实测退出码

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1
# 实测：passed=92 failed=0 total=92；exit 0
```

```powershell
npm run typecheck
# 实测：exit 0
npm test
# 实测：129 files / 1156 tests passed / 0 failed / 0 skipped（182.99s）；exit 0
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha 0000000000000000000000000000000000000000
# 实测：Checkout SHA mismatch；exit 1；未创建 runDir、未执行 step
```

缺失 Node 故障探针（PATH 只保留 git/System32）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha <HEAD> -ArchiveRoot .tmp/ci-probe3
# 实测：exit 1
# manifest: status=FAILED, failedStage=execution, exitCode=1,
#           cleanup=NOT_REQUIRED, processTree=NOT_REQUIRED,
#           archive.integrity=verified, fileCount=2
# run-identity.json / README.txt / checksums.sha256 均存在；manifest 无 BOM
```

## 3. 探针覆盖（92 项）

原有 56 项（安装隔离、旧安装保护、清理、脱敏、证据边界、安装器选择）全部保留；新增 36 项：

- runDir：GUID 目录创建、5 个子目录、同 stamp/runId 复用拒绝且旧字节/时间戳不变、预置目录拒绝且字节不变、SHA 路径穿越拒绝、junction 拒绝且外部内容不变。
- manifest：正常 PASS + checksums 哈希 + 无循环；README 故障、checksum 故障、manifest 故障分别 FAILED 且无 PASS manifest；archive 失败状态保留。
- 进程树：单进程识别/停止、父子多级、父进程快速退出后子进程残留、外部用户进程不归本次、PID/路径不匹配不误杀、权限拒绝记录错误并保留、终止超时记录 remaining。
- 静态：runner 使用唯一目录/终态器/进程树 helper，无 `-Force` 复用 runDir，无按名字 taskkill，manifest 记录 exitCode。

## 4. manifest 样例（合成故障路径，不是真实 workflow run）

```json
{
  "runId": "<32 hex>",
  "runDir": "<ArchiveRoot>/<timestamp>-<sha>-<runId>",
  "archiveRoot": "<ArchiveRoot>",
  "sha": "<40 hex>",
  "expectedSha": "<40 hex>",
  "actualSha": "<40 hex>",
  "status": "FAILED",
  "failedStage": "execution",
  "exitCode": 1,
  "processTree": { "status": "NOT_REQUIRED", "ownedCount": 0, "records": [], "stopped": [], "remaining": [], "errors": [] },
  "cleanup": { "status": "NOT_REQUIRED", "uninstaller": null, "uninstallerExitCode": null, "removedPaths": [], "errors": [] },
  "archive": {
    "integrity": "verified",
    "checksumPolicy": "run-manifest.json and checksums.sha256 are excluded; every other file, including hidden files, is listed; checksums.sha256 is hashed into the manifest.",
    "checksumsFileSha256": "<sha256>",
    "fileCount": 2,
    "readmeWritten": true,
    "errors": []
  }
}
```

校验方法：

1. 读取 `checksums.sha256`，逐行 `<sha256> *<relative path>` 复算文件哈希，必须全部一致。
2. 对 `checksums.sha256` 自身求 SHA256，必须等于 manifest 的 `archive.checksumsFileSha256`。
3. manifest 不在 checksums 列表中，checksums 也不在自身列表中，因此无循环。
4. 若 manifest `status != PASS`，则 `exitCode` 必须为 1；若 `exitCode != 0`，则 `status` 不得为 PASS。

## 5. 进程树“不误杀用户进程”的证明

- 归属条件：`ExecutablePath` 严格位于本次唯一 `<runDir>\installed-app` 下，且 `CreationDate >= smokeStartedAt`；后代按 `ParentProcessId` 纳入。
- 复核条件：PID 存在、创建时间与记录相差 ≤2 秒、路径仍在安装目录内或记录为后代；PID 被复用则跳过。
- 只调用 `CloseMainWindow` / `Stop-Process -Id`，不使用 `taskkill /IM Morrow.exe`。
- 探针 `process-tree-user-process-not-owned` 证明外部 PowerShell 进程不被纳入；`process-tree-pid-path-mismatch` / `process-tree-no-mismatch-kill` 证明路径不匹配时当前进程不被终止。
- 权限拒绝/超时探针证明无法终止时返回 `Remaining`/`Errors`，由 runner 标记 `CLEANUP_FAILED` 并保留安装目录。

## 6. 真实运行

**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**：`actions/runners total_count=0`，没有真实 self-hosted run；本机 NSIS 构建仍被宿主执行策略阻塞，真实安装/卸载未执行。未提交任何凭空构造的 workflow run、NSIS 结果或用户机器证据。

## 7. 结论

代码、探针、静态验收与全量测试完成；真实 NSIS/self-hosted 运行仍为 PENDING_USER_ACTION。整体 **PARTIAL**，不是 CI PASS。
