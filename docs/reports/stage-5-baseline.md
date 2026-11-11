# Stage 5 基线与源码追踪

- 仓库 `ve766/morrow-ai-companion-v2` · 分支 `feat/stage-5-relational-presence`（从 `57d2ff3` 创建）
- 父 PR [#24](https://github.com/ve766/morrow-ai-companion-v2/pull/24)（Stage 4-A，**保持 OPEN / PARTIAL**）
- 新 PR base：`feat/stage-4a-companion-continuity`（stacked PR，依赖 #24，不改其 base/head）
- 开工核验：远端 4-A head = `57d2ff3` = 本地；工作树干净；PR #19 / Issue #22 未动
- 迁移：起始 v42 → 本阶段 v43（`relationship_threads` + `relationship_thread_evidence`）

## 需求 → 源码入口 → 调用链 → 缺口 → 测试

| 需求 | 源码入口 | 当前调用链 | 缺口（本阶段处理） | 测试 |
|---|---|---|---|---|
| A 关系连续性 | 新增 `src/relationship/relationship-threads.ts` | `prepare()` 内 observe（本轮）→ 下一轮 `activeThreads()` → prompt 连续性块 | 此前**没有任何**跨会话关系线索；只有事实记忆 | `relationship-threads.test.ts`(7) + `stage5-presence.integration.test.ts` |
| A2 形成/更新/遗忘 | 同上 `recompute()` | 证据按 message 去重 → 半衰公式 → 阈值/独立组 → active/candidate/expired/retracted/superseded | — | 同上（重复不加权、纠正替换、撤回即停、TTL 过期） |
| B 内在状态 | `src/affective-state/feeling.ts`（已有）+ 新增 `expression-policy.ts` | `feelings.snapshot/preview` → `deriveExpressionPolicy` → prompt 策略块 + TurnEvaluation | 此前状态只产出一段引导文字，**没有结构化策略字段**，无法比较/断言 | `stage5-presence.integration.test.ts`（策略对比 4 例） |
| B3 状态改变行为 | `companion-service.ts` `prepare()` | 策略块与证据块并列，事实行不受影响 | — | 同 payload 中证据不变（S9） |
| C 12 场景 | `evals/stage-5/scenarios-v1.json` + `run.ts` | 生产装配逐场景 setup→probe | — | scripted 12/12 |
| D1 宽泛 catch | `prepare()` 认知块 | 单 catch 清空 analysis/decision/reading/memory | 已拆分阶段（analysis/retrieval/feeling），保留已完成结果，降级事件带阶段名 | 全量测试 + 代码检查 |
| D2 索引一致性 | `memory-service.ts` + `fact-memory.ts` | 记忆写入 → reindex（事务内）→ 失败写 degraded job + 退避 | Stage 3/4 已实现；本阶段复核并保留 | `fact-index-faults.test.ts` |
| D3 多事实验证 | `executeOperation` create 路径 | 只验证 `plan.facts[0]` | 改为逐项验证，部分失败返回 `PARTIAL_VERIFICATION_FAILED` 且不声称成功 | `stage4a-continuity.integration.test.ts` |
| D4 记忆表达 | `fixedPrinciples` + 策略块 | 证据 JSON 含 confidence/revision/id，模型曾对用户说"可信度 85" | 新增固定原则与策略块指令：不得向用户引用内部数值/ID | S9 检查 + 人工复核 |

## 已知风险（带入下一阶段）

- 关系线索抽取依赖显式句式；模糊暗示不写入（有意）。
- 关系线程与事实记忆是两套存储（线程=连续性上下文，事实=可寻址证据），二者都以来源 message 为证据；一致性由同一 turn 写入保证，但没有跨表事务。
- 第二真实 Provider 仍 BLOCKED；S12 以“同库重建运行时”验证应用侧连续，config 级切换由 Stage 4-A 自动化测试覆盖。
- Electron 应用级冒烟仍受本机环境限制（渲染进程崩溃），CI 为准。
