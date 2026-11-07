# Self-hosted CI Guard 安全策略与运行状态

- 工作流：`.github/workflows/self-hosted-ci.yml`
- 策略源：`scripts/ci/guard-policy.ts`
- 测试：`tests/ci-guard-policy.test.ts`（4 tests）
- 状态：**代码修复完成；真实 CI run = BLOCKED**（workflow 不在默认分支 + Runner 未注册）

## 1. 修复前问题

原 guard 条件：

```yaml
github.repository == 've766/morrow-ai-companion-v2' &&
(github.ref == 'refs/heads/feat/morrow-v2-final-closure' ||
 startsWith(github.ref, 'refs/tags/ci-self-hosted-')) &&
github.actor == 've766' &&
github.triggering_actor == 've766'
```

目标分支 `feat/morrow-v2-product-complete-20261106` 不在白名单，guard job 被 skipped，verify 因 `needs.guard.result == 'success'` 也 skipped；GitHub 可能把整个 run 显示为成功，形成“触发了但没验证”的假象。

## 2. 修复

### 2.1 可信触发策略

仅允许：

- `workflow_dispatch` + 以下显式分支之一：
  - `refs/heads/feat/morrow-v2-final-closure`
  - `refs/heads/feat/morrow-v2-product-complete-20261106`
  - `refs/heads/feat/morrow-v2-product-closure-20261107`
- `push` + `refs/tags/ci-self-hosted-*`，且 tag 名必须严格等于 `ci-self-hosted-${GITHUB_SHA}`。

同时校验：

- `github.repository == 've766/morrow-ai-companion-v2'`
- `github.actor == 've766'` 且 `github.triggering_actor == 've766'`
- 不使用 `pull_request_target`；不执行 fork PR 代码。

### 2.2 Guard skipped 不得显示绿色

新增 `guard-outcome` job：

```yaml
needs: [guard, verify]
if: always()
steps:
  - run: |
      $guard = '${{ needs.guard.result }}'
      $verify = '${{ needs.verify.result }}'
      if ($guard -ne 'success' -or $verify -ne 'success') {
        throw "Self-hosted verification is not successful ..."
      }
```

三个 job 均显式 `continue-on-error: false`。guard/verify/outcome 任一步失败或 skipped，最终 job 失败。

### 2.3 安全边界

- guard job 不 checkout 仓库代码。
- verify checkout 精确 `github.sha`，`fetch-depth: 1`，`persist-credentials: false`。
- checkout 后再次 `git rev-parse HEAD` 与触发 SHA 比对。
- 工作区清理/凭据不落盘由既有 `scripts/ci/run-self-hosted-ci.ps1` 负责；本轮未削弱。
- 不新增 GitHub-hosted runner，不产生 Actions 计费。

## 3. 自动化验证

```bash
npx vitest run tests/ci-guard-policy.test.ts
# 4 passed
```

覆盖：

- 三个白名单分支全部允许。
- 未登记分支、fork repository、错误 actor/triggering_actor 拒绝。
- 正确 tag 允许；错误 tag 名/错误 SHA 拒绝。
- workflow 文本包含白名单、`guard-outcome` 和终态失败条件。

## 4. 真实 dispatch 状态：BLOCKED

事实：

1. `gh run list --workflow self-hosted-ci.yml` 返回 HTTP 404：该 workflow 只存在于特性分支，默认分支没有它；GitHub 的 `workflow_dispatch` 入口无法在当前分支出现。
2. #56/#57 最新评论确认 Runner 未注册，历史状态为 `PARTIAL / PENDING_USER_ACTION`。
3. 因此本轮不能产生真实 runner/steps/log，也不能标记 CI PASS。

最短解阻动作（需仓库管理员）：

1. 将本任务 PR 合并到默认分支，或先把 workflow 文件提交到默认分支（仅 workflow，不含产品代码）。
2. 在自托管 Runner 注册并上线后，对目标分支 dispatch。
3. 只有出现 runner_id、guard/verify steps、checkout SHA 日志与归档路径，才能记录 CI PASS。

## 5. 复现命令（Runner 可用后）

```powershell
gh workflow run self-hosted-ci.yml --ref feat/morrow-v2-product-closure-20261107
gh run list --workflow self-hosted-ci.yml --limit 1
gh run view <run-id> --log
```

期望 guard 输出包含 `repo/ref/sha/actor/event/runner`，verify 输出 `checkout=<触发的 SHA>`；`guard-outcome` 必须成功。
