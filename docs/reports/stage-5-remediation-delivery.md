# Stage 5 复核根因修复交付报告（Issue #27）

- 仓库：`ve766/morrow-ai-companion-v2`
- 修复分支：`fix/stage-5-review-findings`
- 目标 base：`feat/stage-5-relational-presence`（PR #26 的后续修复，**不自动合并**）
- 起始 SHA：`a889ca819ed4686a176a910a54dcf553676fa2a2`
- 代码/测试最终 SHA：`d9864031221b3e7df238cb87ea50a29a7c4aaf59`
- PR #26：base `feat/stage-4a-companion-continuity`，保持 OPEN、未合并；本任务未改其 head/base
- 迁移：v44（关系证据删除传播）、v45（outbox `relationship` 模块）

## 1. 结论

| 维度 | 结果 |
|---|---|
| 18 项验收（代码层） | 17 PASS + 1 PARTIAL（第 14 项真实双 Provider NOT_RUN） |
| 回归测试 | 104 文件 / 970 测试全部通过；新增 19 个验收用例 |
| scripted 12 场景 | 12/12 PASS |
| live 12 场景（spark-x2.6） | 12/12 客观 PASS；S5/S6 自然度按 rubric 通过，真人复核 PENDING |
| typecheck / build | PASS |
| Electron / Windows 冒烟 | **PASS（CI）**：windows-latest 与 ubuntu-latest 真实应用 smoke 通过；本机单独运行 BLOCKED（0xC0000005） |
| CI | **PASS**：run `41386833397`，3 个 job 全部 success |
| **整体状态** | **PARTIAL** |

不把“12/12 客观载荷检查”等同于“自然度验收”，也不把“全量测试通过”等同于
“关系撤回范围/删除残留/事务恢复缺陷不存在”。本报告逐项给出反例与证据。

## 2. 修复前后行为

| 缺陷 | 修复前 | 修复后 |
|---|---|---|
| P0-A 撤回范围 | “那个约定就算了”撤回全部 active/candidate 线程 | 只撤回唯一可定位的约定；0 个→澄清，多个→澄清；全局撤回必须显式并写事件 |
| P0-B 删除残留 | 删除消息/会话后证据仍在，线程继续注入 | v44 触发器与消息删除同事务清理证据并降级线程；`reconcile()` 处理备份恢复的孤儿行；真实备份恢复+journal replay 测试通过 |
| P1-C 称呼纠正 | “别再叫我小林，叫我阿林”重新确认“小林” | 只在否定短语之后取新值；旧值 `superseded`、新值 `supersedes_thread_id`；只否定→停用不猜 |
| P1-D 写入边界 | `prepare()` 内写关系，未提交消息可留下状态；失败吞掉 | 关系观察成为 outbox 模块，与 assistant 消息同事务入队；失败保留 pending，启动/下一轮重放；effect ledger 防重复 |
| P1-E 批次原子性 | 创建已提交、验证在事务外；索引失败仍显示成功 | 创建+逐项验证同一事务；不符→回滚；仅索引降级→`recovery_required`（禁称已保存/已验证） |
| P1-F 策略信号 | 普通否定 = distress | 明确困扰词或未解决张力才是 distress；直接请求最高优先级 |
| P1-F 自然度 | S6 “我没有情绪/运行正常/随时可以帮你” | 原则点名中英文失败形态；live S6 “阿林，你好呀，见到你很高兴。今天想聊点什么？……” |

## 3. 18 项验收结果

逐项断言、命令与证据见 `docs/testing/stage-5-remediation-acceptance.md` 与机器结果
`evals/stage-5/remediation/results/20261102T034635Z-d9864031221b3e7df238cb87ea50a29a7c4aaf59.json`。

| # | 结果 | 对应生产缺陷 |
|---|---|---|
| 1 | PASS | P0-A |
| 2 | PASS | P0-A |
| 3 | PASS | P0-A |
| 4 | PASS | P0-A |
| 5 | PASS | P1-C |
| 6 | PASS | P1-C |
| 7 | PASS | P0-B |
| 8 | PASS | P0-B |
| 9 | PASS | P0-B（含真实备份恢复 + journal replay） |
| 10 | PASS | P1-D |
| 11 | PASS | P1-E |
| 12 | PASS | P1-E（索引降级→恢复） |
| 13 | PASS | P1-D（幂等） |
| 14 | PARTIAL | 同库重建 PASS；第二真实 Provider NOT_RUN |
| 15 | PASS | P1-F（否定≠distress） |
| 16 | PASS（人工 PENDING） | P1-F（S5/S6） |
| 17 | PASS | 边界不变 |
| 18 | PASS | 撤回/替代/删除不泄漏 |

## 4. 真实 Provider 运行

| 项 | 值 |
|---|---|
| Provider / 协议 | `spark` / `openai-chat-completions` |
| Model ID | `spark-x2.6` |
| 凭据 | `MORROW_TEST_API_KEY`（存在；值未写入代码、日志、Issue、PR、结果文件或本报告） |
| 运行时间（UTC） | 2026-11-02T03:28:42Z 起 |
| 代码 SHA | `d9864031221b3e7df238cb87ea50a29a7c4aaf59` |
| 结果 | 12/12 客观 PASS；`semanticReview=PENDING_HUMAN` |
| 结果文件 | `evals/stage-5/results/20261102T032842Z-d986403-stage-5.json` |
| 历史结果 | 首轮 `1b7ab9cdbbf1ab83026976298f0efeb53ecf9344` 原样保留，未覆盖 |

