# Morrow V2 自托管 CI 交付报告（Issue #56）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 首版实现提交：`ee24aa5b00db6eac91509a56ce2fde2c259e54c7`（parent `70e89f1`）
- 复审修复提交：`d5ae25df072156b7a302fb8dffca32cccdcc3728`（parent `ee24aa5`）
- 复审收口提交：`53acb9cfe81321d5bcac0988aa3538ee8693d85b`（parent `902cf5e`；脱敏/归档/manifest 收口）
- 最终 HEAD 与 parent：以 Issue #56 comment 为准（PR #54 head）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**（代码/脚本/静态验收完成；用户尚未注册 Runner，未执行真实自托管 run）

## 1. 根因证据

- PR #54 托管 run `42011815669`、`42018244011`、`42023327920`、`42025990645`、`42027056929` 均 4/4 job 0-step 失败。
- 每个 job：`runner_id=0`、`runner_name=""`、`steps=[]`，2–3 秒结束，无 job 日志。
- check-run annotation：`The job was not started because recent account payments have failed or your spending limit needs to be increased.`
- 用户 Billing：Compute $12.00/$12.00；Actions storage 0.5/0.5 GB；billable usage 当前 $0，但托管额度已耗尽。
- 父代码 `6f5fe47` run `41995422882` 4/4 PASS，但**不能替代冻结 SHA**。
- workflow 在绿色 run 后未变；不是 YAML/测试失败。

## 2. 方案

- 新增 `.github/workflows/self-hosted-ci.yml`：
  - `workflow_dispatch`（默认分支已含该文件时可用）。
  - tag 回退：push `ci-self-hosted-*`。GitHub 允许 push 事件使用被推送 ref 上的 workflow，因此**不需要修改 main** 即可触发；guard 校验 tag 名必须等于 `ci-self-hosted-<完整 SHA>`，tag 只触发 CI，不创建 Release。
  - `runs-on: [self-hosted, Windows, X64, morrow-ci]`；无 hosted fallback。
  - guard job：repo/ref/actor/triggering_actor 四重校验；不 checkout；不通过则 verify 不调度。
  - verify job：checkout 触发 SHA；`git rev-parse` 二次校验；Node 22 硬性检查；`npm ci`；Electron 二进制按需安装；typecheck、全量 test、evaluate、evaluate:cognition、build、smoke、product-path、persistence/migration、`package:win`；NSIS `/S` 静默安装；对已安装 `Morrow.exe` 运行 `scripts/smoke.mjs --verify-upgrade`（隔离 profile、期望版本 2.0.0）。
  - 所有 step 使用 `shell: powershell`（Windows PowerShell 5.1），不要求 PowerShell 7。
- 无 `pull_request_target`、无 artifact upload、无权限提升、无 `continue-on-error`。
- `.github/workflows/ci.yml` 改为仅 `workflow_dispatch`，保留原 job/命令，避免额度耗尽时自动产生失败 run。该改动只在本分支；`main`/`release` 仍为旧触发（任务禁止修改）。
- 本地归档：`%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<sha>`，含 manifest/logs/results/installers/screenshots/checksums/README。
  - 只归档本次 run 开始后产生的文件（`LastWriteTimeUtc -ge runStart`），避免把上一次的截图/结果/安装包当成本次证据。
  - 控制台与日志都经过 `Redact-Text`：`Authorization: Bearer|token|basic`、`sk-`、`ghp_`/`github_pat_`、JSON 引号形式的 `apiKey`/`api_key`/`token`/`authorization`。
  - 不自动提交 git，不上传 GitHub artifact。

## 3. 交付文件

- `.github/workflows/self-hosted-ci.yml`
- `.github/workflows/ci.yml`（仅触发策略）
- `scripts/ci/run-self-hosted-ci.ps1`
- `scripts/ci/setup-self-hosted-runner.ps1`
- `docs/ci/self-hosted-runner-setup-windows.md`
- `docs/ci/ci-no-billing-operations.md`
- `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md`
- `docs/reports/morrow-v2-self-hosted-ci-evidence-index.md`
- `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md`

## 4. 静态/本地验证（本机 Windows，Windows PowerShell 5.1）

| 检查 | 结果 |
| --- | --- |
| YAML 解析（self-hosted-ci.yml、ci.yml） | PASS：`on=[workflow_dispatch, push]`；jobs=`[guard, verify]`；`ci_on=[workflow_dispatch]` |
| PowerShell 语法解析（两个脚本） | PASS：`run OK`、`setup OK` |
| setup 前置检查（`powershell -File`，PS 5.1） | PASS：exit 0，node v22.23.2 / npm 10.9.8 / git 2.55.0 |
| SHA guard（错误 SHA） | PASS：exit 1，`Checkout SHA mismatch`，未创建归档、未执行命令 |
| 脱敏探针（Bearer/token/Basic、JSON 引号 apiKey/api_key、sk-） | PASS：全部替换为 `[REDACTED]` |
| 脚本每条命令 `$LASTEXITCODE` 检查 | PASS（代码审查 + 探针） |
| 无 token 参数/自动注册/自动抓取 token | PASS |
| 无 `pull_request_target`/hosted fallback/continue-on-error | PASS |
| 无 artifact upload | PASS |
| 归档路径在仓库外 + 仅本次新文件 | PASS（代码审查） |
| Node 22 硬性检查 | PASS（脚本第 61-63 行；setup 脚本同） |
| 未修改产品运行时/schema/测试 | PASS（diff 仅 workflow/scripts/docs） |

## 5. 未执行/待用户

- 用户尚未注册 Windows 自托管 Runner，因此没有真实自托管 run（`workflow_dispatch` 或 tag）。
- 状态：**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**，不是 CI PASS。
- 用户按 `docs/ci/self-hosted-runner-setup-windows.md` 注册后，用 4.1 或 4.2 触发；结果归档在本机。
- 若 Runner 在线后 NSIS/安装/Electron smoke 仍因宿主策略或 0xC0000005 失败，记录真实失败，不改写为 PASS。
- 真实 Provider/本地服务仍为外部阻塞，不重复空转。

## 6. 风险与回滚

- 自托管 Runner 在用户电脑执行仓库代码；guard 只允许 repo/ref/actor/triggering_actor，触发是手动的；不要注册 organization-wide。
- tag 触发是 push 事件：任何能推送 `ci-self-hosted-*` tag 的写权限成员都会触发；guard 仍限制 actor/triggering_actor 为 `ve766`，且 tag 名必须等于 SHA。用完可删除 tag（不删除 workflow、不删除历史证据）。
- tag 触发的 workflow 文件来自被 tag 的提交。有写权限的协作者若推送一个改动 workflow 的提交并在其上打 tag，可绕过 actor 白名单；但该协作者本就有分支写权限，不构成越权或 fork 提权。若要绝对白名单，需在 guard 增加“tag 提交必须是被信任分支的祖先”校验；本轮未实现，记录为残余风险。
- Runner 使用专用低权限用户；CI 使用隔离 profile，不读取真实用户数据。
- 分支保护 API 在私有免费仓库不可读；如存在 required checks，需要管理员手动确认/调整，Agent 不猜测。
- `actions/checkout@v4` 为 tag 固定而非 SHA 固定；与现有 workflow 一致，属于后续供应链加固项。
- 回滚：停止/卸载 Runner；删除 `ci-self-hosted-*` tag；把 `ci.yml` 触发器恢复为手动确认后的策略；删除本地归档不影响 GitHub 历史证据。
- 不自动合并 PR、不发布正式 Release、不修改 main/release。
