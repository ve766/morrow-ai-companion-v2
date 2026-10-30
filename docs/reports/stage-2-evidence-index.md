# Stage 2 证据索引

本文件是阶段二**唯一当前索引**，与 [`stage-2-final-delivery-current.md`](stage-2-final-delivery-current.md)、[`stage-2-final-delivery-audit.md`](../audit/stage-2-final-delivery-audit.md) 保持同一口径。

## 0. SHA 口径

| 名称 | SHA | 含义 |
|---|---|---|
| 审计 HEAD | `42a51e075af8a8ce9628c87490c37df8c92b7580` | 本索引所有验证在该提交、**工作区干净**时执行 |
| 评测结果生成 SHA | `42a51e0` | `evals/stage-2/results/2026-10-30T06-12-40-42a51e0.json`、`ablation/results/2026-10-30T06-12-49-42a51e0.json`、devset 报告 |
| 真实 Provider 报告 SHA | `26aeac7` | `evals/stage-2/provider/phase24-real-model-26aeac7.json` 的 `codeSha`；生成于更早提交，**不冒充当前 HEAD 的验证** |

状态口径：**PASS** 有可复核证据；**PARTIAL** 部分接通；**BLOCKED** 外部条件阻断；**NOT_RUN** 从未执行。

## 1. 认知层

| # | 能力 | 状态 | 源码 | 测试（文件 + 用例） | 证据 | 能证明 / 不能证明 |
|---|---|---|---|---|---|---|
| C1 | 规则层意图判断 | PASS | `src/cognition/intent-decision.ts` | `src/cognition/intent-decision.test.ts` | `evals/stage-2/results/verify-42a51e0-061042.log` | 能：规则命中与策略映射。不能：真实模型下的意图准确率 |
| C2 | 多信号意图置信度（B1） | **PARTIAL** | `src/cognition/intent-confidence.ts`、`src/cognition/cognitive-turn-analyzer.ts` | `src/cognition/cognitive-turn-analyzer.test.ts`：`reports a low-confidence reading without turning it into a question`、`does not let a coin-flip reading force clarify when nothing would be retrieved`、`scores a turn mostly by whether there is prior history, not by how vague it is` | 同上（该文件 18 条全过） | 能：分数被计算并随分析返回；分数由"有无上文"主导（同一句 0.780 vs 0.947）。**不能**：认为它影响了决策——它没有 |
| C3 | 上下文效用 `U(c)` 的 P/X/D（B3） | PASS | `src/cognition/context-utility.ts` → `src/memory/memory-context-assembler.ts` `rankScore`；`MemoryService.conflictedIds`；`personalizationFit` | `context-utility.test.ts`（5 条）；`memory-context-assembler.test.ts`：`ranks a record involved in an unresolved conflict below its twin`、`penalises a record that was never confirmed and is old`、`promotes a memory that is about a dimension the user personalised`；`personalization-service.test.ts`：`scores a memory about a personalised dimension and nothing else`、`takes the strongest matching dimension` | 验证日志 + 消融 `no_context_utility` 臂（`ablation/results/2026-10-30T06-12-49-42a51e0.json`，`contextUtilityChangesMemoryOrder: true`） | 能：三个分量都改变投递顺序。不能：`P` 只覆盖"记忆明确提到交互维度"的情形，未提到时恒为 0 |
| C4 | 轮次状态机（B4） | PASS | `src/cognition/turn-state-machine.ts`、`src/app/companion-service.ts` `recordTurnState` | `turn-state-machine.test.ts`（6 条）；`src/app/turn-state-sequence.integration.test.ts`：`walks received → analyzed → context_ready → awaiting_consent → requesting → response_received → committed`、`records a provider failure after requesting, and never claims a delivery`、`declares the interrupted-only states legal from the steps that can reach them` | 验证日志 | 能：9 个状态都有真实写入点，成功轮次 7 步序列可观测。不能：`recovery_required` 只有状态机边断言，缺"真实中断后恢复"的端到端用例 |

