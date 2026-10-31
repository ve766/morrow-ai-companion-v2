# Stage 3 认知运行时（实际运行架构）

本文件只记录**已经实现并在运行路径上**的内容。未接线的设计不写在这里。

## 1. 一轮对话的真实调用链

```
renderer
  └─ IPC invoke 'chat:send'
       └─ src/app/ipc.ts / register-ipc.ts
            └─ CompanionService.sendChat            (companion-service.ts:876)
                 └─ ChatService.send                (companion-service.ts:1004)
                      ├─ 幂等检查（同 requestId 已有 assistant 则直接返回）
                      ├─ recordTurnState('received')
                      ├─ ChatService.prepare         (companion-service.ts:1397)
                      │    ├─ PersonalityService.get()
                      │    ├─ [G1] hooks.effectiveProfile(profile)   ← 基线 + 有界漂移
                      │    ├─ CognitiveSettingsService.get()
                      │    ├─ analyzeCognitiveTurnDetailed()          → analysis / decision
                      │    ├─ buildRetrievalQuery()                   → 检索词
                      │    ├─ CognitiveFeelingService.snapshot()      → 回合开始时的状态
                      │    ├─ adjustPolicyForState(policyForIntent()) → 检索宽度
                      │    ├─ MemoryService.assembleContext()         → 证据块 + conflicts
                      │    ├─ createCognitiveFeelingEvent() + preview() → 本轮状态迁移
                      │    ├─ hooks.contextBlock(turn)                → 长期层（兴趣/自我模型/偏好/[G1]漂移/[X1]自主话题）
                      │    └─ makeRequestPayload()                    → 最终 provider payload
                      ├─ recordTurnState('analyzed' | 'context_ready')
                      ├─ authorize(consentPreview)    → 用户逐次同意（含 payloadSha256）
                      ├─ 二次 prepare + hash 比对     → TOCTOU 防护
                      ├─ 持久化用户消息（含 cognitiveObservation）
                      ├─ dispatchToProvider()          → 真实 HTTP / 取消 / 超时
                      ├─ guardAnswerFacts()            → 未受支持的个人事实改写
                      ├─ 持久化 assistant 消息（事务内：状态更新 + 定稿意图应用）
                      ├─ recordTurnState('committed')
                      ├─ hooks.onTurnCompleted()       → 兴趣 / 偏好 / [G1]成长证据 / 自我事实 / 反思
                      └─ evaluateAnswerEvidence() + buildTurnEvaluation() → 只记录，不改判定
```

关键点：

- **payload 只构建一次语义**：`prepare()` 被调用两次（预览与校验），但两次输入相同、结果哈希一致，否则抛 `CONFLICT`。
- **状态读取发生在检索之前**：`this.feelings.snapshot(evaluationAt)` 在 `assembleContext` 之前，避免本轮事件决定本轮证据（`companion-service.ts:1440-1446`）。
- **成长与自主话题都在 system prompt 里**，不新增工具、不新增外部调用。

## 2. 长期层在 prompt 中的位置

`prepare()` 的 system 由 7 段按固定顺序拼接（`companion-service.ts:1464-1476`）：

1. 用户编辑的沟通偏好（版本 + 四个数值）
2. 附加风格偏好（`systemRules`）
3. 认知指引（意图 / 不确定性 / 证据指令）
4. 状态指引（本轮状态迁移）
5. **长期层块**（`buildSelfModelContextBlock`）：兴趣 → 未经确认的自我推断 → 交互偏好 → **人格漂移** → **自主话题许可**
6. 记忆证据块（JSON，含冲突标记）
7. 固定原则

长期层的每一行都带"这是规则推导/低置信/可逆"的限定语，且都不携带权限。

## 3. 本次新增的两个运行时部件

### 3.1 人格有界漂移（G1）

- 服务：`src/personalization/personality-growth.ts`
- 表：`personality_growth_signals` / `personality_growth_state` / `personality_growth_events`（迁移 29）
- 接线点：`ChatService.prepare`（读取有效人格）、`onTurnCompleted`（写入证据）
- 失败策略：读取失败 → 回落到用户基线并记 `cognition.degraded`；写入失败 → 抛给调用方的 try/catch，聊天不受影响

### 3.2 受约束自主话题（X1）

- 服务：`src/self-model/exploration-policy.ts`
- 表：`exploration_events`（迁移 29）
- 接线点：`buildSelfModelContextBlock`（决策并记录）、`ChatService.prepare`
- 边界：**只在用户已发起的回合内**说话；本构建没有任何回合外通道，表结构里也没有能假装有的列

## 4. 数据与失败边界

