# Stage 3 最终运行时地图

- 生成时间：2026-11-01T02:50Z
- 工作树：`E:\Hasee\Documents\morrow-stage3`（**无 `.git`**，故本文不绑定任何 commit）
- 口径：本文只描述**代码里实际跑通的路径**；凡是靠读代码推断、未在运行中观察到的，标 `[推断]`。
- 相关：`docs/reports/stage-3-final-verification.md`（验证结果）、`docs/reports/stage-3-c1-behavior-matrix.md`（C1 行为）、`docs/algorithms/stage-3-algorithm-registry.md`（算法登记）

---

## 一、进程与信任边界

三个 JS 上下文，一条单向信任链：

```
renderer (src/renderer/)  ──contextBridge──▶  preload (src/preload/index.ts)
        │                                              │
        │ 只能看见 window.morrow.*（白名单 API）        │ ipcRenderer.invoke(通道名)
        ▼                                              ▼
   main (src/app/)  ◀── ipcMain.handle(66 个通道) ──────┘
        │
        ├── security/url-gate        本地 Provider 端点须由 URL 文本自证回环
        ├── persistence/             node:sqlite，单文件库，38 个迁移
        └── provider 客户端          出站 HTTPS（云端）或本机回环（本地）
```

- 通道常量集中在 `src/shared/contracts.ts`，共 **66** 个 `morrow:*`；`src/app/register-ipc.ts` 只有一处注册循环，不逐个 `ipcMain.handle`（`grep -c "ipcMain.handle"` 在该文件返回 1）。这意味着**新增通道必须同时改 `contracts.ts`**，否则 renderer 侧 TS 直接报错。
- renderer 不持有任何凭据：`provider:get` 只返回非敏感字段，密钥只在 main 进程用 `safeStorage` 解出、只活在一次请求内。
- `preload` 只有 1 个文件 / 161 行，是唯一暴露面；没有 `nodeIntegration`、没有 remote。

## 二、代码规模（不含 `*.test.ts`）

| 目录 | 文件 | 行 | 职责 |
|---|---:|---:|---|
| `app/` | 7 | 3,751 | 主链编排、IPC、窗口、装配 |
| `cognition/` | 16 | 4,746 | 认知分析、C1 意图读解、决策、prompt 指导 |
| `persistence/` | 12 | 5,047 | 迁移、仓储、事务、备份 |
| `evaluation/` | 14 | 3,473 | 离线评估器与数据集加载 |
| `self-model/` | 9 | 3,205 | 兴趣、反思、探索、自我模型、知识缺口 |
| `motivation/` | 12 | 2,717 | 陪伴目标、期限解析、工具审批 |
| `memory/` | 8 | 1,998 | 记忆装配、重要度、证据策略 |
| `renderer/` | 6 | 1,857 | 界面（含 `.css` 之外的 TS/TSX） |
| `personalization/` | 3 | 869 | 人格、有界漂移、交互偏好 |
| `affective-state/` | 3 | 856 | 内在状态（计算变量） |
| `providers/` | 3 | 542 | 云端 / 本地 Provider 客户端 |
| `security/` | 6 | 259 | URL 网关、凭据封装 |
| `shared/` | 4 | 1,036 | 契约、通道、类型 |
| `conversation/` | 1 | 101 | 会话元数据 |
| `observability/` | 1 | 71 | 事件日志（只追加） |
| `preload/` | 1 | 161 | 桥 |

合计 105 个源文件 / 约 32.7k 行（含测试则 134 文件）。

## 三、一轮对话的真实调用链

入口 `morrow:chat:send` → `CompanionService.sendChat` → `prepare()`（`src/app/companion-service.ts:1776` 起）→ 出站 → 落库 → 返回 payload。

`prepare()` 内的顺序（行号为当前工作树）：

1. **取人格基线**：`this.personality.get()`（1790），再用 `selfModel.effectiveProfile(baseline)`（1791）合成"本轮实际使用的人格"。
   ⚠ 合成只加**交互偏移**（`interaction.offsets()`，1001–1008），不加人格生长台账的 offset —— 见 §五"两处漂移"。
2. **C1 读解 + 分析 + 决策一次产出**：`analyzeCognitiveTurnDetailed(content, cognitiveHistory, sourceMessageId)`（1804）返回 `{ analysis, reading, decision }`，三者同源同版本，避免"分析说 A、决策按 B"。
3. **指代解析**：`firstPass.topicReferenceMessageId`（1808）→ 在 `cognitiveHistory` 里取回被引用的那条消息，供检索与读解共用。
4. **检索查询构造**：`buildRetrievalQuery`（1812）拼入被引用正文、上一条用户消息，`widen` 仅在 `strategy='retrieve_memory'` 时为真。
5. **读内在状态（本轮开始时的状态）**：`feelings.snapshot(evaluationAt)`（1822）。注释明确：必须在本轮事件应用**之前**读，否则一轮自己的事件会给自己当证据。
6. **检索策略**：`adjustPolicyForState(policyForIntent(decision.intent), previousFeelingState)`（1827）—— 意图收窄，状态只能小幅放宽，**都不能放宽权限/状态/敏感度**。
7. **记忆装配**：`memories.assembleContext(...)`（1828）。
8. **把记忆引用写回分析**：`withCognitiveContextEvidence(firstPass, memoryReferences, profile.version)`（1830）—— 证据只存 `{kind:'memory_revision', id, revision}`，不复制正文。
9. **内在状态事件与预览**：`createCognitiveFeelingEvent` / `feelings.preview`（1832–1843）。
10. **探索许可**：`selfModel.explorationLine(...)`（1861），每轮一次决策，随后由回复结算。
11. **拼 system prompt**（1866 起）：人格基线行 → 用户附加风格 → `cognitivePromptGuidance(analysis, decision, hasMemory, conflicts, variant, reading)` → 感受指导 → 自我模型上下文块 → 探索行 → 记忆（标注为"不可信证据"）→ 固定原则。

