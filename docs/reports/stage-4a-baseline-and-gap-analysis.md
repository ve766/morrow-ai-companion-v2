# Stage 4-A 基线与断点分析

- 起始 SHA：`548d40e4846556a86b208e29876971f46824e211`（远端 Stage 3 分支 head，开工核验一致；工作树干净）
- 新分支：`feat/stage-4a-companion-continuity`
- 迁移版本：起始 v42 → 本阶段仍 v42（未新增表；只补了行为路径）
- 启动入口：`src/app/index.ts`（Electron main bootstrap → CompanionService 装配）

## 1. 真实调用链（核查结论）

```
renderer chat.send → preload → ipc.ts chatSend → CompanionService.sendChat
  → ChatService.send → prepare()（人格基线→effectiveProfile(G1)→认知分析→记忆装配→固定原则）
  → 同意载荷哈希 → provider.generate → fact guard → assistant 消息事务
      → outbox drain：interest / preference / growth / self_fact / goal / memory / reflection 投影器
  → settleExploration → evaluateTurn（memoryUse + evidenceGate）
```

记忆写入路径（本阶段前）：

- `memory` 投影器只调用 `observeUtterance`（重复提及计数），**不创建记忆**
- 记忆创建只发生在：① 设置页手动创建 IPC；② 记忆建议（model_inferred_confirmed）经用户接受
- `fact_records`（v40/v41）由记忆派生；`memory_revisions` 已带 provenance（v42 复核轮）

## 2. 猫名故事断点（逐步行号）

| 步骤 | 结果 | 断点 |
|---|---|---|
| A 用户说“我有一只猫，它叫咪咪。帮我记住。” | **断裂** | `cognitive-turn-analyzer.ts` 的 `explicitMemorySaveRequest` 不匹配“帮我记住”变体；`companion-service.ts` 的 memory 投影器即使匹配也只是记 personalization 信号，不创建记忆；`fact-slot.ts` 的单槽位提取器无法从“我有一只猫，它现在叫X”的复合句产出 `pet_name`（代词子句无标记） |
| B 新会话问“你还记得我的猫叫什么吗？” | 依赖 A → 无记忆可投递 | 同上；检索层本身对“我的猫叫什么”可命中（若记忆存在），见 closure F05 |
| C 纠正“我说错了，它现在叫豆豆。” | **断裂** | `correction` 信号不进入记忆写入路径；无 supersede 语义入口 |
| D 新会话问“我的猫叫什么” | 依赖 C → 仍为旧值 | 同上 |

定位证据（实现前脚本）：`buildStack` 直跑 A/B/C，`store after A: []`、`facts: {total:0}`、B 未投递、C 后无 superseded 行。

## 3. 其他核查项

- **Provider 切换**：人格基线在 `personality_profiles`，`effectiveProfile` 每轮从库折叠；provider 配置与身份无关（无共享状态）。切换验证见验收 #7。
- **重复实现/无消费者模块**：Stage 3 修复后 G1（`personality_growth_signals`）已有生产写入与消费；`fact_index_jobs` 的重试调度目前由生命周期写入与启动 `reindexAll` 驱动，没有独立定时器（可观测、可测；本阶段不扩为调度器）。
- **Stage 3 CI 失败**：`548d40e` 关联 run [41303086095](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41303086095) failure，job 日志：`src/memory/fact-index-faults.test.ts(23,7) TS4114: This member must have an 'override' modifier`（两个 job 同因失败）。**直接阻断本阶段基线**，已在 4-A 首个提交修复。旧的本机绿灯不当作远端 CI 通过。

## 4. 本阶段修正范围（只修阻断项）

1. 显式记忆请求（“帮我记住/ Please remember”）在记忆投影器内创建事实性记忆，携带真实 source message id
2. 与 active 单值记忆冲突的显式事实走“授权纠正”（supersede 链）
3. 代词纠正（“它现在叫X”）仅在**唯一** active pet 事实存在时解析；歧义则跳过
4. 复合句 pet 名抽取（“我有一只猫，它叫咪咪”）
5. `lookupActive` 的 past 语义（历史查询可读 superseded）与 `valid_to` 条件修正
6. 测试类 `override` 修复（CI 阻断）

未扩张：不重写检索、不改人格算法、不加 UI、不引入调度器、不做 Agent/语音。