| 部件 | 一致性策略 | 失败时行为 |
|---|---|---|
| 成长证据 | `BEGIN IMMEDIATE` 内插入 + 折叠 + 写缓存 | 回滚事务，聊天继续 |
| 自主话题记录 | 单条 insert，`(turn, kind)` 语义幂等 | 记录失败即视为未发起 |
| 消息删除 | 触发器级联删除成长证据与探索记录 | 折叠自动重算，不留幽灵值 |
| 回合上下文 | 定稿意图先落库，消息事务内应用 | 崩溃后由 `recoverInterruptedTurns` 收尾 |

## 5. 明确不在本架构内

- Agent / 工具执行 / 桌面操控 / 浏览器操控：**没有**任何实现，也不在数据模型里留位。
- 回合外主动联系：**没有**通道。
- 记忆巩固与按重要度衰减：**未实现**，只有 180 天过期标记。


---

## 6. 后续修复后的运行时变化（Issue #20）

### 6.1 长期层的三行归属

`buildSelfModelContextBlock` 现在按 `interests.origin` 拆成三段，互不合并：

1. `Topics the user returned to…`（`origin=user`）
2. `Topics Morrow chose to pursue…`（`origin=morrow`）
3. `Topics both sides have independent evidence for…`（`origin=shared`）

用户证据落在 Morrow 话题上会升级为 `shared`；Morrow 证据落在用户话题上**不会**改写归属。

### 6.2 探索从"写字符串"变成状态机

旧实现把许可写在 prompt 构建里并直接记成 `raised`。现在拆成两个钩子：

```
prepare() → hooks.explorationLine(turn) → { line, interestId, label } → 写入 system
                                       → exploration_events(state='permitted')
                                       → 若 line 非空：state='selected_for_prompt'
send()    → assistant 消息落库后 → hooks.settleExploration({turnId, outcome, reply})
                                       → detectRaised(reply,label)
                                       → 'actually_raised' | 'not_raised' | 'provider_failed'
```

只有 `actually_raised` 计入 24 小时频次。

### 6.3 人格证据来源可追溯

`personality_growth_signals.source` 记录命中的规则名（如 `explicit_direct_request`），`personality_growth_events.reason` 里带同一来源，因此"为什么漂移"不需要重跑分析器。


---

## 7. 记忆生命周期（Issue §2A）

```
MemoryService.create/correct/retract/restore/confirm
   └─ importance.onMemoryChanged(id)          ← 每次变更重算，不做增量
        └─ scoreMemory(record, corrected, now) → memory_importance(score, components, version)

启动期一次（无后台调度）：
   recomputeAll() → consolidate() → archiveBelow(0.35, 180d)
```

- **归档不改状态**：只写 `memories.archived_at`，`status` 仍是 `active`；`retracted` 专指用户撤回。
- **检索过滤**：`memory-context-assembler` 的候选集合加 `archived_at IS NULL`，归档记忆不进入 prompt 竞争。
- **合并只引用**：`memory_consolidations` 存成员 id 列表，正文仍只有 `memories` 一份。
- **恢复**：`importance.restore(id)` 清空 `archived_at`，内容与修订不变。


---

## 8. 陪伴目标（Issue §2D）

`CompanionGoalService`（`src/motivation/companion-goal.ts`）在长期层中提供第三块内容：

```
buildSelfModelContextBlock
  ├─ 兴趣三行（user / morrow / shared）
  ├─ 未经确认的自我推断
  ├─ 交互偏好
  ├─ 人格有界漂移
  └─ 目标三行（user / shared / morrow）   ← §2D
```

读取路径：`activeForContext(3)` → `expireOverdue()` → `status='active'` 且 `due_at` 未过 → 按优先级升序。
完成、取消、过期的目标在下一轮直接消失；`resume()` 可恢复（`cancelled` 除外）。

**与既有 `GoalService` 的关系**：后者是审批 + 工具执行的任务演示，留在 Agent 侧，不进入陪伴主链。


---

## 2026-10-31 纠偏：运行时变化

> 上文引用的行号已过时。以 `docs/architecture/stage-3-target-architecture-v2.md` 为准。

1. **回合后认知改为事务 outbox**：`cognitive_outbox` 行在 assistant 消息事务内写入，提交后逐模块消费；启动期重放。`onTurnCompleted` 的串行 try/catch 已从生产路径移除（离线调用方保留）。
2. **兴趣聚合改为可重算投影**：`interests.stale_at` 由触发器标记，`list()`/`activeForContext()` 重算并拒绝 stale 行。
3. **表达适配与身份分离**：`user_interaction_profile` 独立建表；`effectiveProfile` 只叠加表达偏移。
4. **目标有生产写入**：outbox `goal` 模块调用 `detectFromTurn`，显式承诺直接建目标、含糊意愿建候选。
5. **探索多一个 `uncertain` 状态**，预算按 turn 键。

调用链（修正后）：

