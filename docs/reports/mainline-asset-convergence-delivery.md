# 全仓历史资产继承与 main 主线收敛 — 阶段 1 交付报告

## 0. 结论

- 仓库：`ve766/morrow-ai-companion-v2`
- Issue：#85
- 分支：`integration/morrow-mainline-asset-convergence-20261110`
- 起始 main：`8b207b7d7b80b91ed4369d02fd6ef7e170b81133`（执行时已核实）
- 阶段 1 代码 SHA：`def61eab532e88bfaf8e0a3096176d66d65cc84f`
- 总体状态：**PARTIAL**。完整 Issue 是 6 阶段总任务；本报告只交付**阶段 1**（≤24h）：全仓资产账本、基线冻结、产品线整合、冲突图和 C1–C4 修复。阶段 2–6 未完成，不能标记 DONE。
- `main` 未被直接修改；没有合并/关闭任何历史 PR；没有删除分支；没有 force-push。

## 1. 基线事实（重新核验）

- 远端 51 个 heads（50 非 main + main）；全部登记在
  `docs/integration/mainline-asset-inventory.md` 和
  `docs/integration/branch-inheritance-matrix.csv`。
- main 是产品线的祖先：`origin/main..fix/morrow-p0...` = 375 commits；
  `fix/morrow-p0...` 没有 main 之外的缺失（main 0 ahead）。
- 因此集成分支从 main 快进到产品 tip `4bf63ef`，没有冲突/历史改写。这是
  阶段 1 唯一一次“整合”，不是把 50 个分支全部 merge。
- 产品线自身仍来自 PARTIAL 的 Issue #83；本阶段没有把它当作最终安全基线。

## 2. 分支处置摘要

完整逐分支表在固定交付物中。关键分类：

| 类别 | 数量/代表 | 处置 |
| --- | ---: | --- |
| main / 集成分支 | 2 | BASELINE |
| 产品 tip | 1 | MERGE_AS_IS（快进） |
| 产品线祖先（含 Stage 2–6、Provider、PR #64 后续） | 31 | INHERITED_IN_LINEAGE（commit 图证明；运行调用链待阶段 3 文件级审计） |
| 语义/混合检索 | `feature/algorithm-v2-phase-a`（19 unique） | PORT_AND_ADAPT，阶段 2 |
| 早期 Memory Reliability/Trust | 4 条分支（105–134 unique） | PORT_AND_ADAPT，阶段 2 |
| Companion core / turn-context | `feat/phase-2-companion-core`、`feat/stage-2-continuous...` | PORT_AND_ADAPT，阶段 2/3 |
| Self-model + consent | `feat/ai-life-core-upgrade...`（2 unique） | REPLACED_WITH_PROOF 待阶段 3 等价性核验 |
| Audit/report/research/docs | 10 条 | RESEARCH_ONLY；PR #48 仅合入 PR #40 分支，PR #49 不是合并批准 |
| Test contract | `infra/shared-real-model-test-contract` | TEST_ONLY |

## 3. 阶段 1 实际代码改动（def61ea）

在整合后的 P0 代码上修复 Issue #85 明确列出的 C1–C4：

| 项 | 修复 | 测试 |
| --- | --- | --- |
| C1 启动/后台锁 | `ChatService.drainCognition` 在 locked 时直接返回；scheduler 已暂停 | P0 测试与类型检查 |
| C2 DB 错误不吞 | `SourceValidityService` 只忽略 “no such table”，busy/IO/closed DB 重新抛出 | closed-database 测试真实抛错 |
| C3 当前节点自身一致性 | derived event 的 user/memory actor 不能继承 Morrow 父链；非空 correlation 必须由父链证明 | user-parent 与 bad-correlation 测试 |
| C4 memory 递归失效 | memory 删除/撤回通过 `parent_ids_json` 递归标记后代 | derived child retracted 测试 |

C5–C7 仍是阶段 4 的完整验收项，未标 PASS。

## 4. 验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| gate tests | 23 PASS |
| P0 integration tests | 14 PASS |
| full `npx vitest run` | **151 files / 1299 tests PASS** |
| `npm run build` | exit 0 |
| built chat smoke | PASS，含 consistency IPC ready |
| Windows 安装包 | **NOT_RUN at def61ea**；b229 包已过期，阶段 5 重建 |
| CI | 未触发；workflow 为 manual-only，未请求 runner token |

## 5. 未完成（阶段 2–6）

1. **阶段 2**：PR #1 语义/混合检索与 Memory Reliability 分支的 PORT_AND_ADAPT、
   真实基准、model/degradation、Payload 治理。
2. **阶段 3**：Stage 3–6、PR #64 的文件级/调用链继承核验；统一
   `self_model_entries` / `self_model_states` / `morrow_self_states` 读模型。
3. **阶段 4**：C5–C7 全投影 sweep、所有 crash 点、restore/restart 不复活。
4. **阶段 5**：Provider 切换、Windows 最终 SHA 重打包、真实纵向验收。
5. **阶段 6**：独立审计、main PR diff、测试/包 SHA 绑定、最终 main 集成 PR。

因此当前不是“main 已收敛”，只是“main 主线整合的第一阶段完成并提交”。
不得把本分支合并 main，也不得把阶段 1 PR 当作最终交付。

## 6. 固定交付物

- `docs/integration/mainline-asset-inventory.md`
- `docs/integration/branch-inheritance-matrix.csv`
- `docs/integration/mainline-architecture-map.md`
- `docs/integration/conflict-and-migration-decisions.md`
- `docs/testing/mainline-integration-acceptance.md`
- `docs/reports/mainline-asset-convergence-delivery.md`（本文件）
- `docs/reports/mainline-asset-convergence-evidence-index.md`
- `evals/mainline-asset-convergence/results/2026-11-10T17-10-00Z-def61eab532e88bfaf8e0a3096176d66d65cc84f.json`
- `docs/reports/results/mainline-asset-convergence/run-20261110T1704Z-def61ea/`
