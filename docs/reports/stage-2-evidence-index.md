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
| 8 | B1 多信号置信度 | `src/cognition/intent-confidence.ts` → analyzer | `intent-confidence.test.ts`（5 条）+ 2 条测量断言 | — | **PARTIAL**：计算并记录；试接 clarify 使语料准确率 1.000→0.885，已回退 |
| 9 | B2 渐进式个性化 | `src/personalization/personalization-service.ts`、迁移 22 | `personalization-service.test.ts`（11 条，含 P1-A/B/C 与端到端） | 同上 | **PASS（离线）** |
| 9b | B2 删除一致性 | 同左（证据折叠 + 缓存回填） | 删除源消息后重算回 0.5 | 同上 | **PASS** |
| 10 | B3 `U(c)` | `context-utility.ts` → `memory-context-assembler.rankScore`；`MemoryService.conflictedIds` | `context-utility.test.ts`（5 条）+ 装配器 2 条排序断言 | `evals/stage-2/ablation/results/*`（`no_context_utility`） | **PARTIAL**：X/D 已接线并改变投递顺序；P 仍 0 |
| 11 | B4 轮次状态机 | `turn-state-machine.ts` + `companion-service.ts` 写入点 + 迁移 23 | `turn-state-machine.test.ts`（6 条）+ `turn-state-sequence.integration.test.ts`（3 条） | — | **PASS**：9 个状态全部有写入点，成功轮次 7 步序列有断言 |
| 12 | B5 反思进入下一轮请求 | `reflection.run` → `interests.observe`（主题同一性匹配）→ `activeForContext` | 评测场景 B5（5 条断言） | `evals/stage-2/results/*`（最新） | **PASS**：证据 3 条 / 2 会话，下一轮 payload 含注意力块且带目标兴趣 id |
| 12a | 主题同一性匹配 | `src/self-model/topic-identity.ts` → `InterestService.observeInner` | `topic-identity.test.ts`（12 条，含开发集指标与框架碰撞） | `evals/stage-2/results/topic-identity-devset-report.json` | **PASS（开发集）**：precision 1.000 / recall 0.889 / FP 0（26 对，devset v2） |
| 12b | 兴趣证据账本（幂等/撤回/恢复） | 迁移 24 `interest_evidence` + `InterestService.reconcile` | `interest-evidence.test.ts`（11 条） | — | **PASS**：重放不累计、删消息降级/删除、重启后账本与晋升一致 |
| 12c | 记忆证据随记忆失效（P0-A） | 迁移 25（`evidence_revision` + 3 个记忆触发器）+ `reconcile` 重折叠 | `interest-invalidation.test.ts`（9 条）、`migrations.test.ts` v24→v25 | `src/app/interest-payload-invalidation.integration.test.ts` | **PASS**：retract / delete / correct（`confirm` 不误删）/ 重启 / 备份恢复，payload 不再含该兴趣 id |
| 12d | 反转改变兴趣状态（P0-B） | `InterestService.fold` → `evaluate` / `derivedStatus` | `interest-invalidation.test.ts`（4 条反转用例） | 同上 | **PASS**：反转立即 `active→candidate`；重新喜欢恢复；删 counter 来源后重算；重放不重复计数 |
| 13 | A–L 评测 | `evals/stage-2/runner/cli.ts` | 由运行器自身执行（12 场景 / 45 条断言） | `evals/stage-2/results/*`（最新） | A/B/C/D/E/F/G/H/I/J/B4/B5 **PASS**（12/12）；K/L **BLOCKED**；**NOT_RUN 0** |
| 13a | A 指代依赖 | `intent-decision.ts` `dependsOnPriorTurn` → `turn-context.ts` `contextDependency` | `turn-context-fidelity.integration.test.ts`（3 条）+ 场景 A（4 条） | 同上 | **PASS**：无上文→`unresolved`、自足问句→`none`、代词追问→`prior_turn` |
| 13b | C 纠正链 | `memory-service.ts` `correct` / `history` | 场景 C（4 条） | 同上 | **PASS**：两条修订成链，下一轮载荷只带新值 |
| 13c | E 人格稳定 | `personality-service`（用户编辑才升版本） | 场景 E（4 条） | 同上 | **PASS**：4 轮情绪/反馈轮次后版本与数值不变，载荷文案逐轮一致 |
| 13d | F 状态影响 | `affective-state/feeling.ts` → `applyFinalization` | `turn-context-fidelity.integration.test.ts` + 场景 F（5 条） | 同上 | **PASS**：`applied=true`、`after` 等于已提交状态、单轮变化在限内、载荷声明不可覆盖 |
| 13e | G 兴趣晋升门槛 | `interestPromotionEligible` | 场景 G（4 条） | 同上 | **PASS**：单会话 3 次不晋升；跨会话晋升；无关主题仍为候选 |
| 13f | H 反思限流 | `reflection-service.ts` `canRun` | 场景 H（4 条） | 同上 | **PASS**：额度用尽即拒，被拒不留运行记录，窗口 1 小时后重开 |
| 13g | J 载荷哈希一致 | `hashProviderInput` → `authorize` | 场景 J（4 条） | 同上 | **PASS**：批准哈希等于实发载荷哈希；重放不重发；撤回后哈希改变 |
| 14 | 消融 | `evals/stage-2/ablation/run.ts` | 四组臂自断言 | `evals/stage-2/ablation/results/*`（最新 `e25308c`） | **PASS（4/4 执行）**：B2 差异 242 字节；B3 改变记忆顺序；B5 反思 4 次 vs 0 次 |
| 15 | CI | `.github/workflows/ci.yml` | — | run 40993696285（`head_sha=5635a9c`） | **BLOCKED（账号计费）**：`runner_id=0` / `steps=0` / 日志 `BlobNotFound` / 自托管 runner `total_count=0`；check-run 注解为账号付款失败或额度不足 |
| 16 | 真实 Provider S1–S6 | `scripts/phase24-real-model.ts` | 场景内自断言 | `evaluation/reports/phase24-real-model-78ff892.json` | **PASS WITH LIMITATIONS**：S1/S2/S3/S5/S6 全过（26/26 客观断言，2 次/场景），S4 SKIPPED（无第二模型） |
| 17 | Electron / Windows | `src/app/index.ts` | `scripts/smoke.mjs`（`npm run smoke`） | — | **PASS**：连跑两次 exit 0，默认沙箱未禁用；覆盖 built app、凭据保存-重启-删除、认知开关、记忆/目标/提醒、删除与重启校验。安装包升级路径仍无证据 |

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
