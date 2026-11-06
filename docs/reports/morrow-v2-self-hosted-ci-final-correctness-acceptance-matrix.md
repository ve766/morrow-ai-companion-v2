# 自托管 CI 最终正确性验收矩阵（Issue #58）

- 基线 HEAD：`60a445e2a7aecf300816b8941ad4611c561aebe0`
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 每次运行创建全新唯一 runDir（GUID） | PASS | `New-UniqueRunDirectory`；探针 `run-dir-created`、`run-dir-subdirs` |
| 2 | 已存在目录绝不复用，旧目录字节/时间戳/文件集不变 | PASS | `run-dir-reuse-rejected`、`run-dir-old-bytes-unchanged`、`run-dir-old-timestamp-unchanged`、`run-dir-preexisting-*` |
| 3 | 目录创建原子、无 `-Force`、创建失败 fail closed | PASS | `New-Item` 无 `-Force`；静态探针 `runner-no-run-dir-force` |
| 4 | runDir 必须是 ArchiveRoot 严格子路径，SHA 无路径分隔符 | PASS | `run-dir-sha-traversal-rejected`；代码校验 |
| 5 | junction/reparse point 逃逸拒绝 | PASS | `run-dir-junction-rejected`、`run-dir-junction-outside-intact` |
| 6 | 在任何日志/manifest 前完成目录与边界校验并记录 runId | PASS | `run-identity.json` 先于步骤写入；缺失 Node 探针验证 |
| 7 | 状态机区分 RUNNING/PASS/FAILED/CLEANUP_FAILED | PASS | `Complete-RunArchive`；manifest 字段 |
| 8 | 测试/清理/README/checksum/manifest/校验均纳入终态 | PASS | 终态顺序；故障注入 3 项 |
| 9 | manifest 与最终退出码严格一致 | PASS | 缺失 Node 探针 `FAILED/exitCode=1`；正常路径 `PASS/0` |
| 10 | README 失败 → FAILED，无 PASS manifest | PASS | `manifest-readme-failure` |
| 11 | checksum 失败 → FAILED，无 PASS manifest | PASS | `manifest-checksum-failure` |
| 12 | manifest 写入失败 → FAILED，无 PASS manifest | PASS | `manifest-write-failure` |
| 13 | archive 失败状态保留 | PASS | `manifest-archive-failure-preserved` |
| 14 | checksum 无循环、可独立复现 | PASS | `manifest-normal-no-cycle`；`checksumsFileSha256` 复算一致 |
| 15 | 进程树归属记录（PID/PPID/路径/创建时间/原因） | PASS | `Get-OwnedProcesses`；`process-tree-owned-root` |
| 16 | 多级父子与快速退出父进程的子进程被识别 | PASS | `process-tree-child-owned`、`process-tree-child-stopped` |
| 17 | 不按进程名全局终止，不触碰用户进程 | PASS | 静态 `runner-no-name-taskkill`；`process-tree-user-process-not-owned` |
| 18 | PID/路径不匹配不误杀 | PASS | `process-tree-pid-path-mismatch`、`process-tree-no-mismatch-kill` |
| 19 | 权限拒绝/超时 → CLEANUP_FAILED 并保留证据 | PASS | `process-tree-access-denied`、`process-tree-timeout-remaining` |
| 20 | 仅进程树确认退出后才卸载/删除 | PASS（代码审查） | runner `treeOk` 门控；`uninstall skipped` 分支 |
| 21 | 原有 56 项探针继续通过 | PASS | 92 项总探针，0 FAIL |
| 22 | PS 5.1 parser、typecheck、全量测试、YAML、diff check | PASS | Parser 3/3；typecheck 0；129 files / 1156 tests；YAML OK；`git diff --check` 0 |
| 23 | 不修改产品运行时/schema/测试语义 | PASS | diff 仅 scripts/ci + docs |
| 24 | 独立复审最终代码 SHA | PASS（无 BLOCKER/HIGH） | 最终复审 `e325b48`：`docs/audit/morrow-v2-self-hosted-ci-final-correctness-independent-review-r2.md`；首轮 `ba8e479` 的 3 个 MEDIUM 已修复 |
| 25 | 真实 NSIS 安装/卸载 | **PENDING_USER_ACTION** | 宿主 NSIS 构建被策略阻塞 |
| 26 | 真实 self-hosted workflow | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** | 0 runners，0 runs |
| 27 | PR #54 保持 OPEN、未合并、未发布 Release | PASS | `gh pr view 54` OPEN |
| 28 | manifest 写入失败时保留最小诊断 | PASS（LOW 残余） | `finalization-error.txt` + exit 1；无 PASS manifest |
| 29 | 父进程退出且路径在安装目录外的孤儿后代 | 残余（LOW） | 已记录；Electron 子进程均在安装目录内 |
| 30 | 嵌套同名 checksums / 预存 manifest tmp | 残余（LOW） | 极端边界，已记录 |

## 结论

三个正确性缺口均已修复并通过 92 项 PS 5.1 探针、typecheck 与全量测试；最终独立复审 `e325b48` 无 BLOCKER/HIGH。真实 NSIS/self-hosted 运行仍为 PENDING_USER_ACTION。整体 **PARTIAL / PENDING_USER_ACTION**，不是 COMPLETE，不是 CI PASS。