## 2. 记忆与自模型

| # | 能力 | 状态 | 源码 | 测试（文件 + 用例） | 证据 | 能证明 / 不能证明 |
|---|---|---|---|---|---|---|
| M1 | 记忆撤回/删除/纠正 → 兴趣证据失效 | PASS | 迁移 25（`src/persistence/migrations.ts`）+ `src/self-model/interest-service.ts` `reconcile` | `src/self-model/interest-invalidation.test.ts` 9 条：`drops the evidence when the memory is retracted, and the interest with it`、`drops the evidence when the memory row is deleted outright`、`ages out evidence from an older revision but keeps evidence from the current one`、`keeps the invalidation after a restart`、`carries the invalidation into the snapshot` | 验证日志；`src/persistence/migrations.test.ts` 的 v24→v25 用例 | 能：证据行在同一事务内删除，缓存按剩余证据重折叠。不能：不覆盖"多进程同时改同一记忆" |
| M2 | 失效不泄漏到最终 payload | PASS | `src/app/companion-service.ts` 上下文装配 | `src/app/interest-payload-invalidation.integration.test.ts`：`drops the interest from the payload when its memory evidence is retracted`、`drops the interest from the payload when the user reverses, and restores it on a newer support` | 同上 | 能：读的是**序列化后的请求**。不能：不覆盖真实模型如何利用该上下文 |
| M3 | 反转改变兴趣状态 | PASS | `src/self-model/interest-service.ts` `evaluate`/`derivedStatus` | `interest-invalidation.test.ts`：`suspends an active interest as soon as the user reverses`、`lets a newer support clear an older reversal instead of being vetoed forever`、`recomputes from the remaining evidence when the counter source is deleted`、`does not double count a replayed reversal` | 同上 | 能：反转立即降级、可恢复、删反证可重算、重放幂等。不能：不覆盖同秒多条证据的真实并发 |
| M4 | 兴趣证据账本（幂等/撤回/恢复） | PASS | 迁移 24 + `reconcile` | `src/self-model/interest-evidence.test.ts`（11 条） | 同上 | 能：重放不累计、删消息降级或删除、重启后账本一致 |
| M5 | 主题同一性匹配 | PASS | `src/self-model/topic-identity.ts` | `src/self-model/topic-identity.test.ts`（12 条） | `evals/stage-2/results/topic-identity-devset-report.json`（26 对，P 1.000 / R 0.889，FP 0 / FN 1） | 能：框架碰撞不合并、同槽替换不合并、歧义保留。不能：26 对是小样本，不具统计意义 |
| M6 | 撤回与删除边界（通用） | PASS | `src/memory/memory-service.ts`、迁移 19/21 | `src/persistence/derived-deletion-boundary.test.ts`（4 条） | 验证日志 | 能：源数据删除后派生行清理 |
| M7 | 备份/恢复一致性 | PASS | `src/persistence/backup-service.ts` | `src/persistence/backup-service.test.ts`；`interest-invalidation.test.ts` 的 `carries the invalidation into the snapshot` | 验证日志 | 能：快照不含已撤回证据。不能：不覆盖安装器升级后的恢复 |

## 3. 人格与个性化（B2）

| # | 能力 | 状态 | 源码 | 测试 | 证据 | 边界 |
|---|---|---|---|---|---|---|
| P1 | 人格稳定（情绪/反馈不改写人格） | PASS | `src/personalization/personalization-service.ts`、迁移 22 | 评测场景 E（4 条断言）；`src/personalization/personalization-service.test.ts`（13 条） | `evals/stage-2/results/2026-10-30T06-12-40-42a51e0.json` | 能：4 轮情绪/反馈后版本与数值不变。不能：不覆盖长期多会话漂移 |
| P2 | 有界更新与撤回重算 | PASS | 同上 | `personalization-service.test.ts`（含 P1-A/B/C 三条） | 验证日志 | 能：单轮位移 ≤ 上限、撤回回到 0.5、非法输入零写入 |