失败语义：第 2–9 步任一抛错，`catch` 把 `analysis/decision/reading/memory` 全部置 `undefined`（1844–1849），随后走"无认知核心"的降级检索（1852–1858）。**降级不是静默**：`reading` 一起消失，payload 里就没有读解，属于可观察的空值而不是编造的读解。

## 四、C1（语境理解）在链上的位置

```
content + history
   │
   ├─ speech-act.ts        说话行为（question / request / quotation / hypothesis / retraction / correction / preference_expression …）
   ├─ intent-reading.ts    统一读解：slots、topic 绑定、responseMode、confidence、版本
   └─ intent-decision.ts   路由与授权（mayExecute、execute_pending、stop_previous）
        │
        ▼
   reading ──▶ cognitivePromptGuidance(..., reading)   ← 唯一进入 prompt 的通道
        │
        ├─▶ 持久化（intent_readings，含 supersedesMessageId）
        └─▶ payload（renderer 可见，用于显示"她理解成了什么"）
```

三个常量版本：`ALGORITHM_VERSION` / `PARAMETER_VERSION` 在 `src/cognition/intent-reading.ts`，评测侧对应 `c1-params-v1`。读解的 `scoreKind` 恒为 `heuristic_score`，**任何地方都不得当成概率**。

## 五、两处"漂移"，必须分开说

这是本轮复核发现的**最容易读错的一处**，登记表原文也在此处自相矛盾（已修，见 §七）。

| | 人格生长 G1 | 交互偏好 G2 |
|---|---|---|
| 源码 | `personalization/personality-growth.ts` | `personalization/interaction-profile.ts` |
| 迁移 | 29 `bounded-personality-growth` | 见 `user_interaction_profile`（迁移内建表） |
| 表 | `personality_growth_signals` / `_state` / `_events` | `user_interaction_profile` / `_signals` |
| 生产者 | ✅ 每完成轮 `deriveGrowthSignals` → `growth.apply`（1073–1082） | ✅ 每完成轮 `interaction.apply`（782–793） |
| 进 prompt | ❌ `describeGrowth()` 全仓无生产调用点 | ✅ `effectiveProfile` 只加它的 `offsets()` |
| 上限 | ±8，门槛 3 条，半衰期 45 天 | ±8，门槛 3 条，半衰期 45 天 |

结论（可直接引用）：

> 身份基线只由用户编辑改变。本轮 prompt 里那三个呈现数值（warmth/directness/humor）来自**交互偏好**的偏移，不是人格生长台账。人格生长有证据、有审计事件、可 `rollback`，**但当前没有任何读取方把它送进 prompt**。

实证：唯一一次真实模型长跑（`evals/real-provider/results/20261031T083700Z-ee728fd.json`，32 轮 / 3 会话）里 `interactionOffsets = {warmth:0, directness:0, humor:0}`，且断言"风格请求达到证据门槛并产生交互偏移"失败（`directness_signals=2`，门槛 3）。**也就是说：这条路径在真实会话中从未被观察到真正移动过。** 机制有测试覆盖，端到端效果无证据。

## 六、数据流与删除传播

- 消息 → `messages`；读解 → `intent_readings`（引用 `source_message_id`，不复制正文）；感受证据 → 只存消息引用。
- 删除一条消息时：触发器清除该轮的生长/交互/预算证据；`supersedesMessageId` 链上的旧读解标为失效；未决项关闭。冒烟测试与 `restart` 套件覆盖了"删除后不再被引用"。
- 事件日志 `event_journal` 只追加；观察性写入走 `tryRecord`，失败返回 `null`，**不阻塞聊天闭环**。

## 七、本轮对登记表的修正（与本文同步）

`docs/algorithms/stage-3-algorithm-registry.md` 原有三处互相矛盾，已在本轮修正：

1. G1 公式写 `effective_d = clamp(baseline_d + offset_d, 0, 100)`，但代码里 `effectiveProfile` 加的是交互偏移 → 改为分列两条，并注明 G1 的 `effective_d` **未实现**。
2. "身份自身的演化（G1 原意）当前无生产者" → G1 **有生产者**，缺的是消费者。
3. "上文的 G1 已被下列版本取代" → G1 未被取消，只是从未接进 prompt；被取代的是参数与措辞。

## 八、已知未覆盖

- 无 `.git`：本文所有行号对应当前磁盘状态，不对应任何可复现 commit。
- `[推断]` 未标注的路径均已在本机跑通；但 renderer 侧只有冒烟级覆盖（启动、IPC 往返、重启持久化），**没有逐屏交互测试**。
- 探索"是否真的提起"仍是词面 + 形态双检（`exploration-policy.ts`），改写式提出会漏判为 `not_raised`。
