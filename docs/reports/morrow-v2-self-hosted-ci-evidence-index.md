# 自托管 CI 证据索引

- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 首版实现提交：`ee24aa5b00db6eac91509a56ce2fde2c259e54c7`（parent `70e89f1`）
- 复审修复提交：`d5ae25df072156b7a302fb8dffca32cccdcc3728`（parent `ee24aa5`）
- 复审收口提交：`53acb9cfe81321d5bcac0988aa3538ee8693d85b`（parent `902cf5e`）
- 最终 HEAD 与 parent：以 Issue #56 comment 为准（PR #54 head）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

## 1. 文件

| 文件 | 用途 |
| --- | --- |
| `.github/workflows/self-hosted-ci.yml` | 手动 Windows 自托管完整验证 workflow（workflow_dispatch + `ci-self-hosted-<SHA>` tag） |
| `.github/workflows/ci.yml` | 托管 workflow 改为仅 workflow_dispatch |
| `scripts/ci/run-self-hosted-ci.ps1` | 执行命令、记录退出码、控制台/日志脱敏、安装+启动 smoke、归档 manifest/installer/checksums |
| `scripts/ci/setup-self-hosted-runner.ps1` | 只读前置检查与官方注册步骤，不处理 token |
| `docs/ci/self-hosted-runner-setup-windows.md` | Runner 注册/启动/停止/更新/卸载 + workflow_dispatch/tag 两种触发 |
| `docs/ci/ci-no-billing-operations.md` | 零新增账单操作、queued/offline、归档、回滚 |
| `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | 根因/设计/验证/未完成 |
| `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | 逐项状态 |

## 2. 静态验证命令与实测结果

```powershell
python -c "import yaml; yaml.safe_load(open('.github/workflows/self-hosted-ci.yml', encoding='utf-8')); yaml.safe_load(open('.github/workflows/ci.yml', encoding='utf-8')); print('YAML OK')"
# 实测：YAML OK；on=[workflow_dispatch, push]；jobs=[guard, verify]；ci_on=[workflow_dispatch]

powershell -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/ci/run-self-hosted-ci.ps1"),[ref]$null,[ref]$e) > $null; if($e.Count){$e|%{$_.Message};exit 1}else{"run OK"}'
# 实测：run OK

powershell -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/ci/setup-self-hosted-runner.ps1"),[ref]$null,[ref]$e) > $null; if($e.Count){$e|%{$_.Message};exit 1}else{"setup OK"}'
# 实测：setup OK

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/setup-self-hosted-runner.ps1
# 实测：exit 0（Windows PowerShell 5.1）；node v22.23.2 / npm 10.9.8 / git 2.55.0

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha 0000000000000000000000000000000000000000
# 实测：exit 1，Checkout SHA mismatch；未创建归档、未执行后续命令
```

脱敏探针（用 Parser 提取 `Redact-Text` 后直接调用）实测输出：

```
Authorization: [REDACTED] [REDACTED]
Authorization: [REDACTED] [REDACTED]
{"apiKey": "[REDACTED]", "api_key": "[REDACTED]"}
[REDACTED]
```

## 3. 真实自托管运行

**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**：用户尚未注册 Runner，未执行。Runner 在线后二选一：

- 若默认分支已有 workflow：Actions → **Self-hosted Windows CI** → Run workflow → `feat/morrow-v2-final-closure`。
- 否则 tag 回退（无需 main）：
  ```bash
  git fetch origin feat/morrow-v2-final-closure
  git tag ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)
  git push origin ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)
  ```
  guard 校验 tag 名 == `ci-self-hosted-<完整 SHA>`；tag 不创建 Release。

结果归档：`%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<sha>\run-manifest.json`。不依赖 GitHub artifact upload；storage 不增加。

## 4. 现有托管 CI 证据（历史，不作为自托管 PASS）

- run `42027056929` / `42025990645` 等：4/4 job 0-step，billing/spending-limit annotation。
- 父代码 `6f5fe47` run `41995422882` 4/4 PASS，但不是冻结 SHA。

## 5. 安全/脱敏

- guard：repo/ref/actor/triggering_actor 四重校验；guard 不 checkout；verify 仅在 guard success 后运行；无 `pull_request_target`；无 hosted fallback。
- 脚本不接收 token；不自动注册；不打印环境变量。
- 控制台与文件日志都经过 `Redact-Text`：`Authorization: Bearer|token|basic`、`sk-`、`ghp_`/`github_pat_`、JSON 引号 `apiKey`/`api_key`/`token`/`authorization`。
- 归档在 `%LOCALAPPDATA%\Morrow\CI`，不在仓库；只收录本次 run 新生成的文件；不自动提交/上传。
- 分支保护 API 在私有免费仓库不可读；required checks 需管理员手动确认。

## 6. 独立复审

- 复审文档：
  - `docs/audit/morrow-v2-self-hosted-ci-independent-review.md`（冻结 HEAD `ee24aa5`，pre-fix：BLOCKED，F1-F12）
  - `docs/audit/morrow-v2-self-hosted-ci-independent-review-postfix.md`（冻结 HEAD `902cf5e`，post-fix：F1/F2/F7 PASS，F3 实现 PASS/执行 PENDING，F4/F5/F6 PARTIAL，F8 待 Issue comment 补齐）
- 复审指出的 F4（JSON 引号值尾部泄漏）、F5（截图目录 mtime）、F6（BOM/Pop-Location）已在 `53acb9c` 修复；F12（tag 触发的 workflow 来自被 tag 提交）作为残余风险记录，不构成越权。
- 本文件不把复审的 PENDING/BLOCKED 项改写为 PASS。

## 7. 结论

代码/脚本/静态验证 PASS；真实自托管运行 PENDING_USER_ACTION。整体 **PARTIAL**，不是 COMPLETE，不是 CI PASS。
