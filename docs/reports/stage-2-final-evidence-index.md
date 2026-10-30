# Stage 2 最终证据索引

结果生成 SHA：`a8e382de96840e72effa9c8d7901971bee6e6e89`（干净工作树，`dirty=0`）。
状态口径：PASS / PARTIAL / BLOCKED / NOT_RUN。所有路径均已用远端 API 或本地 `git ls-files` 确认存在。

## 0. 原始结果文件（`evals/stage-2/final/`）

| 文件 | 内容 |
|---|---|
| [`…-verification.txt`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-verification.txt) | 11 条命令的原始日志：命令、起止 UTC、退出码、dirty 状态、OS/Node/npm |
| [`…-summary.json`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-summary.json) | 状态矩阵：每项 status / evidence / commitSha / blockedReason |
| [`…-b1.json`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b1.json) | B1 26 例逐条结果、混淆矩阵、高置信度错误、`uncalibrated_heuristic` |
| [`…-b4-faults.json`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b4-faults.json) | B4 故障窗口矩阵与 9 条用例状态 |
| [`…-b5-ablation.json`](../../evals/stage-2/final/2026-10-30T08-37-58-a8e382de96840e72effa9c8d7901971bee6e6e89-b5-ablation.json) | B5 full / no_reflection 四层对比与撤回结果 |

## 1. B1 意图置信度

| 项 | 状态 | 源码 | 测试 | 证据 | 能 / 不能证明 |
|---|---|---|---|---|---|
| 五特征打分 | PASS | `src/cognition/intent-confidence.ts` | `intent-confidence.test.ts`（11 条） | `…-b1.json` | 能：权重归一、按 z 排序、share 非概率。不能：称为概率 |
| 历史不抬分 | PASS | 同上 `contextFitOf` | `intent-confidence.test.ts`「四档历史同分」；`cognitive-turn-analyzer.test.ts`「三档历史同分同策略」 | `…-b1.json` `cases[].topScore` | 能：同一句在无/无关/相关/冲突历史下 topScore 相同。不能：覆盖所有可能的"相关"定义 |
| 未解析指代硬闸 | PASS | 同上 `unresolvedReference` | `intent-confidence.test.ts`；`cognitive-turn-analyzer.test.ts` | 同上 | 能：无上文 + 指代必追问。不能：覆盖跨会话指代 |
| 策略接线到 payload | PASS | `src/cognition/cognitive-turn-analyzer.ts`、`src/app/companion-service.ts` | `src/app/b1-strategy-payload.integration.test.ts`（3 条） | 验证日志 | 能：payload 出现 `route=clarify` 与澄清指令。不能：证明模型会照做 |
| 授权门控不被绕过 | PASS | `companion-service.ts` `authorize()`（未改） | 既有 consent/companion 测试（`npm test` 内） | 验证日志 | 能：B1 只写 strategy。不能：证明 UI 授权体验 |
| 权重来源 | PASS | `scripts/b1-calibrate.ts` | — | `evals/stage-2/results/…-cognitive.json`（历史）、`…-b1.json` | 能：可复现搜索 + 双集验证。不能：统计显著性 |

## 2. B4 轮次恢复

| 项 | 状态 | 源码 | 测试 | 证据 | 能 / 不能证明 |
|---|---|---|---|---|---|
| 状态机 11 态 | PASS | `src/cognition/turn-state-machine.ts` | `turn-state-machine.test.ts`（6）；`turn-state-sequence.integration.test.ts`（3） | 验证日志 | 能：合法边与终态不可复活。不能：覆盖并发写 |
| 调用前崩溃 | PASS | `src/app/companion-service.ts` | `tests/b4-child-crash.test.ts` | `…-b4-faults.json` | 能：真实 SIGKILL 后无消息、无 provider 调用。不能：断电 |
| 调用中崩溃 | PASS | 同上（第二遍扫描非终态） | 同上 | 同上 | 能：settle 为 failed 且不重发。不能：上游是否真的收到请求 |
| 返回后未持久化 | PASS | 同上（意图恢复） | 同上 + `b4-recovery.integration.test.ts` | 同上 | 能：不重复调 provider。不能：恢复被上游计费的请求 |
| 提交后清理失败 | PASS | 同上 | 同上（注入清理失败） | 同上 | 能：只补记账，不重复消息。不能：真实断电下的同窗口（事务内，不存在） |
| 删除会话 / 重复恢复 / 重启 | PASS | 同上 | 同上 | 同上 | 能：不复活、幂等、重启可恢复。不能：多进程并发 |

