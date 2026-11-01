# Stage 3 运行时与数据血缘审查

- 审查对象：`ve766/morrow-ai-companion-v2` @ `5fe62f546b84b0306e7f11e887bad9c75f3227ba`
- 分支：`feat/stage-3-long-term-companion`；PR [#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19)
- 审查者身份：**本轮实现的作者之一 → 非独立**。见 `stage-3-independent-final-acceptance.md` §0，本文件结论一律受 `BLOCKED_INDEPENDENCE` 约束。
- 方法：`git fetch --filter=blob:none` 取树 + 本地 blob 哈希比对 + 源码逐点阅读；未修改任何业务文件。

## 1. 树一致性（先证明我审的就是这个 SHA）

`git ls-tree -r 5fe62f5` 共 **583** 个文件。逐个计算本地 blobs 的 `sha1("blob <len>\0"+bytes)`：

| 结果 | 数量 | 说明 |
|---|---:|---|
| 完全一致 | 518 | 字节级相同 |
| 仅行尾不同（CRLF ↔ LF） | 65 | 已逐个用 `diff --strip-trailing-cr` 复核为 **0 差异** |
| 内容不同 | **0** | — |
| 远端缺失/本地多余 | 0 / 2 | 多余的两个是 `evaluation/reports/m3-*.json`、`m4-*.json`，`git` 未跟踪（本地重跑产生） |

结论：本地工作树与 `5fe62f5` **内容等价**，行尾差异不影响 TypeScript 语义。因此下文的行号与本地重跑结果均可归属到该 SHA。

## 2. 进程与调用图

```
renderer (src/renderer/, 6 files)
   │ window.morrow.*            白名单 API，contextBridge
preload (src/preload/index.ts, 161 行)
   │ ipcRenderer.invoke('morrow:*')
main (src/app/)
   │ ipcMain.handle × 66 个通道（常量在 src/shared/contracts.ts）
CompanionService.sendChat → prepare()  ← 认知与检索都在这
   │ system prompt
provider 客户端（云端 HTTPS / 本机回环）
   │
persistence (node:sqlite, 38 个迁移, 57 张表)
```

66 个通道全部由 `src/app/register-ipc.ts` 的一处循环注册（该文件 `ipcMain.handle` 只出现 1 次），意味着新增通道必须同时改 `contracts.ts`，否则 renderer 侧类型直接失败——这是契约与实现之间唯一的强制同步点。

## 3. 一轮对话的真实次序（`companion-service.ts`）

| # | 动作 | 位置 | 写入/读取 |
|---:|---|---|---|
| 1 | 取人格基线，合成 effectiveProfile | 1790–1791 | 读 `personality_profiles` |
| 2 | C1 读解 + 分析 + 决策（同源一次产出） | 1804 | 纯计算 |
| 3 | 指代解析（取回被引用消息） | 1808 | 读 `messages` |
| 4 | 构造检索查询 | 1812 | — |
| 5 | 读本轮**开始前**的内在状态 | 1822 | 读 `cognitive_feeling_state` |
| 6 | 检索策略（意图收窄 + 状态放宽） | 1827 | — |
| 7 | 记忆装配 | 1828 | 读 `memories` / `memory_revisions` |
| 8 | 记忆引用回写分析 | 1830 | 只写引用 id |
| 9 | 感受事件 + 状态预览 | 1832–1843 | 计算，落库在后续步骤 |
| 10 | 探索许可（permitted/selected） | 1861 | 读 `exploration_budget` |
| 11 | 拼 system prompt（含 `reading`） | 1866 起 | — |

失败语义：步骤 2–9 任一抛错 → `analysis/decision/reading/memory` 全部 `undefined`（1844–1849），随后走无认知的降级检索（1852–1858）。**降级会产生"没有读解"的空值，而不是伪造读解**——这点在真实运行中可观察（payload 缺字段）。

## 4. 血缘：谁生产、谁消费

这是本次审查最重要的一张表。**"有表"不等于"有消费者"**。

| 数据 | 生产者 | 消费者 | 是否进入实际回复 |
|---|---|---|---|
| `intent_readings` | 步骤 2 | `cognitivePromptGuidance(..., reading)`；payload | ✅ |
| `user_interaction_profile` | 每完成轮 `interaction.apply`（782–793） | `effectiveProfile` 的 `offsets()`（1001–1008） | ✅（仅 warmth/directness/humor） |
| `personality_growth_signals/_state/_events` | 每完成轮 `deriveGrowthSignals` → `growth.apply`（1073–1082） | **无**。`describeGrowth()` 全仓无调用点；`effectiveProfile` 不读 growth | ❌ |
| `memory_evidence` | `MemoryService.observeUtterance`（拒绝门后） | 重要度重算的 `n`（`R = 1 − e^(−n/3)`） | ✅（间接影响排序） |
| `knowledge_gap_evidence` | 事实守卫改写（`guard.verdict='rewrite'`） | 反思候选 `pickMorrowGapCandidate`（≥2 个独立会话） | ✅（但来源单一） |
| `interest_evidence` | 反思 → `observeMorrowEvidence`（669）/ `observeMorrow`（678） | 兴趣 fold 与探索资格 | ✅ |
| `cognitive_effect_ledger` / `cognitive_outbox` | 认知后处理 | `drain` / `requeueInterrupted` | 间接（副作用恰好一次） |
| `reflection_cursors` | 每批反思提交后推进 | `run()` 的 `seq > cursor` | ✅ |
| `cognitive_feeling_state` | 步骤 9 之后的落库 | 下一轮的步骤 5（策略放宽） | ✅ |
| `companion_goals` | 候选接受（单事务 + 幂等键） | `activeForContext()` → prompt 三行 | ✅ |

由此得到一条**必须写进结论**的判据：

> G1「人格有界漂移」有生产者、有审计、可回滚，但**没有任何消费者把它送进 Prompt**。`effective_d = baseline + growth_offset` 未实现。身份基线只由用户编辑改变这一条成立，但"人格会随对话成长"不成立。

## 5. 事务边界（逐处核对）

| 边界 | 位置 | 说明 |
|---|---|---|
| assistant 消息 + knowledge gap 证据 | `recordDeterministic` 于同一事务 | 失败即整条消息回滚，不再吞错 |
| effect 领取 | `effect-ledger.ts` 单事务条件 UPDATE + `changes=1` | 并发只允许一个 owner，60s 租约 |
| 目标候选接受 | `acceptCandidate` 单事务 + `goal_creation_keys` 幂等 | 连续两次只产生 1 行 |
| 探索预算 | `exploration-policy.ts` `BEGIN IMMEDIATE` | 预留即占名额，跨 UTC 日按 `turn_id` 查 |
| 读解 supersede | 同轮写入 + `supersedesMessageId` 链 | 旧读解标失效，不物理删除 |
| 删除传播 | `messages` 删除触发器 | 清 turn 相关证据、关闭未决项 |

## 6. 主体归属

- 记忆与感受的"证据"只存**消息引用**（`{kind:'memory_revision', id, revision}`），不复制原文；删除消息即断链。
- 兴趣归属 `origin ∈ {user, morrow, shared}`：`shared` 的定义是双方各有独立证据，任一侧不得吞掉另一侧。
- 探索资格只认 `morrow/shared`，用户兴趣不得被当作她的兴趣提出。

## 7. 未核实的部分（不得当作已审）

1. **renderer 逐屏交互**：只有冒烟级覆盖（启动、IPC 往返、重启持久化），没有逐屏断言。
2. **Windows 安装包升级/卸载/数据保留**：未执行。
3. **CI**：外部门槛，未启动（计费）。
4. **真实模型语义**：本轮无凭据，见 `stage-3-real-provider-evidence.md`。
5. 行号均对应 `5fe62f5`；若 HEAD 变化需重取。
