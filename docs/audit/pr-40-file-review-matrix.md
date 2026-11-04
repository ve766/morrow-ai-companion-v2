# PR #40 逐文件审查矩阵（63/63）

审计基线：`052bcaa9c0320ef5e726c7bf66df85a49055628d`
状态说明：`已审` = 阅读 diff + 必要上下文/运行验证；`结论` = 该文件是否支持 PR 声明。
finding 编号见 `pr-40-independent-review.md`。

## A. 文档（10）

| # | 文件 | 已审 | 结论 | findings |
|---|---|---|---|---|
| 1 | `docs/architecture/database-schema.md` | 是 | v48 字段/状态/不变量与代码一致；legacy 限制已写明 | P2-03（说明存在） |
| 2 | `docs/reports/stage-4-companion-confirmation-closure-report.md` | 是 | 绑定 `7b83fea` 的历史报告；数字为当时事实；未冒充当前 | — |
| 3 | `docs/reports/stage-4-companion-confirmation-evidence-index.md` | 是 | 历史索引；结果文件/SHA 指向正确 | P2-05（继承结果 branch 字段） |
| 4 | `docs/reports/stage-4-evidence-consistency-closeout.md` | 是 | Issue #44 三项修正与实际文件一致 | — |
| 5 | `docs/reports/stage-4-final-audit-closure.md` | 是 | Issue #43 根因/修复/测试与代码一致；承认 complete/drop 原语 | P3-07（已登记） |
| 6 | `docs/reports/stage-4-final-repair-evidence-index.md` | 是 | A 组 5、B 组 3、111/1042 与实测一致 | — |
| 7 | `docs/reports/stage-4-final-repair-report.md` | 是 | Issue #42 历史 + #43 追加；事务/失败表与代码一致 | P1-01（未覆盖的失败路径） |
| 8 | `docs/reports/stage-4-migration-verification.md` | 是 | **“上一个 schema→current PASS”无仓库测试支撑** | P2-02 |
| 9 | `docs/testing/stage-4-companion-confirmation-acceptance-matrix.md` | 是 | 路由/候选行为与测试对应；**P09 不覆盖 candidate/pending 重启** | P2-04 |
| 10 | `docs/testing/stage-4-final-repair-acceptance-matrix.md` | 是 | 轮次边界清楚；**重启/DB busy 行覆盖不足** | P2-04 |

## B. 评测资产（26）

