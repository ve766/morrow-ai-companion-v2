# Windows 自托管 Runner 设置指南（Morrow V2）

本指南把 PR #54 的 CI 从已耗尽额度的 GitHub-hosted runner 转移到用户自己的 Windows 电脑。**不要求购买 C1、升级套餐、添加付款方式或提高预算。** Runner 注册 token 只在本机 GitHub 页面交互输入，不进入仓库、脚本参数、日志或聊天。

## 1. 前置条件

- Windows 10/11 x64
- Windows PowerShell 5.1+（workflow 使用 `shell: powershell`，不要求 PowerShell 7）
- Node.js 22+、npm、git
- 至少 5 GB 空闲磁盘
- 仓库为私有仓库 `ve766/morrow-ai-companion-v2`
- 建议使用专用低权限 Windows 用户；不要用日常管理员账户运行 Runner

## 2. 安全前置检查

在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ci/setup-self-hosted-runner.ps1
```

脚本只做只读检查、创建 Runner 目录、打印官方注册步骤；它**不读取、不接收、不保存 registration token**。

## 3. 注册 Runner（官方交互流程）

1. 打开 `https://github.com/ve766/morrow-ai-companion-v2/settings/actions/runners/new`。
2. 选择 Windows x64，下载 GitHub 页面提供的 runner 压缩包。
3. 按页面显示的 SHA256 校验压缩包。
4. 解压到 `%LOCALAPPDATA%\Morrow\Runner`（或脚本打印的目录）。
5. 在普通 PowerShell 中运行 `config.cmd`，按提示：
   - 仓库 URL：`https://github.com/ve766/morrow-ai-companion-v2`
   - 粘贴 GitHub 页面生成的短期 registration token（只在交互提示中）
   - Runner name：例如 `morrow-win-01`
   - Labels：`self-hosted,Windows,X64,morrow-ci`
   - Work folder：`_work`
6. 启动：
   - 前台：`run.cmd`
   - 服务：`svc.cmd install` 然后 `svc.cmd start`（需本机权限；按官方 runner 文档）
7. 在 Settings → Actions → Runners 确认状态为 **Idle/Online**。

不要把 token 写入脚本、命令历史、截图、Issue、PR 或本仓库。不要注册成 organization-wide 或共享给其他仓库。

## 4. 运行自托管 CI

### 4.1 首选：workflow_dispatch

1. 在 GitHub Actions 页面选择 **Self-hosted Windows CI**。
2. 点击 **Run workflow**，选择分支 `feat/morrow-v2-final-closure`。

> GitHub 要求 `workflow_dispatch` 的 workflow 文件已存在于默认分支 `main`。本任务不允许修改 main；如果 Actions 页面没有 Run workflow，使用 4.2 的 tag 触发。

### 4.2 无默认分支改动：tag 触发

在 PR #54 的精确 HEAD 上创建并推送 tag：

```bash
git fetch origin feat/morrow-v2-final-closure
git tag ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)
git push origin ci-self-hosted-$(git rev-parse origin/feat/morrow-v2-final-closure)
```

workflow 的 guard 会校验 tag 名必须等于 `ci-self-hosted-<完整 SHA>`、repo/actor 受信；checkout 的 SHA 就是该 tag 指向的提交。tag 只用于触发，不创建 Release。

guard 通过后，checkout 触发 SHA，执行完整验证并归档到 `%LOCALAPPDATA%\Morrow\CI\<UTC timestamp>-<sha>`。不依赖 GitHub Actions artifact upload；storage 用量不增加。

## 5. Runner 离线 / 队列

- Runner 离线时 workflow_dispatch 的 job 会保持 queued；不会自动切回 GitHub-hosted runner。
- 启动本机 Runner 后再手动运行；不要重复点击创建多个 run。
- 同一 ref 使用 concurrency，避免同一台电脑并行跑多个高负载构建。
- 停止：前台 `Ctrl+C`；服务 `svc.cmd stop`。
- 更新：停止服务，替换 runner 目录为新版本，重新配置（token 重新从页面获取）。
- 卸载：`config.cmd remove`，删除 `%LOCALAPPDATA%\Morrow\Runner`。

## 6. 数据隔离

- CI 使用仓库自己的临时/隔离 profile；不读取用户真实 `%APPDATA%\morrow-ai-companion` 数据、Provider keys、浏览器配置或个人文件。
- 归档目录默认在 `%LOCALAPPDATA%\Morrow\CI`，不在仓库内，不会被 git 提交。
- 日志会脱敏 `Authorization: Bearer …`、`sk-…`、`api_key=…`；仍建议用户上传 Issue 前人工复核。

## 7. 当前限制

- 自托管 Runner 不提供 Ubuntu 环境；本轮只交付 Windows 全量验收。Linux 兼容性需要用户已有 WSL/Docker，不能作为付费前置条件。
- GitHub-hosted workflow 已改为 `workflow_dispatch` 手动触发，避免额度耗尽时自动产生 4 个失败 job。
- 分支保护 API 在私有免费仓库不可读；若仓库有 required checks，需要管理员在 Settings 中手动确认/调整，Agent 不猜测。
- 自托管 workflow 需要先存在于默认分支才能用 workflow_dispatch；否则使用 4.2 的 tag 触发。
