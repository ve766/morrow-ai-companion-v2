# Stage 3 证据索引

单一入口：**需求 → 源码 → 测试 → 评测 → 证据文件**。所有 SHA 指本分支提交；结果文件内 `codeCommit` 字段记录生成时的实际 HEAD。

基线：`84670792fa08352835d4cca88da6355435ee0cd6`（`feat/stage-2-delivery-hardening`）

## 1. 按需求索引

| 需求（Issue #18） | 源码 | 测试 | 评测场景 | 证据文件 |
|---|---|---|---|---|
| §3.1 真实认知链 | `src/app/companion-service.ts:928`（`ChatService.send`）、`:1397`（`prepare`） | `src/app/cognitive-loop.integration.test.ts` | L1–L3, L13 | `evals/stage-3/results/*.json` |
| §3.2 记忆纠正/撤回/删除 | `src/memory/memory-service.ts` | `memory-service.test.ts` | L2, L12 | 同上 |
| §3.2 巩固与衰减 | **未实现** | — | — | 交付报告 §6 |
| §3.3 人格稳定 | `companion-service.ts:520`（`PersonalityService`） | `companion-service.test.ts` | L4 | 同上 |
| §3.3 人格渐进成长（G1） | `src/personalization/personality-growth.ts` | `personality-growth.test.ts`（16） | L4 + 消融 | `ablation/results/*.json` |
| §3.3 独立判断 | `fixedPrinciples`（`companion-service.ts:62`） | `cognitive-loop.integration.test.ts` | L6 | 同上 |
| §3.4 内在状态 | `src/affective-state/cognitive-feeling-engine.ts` | `cognitive-feeling-engine.test.ts` | L7 | 同上 |
| §3.5 自我模型 | `src/self-model/self-model-service.ts` | `self-model.test.ts` | L5 | 同上 |
| §3.5 兴趣生命周期 | `src/self-model/interest-service.ts` | `interest-evidence.test.ts`、`interest-invalidation.test.ts` | L8 | 同上 |
| §3.5 受约束自主探索（X1） | `src/self-model/exploration-policy.ts` | `exploration-policy.test.ts`（11） | L5 + 消融 | `ablation/results/*.json` |
| §3.5 反思门控 | `src/self-model/reflection-service.ts` | `reflection-mapping.test.ts` | L9 | `results/*.json` |
| §3.6 上下文质量 | `src/memory/memory-context-assembler.ts` | `memory-context-assembler.test.ts` | L3, L13 | 同上 |
| §4 桌面可用性 | `src/renderer/*`、`src/app/ipc.ts` | `ipc.test.ts` | — | **BLOCKED** |
| §5 长期评测 | `evals/stage-3/runner/harness.ts`、`cli.ts` | — | L1–L15 | `results/`、`ablation/results/`、`longitudinal/results/` |

## 2. 数据模型变更

| 迁移 | 名称 | 表 |
|---|---|---|
| 29 | `bounded-personality-growth` | `personality_growth_signals`、`personality_growth_state`、`personality_growth_events`、`exploration_events`（+2 触发器） |

## 3. 结果文件清单

| 文件 | 内容 | 关键数字 |
|---|---|---|
| `evals/stage-3/results/<ts>-<sha>.json` | 15 场景逐条断言 | 13 PASS / 0 FAIL / 2 NOT_RUN |
| `evals/stage-3/results/<ts>-<sha>-summary.json` | 机器汇总（场景→状态） | 同上 |
| `evals/stage-3/ablation/results/<ts>-<sha>.json` | 4 臂 × 15 场景 | 差异：`no_growth→L4`、`no_exploration→L5`、`no_reflection→L9` |
| `evals/stage-3/longitudinal/results/<ts>-<sha>.json` | 10 天 × 3 轮 | 6 条断言 PASS；`fresh=3 / aged=1.5` |

每个结果文件包含：`datasetVersion`、`harnessVersion`、`codeCommit`、`environment`、`provider`、`startedAt`、`finishedAt`、`denominator`、`counts`。

## 4. 工程门槛证据

| 门槛 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | exit 0 |
| 测试 | `npx vitest run` | 82 文件 / 720 测试全通过 |
| 构建 | `npx electron-vite build` | exit 0 |
| 评测 | `npm run eval:stage3` | exit 0 |
| 消融 | `npm run eval:stage3:ablation` | exit 0 |
| 纵向 | `npm run eval:stage3:longitudinal` | exit 0 |

## 5. 未覆盖 / 阻断

| 项 | 状态 | 精确原因 |
|---|---|---|
| L10 长期目标跨会话 | NOT_RUN | `GoalService` 不在 `CompanionService` 主链，需 Electron 主进程装配 |
| L15 多日模拟 | NOT_RUN | 由 `longitudinal` 运行器独立执行（不重复计入） |
| 真实 Provider | BLOCKED | 无凭据 |
| Electron smoke | BLOCKED | 本机渲染进程沙箱初始化崩溃（0x80000003），阶段二已两次证伪为环境问题 |
| Windows 安装器升级 | BLOCKED | 无干净授权机器 |
| CI | BLOCKED | 账号侧 `runner_id=0 / steps=0` |


