# Stage 3 最后一轮纠偏报告（P0-1…P0-5 / P1-6…P1-8）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-3-long-term-companion`
- PR：[#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19)（OPEN，未合并）
- 审查基线：`b72c5141a591b193782d6358877b62306ecab984`
- 本轮代码基线：`b0e719ad116db5607295da9f5ccddc6e2f4589b4`
- 结果文件中的 `codeCommit` 均为 `b0e719a`，结果提交本身只增文件、不改代码。

## 0. 本轮做了什么、没做什么

本轮不新增 Stage 3 功能，只把「已经存在但没闭合」的八项修到可验证：

- 三个可靠性底座（Outbox 幂等/崩溃恢复、knowledge-gap durable write、反思增量游标）先闭合；
- 再闭合证据生产与归属（Morrow 独立证据、memory restatement/confirmation、goal 生命周期）；
- 再修评测真实性（L5/L12 假阳性、结果绑定与 `unmeasured`）；
- 最后做整体验收（本地全部可执行项 + CI/真实 Provider 的诚实标注）。

未做：Stage 4、新算法/新表/新 prompt block（除本任务直接必要）、合并 PR、改 `main`、发布 Release、把 scripted 结果说成模型质量。

## 1. 逐项追踪表

| 项 | 根因 | 修复 | 提交 | 测试 | 原始结果 | 最终状态 |
|---|---|---|---|---|---|---|
| P0-1 Morrow 兴趣不能证明独立形成/晋升 | 一个 finding 只调用一次 `observeMorrow`，且只传第一个会话 id；聚合 `origin` 可被后续观测改写，无法证明归属 | `interest_evidence` 增加 `evidence_origin / source_finding_id / event_ref / topic_label`；`observeMorrowEvidence` 逐条事件写证据；fold 按来源拆分；morrow/shared 只按 Morrow 侧证据晋升，存储计数也只计该侧；探索生命周期增加 `eligible` / `model_attempted`，提出判定要求「提问或第一人称关注」形态 | `f1f7a02` | `src/self-model/morrow-attribution.test.ts`（6）、`tests/correction-round.test.ts`、`tests/eval-assertions.test.ts` | `evals/stage-3/results/20261031T063724Z-b0e719a.json` L5 | **PASS** |
| P0-2 反思永远只读最早 200 条 | `events.list({ascending:true})` 每次返回最旧 200 行，游标不存在 | `reflection_cursors` 持久化 `seq` 水位；`run()` 以 `seq > cursor` 分批读取，整批在同一事务内提交后才推进游标；`backlog()` 暴露位置/最新/待处理数；消费者名独立，多个触发器不会互相推进 | `f1f7a02` | `tests/correction-round.test.ts` P0-2（3） | 同主结果；500 事件 + 第 501 条 | **PASS** |
| P0-3 Outbox 不是「恰好一次」 | 副作用成功、标记 done 前崩溃 → 重启重放；goal 无唯一约束；finding 已存在时直接跳过 effect | `cognitive_effect_ledger`（pending/running/applied/failed_retryable/terminal_failed）；drain 先 claim、先 complete ledger 再标记 outbox；`applied` 直接跳过并计入 `replayed`；goal 以 `goal_creation_keys` 幂等；reflection 的 finding 存在性不再等于 effect 完成，重复 finding 仍走 ledger；`requeueInterrupted()` 恢复 running | `f1f7a02` | `tests/correction-round.test.ts` P0-3（6） | 崩溃点矩阵见 §2 | **PASS** |
| P0-4 knowledge-gap 吞错 | `tryRecord` 捕获异常返回 null，消息照常提交 | 改为 `recordDeterministic`，在 assistant 消息事务内，失败即回滚整条消息；`knowledge_gap_evidence` 同事务写入独立证据行；确定性事件 id 保证重试只写一次；删除 turn 由触发器回收 | `f1f7a02` | `tests/correction-round.test.ts` P0-4（2） | 事务回滚 + 1 gap/轮 | **PASS** |
| P0-5 记忆重复提及没有生产输入 | 生产只写 `statement`/`correction`；`confirm()` 不写证据 | `memory_evidence` 词表扩到 restatement/confirmation/retraction/model_reference；`confirm()` 写 confirmation 证据、`retract()` 写 retraction 并抑制重复贡献；`MemoryService.observeUtterance` 经拒绝门（疑问/否定/引用/假设/角色扮演/讨论）后写入；新增 `memory` outbox 模块接入真实回合 | `f1f7a02` | `src/memory/memory-evidence.test.ts`（10） | 同主结果 L16；排序变化断言 | **PASS** |
| P1-6 目标期限丢失、接受非原子 | `dueAt: null` 写死；标题含时间短语；`acceptCandidate` 读后写；无幂等键；来源删除不传播 | `goal-time.ts` 解析显式日期/明年三月/下个月/下周/N 天后（UTC+8），无法解析保留原表达并要求澄清；标题剥离时间；`acceptCandidate` 单事务 + 来源存在性 + `goal:candidate:<id>` 幂等；`goal_candidates` 增加 `due_at/due_expression/source_state`，删消息触发器使候选失效并取消目标 | `f1f7a02` | `src/motivation/goal-lifecycle.test.ts`（14） | 主结果 L10 | **PASS** |
| P1-7 L5/L12 断言与证据不一致 | L5 只断言 `permitted/selected_for_prompt`；L12 断言 `evidenceCount >= 0`，detail 却是 `evidence=0` | L5 走完整链路并要求 `model_attempted` + `actually_raised`（关键词命中只算辅助，裸提及记 `uncertain` 且不计通过）；L12 前置条件改为 `>0`，并要求投影收缩；两者导出为 `runL5/runL12` 以便负向注入；结果文件补 `datasetVersion/harnessVersion/paramsVersion/clock/providerModelId/unmeasured` | `b0e719a` | `tests/eval-assertions.test.ts`（5） | L5/L12 正反例见 §3 | **PASS** |
| P1-8 真实 Provider / CI 证据 | 无真实凭据；Actions runner 未启动 | 本地全部可执行项已执行；CI 与真实模型见 §4 | — | — | — | **BLOCKED** |

## 2. Outbox 崩溃点故障注入矩阵

全部在 `tests/correction-round.test.ts`，使用真实 SQLite 文件（重启项）与真实 `CompanionGoalService`。

| 崩溃点 | 注入方式 | 期望 | 实测 |
|---|---|---|---|
| effect 执行前崩溃 | projector 直接抛错 | 行留 pending，effect 记 `failed_retryable`；后续成功只生效一次 | PASS |
| effect 提交后、outbox 标记前崩溃 | 先写业务行再抛错 | 重放不产生第二条业务行（幂等键） | PASS |
| ledger applied 之后重放 | 手工 `begin`+`complete` 后 drain | projector 不再被调用，计 `replayed` | PASS |
| 永久失败 | 每次抛错 | 第 5 次后 effect `terminal_failed`，outbox `failed`，`stats()` 可见 | PASS |
| 进程重启（running 残留） | 关闭数据库后重开 + `requeueInterrupted()` | running → `failed_retryable`，重放补完 | PASS |
| 同一候选重复/并发接受 | 连续两次 `acceptCandidate` | 返回同一 goal，`companion_goals` 仅 1 行 | PASS |
| 来源消息已删除 | 删除 message 后接受 | 候选已 expired，接受抛错，无孤儿目标 | PASS |

## 3. L5 / L12 正反例

| 断言 | 正例 | 反例（必须 FAIL） |
|---|---|---|
| L5 `actually_raised` | 回复「我最近一直在想蛋白质折叠的问题，想问问你怎么看。」→ `actually_raised` | 回复「好的，我明白了。」→ `not_raised`，场景 FAIL |
| L5 独立性 | 3 个知识缺口跨 2 个会话 → active | `gapsInFirst: 1`（仅 1 个会话）→ 未晋升，FAIL |
| L12 前置 | 显式风格要求 → `evidence>0`，删除后行清零、投影收缩 → PASS | 中性闲聊 → `evidence=0`，FAIL |

命令行实测：`tests/eval-assertions.test.ts` 5/5 通过，其中 3 条明确要求 FAIL。

## 4. 未闭合项与阻断

| 项 | 状态 | 证据 |
|---|---|---|
| 有效 CI | **BLOCKED** | run [41178081914](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41178081914)：三个 job `steps=[]`、`runner_name` 为空，注解为 *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* —— 账号计费/额度阻断，非代码失败 |
| 真实 Provider 多轮陪伴 | **BLOCKED** | 本轮未持有可用真实凭据，未读取/上传/打印任何凭据；scripted provider 只证明接线 |
| Electron renderer | **BLOCKED** | 本机渲染进程沙箱初始化即崩（0x80000003），属环境问题，非代码；CI 双平台覆盖 |
| Windows 安装升级 | **NOT_RUN** | 未在本轮执行安装器验收 |

这些都不影响「本地代码 + 本地评测」的结论，但足以让整体不能报 PASS。

## 5. 最终状态

- P0-1…P0-5：**PASS**（有源码、迁移、回归测试、失败路径测试、评测证据）
- P1-6、P1-7：**PASS**
- P1-8：**BLOCKED**（外部条件阻断，本地可执行项已全部完成）
- **整体：PARTIAL**。任何 P0 未闭合都不得为 PASS；P1-8 的外部阻断也不得冒充 PASS。
