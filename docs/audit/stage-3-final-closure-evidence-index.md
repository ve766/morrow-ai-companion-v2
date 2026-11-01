# Final Closure 证据索引

全部结果绑定实际 checkout SHA(文件名内嵌短 SHA);HEAD 见 PR #19。

## 代码 ↔ 测试 ↔ 结果

| 主线 | 代码 | 测试 | 结果 |
|---|---|---|---|
| P0-A 事实层 | `src/persistence/migrations.ts`(v40)、`src/memory/fact-memory.ts`(新)、`src/memory/memory-service.ts`(钩子+事实通道)、`src/memory/memory-context-assembler.ts`(fact 通道+时态准入)、`src/memory/fact-slot.ts`(pet_name/object_location)、`src/app/index.ts`(启动重建) | `src/memory/*`、`src/app/*`(326+ 通过) | `evals/stage-3/final-closure/results/<ts>-<sha>.json`(58/58) |
| P0-B 门 | `src/cognition/turn-evaluation.ts`(evidenceGate)、`src/app/companion-service.ts`(分类+manifest+AnswerConfidence) | 同上(集成断言 gate 分类) | 同上(逐 case 断言) |
| P0-C 判断 | `evals/real-provider/final-closure-live/run.ts`(新)、`evals/stage-3/shared/real-provider.ts`(credentials)、`evals/stage-3/runner/harness.ts`(L6) | 主套件 L6 | `evals/real-provider/results/<ts>-<sha>-final-closure.json` |
| P1 trace | `src/cognition/reflection-routing.ts`(injected_turn_id) | `src/cognition/reflection-routing.test.ts` | 路由行+TurnEvaluation join |
| CI | patch:`docs/reports/stage-3-ci-workflow.patch` | — | BLOCKED_WORKFLOW_SCOPE |

## 命令与退出码(closure 轮,本机 win32/Node 22.23)

| 命令 | 退出码 |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx vitest run --no-file-parallelism`(TEMP 重定向) | 0 |
| `npm run eval:stage3:final-closure` | 0(58/58) |
| `npm run eval:stage3` / `:ablation` / `:longitudinal` / `:restart` / `:long-conversation` / `:intent` / `:memory` | 0 |
| `npm run eval:final-closure:live` | 1(J2 PROVIDER_RESPONSE 1 次,错误分类记录;其余 7 场景完成) |
| `npm run eval:final-closure:live`(J2 重跑可选) | — |
| `npm run eval:stage3:live` / `:intent:semantic` | 修复轮已运行(live 9/10;semantic 8/8 AWAITING_MANUAL_REVIEW) |
| `npx electron-vite build` | 0 |
| `npm run smoke` | 本机环境 BLOCKED;CI 为准 |

## 真实 API 汇总(修复轮+closure 轮,均为 spark-x2.6 @ 契约 endpoint)

| 套件 | 结果文件 | 轮/调用 | 客观结果 |
|---|---|---|---|
| live(32 轮记忆) | 20261101T072132Z-0c5bcb9-live.json | 32/3 会话 | 9 PASS/1 FAIL(风格门槛) |
| semantic C1 | 20261101T074920Z-f7dffec-semantic.json | 8 轮 | AWAITING_MANUAL_REVIEW |
| final-closure live(八类判断) | 20261101T091701Z-d43cfb6-final-closure.json | 12 调用 | J4/J5/J8 客观过;J1 真实行为发现;J2 PROVIDER_RESPONSE(分类) |

错误分类:PROVIDER_RESPONSE(服务端响应错误,已重试规则外)/PROVIDER_TIMEOUT·DEADLINE(重试覆盖)/鉴权·网络·限流未出现。

## 未运行/阻断

- 真人复核 PENDING(包:final-closure-review.md)。
- CI Stage 3 门禁 BLOCKED_WORKFLOW_SCOPE(解锁两步见 closure 报告)。
- Windows 安装验收 NOT_RUN(无干净授权机器)。
- 语音 NOT_IMPLEMENTED(任务边界外)。
