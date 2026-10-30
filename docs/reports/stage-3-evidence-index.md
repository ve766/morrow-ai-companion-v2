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