## 3. B5 反思

| 项 | 状态 | 源码 | 测试 | 证据 | 能 / 不能证明 |
|---|---|---|---|---|---|
| allowlist 映射 | PASS | `src/self-model/reflection-mapping.ts` | `reflection-mapping.test.ts`（7） | 验证日志 | 能：未知 kind 拒绝、无证据拒绝、证据失效拒绝。不能：覆盖未来新增 kind |
| 去重幂等 | PASS | 迁移 27 `dedupe_key`；`reflection-service.ts` | `self-model.test.ts`「重跑幂等」 | 同上 | 能：同证据二次运行 `stored=0, duplicates>0`。不能：跨设备并发 |
| 证据失效 | PASS | 迁移 25 触发器 + 映射校验 | `self-model.test.ts`「撤回后不再重建证据」 | 同上 | 能：撤回后证据消失且不再产生候选。不能：覆盖所有来源类型 |
| 人格不被静默改写 | PASS | `pending_personality_candidates`（迁移 27） | `self-model.test.ts`「挂起人格候选且基线不变」 | 同上 | 能：personalization 前后完全相同。不能：证明用户确认流程（未实现） |
| 下一轮 payload 差异 | PASS | `src/app/companion-service.ts` 装配 | `scripts/reflection-positive.ts` | `…-b5-ablation.json` | 能：full 有块 / off 无块 / 撤回后消失。不能：证明回复质量提升 |
| 反思失败不阻塞 | PASS | `companion-service.ts` hooks | `b5-reflection-safety.integration.test.ts` | 验证日志 | 能：注入抛错仍 deliver。不能：覆盖所有失败模式 |

## 4. 回归

| 项 | 状态 | 证据 |
|---|---|---|
| B2 个性化 | PASS | `npm test` 内 `personalization-service.test.ts`（13） |
| B3 上下文效用 | PASS | `context-utility.test.ts`（5）、`memory-context-assembler.test.ts`（7，含 P/X/D 三条排序） |
| A1–A3 删除/撤回/备份 | PASS | `derived-deletion-boundary.test.ts`、`interest-invalidation.test.ts`、`backup-service.test.ts` |
| A–L 评测 | PASS | `results/2026-10-30T08-40-01-a8e382d.json`：12/12，45 断言，blocked 2 |
| 主题开发集 | PASS（小样本） | `results/topic-identity-devset-report.json`：P 1.000 / R 0.889，26 对 |
| 四组消融 | PASS（执行） | `ablation/results/…-a8e382d.json` |

## 5. 环境与外部项

| 项 | 状态 | 证据 |
|---|---|---|
| Electron smoke | PASS | `…-verification.txt`（`npm run smoke` exit 0，默认沙箱） |
| Windows schema 升级 | PASS | `npm test` 内 `src/persistence` 57 条 |
| Windows 安装器构建 | 见交付报告附录（网络 502） | `node_modules/.cache/package-win*.log`（未提交） |
| Windows 安装器升级 | **BLOCKED / NOT VERIFIED** | 无干净测试机、无旧版安装包 |
| CI | **BLOCKED** | run [41021035940](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41021035940)：三 job `runner_id=0`/`steps=0`，注解为账号付款失败或额度不足 |
| 真实 Provider | **NOT_RUN（本轮）** | `evals/stage-2/provider/phase24-real-model-26aeac7.json`（`codeSha=26aeac7`，不冒充当前 SHA） |

## 6. 历史结果（保留，不覆盖）

`evals/stage-2/results/` 下按 SHA 归档：`5635a9c`、`e25308c`、`fff5a13`、`02c2e4a`、`6e8fece`、`8650c48`、`67f2a37`、`42a51e0`、`a8e382d`。消融同理。真实 Provider 更早的运行（`78ff892`、`50acd83`、`6bf3758`）只在本地 `evaluation/reports/`（被 `.gitignore` 忽略），不作为可复核证据引用。
