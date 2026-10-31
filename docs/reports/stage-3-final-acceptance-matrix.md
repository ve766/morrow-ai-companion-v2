# Stage 3 最终验收矩阵

- 代码基线（结果文件中的 `codeCommit`）：`b0e719ad116db5607295da9f5ccddc6e2f4589b4`
- 审查基线（本轮开工前）：`b72c5141a591b193782d6358877b62306ecab984`
- 分支：`feat/stage-3-long-term-companion`；PR [#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19) OPEN / 未合并

状态取值只有 `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`。`BLOCKED` 与 `NOT_RUN` **不计入** PASS。

## 1. P0 / P1 逐项

| 项 | 状态 | 证据 |
|---|---|---|
| P0-1 Morrow 独立兴趣 | PASS | `src/self-model/interest-service.ts`、`reflection-service.ts`；`src/self-model/morrow-attribution.test.ts`；L5 |
| P0-2 反思增量游标 | PASS | `src/self-model/reflection-service.ts`、`src/persistence/migrations.ts` v35；`tests/correction-round.test.ts` |
| P0-3 Outbox 幂等与崩溃恢复 | PASS | `src/app/effect-ledger.ts`、`src/app/cognitive-outbox.ts`；§2 崩溃矩阵 |
| P0-4 knowledge-gap durable | PASS | `src/app/companion-service.ts`（`recordKnowledgeGap`）、`src/self-model/knowledge-gap-service.ts`；事务回滚测试 |
| P0-5 记忆重复提及生产链 | PASS | `src/memory/memory-evidence-policy.ts`、`memory-service.ts`、`memory-importance.ts`；`src/memory/memory-evidence.test.ts` |
| P1-6 目标生命周期 | PASS | `src/motivation/goal-time.ts`、`companion-goal.ts`；`src/motivation/goal-lifecycle.test.ts` |
| P1-7 评测真实性 | PASS | `evals/stage-3/runner/harness.ts`（`runL5` / `runL12`）；`tests/eval-assertions.test.ts` |
| P1-8 真实 Provider / CI | **PARTIAL** | 真实模型 32 轮已跑（8/9 断言 PASS）；CI 仍 BLOCKED；人工评价 NOT_RUN。见 §3 |

## 2. 门槛逐条（对应任务 §6）

| 门槛 | 状态 | 证据 |
|---|---|---|
| P0-1…P0-5 有真实代码修复与回归证据 | PASS | 见 §1 与 `stage-3-final-correction-report.md` |
| P1-6…P1-8 有 PASS 或明确外部阻塞 | PASS（P1-8 PARTIAL） | §3 |
| user / morrow / shared 严格分离，Morrow-only 有独立证据与后续行为 | PASS | L5：逐条事件证据、2 会话、`model_attempted`、`actually_raised` |
| 反思持久化增量游标，500+ 事件后仍能处理 | PASS | `tests/correction-round.test.ts`「keeps consuming new events after the journal passes the batch size」 |
| Outbox 幂等键 + effect ledger + 崩溃恢复 | PASS | §2 矩阵 |
| knowledge-gap durable transaction | PASS | 回滚测试：journal 失败 → 0 条 assistant 消息、0 条 gap |
| memory restatement/confirmation 真实生产链，模型复述不误算 | PASS | `readMemoryUtterance({actor:'morrow'})` → `model_text`；10 条测试 |
| 目标期限/确认/幂等/来源删除/跨会话 | PASS | `goal-lifecycle.test.ts` 14 条 |
| L5/L12 无假阳性；NOT_RUN/uncertain/缺证据不计 PASS | PASS | `eval-assertions.test.ts` 5 条（3 条要求 FAIL） |
| restart / long-conversation / 跨会话 / 删除撤回有原始结果 | PASS | 见 §5 |
| 全量测试、类型检查、构建、有效 CI 分别有证据 | PARTIAL | 前三项有；CI 见 §4 |
| 真实 Provider 多轮行为 | PARTIAL | 32 轮已跑，8/9 断言 PASS；1 条失败（风格偏移）；人工评价 NOT_RUN。见 §3.1 |
| 无未解决 P0/P1 隐私、一致性、撤回、重复 effect、授权缺陷 | PASS | 另修复一处未申报泄漏：`user_interaction_signals` 无删除传播 |
| PR #19 OPEN / 未合并，main 未改 | PASS | PR 状态 OPEN，base `feat/stage-2-delivery-hardening` |

## 3. 真实 Provider 与 CI

### 3.1 真实模型（已执行）

| 项 | 值 |
|---|---|
| Provider / Model | iFlytek Spark MaaS / `spark-x2.6` |
| 规模 | 3 会话 / **32 轮**，0 失败，0 重试 |
| 结果 | 9 条客观断言 **8 PASS / 1 FAIL**；Morrow 兴趣 **NOT_RUN**（1 个知识缺口 < 3） |
| 代码 SHA | `876d263f687e704fb7f9df1e686ccf7ea7fd618d` |
| 原始结果 | `evals/stage-3/live/results/20261031T073847Z-876d263.json` |
| 报告 | `docs/reports/stage-3-live-provider-report.md` |

失败项是「风格请求达到证据门槛并产生偏移」：三次自然表达只写入 1 条 `user_interaction_signals`，偏移为 0。已确认至少一种自然说法（「还是希望你直接一点」）不被识别；第 2 条为何未写入尚未定位，列为开放问题。

### 3.2 仍未闭合

| 项 | 状态 | 说明 |
|---|---|---|
| 人工评价 | NOT_RUN | `manualReview.status = "PENDING"`，未用同一模型自评冒充 |
| 跨天/跨周真实时间跨度 | NOT_RUN | 32 轮是连续 12 分钟 |
| CI | BLOCKED | 见 §4 |

## 4. 外部阻断

| 项 | 状态 | 可复核证据 |
|---|---|---|
| GitHub Actions 有效运行 | BLOCKED | run [41178081914](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41178081914)（HEAD `91f6173`）：三个 job 均 `conclusion=failure`、`steps=[]`、`runner_name` 为空。check-run 注解原文：*"The job was not started because recent account payments have failed or your spending limit needs to be increased."* —— 这是账号计费/额度问题，不是测试失败，也绝不是 CI 通过 |
| 真实模型多轮陪伴 | BLOCKED | 无可用凭据；未读取/上传/打印任何凭据。scripted 结果只覆盖接线 |
| Electron renderer | BLOCKED | 本机沙箱初始化崩溃（0x80000003），空白 `data:` 页同样复现，`--no-sandbox` 可绕过 → 环境问题 |
| Windows 安装升级 | NOT_RUN | 本轮未执行 |

## 5. 机器结果

| 运行器 | 文件 | 结果 |
|---|---|---|
| 主评测 | `evals/stage-3/results/20261031T063724Z-b0e719a.json` | 16 场景：15 PASS / 0 FAIL / 1 NOT_RUN（L15 由纵向运行器执行） |
| 消融 | `evals/stage-3/ablation/results/20261031T063933Z-b0e719a.json` | 基线 15 PASS；`no_growth`→L4,L12；`no_exploration`→L5；`no_reflection`→L5,L9 |
| 纵向（10 天压缩时钟） | `evals/stage-3/longitudinal/results/20261031T064131Z-b0e719a.json` | 7/7 断言 |
| 重启 | `evals/stage-3/restart/results/20261031T064150Z-b0e719a.json` | 6/6 断言 |
| 长对话（30 轮） | `evals/stage-3/long-conversation/results/20261031T064154Z-b0e719a.json` | 8/8 断言 |

全部结果均带 `datasetVersion=stage-3-v2.1`、`harnessVersion`、`paramsVersion`、`clock`、`provider`、起止时间；主评测另带 `providerModelId` 与 `unmeasured`。

## 6. 总体判定

**PARTIAL。**

- 八项中七项 PASS，一项（P1-8）因外部条件 BLOCKED；
- 没有任何 P0 未闭合；
- CI 与真实模型质量没有有效证据，因此**不得**声称 Stage 3 完整完成，也**不得**据此进入 Stage 4。
