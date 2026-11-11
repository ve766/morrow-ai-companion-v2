# 自托管 CI 验收矩阵

- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 复审修复提交：`d5ae25df072156b7a302fb8dffca32cccdcc3728`（parent `ee24aa5`）
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | workflow YAML 可解析 | PASS | `python yaml.safe_load` 两个文件；`on=[workflow_dispatch, push]` |
| 2 | 仅手动触发，无 pull_request_target | PASS | `workflow_dispatch` + `ci-self-hosted-*` tag；无 PR 事件 |
| 3 | guard 校验 repo/ref/actor/triggering_actor | PASS | guard `if` 表达式；不通过不调度 verify |
| 4 | tag 回退校验 tag 名 == `ci-self-hosted-<完整 SHA>` | PASS | guard step 比较 `GITHUB_REF_NAME` 与 `GITHUB_SHA` |
| 5 | runner labels 一致 | PASS | `[self-hosted, Windows, X64, morrow-ci]`；文档一致 |
| 6 | 无 hosted fallback | PASS | 无 `windows-latest`/`ubuntu-latest` 在自托管 workflow |
| 7 | 无 artifact upload/默认关闭 | PASS | 无 `upload-artifact`；归档本地 |
| 8 | 无权限提升 | PASS | `permissions: contents: read` |
| 9 | checkout 触发 SHA | PASS | `ref: ${{ github.sha }}` + `git rev-parse` 校验 |
| 10 | PowerShell 5.1 兼容 | PASS | 所有 step `shell: powershell`；setup 脚本 PS 5.1 exit 0 |
| 11 | 每条命令真实退出码 | PASS | `Invoke-CiStep` 检查 `$LASTEXITCODE`，失败 throw |
| 12 | 完整命令集 | PASS（静态） | typecheck/test/evaluate/cognition/build/smoke/product-path/persistence/package |
| 13 | 安装包静默安装 + 已安装应用 smoke | PASS（实现）/ PENDING（执行） | NSIS `/S` + `smoke.mjs --verify-upgrade`；需 Runner 实机执行 |
| 14 | 本地归档 manifest/logs/results/installers/screenshots/checksums | PASS（脚本） | `run-self-hosted-ci.ps1` |
| 15 | 只归档本次 run 新文件 | PASS（脚本） | `LastWriteTimeUtc -ge $runStart` 过滤；截图逐文件复制并保留结构 |
| 16 | 控制台 + 日志脱敏 | PASS | `Redact-Text` 同时写日志和 `Write-Host`；整段引号值替换，探针覆盖 `"authorization": "Bearer …"`、`"apiKey": "… …"` |
| 17 | Node 22 硬性检查 | PASS | run 脚本第 61-63 行；setup 脚本第 14 行 |
| 18 | 不读取真实用户数据 | PASS（设计） | 隔离 profile；归档在 LOCALAPPDATA |
| 19 | 不修改产品运行时/schema/测试 | PASS | 本轮仅 CI 文件/脚本/文档 |
| 20 | PowerShell 语法 | PASS | Parser 检查 `run OK`、`setup OK` |
| 21 | SHA guard 错误 SHA | PASS | exit 1，未执行后续命令 |
| 22 | 用户 Runner 注册 | **PENDING_USER_ACTION** | 用户尚未注册；见 setup 文档 |
| 23 | 真实自托管运行（dispatch 或 tag） | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** | 未执行；不得标 CI PASS |
| 24 | 真实 NSIS/安装/启动 | **PENDING_USER_ACTION** | 脚本已实现；取决于 Runner 宿主；失败需保留日志 |
| 25 | 无新增 hosted compute/storage | PASS（设计） | 托管 workflow 手动；无 artifact upload |
| 26 | main/release 未被修改 | PASS | 本分支改动；`main`/`release` 仍为旧触发 |
| 27 | tag 触发的 workflow 来源风险 | 残余（P3） | workflow 取自被 tag 提交；仅写权限协作者可利用，非 fork 提权；见交付报告第 6 节 |
| 28 | 独立复审 | PARTIAL | pre-fix BLOCKED 与 post-fix 复审文档均在 `docs/audit/`；未把 PENDING 改写为 PASS |

## 结论

代码/脚本/静态验收 PASS；真实自托管执行与安装验证 PENDING_USER_ACTION。整体 **PARTIAL**；在用户注册 Runner 并完成一次真实自托管 run 前，不得标 COMPLETE 或 CI PASS。