## 4. 评测

| # | 能力 | 状态 | 证据 | 边界 |
|---|---|---|---|---|
| E1 | 12 个可执行场景（A/B/C/D/E/F/G/H/I/J/B4/B5，45 条断言） | PASS | `evals/stage-2/results/2026-10-30T06-12-40-42a51e0.json`：`executed 12 / passed 12 / blocked 2 / notRun 0` | 脚本化 Provider；**不证明模型质量**。K、L 为 BLOCKED，未计入通过 |
| E2 | 场景 K（真实 Provider 在运行器内） | BLOCKED | 同上（`blockedBy` 字段） | 运行器固定脚本化；真实覆盖见 E5 |
| E3 | 场景 L（桌面在运行器内） | BLOCKED | 同上 | 运行器托管不了 GUI 进程；桌面覆盖见 V1 |
| E4 | 四组消融 | PASS（执行） | `evals/stage-2/ablation/results/2026-10-30T06-12-49-42a51e0.json`：`personalizationBlockAppearsOnlyWhenEnabled=true`、`contextUtilityChangesMemoryOrder=true`、`reflectionRunsFull=4` / `Off=0` | `no_reflection` **未见 payload 差异**（注意力块两臂均为 0），不能证明反思收益 |
| E5 | 真实 Provider S1–S6 | PASS WITH LIMITATIONS | `evals/stage-2/provider/phase24-real-model-26aeac7.json`（`codeSha=26aeac7`）：5 PASS / 1 SKIPPED，客观 13/13 | 1 次/场景；S4 单模型 SKIPPED，**不是 6/6** |

## 5. 环境与平台

| # | 能力 | 状态 | 证据 | 边界 |
|---|---|---|---|---|
| V1 | 桌面 Electron | PASS | `evals/stage-2/results/verify-42a51e0-061042.log`（`npm run smoke` exit 0，默认沙箱未禁用） | 只覆盖 smoke 列出的路径；不覆盖真实用户交互 |
| V2 | Windows schema/migration 升级 | PASS | `npx vitest run src/persistence` 57/57（win32、默认并发，见验证日志） | **只是 schema 测试**，不等于安装器升级 |
| V3 | Windows 安装器升级 | **BLOCKED / NOT VERIFIED** | 无 | 需授权在干净机器执行：装旧版 → 覆盖装新版 → 启动 → 数据保留 |
| V4 | CI | **BLOCKED** | run [41010305777](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41010305777)：三 job `runner_id=0` / `steps=0`；注解为账号付款失败或额度不足 | **不计通过也不计失败**：没有任何步骤执行过 |

## 6. 无证据的项（明列缺口）

| 项 | 缺口 |
|---|---|
| B1 接线 | 无"低置信度改变行为"的证据——从未接通，三次尝试实测回退 |
| `recovery_required` 端到端 | 只有状态机边断言，没有"真实中断 → 进入该状态 → 后续处置"的集成用例 |
| 真实模型主观质量 | 只有词面代理（`subjectiveScored: 3`），不构成质量评价 |
| 多模型切换（S4） | 无第二模型凭据 |
| 安装器升级 | 无任何证据 |

## 7. 历史结果（保留，不覆盖）

`evals/stage-2/results/` 下按 SHA 归档的旧结果全部保留：`5635a9c`、`e25308c`、`fff5a13`、`02c2e4a`、`6e8fece`、`8650c48`、`67f2a37`、`42a51e0`（当前）。消融同理。

真实 Provider 的更早运行（`78ff892`、`50acd83`、`6bf3758`）只存在于本地 `evaluation/reports/`，该目录被 `.gitignore` 忽略、**从未入库**，因此不作为可复核证据引用。
