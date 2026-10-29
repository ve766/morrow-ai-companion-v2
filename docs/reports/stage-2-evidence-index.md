# Stage 2 证据索引

单一入口：每项给出源码位置、测试、结果文件与状态。状态口径与评测运行器一致：
`PASS / FAIL / SKIPPED / BLOCKED / NOT_RUN`，未运行项不计入通过。

| # | 能力 / 门槛 | 源码入口 | 测试 | 证据文件 | 状态 |
|---|---|---|---|---|---|
| 1 | 意图判断（规则层） | `src/cognition/intent-decision.ts` | `src/cognition/intent-decision.test.ts` | — | 单元 PASS；真实模型 BLOCKED |
| 2 | 轮次分析（信号/不确定性/策略） | `src/cognition/cognitive-turn-analyzer.ts` | `cognitive-turn-analyzer.test.ts` | — | 单元 PASS |
| 3 | 记忆检索与装配 | `src/memory/retrieval-policy.ts`、`memory-context-assembler.ts` | 现有集成测试 | `evals/stage-2/results/2026-10-29T09-34-34-55c9aef.json`（场景 B/D） | **PASS（离线，脚本化 provider）** |
| 4 | 撤回与删除边界 | `src/memory/memory-service.ts`、迁移 19/21 | `src/persistence/derived-deletion-boundary.test.ts` | 同上（场景 D） | PASS |
| 5 | 自我模型不复制原文 | `src/self-model/self-fact-statement.ts`、迁移 20 | `src/self-model/self-fact-statement.test.ts` | — | PASS |
| 6 | 旧 schema 读取 | `src/cognition/turn-context.ts` `normalizeTurnContext` | `src/cognition/turn-context.test.ts` | — | PASS |
| 7 | 轮次幂等 | `src/app/companion-service.ts` `send` | `turn-reliability.integration.test.ts` | 同上（场景 I） | PASS |
| 8 | B1 多信号置信度 | 无 | 无 | — | **NOT_IMPLEMENTED** |
| 9 | B2 渐进式个性化 | `src/personalization/personalization-service.ts`、迁移 22 | `personalization-service.test.ts`（6 条，含端到端） | 同上 | **PASS（离线）** |
| 10 | B3 `U(c)` | 无（现为相关度+新近度+预算） | 无 | — | **NOT_IMPLEMENTED** |
| 11 | B4 轮次状态机 | 仅 `succeeded/failed/cancelled` | 无 | — | **NOT_IMPLEMENTED** |
| 12 | B5 反思进入下一轮请求 | `onTurnCompleted` → `reflection.run` | 接线测试 | — | 接线 PASS；payload 级证据 **NOT_RUN** |
| 13 | A–L 评测 | `evals/stage-2/runner/cli.ts` | 由运行器自身执行 | `evals/stage-2/results/2026-10-29T09-34-34-55c9aef.json` | A/C/E/F/G/H/J **NOT_RUN**；B/D/I **PASS**；K/L **BLOCKED** |
| 14 | 消融 | 未实现 | — | `evals/stage-2/ablation/README.md` | **NOT_RUN** |
| 15 | CI | `.github/workflows/ci.yml` | — | run 40840918994（attempt 2） | **BLOCKED**：runner_id=0 / steps=[] |
| 16 | 真实 Provider S1–S6 | `scripts/phase24-real-model.ts` | — | — | **BLOCKED**：凭据 absent，端点 401 |
| 17 | Electron / Windows | `src/app/index.ts` | `scripts/smoke.mjs` | — | **BLOCKED**：渲染沙箱 0x80000003；no-sandbox 后主进程 0xC0000005 |

## 复算方式

```bash
npm run eval:stage2        # 生成新的 <UTC>-<sha>.json 与 -summary.json，不覆盖旧结果
npx tsc --noEmit
npx vitest run --maxWorkers=2
npm run build
```

每个结果文件内都带生成它的 `headSha`；旧 SHA 的结果不得当作当前提交的证据。

## 已知限制

1. 脚本化 provider 只能证明接线与载荷内容，**不能证明模型质量**。
2. 本仓库的 v2 轮次 schema 目前是"版本容错"，并未新增字段；B1 的 speech acts 落地时会另加字段并升版本。
3. 场景 D 的判定依赖"正对照"，不要删掉它——运行器开发过程中正是它挡住了假通过。