## 5. 命令、退出码、测试数

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 104 文件 / 970 测试通过（基线 951 + 19） |
| `npx vitest run src/app/stage5-remediation.integration.test.ts` | 0 | 19/19 |
| `npm run eval:stage5` | 0 | 12/12 |
| `npm run eval:stage5:live` | 0 | 12/12 |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | 成功 |
| `MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke` | 1（本机） | BLOCKED：`3221225477 (0xC0000005)` 启动崩溃 |
| CI `41386833397` | success | ubuntu/windows typecheck、tests、build、真实 Electron smoke 全部通过；Windows 升级路径通过 |

环境：win32 / Node 22.23.2 / `node:sqlite`。由于本机 esbuild 无法写系统临时目录，
测试与评测将 `TEMP/TMP` 指向仓库内 `.tmp/es`（单文件 bundle 可复现该宿主限制）。

## 6. 提交

| 提交 | 内容 |
|---|---|
| `16924568d3143aec2aa28b80f1f33cc499e490e2` | 目标化 mutation、v44 删除传播、outbox 投影（v45）、事实批次原子性、表达信号、19 项验收 |
| `9ea53870a0faabca4816b20ffa4f9d9e18a876e5` | 问候失败形态写入固定原则 |
| `d9864031221b3e7df238cb87ea50a29a7c4aaf59` | 真实备份恢复 + deletion journal replay 回归 |
| 本提交 | 九份固定交付物与结果文件（无业务代码变更） |

## 7. 未完成、BLOCKED、NOT_RUN

| 项 | 状态 | 复现方式 / 说明 |
|---|---|---|
| Electron 应用级冒烟（CI） | PASS | run `41386833397`：windows-latest 与 ubuntu-latest 真实应用 smoke 通过 |
| Electron 应用级冒烟（本机） | BLOCKED | `MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke` → 启动即崩溃 0xC0000005；宿主限制，不作为产品结论 |
| 第二真实 Provider 切换 | NOT_RUN | 无第二 Provider 凭据；不得用配置级测试冒充真实模型切换 |
| 真人自然度评分 | PENDING | 需要独立审阅者按 rubric 打分；agent 评分已标注为 agent |
| CI | PASS | run `41386833397`，3 个 job 全部 success |

## 8. 剩余风险

1. **计划器仍是规则驱动**：新的撤回/称呼句式若不在模式内，会落到“无操作”或澄清；
   这是保守方向，但可能漏掉合法的口语变体。缓解：错误方向是“少撤回/多澄清”，不会越权撤回。
2. **outbox 投影延迟**：关系写入在消息提交后的 drain 中完成；若 drain 连续失败 ≥5 次，
   obligation 进入 `failed`，需要人工检查。聊天本身不受影响，但关系连续性会滞后。
3. **自然度依赖模型行为**：原则已点名失败形态，但换模型后可能回归；需要 live 场景持续复验。
4. **单条消息删除**：产品当前无 UI/IPC；触发器覆盖数据库层删除，未来加入删除入口时无需再改。
5. **本机 Electron 冒烟不可用**：本机宿主 0xC0000005，但 CI 的 Windows/Ubuntu 真实应用 smoke
   已通过（run `41386833397`）；本机结果只作为环境证据，不作为产品结论。

## 9. 回滚步骤

1. 回滚业务代码：`git revert d986403 9ea5387 1692456`（按逆序）。
2. 迁移 v44/v45 为前向兼容结构；如需彻底回滚：
   - `DROP TRIGGER IF EXISTS relationship_evidence_delete_with_message;`
   - 重建 `cognitive_outbox` 并移除 `relationship` module（或保留行但旧代码会 skip）。
3. 已撤回/已替代的关系状态不会被回滚“复活”：数据仍在原表，回滚只影响新代码是否读取。
4. 结果文件与历史 live 结果不得删除或覆盖；回滚后在报告中标明版本。

## 10. 交付文件

| 文件 | 用途 |
|---|---|
| `docs/audit/stage-5-independent-review-findings.md` | 修复前确认缺陷、根因、复现 |
| `docs/audit/stage-5-root-cause-matrix.md` | 根因 → 代码 → 测试 → 证据 |
| `docs/architecture/stage-5-relationship-lifecycle-and-deletion.md` | 状态机、事务边界、删除/恢复 |
| `docs/algorithms/stage-5-relationship-mutation-and-expression-policy.md` | 聚合公式、目标撤回、表达策略 |
| `docs/testing/stage-5-remediation-acceptance.md` | 18 项验收 + 19 用例 + rubric |
| `evals/stage-5/remediation/results/20261102T034635Z-d9864031221b3e7df238cb87ea50a29a7c4aaf59.json` | 机器结果 |
| `evals/stage-5/remediation/review/transcript-remediation.md` | 修复后真实转写与 agent rubric（真人 PENDING） |
| `docs/reports/stage-5-remediation-delivery.md` | 本报告 |
| `docs/reports/stage-5-remediation-evidence-index.md` | 单一证据索引 |