| # | 文件 | 已审 | 结论 | findings |
|---|---|---|---|---|
| 11 | `evals/stage-3/runner/harness.ts` | 是 | 仅补 `CompanionGoalService(...,eventLog)`、pending repo 注 audit、空白；无语义变化 | P3-06（harness 部分） |
| 12 | `evals/stage-3/shared/real-provider.ts` | 是 | 同上（构造参数 + pending audit）；provider 行为未改 | P3-06 |
| 13 | `evals/stage-3/results/20261102T153506Z-7b83fea.json` | 是（元数据+结构） | SHA=7b83fea；15+1NOT_RUN/16；scripted-offline 标注清楚 | — |
| 14 | `evals/stage-3/results/20261102T153506Z-7b83fea-summary.json` | 是 | 与 #13 同源摘要 | — |
| 15 | `evals/stage-3/results/20261103T041302Z-b729917.json` | 是 | SHA=b729917 一致 | — |
| 16 | `evals/stage-3/results/20261103T041302Z-b729917-summary.json` | 是 | 同上 | — |
| 17 | `evals/stage-3/results/20261103T042747Z-1ab1f64.json` | 是 | SHA=1ab1f64 一致 | — |
| 18 | `evals/stage-3/results/20261103T042747Z-1ab1f64-summary.json` | 是 | 同上 | — |
| 19 | `evals/stage-3/results/20261103T152321Z-294dcd5.json` | 是 | SHA=294dcd5；L15 NOT_RUN 带原因 | — |
| 20 | `evals/stage-3/results/20261103T152321Z-294dcd5-summary.json` | 是 | 同上 | — |
| 21 | `evals/stage-4-companion-confirmation/results/20261102T155319Z-7b83fea8aa9ec7847bf47541e49dde073137059f.json` | 是 | 绑定 7b83fea；审计项状态 | — |
| 22 | `evals/stage-4-companion-confirmation/results/20261103T044602Z-1ab1f64d561ab241e3a9321167f7dbc6c607f1b4.json` | 是 | 绑定 1ab1f64；7 项 FIXED | — |
| 23 | `evals/stage-4-companion-confirmation/results/20261103T154342Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8.json` | 是 | 绑定 294dcd5；`ci.status=PENDING` 为生成时事实（保留） | — |
| 24 | `evals/stage-4-companion-confirmation/results/20261103T162520Z-294dcd50c64ee5af2d99cca47dd8a0e6669539b8-ci-closure.json` | 是 | codeSha/evidenceHeadSha 区分正确；run 41667548702 三 job | — |
| 25 | `evals/stage-4a/results/20261102T153540Z-7b83fea.json` | 是 | SHA 一致；branch 字段硬编码 | P2-05 |
| 26 | `evals/stage-4a/results/20261103T041342Z-b729917.json` | 是 | 同上 | P2-05 |
| 27 | `evals/stage-4a/results/20261103T042827Z-1ab1f64.json` | 是 | 同上 | P2-05 |
| 28 | `evals/stage-4a/results/20261103T152359Z-294dcd5.json` | 是 | 7/7；branch 字段硬编码 | P2-05 |
| 29 | `evals/stage-5/results/20261102T153443Z-7b83fea.json` | 是 | scripted 12/12；provider=scripted-offline | P2-05 |
| 30 | `evals/stage-5/results/20261102T153557Z-7b83fea-stage-5.json` | 是 | live 12/12；真实回复；AWAITING_MANUAL_REVIEW | P2-05 |
| 31 | `evals/stage-5/results/20261103T041235Z-b729917.json` | 是 | 同上 | P2-05 |
| 32 | `evals/stage-5/results/20261103T041410Z-b729917-stage-5.json` | 是 | 同上 | P2-05 |
| 33 | `evals/stage-5/results/20261103T042723Z-1ab1f64.json` | 是 | 同上 | P2-05 |
| 34 | `evals/stage-5/results/20261103T042909Z-1ab1f64-stage-5.json` | 是 | 同上 | P2-05 |
| 35 | `evals/stage-5/results/20261103T152255Z-294dcd5.json` | 是 | 12/12；SHA 一致 | P2-05 |
| 36 | `evals/stage-5/results/20261103T152425Z-294dcd5-stage-5.json` | 是 | live 12/12；spark-x2.6；真实回复；17 分钟 | P2-05 |

## C. 生产代码（17）

| # | 文件 | 已审 | 结论 | findings |
|---|---|---|---|---|
| 37 | `src/app/companion-service.ts` | 是 | 移除 `completePendingItem`（-6 行）；goal/reflection projector 仍走 detectFromTurn/ingestRun | P1-01（outbox 影响） |
| 38 | `src/app/index.ts` | 是 | 真实调用 `composeStartupReflectionServices`/`runStartupReflection`；companionGoals 注入 IPC；decide 单一路径 | P3-08、P1-01（manual 错误映射） |
| 39 | `src/app/ipc.ts` | 是 | 新 channel 经统一 execute/trusted sender/严格 schema；旧 complete 不注册 | — |
| 40 | `src/app/startup-composition.ts` | 是（新增） | 生产组合与 startup 执行函数；routing 失败 fail-safe | P3-08 |
| 41 | `src/cognition/pending-items.ts` | 是 | findingId/decision 字段；decide 委派 repository；dedupe key 为 P1 根因之一 | P1-01、P3-07 |
| 42 | `src/cognition/reflection-routing.ts` | 是 | 单一 kind 来源；open_question→pending_user；逐 finding 事务；**PENDING_LINK_MISMATCH 是 P1 触发点** | P1-01 |
| 43 | `src/motivation/companion-goal.ts` | 是 | decideCandidate 单事务；GoalAuditSink 必需；来源校验/expired 持久/幂等/冲突 | — |
| 44 | `src/persistence/cognitive-context-repository.ts` | 是 | decide 事务顺序正确；route changes===1；审计必填（运行期）；complete/drop 原语 | P3-06、P3-07、P2-03、P3-11 |
| 45 | `src/persistence/migrations.ts` | 是 | v48 顺序在 v47 后；加列+索引；迁移事务/回滚/备份未变 | P2-02、P2-03 |
| 46 | `src/preload/index.ts` | 是 | 新 bridge 与 contracts 一致；旧 complete 移除 | — |
| 47 | `src/renderer/index.html` | 是 | 候选面板/正式目标列表结构；无内联脚本；语义标题 | — |
| 48 | `src/renderer/src/goal-candidates-ui.ts` | 是（新增） | 真实 bridge 调用；两个 request guard；accept 刷新候选+正式列表+goals view；失败恢复按钮 | — |
| 49 | `src/renderer/src/goals-ui.ts` | 是 | 仅导出 `refreshGoalViews`，行为未变 | — |
| 50 | `src/renderer/src/main.ts` | 是 | 初始化候选面板，无其他改动 | — |
| 51 | `src/self-model/reflection-service.ts` | 是 | open_question producer 只读 gap 事件；2 会话阈值分离；effcts/cursor 事务 | P1-01（重复 finding 来源）、P3-09 |
| 52 | `src/shared/contracts.ts` | 是 | channel/类型与 preload/ipc 一致；旧 complete 移除 | P3-10 |
| 53 | `src/shared/validation.ts` | 是 | 新解析器严格；旧 `parsePendingItemIdRequest` 死代码；文件含历史 NUL 字符（既有） | P3-10 |

