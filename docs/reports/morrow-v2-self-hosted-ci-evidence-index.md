# 自托管 CI 证据索引

- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 实现提交：见 PR #54 head（本文件所在提交）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

## 1. 文件

| 文件 | 用途 |
| --- | --- |
| `.github/workflows/self-hosted-ci.yml` | 手动 Windows 自托管完整验证 workflow |
| `.github/workflows/ci.yml` | 托管 workflow 改为仅 workflow_dispatch |
| `scripts/ci/run-self-hosted-ci.ps1` | 执行命令、记录退出码、脱敏日志、归档 manifest/installer/checksums |
| `scripts/ci/setup-self-hosted-runner.ps1` | 只读前置检查与官方注册步骤，不处理 token |
| `docs/ci/self-hosted-runner-setup-windows.md` | Runner 注册/启动/停止/更新/卸载 |
| `docs/ci/ci-no-billing-operations.md` | 零新增账单操作、queued/offline、归档、回滚 |
| `docs/reports/morrow-v2-self-hosted-ci-delivery-report.md` | 根因/设计/验证/未完成 |
| `docs/testing/morrow-v2-self-hosted-ci-acceptance-matrix.md` | 逐项状态 |

## 2. 静态验证命令

```powershell
python -c "import yaml; yaml.safe_load(open('.github/workflows/self-hosted-ci.yml', encoding='utf-8')); yaml.safe_load(open('.github/workflows/ci.yml', encoding='utf-8')); print('YAML OK')"
powershell -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/ci/run-self-hosted-ci.ps1"),[ref]$null,[ref]$e) > $null; if($e.Count){$e|%{$_.Message};exit 1}else{"run OK"}'
powershell -NoProfile -Command '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "scripts/ci/setup-self-hosted-runner.ps1"),[ref]$null,[ref]$e) > $null; if($e.Count){$e|%{$_.Message};exit 1}else{"setup OK"}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/run-self-hosted-ci.ps1 -ExpectedSha 0000000000000000000000000000000000000000
# 预期 exit 1，SHA mismatch，不执行后续命令
```

## 3. 真实 workflow_dispatch

**PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**：用户尚未注册 Runner，未执行。Runner 在线后运行：

- Actions → **Self-hosted Windows CI** → Run workflow → `feat/morrow-v2-final-closure`。
- 结果归档：`%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<sha>\run-manifest.json`。
- 不依赖 GitHub artifact upload；storage 不增加。

## 4. 现有托管 CI 证据（历史，不作为自托管 PASS）

- run `42027056929` / `42025990645` 等：4/4 job 0-step，billing/spending-limit annotation。
- 父代码 `6f5fe47` run `41995422882` 4/4 PASS，但不是冻结 SHA。

## 5. 安全/脱敏

- guard：repo/ref/actor 三重校验；无 checkout 在 guard 前；无 `pull_request_target`；无 hosted fallback。
- 脚本不接收 token；不自动注册；不打印环境变量。
- 日志脱敏 `Authorization: Bearer`、`sk-`、`api_key`。
- 归档在 `%LOCALAPPDATA%\Morrow\CI`，不在仓库；不自动提交/上传。
- 分支保护 API 在私有免费仓库不可读；required checks 需管理员手动确认。

## 6. 结论

代码/脚本/静态验证 PASS；真实自托管运行 PENDING_USER_ACTION。整体 **PARTIAL**，不是 COMPLETE，不是 CI PASS。