```
send → prepare（读：人格基线+交互偏移 / 分析 / 记忆 / 状态 / 长期层 / 序列化）
     → 授权 → 二次 prepare → hash 比对
     → 事务[assistant 消息 + 感受事件 + 待决项 + 回合上下文 + outbox 6 行 + 可选 knowledge_gap]
     → 提交 → drainCognition(turnId)（6 个 projector，各自幂等、各自失败）
     → 评估 → 返回
```

---

## 11. 最终纠偏后的运行时（2026-10-31）

上一节的流程在**事务边界**和**重放语义**上是错的，本节取代它。

### 11.1 一个回合的真实事务边界

```
send → prepare（读：人格基线+交互偏移 / 分析 / 记忆 / 状态 / 长期层 / 序列化）
     → 授权 → 二次 prepare → hash 比对
     → 事务[
         assistant 消息
         + 感受事件
         + 待决项
         + 回合上下文
         + cognitive_outbox 7 行（interest/preference/growth/self_fact/reflection/goal/memory）
         + 可选 cognition.knowledge_gap 事件（确定性 id）
         + 可选 knowledge_gap_evidence 一行
       ]                                   ← 任一失败整条消息回滚
     → 提交
     → markExplorationAttempted（provider 调用前）
     → dispatchToProvider
     → settleExploration（按回复判定 not_raised / uncertain / actually_raised）
     → drainCognition(turnId)
     → 评估 → 返回
```

关键变化：knowledge-gap 不再是 `tryRecord` 的尽力而为写入。它和消息在同一个事务里，写不进去就整条回滚——因为它是反思的正式输入，不是日志。

### 11.2 Outbox 的重放协议

```
drain(row):
  ledger.begin(turn, module, version, 'project')
    ├─ 'applied'  → outbox 标记 done，计入 replayed，**不执行副作用**
    └─ 'run'      → 执行 projector
                    → ledger.complete(...)   ← 业务写入之后
                    → outbox 标记 done
                    失败 → ledger.fail(code) → outbox pending/failed
```

顺序是刻意的：先 ledger 再 outbox。反过来会在崩溃后重跑已经提交的副作用。

投影副作用自身也必须有幂等键，ledger 只是"不重跑已完成的投影"：

| 副作用 | 幂等键 | 约束 |
|---|---|---|
| 兴趣证据 | `interest_evidence(interest_id, evidence_ref)` + `evidence_ref` 唯一 | 同一消息/事件只记一次 |
| 交互风格 | `user_interaction_signals(dimension, turn_id)` | 同一轮同维度一次 |
| 目标 | `goal_creation_keys(idempotency_key)` | `goal:turn:<msg>:<hash>` 与 `goal:candidate:<id>` |
| 记忆证据 | `memory_evidence(memory_id, source_ref)` | `source_ref` = 消息 id |
| 反思 finding | `reflection_findings(dedupe_key)` | 重放走 ledger，不靠"行已存在"判断 |

### 11.3 反思的增量消费

```
run():
  cursor ← reflection_cursors(consumer='reflection')
  batches ← while (seq > cursor) and batch < 5: listAfter(seq, 200)
  事务[
    createRun
    for finding: createFinding / findByDedupeKey → applyEffect via ledger
    recordDeterministic(reflection.completed)
    setCursor(max(batchEnd, latestSeq))   ← 事务内读，持写锁
  ]
```

游标只在整批提交后前进；失败则整批回滚，下次重读同一批。`backlog()` 给出 `lastSeq / latestSeq / pending`。

### 11.4 证据归属

`interest_evidence` 现在带 `evidence_origin`。fold 同时产出总量与按来源拆分的量，晋升判定只读**拥有方**那一侧：

| 聚合 origin | 晋升用的支持数 | 晋升用的会话数 |
|---|---|---|
| `user` | user 侧 | user 侧 |
| `morrow` | morrow 侧 | morrow 侧 |
| `shared` | morrow 侧（且 user 侧 > 0） | morrow 侧 |

原因很直接：探索门把 `shared` 也当作 Morrow 可以提起的话题，如果用户提及能给 shared 凑够门槛，用户证据就从后门进了她的探索池。

### 11.5 Effect claim 协议（2026-10-31 修正）

```
begin(identity):
  transaction:                        ← BEGIN IMMEDIATE
    INSERT ... ON CONFLICT DO NOTHING  (pending, 无 owner)
    UPDATE ... SET state='running', claim_owner=:worker, lease_until=:now+60s
      WHERE state IN ('pending','failed_retryable')
    changes === 1  → 'run'
    否则读行：
      applied            → 'applied'
      running 且租约过期  → 条件 UPDATE 抢占（乐观并发，changes=1 才 'run'）
      其他               → 'busy'
```

- `complete()` / `fail()` 都带 `claim_owner = :worker`，**只有持有者能收尾**。
- `busy` 不是错误：outbox 行保持 pending，持有者完成或租约过期后自然可再领。
- 租约让"进程崩溃留下的 running"变成"可恢复"，而不是"永远卡住"或"被误认为已完成"。