## D. 测试（10）

| # | 文件 | 已审 | 结论 | findings |
|---|---|---|---|---|
| 54 | `src/app/ipc.test.ts` | 是 | 旧 complete 未注册；decide 校验/不可信 frame；候选 IPC 转发；无断言弱化 | — |
| 55 | `src/app/stage4-goal-candidate-e2e.test.ts` | 是（新增） | IPC→service→SQLite→IPC；listGoals；reject 不建 goal | — |
| 56 | `src/app/stage4-reflection-producer.integration.test.ts` | 是（新增） | 真实 knowledge-gap→producer→open_question；manual/startup 两次路由 | P1-01（只跑一次） |
| 57 | `src/app/stage4-startup-composition.integration.test.ts` | 是（新增） | 真实生产函数；finding/route/pending/audit；无 finding 安全；ABORT 回滚 | P1-01（缺第二次 gap） |
| 58 | `src/cognition/reflection-routing.test.ts` | 是 | 14 用例覆盖 kind 一致/终态/回滚/缺失/legacy/audit；**只重放同一 finding id** | P1-01 |
| 59 | `src/motivation/companion-goal.test.ts` | 是 | 只补 EventLogService 构造；行为断言未变 | — |
| 60 | `src/motivation/goal-lifecycle.test.ts` | 是 | 33 用例；A 组 5 个审计/回滚/编译契约；accept/reject/来源用例 | — |
| 61 | `tests/correction-round.test.ts` | 是 | 仅构造参数更新；outbox/ledger 语义未变 | — |
| 62 | `tests/goal-candidates-ui.test.ts` | 是（新增） | 真实 bridge；accept 后正式列表出现；reject 只走 bridge | — |
| 63 | `tests/helpers/companion-stack.ts` | 是 | goals 注入 events；**continuity pending 仍未注入 events** | P3-06 |

## 覆盖统计

- 已审文件：**63 / 63**（100%）
- 其中需要运行验证的（源码/测试/结果/CI）：全部有对应证据
- 直接关联 finding 的文件：AUD45-P1-01（#38/#37/#41/#42/#51/#56/#57/#58）、
  P2-02（#8/#45）、P2-03（#44/#45/#1）、P2-04（#9/#10）、P2-05（#25–#36）、
  P3-06（#11/#12/#44/#63）、P3-07（#41/#44/#5）、P3-08（#38/#40）、
  P3-09（#51）、P3-10（#52/#53）、P3-11（#44）、P3-12（`pending-ui.ts`，未在 PR 变更内）
- 未发现问题的文件也已记录审查范围（docs/eval metadata/构造改动/测试 helper）。
