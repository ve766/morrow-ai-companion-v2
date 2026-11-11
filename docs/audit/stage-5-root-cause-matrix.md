# Stage 5 修复根因矩阵

- 分支：`fix/stage-5-review-findings`
- 起始 SHA：`a889ca819ed4686a176a910a54dcf553676fa2a2`（PR #26 head）
- 修复提交：
  - `16924568d3143aec2aa28b80f1f33cc499e490e2` — 目标化 mutation、删除传播、durable 投影、事实批次原子性、表达信号
  - `9ea53870a0faabca4816b20ffa4f9d9e18a876e5` — 问候失败形态写入固定原则
  - `d9864031221b3e7df238cb87ea50a29a7c4aaf59` — 备份恢复 + deletion journal replay 回归
- 下文行号以 `d986403` 为准。

## 1. 根因 → 代码 → 测试

| 缺陷 | 根因（函数 / SQL / 事务） | 修复 | 回归测试 | 证据 |
|---|---|---|---|---|
| P0-A 撤回范围 | `observe()`（旧）把 `status IN ('active','candidate')` 全量作为撤回候选；抽取只有“候选值”，没有目标 | `planRelationshipMutation()`（`src/relationship/relationship-threads.ts:99`）返回判别联合 `support/replace/retract/retract_kind/retract_all/clarify`；`applyMutation()`（`:288`）只触碰命名目标；零目标→clarify，多目标→clarify；全局撤回仅匹配显式句式并写 `relationship.retract_all` | 测试 1/2/3/4 | `src/app/stage5-remediation.integration.test.ts` |
| P0-B 删除残留 | v43 证据表无 message FK；消息/会话删除后证据仍参与聚合；读取不校验来源 | v44 触发器 `relationship_evidence_delete_with_message`（`src/persistence/migrations.ts:2392`）：删除消息即删证据并将无证据线程降为 `candidate/strength=0`；`reconcile()`（`:441`）清理备份恢复带回的孤儿证据并重算；会话删除走 `messages` 的 `ON DELETE CASCADE`，同一触发器生效 | 测试 7/8/9/9b | 同上；备份恢复测试见 `d986403` |
| P1-C 称呼纠正 | `ADDRESS_NEW` 先命中否定短语内的“叫我X”，替换分支被 `negated[1] !== fresh[1]` 排除 | 否定分支先定位 `ADDRESS_NEGATED`，只在**其后**的子串搜索替换值；有旧值→`replace`（旧值 `superseded`、新值写 `supersedes_thread_id`）；无新值→停用旧值或澄清；“还是叫我之前那个名字”→clarify | 测试 5/6 | 同上 |
| P1-D 提交边界 | `prepare()` 内 `observe()`：用户消息未提交即可写关系；失败被宽泛 catch 吞掉，无补偿 | 关系观察迁移为 cognition outbox 的一个模块：v45 扩展 `cognitive_outbox` CHECK 允许 `relationship`；`buildCognitiveProjectors()` 新增 `relationship` projector（`src/app/companion-service.ts:975`）；obligation 与 assistant 消息同事务入队；drain 在提交后执行，失败保留 pending、按尝试次数停靠；effect ledger 防重复 | 测试 10/13 | 同上 |
| P1-E 批次原子性 | 旧 `inTransaction` 只包创建；验证在事务外；索引失败被吞后仍走成功渲染 | `executeOperation('create')` 把创建 + 逐项验证放入同一 `database.transaction`（savepoint 感知）；无索引失败时不匹配→抛错回滚（`rolled_back`）；有索引降级→保留主记录并返回 `recovery_required`；`correct` 同样处理；`reindexFact` 失败调用 `markDegradedJob()` 保证 durable job | 测试 11/12 | 同上；`fact-index-faults.test.ts`（既有退避用例保留） |
| P1-F 策略信号 | `userDistress = signals.negation === true \|\| tension` | `deriveExpressionPolicy()` 增加 `text` 输入，distress 只由明确困扰词或未解决张力触发；直接请求优先级最高 | 测试 15 | 同上 |
| P1-F 自然度 | 问候原则只写“不要免责声明”，未点名实际形态；第二轮 live 仍出现状态报告 | 固定原则点名 `"I am running normally" / "一切照常运转" / "没什么新鲜事" / "随时可以帮你" / "有什么需要随时说"`，并给出正向形态（回问候 + 至多一个开放问题） | 测试 16 + live S5/S6 | `9ea5387`；`evals/stage-5/results/<ts>-<sha>-stage-5.json` |
| P1-F S5 过度解释 | 缺少“用一个从句自然使用记忆”的指令 | 新增原则：在一个从句内自然使用（示例“按我记得的，你喜欢咖啡”），不叙述检索过程与边界，除非不确定性影响答案 | 测试 16 + live S5 | 同上 |

## 2. 事务边界（修复后）

| 步骤 | 位置 | 事务 | 失败语义 |
|---|---|---|---|
| 读取关系线程 | `prepare()` → `activeThreads()` | 只读 | 读失败→该轮无连续性块；不写状态 |
| 用户消息持久化 | `conversations.appendMessage(..., 'user')` | 自身事务 | 失败→本轮终止，无关系写入 |
| 关系编译/抽取 | `planRelationshipMutation()`（drain 时） | 无写 | 无法唯一确定目标→clarify，不写 |
| 关系写入 | `observe()` → `database.transaction(() => applyMutation(...))` | savepoint（可嵌套） | 抛错→证据/线程/事件一起回滚；outbox 行保持 pending |
| outbox 入队 | assistant 消息 `afterPersist` | 与 assistant 消息同一事务 | 消息回滚则 obligation 不存在 |
| outbox 消费 | `drainCognition()` | 每模块独立，effect ledger 先 claim | 失败→attempts+1；≥5→failed；重放→applied 不重复执行 |
| 事实创建 + 验证 | `executeOperation('create')` | 同一 `database.transaction` | 验证不符→回滚；仅索引降级→`recovery_required`，记录保留 |
| 索引重试 | `retryDue()`（degraded job） | 单条内存重索引 | 退避窗口内不热循环；成功后 job=`indexed` |

## 3. 不变量

1. `retracted` / `superseded` 线程不进入 `activeThreads()`，重算分数不会复活。
2. 证据以 `(thread_id, source_message_id)` 唯一；同一消息重放不增加权重。
3. 撤回/纠正只作用于计划器命名的目标；不能唯一定位时不写。
4. 删除来源消息后，证据删除、分数重算、注入资格同步失效。
5. `recovery_required` 不是成功：提示层禁止宣称“已保存/已验证”。
6. 表达策略只改语气与追问预算，不改事实、权限、人格基线或记忆真值。

## 4. 迁移与回滚

| 迁移 | 内容 | 升级/回滚 |
|---|---|---|
| v44 `relationship-evidence-deletion-propagation` | 证据删除触发器 + 无证据线程降级 | 前向兼容：旧代码不依赖触发器；回滚需手工 `DROP TRIGGER`（不删数据） |
| v45 `cognitive-outbox-relationship-module` | 重建 `cognitive_outbox`，module CHECK 增加 `relationship`，复制全部旧行 | 结构重建保留行；旧代码会把 `relationship` 行视为未知模块（pending/skip），不会重复执行；回滚需重建表并删除/迁移 `relationship` 行 |

迁移测试：`src/persistence/migrations.test.ts` 覆盖干净库与旧版升级；`backup-service.test.ts`
覆盖恢复后的 schema 版本与 journal 合并。详见
`docs/architecture/stage-5-relationship-lifecycle-and-deletion.md`。