---

## 6. 后续修复（Issue #20）的证据索引

| 需求 | 源码 | 测试 | 评测 | 结果文件 |
|---|---|---|---|---|
| F1 兴趣归属分离 | `self-model/self-model-domain.ts`、`interest-service.ts`、`app/companion-service.ts` | `interest-evidence.test.ts`、`exploration-policy.test.ts` | L5 | `evals/stage-3/results/*` |
| F2 探索生命周期 | `self-model/exploration-policy.ts`、`app/companion-service.ts` | `exploration-policy.test.ts`（15） | L5、纵向 | `results/*`、`longitudinal/results/*` |
| F3 L5 重写 | `evals/stage-3/runner/harness.ts` | — | L5 | `results/*` |
| F4 人格双向证据 | `personalization/personality-growth.ts` | `personality-growth.test.ts`（18） | L4 + 消融 | `results/*`、`ablation/results/*` |
| F5 真实重启 | `evals/stage-3/restart/run.ts` | — | restart | `restart/results/*` |
| F6 注入时钟 | `evals/stage-3/longitudinal/run.ts` | — | 纵向 | `longitudinal/results/*` |
| F7 L6 降级 | `evals/stage-3/runner/harness.ts` | — | L6 | `results/*` |
| 长对话 | `evals/stage-3/long-conversation/run.ts` | — | 30 轮 / 3 会话 | `long-conversation/results/*` |

工程门槛：`tsc` 0 / `vitest` 82 文件 726 测试 / `build` 0 / 五个 eval 运行器退出码 0。


## 7. 记忆生命周期（§2A）证据

| 需求 | 源码 | 测试 | 评测 | 结果 |
|---|---|---|---|---|
| 重要度可解释 | `src/memory/memory-importance.ts`（M1 公式） | `memory-importance.test.ts`（11） | L16 | `results/*` |
| 衰减只归档不删除 | `archiveBelow` + `memories.archived_at` | 归档/恢复/检索排除 3 条 | L16 | 同上 |
| 同槽合并只引用 | `consolidate()` + `memory_consolidations` | 合并/撤回剔除 2 条 | L16 | 同上 |

迁移：31。参数版本：`memory.importance.v1`。


## 8. 陪伴目标（§2D）证据

| 需求 | 源码 | 测试 | 评测 |
|---|---|---|---|
| 三类归属分离 | `companion-goal.ts` `describeGoals` | 归属措辞 1 条 | L10 |
| 优先级与到期 | `activeForContext` / `expireOverdue` | 排序/过期/当日到期 3 条 | L10 |
| 完成即退出上下文 | `setStatus` + `activeForContext` | 完成/恢复 2 条 | L10 |
| 追加式进展 | `recordProgress` / `progress` | 追加与级联 1 条 | — |

迁移：32。`GoalService` 未改动（属 Agent 侧任务执行，不进入陪伴主链）。


## 9. 补充审查证据（S3-01 ~ S3-05）

| 编号 | 源码 | 测试 | 文档 |
|---|---|---|---|
| S3-01 | —（未实现） | — | gap-closure §一 |
| S3-02 | `evals/stage-3/runner/harness.ts` | — | `ablation/results/*` |
| S3-03 | `src/personalization/personality-growth.ts` | `personality-growth.test.ts`（23） | 登记表 G1 |
| S3-04 | `src/self-model/exploration-policy.ts`、迁移 33 | `exploration-policy.test.ts`（19） | 登记表 X1「预算」 |
| S3-05 | — | — | `docs/algorithms/stage-3-algorithm-registry.md` |

整改矩阵：`docs/reports/stage-3-followup-gap-closure.md`。


---

## 10. 2026-10-31 纠偏证据

| 项 | 源码 | 测试 | 评测 |
|---|---|---|---|
| Outbox | `src/app/cognitive-outbox.ts` | `cognitive-outbox.test.ts`（7） | restart |
| 兴趣投影/外键/stale | `src/self-model/interest-service.ts`、`migrations.ts` v34 | `interest-evidence.test.ts`、`migrations.test.ts` | L5、L12 |
| Morrow 兴趣生产链 | `reflection-service.ts`、`reflection-mapping.ts`、`companion-service.ts` | — | L5（含变异） |
| 交互画像 | `src/personalization/interaction-profile.ts` | `interaction-profile.test.ts`（6） | L4、L11 |
| 重要度排序 | `memory-importance.ts`、`memory-context-assembler.ts` | `memory-importance-ranking.test.ts`（2） | — |
| 目标生产链 | `motivation/companion-goal.ts` | `companion-goal.test.ts` | L10 |
| 探索 uncertain/预算 | `exploration-policy.ts` | `exploration-policy.test.ts` | L5 |

结果文件：`evals/stage-3/results/20261031T034*.json`（主评测、消融、纵向、重启、长对话），`codeCommit` = 本次生成提交。

---

## 最终纠偏轮证据（2026-10-31）

`codeCommit` = `b0e719ad116db5607295da9f5ccddc6e2f4589b4`。

