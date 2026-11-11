# 自托管 CI 最终正确性收尾报告（Issue #58）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54（OPEN，未合并）
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`60a445e2a7aecf300816b8941ad4611c561aebe0`（parent `4428477`）
- 代码 SHA：`e325b48859bda287f2b2b65cec79c8d2ad52a96b`（parent `ba8e479`；最终复审对象）
- 文档 HEAD：本文件所在提交（仅文档，不改代码）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**（代码/探针/静态验收完成；Runner 未注册，真实 NSIS 与 self-hosted run 未执行）

## 1. 三个根因

### 1.1 runDir 复用

旧实现用 UTC 秒级时间戳 + SHA 命名，并用 `New-Item -Force` 创建目录。同一秒内同一 SHA 重跑或目录已存在时会复用旧 runDir，旧日志/结果/manifest/证据可能混入本次运行。

### 1.2 manifest 与退出码矛盾

旧流程先写 manifest，再写 README/checksums。若 README/checksum 阶段失败，进程退出码变为非零，但已落盘 manifest 仍为 PASS。

### 1.3 Electron 进程树清理不足

旧 `Stop-ProcessesUnderPath` 只按 `ExecutablePath` 精确匹配并停止进程，未记录进程树归属、未确认子进程退出，也不等待/复查；Electron 的 renderer/GPU/utility 子进程可能残留并锁住安装目录。

## 2. 实现

### 2.1 唯一 runDir（`New-UniqueRunDirectory`）

- `runId = [guid]::NewGuid().ToString('N')`；目录名 `<UTC timestamp>-<sha>-<runId>`。
- 先校验 SHA 为 7–64 位十六进制、无路径分隔符；runDir 必须是 ArchiveRoot 的严格子路径。
- 目标已存在（含 junction）立即 fail closed；`New-Item` **不带 `-Force`**，创建失败即抛出。
- 创建后检查 runDir→ArchiveRoot 链上无 reparse point；`logs`/`results`/`results\transcripts`/`installers`/`screenshots` 逐个新建，已存在即失败。
- 目录创建和边界校验完成后才写 `run-identity.json`（runId/runDir/archiveRoot/expectedSha/actualSha/startedAt/status=RUNNING，注明非终态），随后才写任何日志。

### 2.2 终态状态机（`Complete-RunArchive`）

状态：`RUNNING`（仅 identity 文件）→ `PASS` / `FAILED` / `CLEANUP_FAILED`。

终态顺序：

1. 主执行失败 → `failure` + `failedStage=execution`。
2. 清理失败 → `cleanup.status=CLEANUP_FAILED`，status 优先为 `CLEANUP_FAILED`、`failedStage=cleanup`。
3. 归档复制失败 → `failedStage=archive`。
4. `Complete-RunArchive`：README → checksums → manifest（tmp + 原子 `Move-Item`）→ 解析校验。
5. 任何 README/checksum/manifest 失败都把 status 覆盖为 `FAILED` 并记录 `failedStage`；manifest 写入失败时不会留下 PASS manifest，另写 `finalization-error.txt`（仅在 manifest 阶段失败时）。
6. 最终 `exit 0` 仅当 `Complete-RunArchive` 返回 PASS；否则 `exit 1`。

manifest 记录：`runId`、`runDir`、`archiveRoot`、`sha`/`expectedSha`/`actualSha`、`status`、`failedStage`、`exitCode`、`cleanup`、`processTree`、`installation`、`evidence`、`archive`、`redactionResidual`、`failure`。

### 2.3 无循环 checksum 策略

- `checksums.sha256` 列出归档内除 `run-manifest.json` 和自身之外的所有文件（含 README、日志、安装包、证据）。
- 计算后逐文件复算校验；manifest 记录 `archive.checksumsFileSha256`、`fileCount`、`checksumPolicy`。
- 校验方法：按 `checksums.sha256` 逐行复算文件哈希；再对 `checksums.sha256` 本身求 SHA256，与 manifest 的 `archive.checksumsFileSha256` 比较。manifest 不进入 checksum 列表，因此无循环。

### 2.4 进程树归属与清理

- `Get-OwnedProcesses -InstallDir <runDir>\installed-app -Since <smokeStart>`：
  - 任何 `ExecutablePath` 位于本次隔离安装目录下、且创建时间不早于 smoke 开始时间的进程都是本次所有；
  - 再按 `ParentProcessId` 递归纳入这些进程的后代（覆盖 renderer/GPU/utility/crashpad）；
  - 记录 PID、PPID、Name、ExecutablePath、CreationDate、Reason；完整 `records` 数组写入 manifest 的 `processTree.records`。
- `Test-ProcessRecordOwned`：PID 存在、创建时间与记录相差 ≤2 秒、路径在安装目录内或记录为后代，才视为本次进程；PID 被复用时不会误杀。
- `Stop-OwnedProcessTree`：先对确认属于本次的进程 `CloseMainWindow()`，等待 5 秒；再对仍存活的进程 `Stop-Process -Force`；最多等待 10 秒并复查；任何仍存活或停止异常都返回 `Remaining`/`Errors`。
- 只有 `processTree.status != CLEANUP_FAILED` 才执行卸载；否则跳过卸载、保留 `installed-app`、`cleanup.status=CLEANUP_FAILED`、整体失败、非零退出。
- 不使用 `taskkill /IM Morrow.exe`，不按进程名全局终止。

