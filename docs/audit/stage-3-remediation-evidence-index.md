# Stage 3 修复证据索引（D-1～D-13）

每条结论对应完整 SHA、命令、结果文件与代码位置。修复提交链（自审计 HEAD `4dd0d7c0` 起）：见 `git log 4dd0d7c0..HEAD --oneline`（D-1/D-4/D-10/D-11 → D-5 → D-9 → D-12 → D-13/D-7/D-8 → 本文档）。**最终修复 HEAD 以 PR #19 页面为准**；本文引用的结果文件全部绑定该 HEAD（文件名内嵌 7 位短 SHA）。

## 1. 代码与测试映射（D-1～D-13）

| 缺陷 | 代码 | 测试 | 结果文件 |
|---|---|---|---|
| D-1 | `src/app/companion-service.ts`（growth 投影器/effectiveProfile/prompt 分层/growth IPC/死分支移除）、`src/shared/contracts.ts`、`src/app/ipc.ts`、`src/preload/index.ts` | `src/app/stage3-remediation.integration.test.ts`（6 测试） | 主套件 L4（prompt 数值）、restart（连续性） |
| D-4 | `src/self-model/exploration-policy.ts`、`src/persistence/migrations.ts`（v39） | `src/persistence/migrations.test.ts`（v39 用例）、`src/self-model/exploration-policy.test.ts` | 迁移测试 16/16 |
| D-5 | `src/memory/memory-context-assembler.ts`（RRF/三通道/contested）、`src/memory/fact-slot.ts`、`src/cognition/intent-decision.ts`/`intent-confidence.ts`/`speech-act.ts`（疑问词表）、`src/cognition/turn-evaluation.ts`（memoryUse）、`src/app/companion-service.ts`（原则/use trace） | `src/memory/*`（88）、`src/app/companion-service.test.ts` | `evals/stage-3/memory-recall/results/<ts>-<sha>.json`（10/10） |
| D-9 | `evals/stage-3/runner/harness.ts`（runL6 八类矩阵，PARAMS v3） | 同左（主套件内） | 主套件 L6 断言矩阵 |
| D-10/D-11 | `src/cognition/reflection-routing.ts`（新）、`src/cognition/pending-items.ts`（decide/drop）、`src/persistence/cognitive-context-repository.ts`、`src/app/index.ts`、`src/renderer/src/pending-ui.ts`（新）、`src/renderer/index.html` | `src/cognition/reflection-routing.test.ts`（6）+ 集成 2 项 | 主套件 L9、集成断言 |
| D-12 | `src/memory/memory-maintenance.ts`（新）、`src/app/index.ts` | `src/memory/memory-maintenance.test.ts`（4） | — |
| D-13 | `.github/workflows/ci.yml` | CI run（推送后链接见本索引 §6） | CI 内 Stage 3 套件输出 |
| D-6/D-7/D-8 | `package.json`(2.0.0)、`src/memory/memory-importance.ts`、受影响文档订正注记 | typecheck | — |

## 2. 迁移

v39 `exploration-states-and-finding-routing`：exploration_events 重建（行保留断言）、reflection_finding_routes（FK/CHECK 断言）、memory_maintenance_state（singleton/状态集断言）。升级路径测试 `migrations.test.ts`；回滚=前向兼容（v39 新表对 v38 代码不可见，exploration_events 列集不变）。

## 3. 命令与退出码（修复后全量验证，本机 win32/Node 22.23）

| 命令 | 退出码 | 说明 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run --no-file-parallelism` | 0（TEMP 重定向） | 全量；`src/evaluation/offline-evaluation.test.ts` 的 %TEMP% 拒写为本机环境缺陷（esbuild 子进程），重定向后通过 |
| `npx electron-vite build` | 0 | — |
| `npm run eval:stage3` | 0 | 16 场景：15 PASS / 1 NOT_RUN（L15→纵向） |
| `npm run eval:stage3:ablation` / `:longitudinal` / `:restart` / `:long-conversation` / `:intent` | 0 | 全过 |
| `npm run eval:stage3:memory` | 0 | 10/10，recall@1=1.0 |
| `npm run eval:stage3:live` / `:intent:semantic` | 见结果文件 | MORROW_TEST_API_KEY 由本机环境变量注入（不粘贴、不入库、不打印） |
| `npm run smoke` | 本机 BLOCKED（渲染进程 0x80000003，环境）；CI 双平台为准 | 同审计结论 |

## 4. 消费者链路证据（抽查锚点）

- G1：`companion-service.ts` buildCognitiveProjectors('growth') → `growth.apply`；effectiveProfile → `applyGrowth(baseline, growth.list())`；集成测试直接断言 prompt 数值 = baseline + G1 fold。
- 路由：`reflection-service.ts` findings → `findingRouter.ingestRun`（projector 'reflection' 与 index.ts runReflection 同一入口）。
- 调度：`index.ts` bootstrap `memoryMaintenance.start()` → before-quit `stop()`。

## 5. 真实 Provider 结果（修复后 SHA）

结果文件位于 `evals/stage-3/live/results/`、`evals/stage-3/intent-understanding/results/`（`-semantic` 后缀）、`evals/real-provider/results/`；每份含 codeCommit（完整 SHA）、模型 `spark-x2.6`、endpoint 标识、逐轮时延/载荷哈希/守卫判定，响应文本按契约留存供人工复核。运行摘要见修复报告交付回复；**本机凭据仅存 `.tmp/spark.key`（git 忽略），任何文件不含密钥**。

## 6. CI

推送后填写：PR #19 head SHA 触发的 run URL（ubuntu/windows 的 "Stage 3 suites" 步骤 + 既有 typecheck/test/build/smoke/upgrade-path）。

## 7. 真人复核

复核包：`evals/real-provider/review/`（脱敏逐轮转写 + rubric + 判分栏）。状态 **PENDING**——AI 不冒充真人；完成后在此登记 reviewer 与结论。
