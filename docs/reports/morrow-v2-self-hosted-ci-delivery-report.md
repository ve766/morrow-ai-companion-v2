# Morrow V2 自托管 CI 交付报告（Issue #56）

- Repo: https://github.com/ve766/morrow-ai-companion-v2
- PR: https://github.com/ve766/morrow-ai-companion-v2/pull/54
- Branch: `feat/morrow-v2-final-closure`
- Base: `release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 最终状态：**PARTIAL / PENDING_USER_ACTION**（代码/脚本/静态验收完成；用户尚未注册 Runner，未执行真实 workflow_dispatch）

## 1. 根因证据

- PR #54 托管 run `42011815669`、`42018244011`、`42023327920`、`42025990645`、`42027056929` 均 4/4 job 0-step 失败。
- 每个 job：`runner_id=0`、`runner_name=""`、`steps=[]`，2–3 秒结束，无 job 日志。
- check-run annotation：`The job was not started because recent account payments have failed or your spending limit needs to be increased.`
- 用户 Billing：Compute $12.00/$12.00；Actions storage 0.5/0.5 GB；billable usage 当前 $0，但托管额度已耗尽。
- 父代码 `6f5fe47` run `41995422882` 4/4 PASS，但**不能替代冻结 SHA**。
- workflow 在绿色 run 后未变；不是 YAML/测试失败。

## 2. 方案

- 新增 `.github/workflows/self-hosted-ci.yml`：仅 `workflow_dispatch`，`runs-on: [self-hosted, Windows, X64, morrow-ci]`。
- guard job：repo/ref/actor 三重校验；不 checkout；不通过则 verify 不调度。
- verify job：checkout 触发 SHA；Node 22 检查；`npm ci`；Electron 二进制按需安装；typecheck、全量 test、evaluate、evaluate:cognition、build、smoke、product-path、persistence/migration、`package:win`。
- 无 hosted fallback、无 `pull_request_target`、无 artifact upload、无权限提升。
- `.github/workflows/ci.yml` 改为仅 `workflow_dispatch`，保留原 job/命令，避免额度耗尽时自动产生失败 run。
- 本地归档：`%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<sha>`，含 manifest/logs/results/installers/screenshots/checksums/README；日志脱敏；不自动提交 git。

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

## 4. 静态/本地验证

| 检查 | 结果 |
| --- | --- |
| YAML 解析（self-hosted-ci.yml、ci.yml） | PASS |
| PowerShell 语法解析（两个脚本） | PASS |
| SHA guard（错误 SHA） | PASS，exit 1，未执行后续命令 |
| 脚本包含每条命令 `$LASTEXITCODE` 检查 | PASS |
| 无 token 参数/自动注册/自动抓取 token | PASS |
| 无 `pull_request_target`/hosted fallback/continue-on-error | PASS |
| 无 artifact upload | PASS |
| 归档路径在仓库外 | PASS |
| 日志脱敏（Bearer/sk-/api_key） | PASS（代码审查） |
| 未修改产品运行时/schema/测试 | PASS |

## 5. 未执行/待用户

- 用户尚未注册 Windows 自托管 Runner，因此没有真实 `workflow_dispatch` run。
- 状态：**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**，不是 CI PASS。
- 用户按 `docs/ci/self-hosted-runner-setup-windows.md` 注册后，手动运行 Self-hosted Windows CI；结果归档在本机。
- 若 Runner 在线后 NSIS/安装/Electron smoke 仍因宿主策略或 0xC0000005 失败，记录真实失败，不改写为 PASS。
- 真实 Provider/本地服务仍为外部阻塞，不重复空转。

## 6. 风险与回滚

- 自托管 Runner 在用户电脑执行仓库代码；guard 只允许 repo/ref/actor，且 workflow_dispatch 手动触发；不要注册 organization-wide。
- Runner 使用专用低权限用户；CI 使用隔离 profile，不读取真实用户数据。
- 分支保护 API 在私有免费仓库不可读；如存在 required checks，需要管理员手动确认/调整，Agent 不猜测。
- 回滚：停止/卸载 Runner；把 `ci.yml` 触发器恢复为手动确认后的策略；删除本地归档不影响 GitHub 历史证据。
- 不自动合并 PR、不发布正式 Release、不修改 main/release。
