# 自托管 CI 验收矩阵

- 基线 HEAD：`70e89f1d92975d506e803fff511b83191c9148d0`
- 最终状态：**PARTIAL / PENDING_USER_ACTION**

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | workflow YAML 可解析 | PASS | `python yaml.safe_load` 两个文件 |
| 2 | 仅 workflow_dispatch，无 pull_request_target | PASS | `self-hosted-ci.yml`、`ci.yml` 审查 |
| 3 | guard 校验 repo/ref/actor | PASS | guard job + 表达式；未通过不调度 verify |
| 4 | runner labels 一致 | PASS | `[self-hosted, Windows, X64, morrow-ci]`；文档一致 |
| 5 | 无 hosted fallback | PASS | 无 `windows-latest`/`ubuntu-latest` 在自托管 workflow |
| 6 | 无 artifact upload/默认关闭 | PASS | 无 `upload-artifact`；归档本地 |
| 7 | 无权限提升 | PASS | `permissions: contents: read` |
| 8 | checkout 触发 SHA | PASS | `ref: ${{ github.sha }}` + `git rev-parse` 校验 |
| 9 | 每条命令真实退出码 | PASS | `Invoke-CiStep` 检查 `$LASTEXITCODE`，失败 throw |
| 10 | 完整命令集 | PASS（静态） | typecheck/test/evaluate/cognition/build/smoke/product-path/persistence/package |
| 11 | 本地归档 manifest/logs/results/installers/screenshots/checksums | PASS（脚本） | `run-self-hosted-ci.ps1` |
| 12 | 日志脱敏 | PASS（脚本审查） | Bearer/sk-/api_key 正则替换 |
| 13 | 不读取真实用户数据 | PASS（设计） | 隔离 profile；归档在 LOCALAPPDATA |
| 14 | 不修改产品运行时/schema/测试 | PASS | 本轮仅 CI 文件/脚本/文档 |
| 15 | PowerShell 语法 | PASS | Parser 检查 |
| 16 | SHA guard 错误 SHA | PASS | exit 1，未执行后续命令 |
| 17 | 用户 Runner 注册 | **PENDING_USER_ACTION** | 用户尚未注册；见 setup 文档 |
| 18 | 真实 workflow_dispatch 完整运行 | **PENDING_USER_ACTION / BLOCKED_RUNNER_NOT_REGISTERED** | 未执行；不得标 CI PASS |
| 19 | 真实 NSIS/安装/启动 | **PENDING_USER_ACTION / BLOCKED_HOST** | 取决于 Runner 宿主；失败需保留日志 |
| 20 | 无新增 hosted compute/storage | PASS（设计） | 托管 workflow 手动；无 artifact upload |

## 结论

代码/脚本/静态验收 PASS；真实自托管执行与安装验证 PENDING_USER_ACTION。整体 **PARTIAL**；在用户注册 Runner 并完成一次真实 workflow_dispatch 前，不得标 COMPLETE 或 CI PASS。
