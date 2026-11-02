# Stage 5 独立复核发现（Issue #27 修复基线）

- 仓库：`ve766/morrow-ai-companion-v2`
- 复核对象：PR [#26](https://github.com/ve766/morrow-ai-companion-v2/pull/26)，head `a889ca819ed4686a176a910a54dcf553676fa2a2`，base `feat/stage-4a-companion-continuity`
- 修复分支：`fix/stage-5-review-findings`（自 `a889ca8` 创建）
- 复核方式：源码逐函数追踪 + 生产调用链复现 + 首轮 live 转写人工通读
- 结论：**NO-GO**（修复前）。6 个确认缺陷（2 个 P0、4 个 P1），另有 2 个自然度问题并入 P1-F。

> 本文记录的是**修复前已确认的缺陷**、根因位置与复现方式；修复结果与证据见
> `docs/audit/stage-5-root-cause-matrix.md`、`docs/testing/stage-5-remediation-acceptance.md`。
> 本文不把修复者自测当作独立审计；修复后的独立复核仍需外部审阅者完成。

## 1. 缺陷总表

| ID | 严重度 | 领域 | 修复前行为 | 根因位置 | 状态 |
|---|---|---|---|---|---|
| P0-A | P0 数据/隐私 | 关系撤回范围 | “那个约定就算了”撤回全部 active/candidate 线程（称呼、节奏、承诺一起失效） | `src/relationship/relationship-threads.ts` `observe()`（旧）：候选集合 = `rows().filter(status active/candidate)`，无目标 | FIXED |
| P0-B | P0 数据/隐私 | 删除传播 | 删除来源消息/会话后 `relationship_thread_evidence` 残留，线程可继续注入 | v43 证据表无 message 外键；无触发器；无对账 | FIXED |
| P1-C | P1 语义 | 称呼纠正 | “别再叫我小林，叫我阿林”不能替换；注释声称支持，逻辑排除否定式 | `planRelationshipMutation`（旧）：否定正则未参与决策；`ADDRESS_NEW` 先命中否定短语内的“叫我小林” | FIXED |
| P1-D | P1 一致性 | 写入/提交边界 | 关系 observe 在 `prepare()` 内执行，未提交的消息可留下关系状态；失败仅宽泛 catch | `src/app/companion-service.ts` `prepare()`（旧） | FIXED |
| P1-E | P1 一致性 | 多事实原子性 | 批量只验证 `plan.facts[0]` 的旧问题已改逐项验证，但验证在事务外：失败无法回滚；索引失败仍返回成功外观 | `src/memory/memory-service.ts` `executeOperation()`（旧）：`inTransaction` 只包创建，验证在事务外 | FIXED |
| P1-F | P1 表达 | 自然对话 | (a) 普通否定句 `signals.negation` 被当作 distress；(b) S6 问候返回“我没有情绪，今天运行正常，随时可以帮你做事”；(c) S5 解释检索边界过长 | `src/affective-state/expression-policy.ts`；`companion-service.ts` 固定原则；首轮 live `transcript-live.md` | FIXED（自然度人工复核 PENDING） |

## 2. 逐项证据与复现

### P0-A 撤回范围过宽（`relationship-threads.ts`，旧 `observe()`）

修复前的抽取把一句话分成“新增候选”和“撤回候选”：只要句中出现约定撤回措辞，代码就把
`status IN ('active','candidate')` 的所有行一次性置为 `retracted`。线程类型没有参与判断，
所以用户说“那个约定就算了”时，同一会话里此前建立的称呼偏好、互动节奏、承诺全部失效。

复现（修复前，生产 `sendChat` 路径）：

1. 会话 A 发送“以后叫我小林。”→ `address_preference=小林` active。
2. 同一会话发送“我们下次聊项目时间线。”两次 → `shared_topic` active。
3. 发送“那个约定就算了。”→ 三条线程全部 `retracted`。
4. 新会话问候，Provider system 中不再出现任何关系线索。

需要区分三种语义而旧代码只有一种：目标唯一（撤回它）、目标不唯一（澄清，不写）、
用户明确要求全部撤回（记录显式全局意图后批量撤回）。

### P0-B 删除后证据残留（迁移 v43 + 删除路径）

`relationship_thread_evidence.source_message_id` 只是普通 TEXT，没有外键。删除消息或
删除会话（消息随 `ON DELETE CASCADE` 消失）后：

- 证据行仍在；
- `activeThreads()` 读取时不验证来源消息是否还存在；
- `recompute()` 仍按残留证据计分，线程继续 `active` 并进入下一轮 payload。

复现（修复前）：发送“以后叫我小林。”后 `DELETE FROM messages WHERE turn_id = ?`，
`relationship_thread_evidence` 仍有 1 行；新会话问候仍注入 `"小林"`。

恢复路径同样受影响：备份恢复或 deletion journal replay 把会话删掉后，若证据未被同事务
清理，恢复后的库会保留“来源已不存在”的关系线索。

### P1-C 称呼否定/纠正语义不完整

旧代码的注释写“支持‘别叫我Y’”，但实际逻辑是：

```ts
const negated = ADDRESS_NEGATED.exec(trimmed)
const fresh = ADDRESS_NEW.exec(trimmed)
if (negated && fresh && negated[1] && fresh[1] && negated[1] !== fresh[1]) { ... }
```

`ADDRESS_NEW` 不带锚点，在“别再叫我小林，叫我阿林”中先命中否定短语内部的“叫我小林”，
于是 `fresh[1] === negated[1] === "小林"`，替换分支永不成立，最终又 `support` 了“小林”。
用户明确否定的称呼被重新确认，属于语义反转。

同时缺少两条路径：

- 只否定、无新值（“不要这样称呼我”“别再叫我小林”）→ 应停用旧值/澄清，不得猜新值；
- “还是叫我之前那个名字”无法解析出值 → 应澄清，不得猜。

### P1-D 写入与提交边界

修复前的 `prepare()` 在构建 Provider 请求时直接调用 `relationships.observe()`：

- 该调用发生在用户消息持久化之前，关系证据可以指向一个最终没有提交的消息；
- `observe` 的失败被宽泛 `catch` 吞掉，没有 durable 状态，重启后无法补偿；
- 与 assistant 消息提交不在同一事务边界，无法定义“消息成功、关系失败”的恢复语义。

### P1-E 多事实批次不等于原子性

`executeOperation('create')` 的旧实现：

```ts
const created = this.inTransaction(() => plan.facts.map(...))   // 事务只包创建
// 验证在事务之外
if (!hit || missing.length > 0) throw new Error('VERIFICATION_FAILED')
```

事务在验证之前已经提交，抛错无法回滚任何事实；catch 只能返回 `failed`/`rolled_back`
字样，数据库里却是部分成功。另一个分支：索引写入失败被 `reindexFact` 吞掉，主记录保留、
索引缺失，但操作仍按成功路径渲染，模型会对用户宣称“已记住”。

### P1-F 表达策略与自然度

1. `userDistress = analysis?.signals.negation === true || tension >= 0.05`。普通否定
   （“我不喜欢这个方案”）被当成用户处于困扰，触发 `acknowledge_first`，属于信号误用。
2. 首轮 live（`1b7ab9cdbbf1ab83026976298f0efeb53ecf9344`）S6 问候回复：
   “你好呀，阿林。我这边一切照常运转，没什么新鲜事。……有什么想聊的或需要帮忙的，随时说。”
   这是工具式自我介绍，不是伴侣在场感；且与“不声称人类主观体验”的边界被写成了状态报告。
3. 同轮 S5 回复先解释“按我记得的……”，随后补充检索边界，读起来像展示检索结果。
4. 修复后第二轮 live 仍出现“一切照常运转……随时说”，说明第一版原则不够具体；最终版本
   在原则中直接点名中英文失败形态，并要求“回问候 + 至多一个开放问题”。

## 3. 修复前未覆盖、本次不冒充通过的项目

| 项目 | 状态 | 说明 |
|---|---|---|
| 第二真实 Provider 切换行为 | BLOCKED | 无第二 Provider 凭据；仅做同库运行时重建（S12/测试 14） |
| Electron/Windows 应用级冒烟 | PASS（CI） | CI `41385531397` 的 windows-latest/ubuntu-latest 真实应用 smoke 通过；本机单独运行崩溃（0xC0000005），仅作环境证据 |
| 真人自然度评分 | PENDING | Agent 只能按书面 rubric 判定；不得冒充真人评分 |
| CI | PASS | run `41385531397`，3 个 job 全部 success |

## 4. 范围声明

本次修复只处理上述 6 项及其必要的跨模块根因（事务边界、outbox、删除传播、提示原则），
不新增 Agent 能力、语音、桌面控制或 UI 改版；不改 Stage 4-A 的 PARTIAL 结论，不改
PR #24/#26 的 base/head，不合并任何 PR。
