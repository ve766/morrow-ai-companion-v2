# 零新增账单的 CI 操作手册

## 1. 为什么不再自动跑 GitHub-hosted

- 免费包含 Actions compute 已用尽（用户 Billing 显示 Compute $12.00/$12.00，storage 0.5/0.5 GB）。
- PR #54 的托管 run 在进入任何 step 前失败，check-run annotation 为 “recent account payments have failed or your spending limit needs to be increased”。
- `.github/workflows/ci.yml` 已改为仅 `workflow_dispatch`，避免继续自动消耗 hosted minutes；原有 job/命令未删除。
- 不再反复 rerun hosted job 碰运气。

## 2. 一次性用户操作

1. 按 `docs/ci/self-hosted-runner-setup-windows.md` 注册本机 Windows Runner，labels：`self-hosted, Windows, X64, morrow-ci`。
2. 触发方式二选一：
   - 若 Actions 页面已出现 **Self-hosted Windows CI**：Run workflow → `feat/morrow-v2-final-closure`。`workflow_dispatch` 要求 workflow 已在默认分支 `main`；本任务不修改 main。
   - 否则用 tag 回退（推荐，且不需要 main）：在 PR #54 精确 HEAD 上执行
     `git tag ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)` 并 `git push origin <tag>`。guard 校验 tag 必须等于 `ci-self-hosted-<完整 SHA>`；tag 只触发 CI，不创建 Release。
3. 等 guard 与 verify 完成；若 Runner 离线，job 保持 queued，先启动本机 Runner。

Agent 不会远程注册或控制用户电脑；未注册前状态为 **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED**，不是 CI PASS。

## 3. 查看结果

- GitHub Actions job 页面：每个 step 的真实退出码与日志。
- 本机归档：`%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<full SHA>\`
  - `run-manifest.json`
  - `logs\`
  - `results\`（产品路径/连续性 JSON/transcript）
  - `installers\`（NSIS 安装包 + SHA256）
  - `screenshots\`（若 smoke 产生）
  - 安装验证：静默安装 NSIS 包后，对已安装的 `Morrow.exe` 运行 `scripts/smoke.mjs --verify-upgrade`（隔离 profile、期望版本 2.0.0）；日志在 `logs\NN-installed-app-smoke.log`
  - `checksums.sha256`
  - `README.txt`
- 本地归档不自动提交 git，不上传 GitHub artifact（storage 已满）。

## 4. 会产生 hosted usage / storage 的行为

- 手动运行 `.github/workflows/ci.yml`（GitHub-hosted）会消耗 compute minutes。
- `actions/upload-artifact` 会消耗 storage；自托管 workflow 默认不上传。
- 不要为了“看到绿色”重复触发 hosted run；使用自托管 workflow。

## 5. 失败处理

- 每个命令失败即停止后续依赖步骤，但 finally 仍归档日志/manifest。
- 每个 step 有超时（安装/卸载 180s，测试/打包按步骤设置）；超时会终止进程树并记录 `timedOut=true`。
- 日志脱敏后保存；脱敏后还会做二次 secret-pattern 扫描，若发现残留则抑制该 step 输出、阻止归档并整体 FAILED。
- NSIS 只安装到本次 run 目录的 `installed-app`；目标已存在/路径越界/reparse point 一律 fail closed。安装失败也会执行 finally，尝试卸载并只清理本次目录。
- 用户安装器 `release\Morrow-Setup-*.exe` 只构建并归档，不执行；实际安装的是每次 run 唯一 GUID、快捷方式名 `Morrow CI` 的 `release-ci\Morrow-CI-Setup-*.exe`，因此不会卸载用户已有 Morrow。
- 卸载失败或文件锁定：保留安装目录，`cleanup.status=CLEANUP_FAILED`，整体 FAILED，保留日志供排查。
- NSIS/安装/Electron smoke 若因宿主策略/0xC0000005 失败，记录真实错误，不改写为 PASS。
- 真实 Provider 403 BLOCKED_QUOTA、本地服务未启动保持外部阻塞，不重复空转。

## 6. 回滚/停止

- 停止 Runner：`svc.cmd stop` 或前台 Ctrl+C。
- 卸载 Runner：`config.cmd remove`，删除 `%LOCALAPPDATA%\Morrow\Runner`。
- 恢复 hosted 自动触发：仅在用户明确恢复额度后，手动把 `ci.yml` 的 `on` 改回 `pull_request`/`push`；Agent 不自动做。
- 归档清理：删除 `%LOCALAPPDATA%\Morrow\CI` 下旧目录即可；不删除 GitHub 历史证据。
