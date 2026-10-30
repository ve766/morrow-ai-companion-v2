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
| C1 | 规则层意图判断 | PASS | `src/cognition/intent-decision.ts` | `src/cognition/intent-decision.test.ts` | `evals/stage-2/results/verify-42a51e0-061042.txt` | 能：规则命中与策略映射。不能：真实模型下的意图准确率 |
| C2 | 多信号意图置信度（B1） | **PASS（已接线，未校准）** | `src/cognition/intent-confidence.ts`、`src/cognition/intent-decision.ts`（`scoreIntentCandidates`/`retrievalNeedOf`）、`src/cognition/cognitive-turn-analyzer.ts` | `src/cognition/intent-confidence.test.ts`（10 条：三档历史同分、指代上下文取分、歧义降分、未解析指代必追问、无候选不追问、两读数同路由不追问）；`src/cognition/cognitive-turn-analyzer.test.ts`（6 条 B1 组）；`src/app/b1-strategy-payload.integration.test.ts`（3 条读序列化 payload） | `evals/stage-2/results/2026-10-30T07-34-49-284Z-b5d09f8-cognitive.json`（dev 18/18、holdout 8/8、fixture 26/26、historyContrast.identical=true）；`evals/stage-2/b1-devset.json` | 能：分数真实改变 `strategy`，payload 出现 `route=clarify` 与澄清指令；同句三档历史同分。不能：称为概率（`uncalibrated_heuristic`）；未统计"错误高置信度率" |
| C3 | 上下文效用 `U(c)` 的 P/X/D（B3） | PASS | `src/cognition/context-utility.ts` → `src/memory/memory-context-assembler.ts` `rankScore`；`MemoryService.conflictedIds`；`personalizationFit` | `context-utility.test.ts`（5 条）；`memory-context-assembler.test.ts`：`ranks a record involved in an unresolved conflict below its twin`、`penalises a record that was never confirmed and is old`、`promotes a memory that is about a dimension the user personalised`；`personalization-service.test.ts`：`scores a memory about a personalised dimension and nothing else`、`takes the strongest matching dimension` | 验证日志 + 消融 `no_context_utility` 臂（`ablation/results/2026-10-30T06-12-49-42a51e0.json`，`contextUtilityChangesMemoryOrder: true`） | 能：三个分量都改变投递顺序。不能：`P` 只覆盖"记忆明确提到交互维度"的情形，未提到时恒为 0 |
| C4 | 轮次状态机与恢复（B4） | **PASS** | `src/cognition/turn-state-machine.ts`（10 态，含 `recovering`）、`src/app/companion-service.ts` `recordTurnState` / `recoverInterruptedTurns` | `turn-state-machine.test.ts`（6 条）；`turn-state-sequence.integration.test.ts`（3 条）；`src/app/b4-recovery.integration.test.ts`（4 条故障注入） | 验证日志 + `migrations.test.ts` | 能：提交前中断、提交后意图残留、删除会话、重启四类恢复都有数据库级断言，且不重复调 provider / 不重复消息。不能：覆盖"请求前中断"与"恢复路径中的 Provider 超时" |

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
| E4 | 消融（含反思正向夹具） | **PASS（执行）** | `evals/stage-2/ablation/results/2026-10-30T07-34-19-b5d09f8.json`（四臂）；`evals/stage-2/ablation/results/2026-10-30T07-34-50-725Z-b5d09f8-reflection-positive.json`（正向） | `no_reflection` 在旧夹具上仍无 payload 差异（注意力块两臂为 0）——**该臂本身不构成反思收益的证据**；正向夹具才是：full 3/2→active→有块，off 2/1→candidate→无块 |
| E5 | 真实 Provider S1–S6 | PASS WITH LIMITATIONS | `evals/stage-2/provider/phase24-real-model-26aeac7.json`（`codeSha=26aeac7`）：5 PASS / 1 SKIPPED，客观 13/13 | 1 次/场景；S4 单模型 SKIPPED，**不是 6/6** |

## 4.5 反思结构化（B5）

| # | 能力 | 状态 | 源码 | 测试 | 证据 | 边界 |
|---|---|---|---|---|---|---|
| R1 | 结构化发现 7 类受证据门控 | **PASS** | `src/self-model/reflection-service.ts`、迁移 26、`self-model-domain.ts` | `src/self-model/self-model.test.ts`（断言 `intent_correction`/`next_turn_suggestion` 出现，且 kind 全在枚举内） | 验证日志；`migrations.test.ts` v25→v26 行保留用例 | 能：6 类语义都有对应 kind 与证据引用。不能：`Map(R_t)` 未实现为独立映射（反思不写人格） |
| R2 | 正向夹具：payload 真变 | **PASS** | 同上 + `src/app/companion-service.ts` 装配 | `scripts/reflection-positive.ts` | `ablation/results/2026-10-30T07-34-50-725Z-b5d09f8-reflection-positive.json`：四层（运行/候选/门控/payload）两臂取值均记录 | 能：反思是差异的必要条件。不能：估计反思带来的质量提升 |
| R3 | 撤回后差异消失 | **PASS** | 证据账本（迁移 24/25） | 同上脚本内 `afterRetractionHasAttentionBlock=false` | 同上 | 能：差异随证据失效而消失。不能：覆盖真实用户撤回路径的全部形态 |
| R4 | 反思失败不阻塞答题 | **PASS** | `companion-service.ts` hooks | `src/app/b5-reflection-safety.integration.test.ts` | 验证日志 | 能：注入抛错后仍 deliver，且注入确被触发 |

## 5. 环境与平台

| # | 能力 | 状态 | 证据 | 边界 |
|---|---|---|---|---|
| V1 | 桌面 Electron | PASS | `evals/stage-2/results/verify-42a51e0-061042.txt`（`npm run smoke` exit 0，默认沙箱未禁用） | 只覆盖 smoke 列出的路径；不覆盖真实用户交互 |
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