## 3. 测试与结果

命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/test-self-hosted-install-isolation.ps1
npm run typecheck
npm test
```

实测：

- 探针：**passed=92 failed=0 total=92**，exit 0。包含原有 56 项与新增 36 项：
  - runDir：GUID 创建、子目录、复用拒绝且旧字节/时间戳不变、预置目录拒绝且字节不变、SHA 路径穿越拒绝、junction 拒绝且外部内容不变。
  - manifest：正常 PASS + checksum 哈希；README 故障、checksum 故障、manifest 故障分别 FAILED 且无 PASS manifest；archive 失败状态保留；checksum 无循环。
  - 进程树：单进程、父子多级、父进程快速退出后子进程残留、外部用户进程不归本次、PID/路径不匹配不误杀、权限拒绝、终止超时。
  - 静态：runner 使用唯一目录/终态器/进程树 helper，无 `-Force` 复用 runDir，无按名字 taskkill，manifest 记录 exitCode。
- `npm run typecheck` exit 0；`npm test` **129 files / 1156 tests passed / 0 failed / 0 skipped**（182.99s）。
- 三个 PowerShell 脚本 PS 5.1 Parser 通过；两个 workflow YAML 可解析；错误 SHA guard exit 1；`git diff --check` 干净。
- 缺失 Node 故障探针：exit 1；manifest `FAILED`/`execution`/`exitCode=1`；`cleanup=NOT_REQUIRED`；`processTree=NOT_REQUIRED`；archive `integrity=verified`；`run-identity.json`/`README.txt`/`checksums.sha256` 均存在；无 BOM。独立复算 checksums 全部匹配，checksums 文件哈希与 manifest 一致，manifest 不在 checksums 列表中。

## 4. 未执行

- 本机 NSIS 构建仍被宿主执行策略阻塞；真实 NSIS 安装/卸载、Electron 进程树实机清理未执行。
- `actions/runners` 为 0，没有真实 self-hosted run。
- 状态：**PARTIAL / PENDING_USER_ACTION**，不是 COMPLETE，不是 CI PASS。

## 5. 风险与回滚

- workflow 级 180 分钟强杀仍可能跳过 finally；此时 `<runDir>` 会留下，但目录名含 GUID，不会被下一次复用。
- 进程树清理依赖 WMI/CIM 可读；不可读时按 CLEANUP_FAILED 失败并保留安装目录，不猜测。
- 父进程已退出且子进程可执行文件又不在本次安装目录内的孤儿后代，无法凭路径归属；Electron 的 renderer/GPU/utility/crashpad 均在安装目录内，因此本轮不纳入该孤儿场景。
- CI 变体仍写入唯一 GUID 的 HKCU 键；卸载器删除；清理失败可能残留 CI-only 键，不影响用户原安装。
- 回滚：删除 `ci-self-hosted-*` tag；停止/卸载 Runner；删除 `%LOCALAPPDATA%\Morrow\CI` 下本任务归档；不修改 main/release，不合并 PR #54，不发布 Release。

## 6. 独立复审

- 首轮复审（代码 SHA `ba8e479ebc12e960e5678fbcc33a34a35449fec9`）：**PARTIAL / PENDING_USER_ACTION，无 BLOCKER/HIGH**；3 个 MEDIUM：docs 未写 reviewed SHA、checksums 未覆盖 hidden/`.tmp` 文件、`processTree` 未持久化完整归属记录。报告：`docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review.md`。
- 修复（代码 SHA `e325b48859bda287f2b2b65cec79c8d2ad52a96b`）：checksums 改用 `-Force` 并移除 `.tmp` 排除；manifest 增加 `archive.readmeWritten`/`archive.errors`；`processTree.records` 写入完整 PID/PPID/路径/创建时间/原因；移除死代码 `Stop-ProcessesUnderPath`；`-ExcludePids` 同时作用于后代遍历。
- 最终复审（`e325b48`）：**PARTIAL / PENDING_USER_ACTION，无 BLOCKER/HIGH**；F2/F3/F4/F7/F10 已修复；F1 仅剩 docs 表述，已在本提交修正。报告：`docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review-r2.md`。
- 已知 LOW 残余（不阻塞，记录在案）：
  - manifest 本身写入失败时没有终态 manifest，只有 `finalization-error.txt` 和非零退出；
  - 父进程已退出且子进程可执行文件不在安装目录内的孤儿后代无法凭路径归属；
  - `Stopped` 在停止后未再复核，生产路径的 `Remaining`/`Errors` 仍准确；
  - 嵌套同名 `checksums.sha256` 文件或预先存在的 `run-manifest.json.tmp` 属于极端边界；
  - workflow 的 `if: always()` 归档路径打印在 runDir 创建前失败时可能显示上一个归档；
  - checkout 为 tag 固定，worktree 清洁度未写入 manifest。