| 项 | 源码 | 测试 | 机器结果 |
|---|---|---|---|
| P0-1 归属分离 | `src/self-model/interest-service.ts`、`reflection-service.ts`、`knowledge-gap-service.ts` | `src/self-model/morrow-attribution.test.ts`（6） | `results/20261031T063724Z-b0e719a.json` L5 |
| P0-2 反思游标 | `src/self-model/reflection-service.ts`、`src/persistence/migrations.ts` v35 | `tests/correction-round.test.ts`（3） | 同上；500 事件 + 第 501 条 |
| P0-3 effect ledger | `src/app/effect-ledger.ts`、`src/app/cognitive-outbox.ts` | `tests/correction-round.test.ts`（6） | 崩溃矩阵见纠偏报告 §2 |
| P0-4 durable gap | `src/app/companion-service.ts`、`knowledge-gap-service.ts` | `tests/correction-round.test.ts`（2） | 回滚实测 |
| P0-5 记忆证据 | `src/memory/memory-evidence-policy.ts`、`memory-service.ts`、`memory-importance.ts` | `src/memory/memory-evidence.test.ts`（10） | 主评测 L16 |
| P1-6 目标生命周期 | `src/motivation/goal-time.ts`、`companion-goal.ts` | `src/motivation/goal-lifecycle.test.ts`（14） | 主评测 L10 |
| P1-7 评测真实性 | `evals/stage-3/runner/harness.ts`（`runL5`/`runL12`） | `tests/eval-assertions.test.ts`（5） | L5/L12 正反例 |
| 未申报泄漏 | `src/personalization/interaction-profile.ts` | L12 第三断言 | `restart`、主评测 L12 |

原始结果（全部带 `datasetVersion=stage-3-v2.1`、`harnessVersion`、`paramsVersion`、`clock`、起止时间）：

- 主评测：`evals/stage-3/results/20261031T063724Z-b0e719a.json`（+ summary）
- 消融：`evals/stage-3/ablation/results/20261031T063933Z-b0e719a.json`
- 纵向：`evals/stage-3/longitudinal/results/20261031T064131Z-b0e719a.json`
- 重启：`evals/stage-3/restart/results/20261031T064150Z-b0e719a.json`
- 长对话：`evals/stage-3/long-conversation/results/20261031T064154Z-b0e719a.json`

历史结果一律保留，未覆盖。

## 真实 Provider 证据（2026-10-31）

| 项 | 路径 |
|---|---|
| 运行器 | `evals/stage-3/live/run.ts`（`npm run eval:stage3:live`） |
| 说明 | `evals/stage-3/live/README.md` |
| 原始结果 | `evals/stage-3/live/results/20261031T073847Z-876d263.json`（`codeCommit=876d263`） |
| 报告 | `docs/reports/stage-3-live-provider-report.md` |

规模：iFlytek Spark MaaS / `spark-x2.6`，3 会话 32 轮，0 失败；9 条客观断言 8 PASS / 1 FAIL；Morrow 兴趣 NOT_RUN。

## 最后一轮（2026-10-31，代码基线 `ee728fd`）

| 项 | 源码 | 测试 | 说明 |
|---|---|---|---|
| P0-1 原子领取 | `src/app/effect-ledger.ts`、迁移 v36 | `tests/correction-round.test.ts`（3 条并发/租约） | 条件 UPDATE + changes 判定 + owner + 租约 |
| P0-2 期限边界 | `src/motivation/goal-time.ts` | `src/motivation/goal-lifecycle.test.ts`（11 条边界表 + 闰年） | 之前/底前/内/开始时/以后/裸写 |
| P0-3 兴趣闭环 | — | — | **未实现**，FAIL |
| P0-4 记忆措辞 | `src/app/companion-service.ts`（`fixedPrinciples`） | `tests/correction-round.test.ts` | 提示层区分「未检索」与「从未告诉」 |
| P0-5 风格识别 | `src/personalization/personality-growth.ts` | `personality-growth.test.ts`（3 条新增） | 词法证据优先于 intent 标签 |
| P0-6 共享契约 | `docs/testing/shared-real-model-test-contract.md`、`.env.real-model.example`、`src/shared/companion.ts`、迁移 v37、`evals/stage-3/live/run.ts` | `src/providers/openai-compatible.test.ts` | `/v2` endpoint、`MORROW_TEST_API_KEY`、`evals/real-provider/results/` |

真实 Provider 结果目录：`evals/real-provider/results/`（契约版）；历史 `/v1` 结果保留在 `evals/stage-3/live/results/`。

> **订正（状态截至修复轮，见 docs/reports/stage-3-final-remediation-report.md）**：本文为历史记录，以下表述已被后续事实取代——live 断言计数应为 10 断言 9 PASS 1 FAIL；CI 已在 5fe62f54 及后续 HEAD 全绿（run 41270227620/41270251780 及修复轮 run）；G1 生产链已按 D-1 重写（见 docs/algorithms/personality-growth-runtime-v2.md）；Electron renderer 在 CI 双平台 PASS、特定本机环境 BLOCKED，两态并存。
> §9 的 S3-01 行为陈旧（实际 PASS）。
