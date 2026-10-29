# Morrow V2 — Phase 2.4：连续认知闭环与主体状态贯通

交付日期：2026-10-28
开发分支：`feat/cognitive-loop-v1-phase2-4-continuity`
起始 SHA：`872367ccfddb1cd4ea17cd5107acd473523e6b58`（= PR #13 HEAD，与远端一致，工作区干净）
最终 SHA：`185b0a6`（主体 `6121f5e` + 收口 `185b0a6`；本报告为随后的文档提交）

本阶段没有重写任何既有认知模块，而是在真实产品入口 `ChatService.send` 上把已经存在的部件连成一条可审计、可恢复、可跨轮验证的闭环，并补上两个此前确实缺失的部件：**持久化的轮次上下文**与**最小内部待处理事项**。

> **后续整改**：审查后发现的 P0（反思待办复制原文）与 P1（轮次收尾崩溃窗口）已在 `cognitive-loop-v1-phase2-4-remediation.md` 中修复并验收，本文 §8.4 / §8.5 的结论以该报告为准。

---

## 1. 实际修改文件

| 文件 | 类型 | 作用 |
|---|---|---|
| `src/cognition/turn-context.ts` | 新增 | 轮次上下文的类型、有界构建器、读路径校验、状态快照 |
| `src/cognition/pending-items.ts` | 新增 | 待处理事项的派生规则、去重键、存储端口、有界后台执行 |
| `src/cognition/retrieval-attention.ts` | 新增 | 内在状态 → 检索广度的有界调整（纯函数） |
| `src/persistence/cognitive-context-repository.ts` | 新增 | 两张新表的幂等 SQLite 实现 |
| `src/persistence/migrations.ts` | 修改 | 新增 v17 迁移 |
| `src/app/companion-service.ts` | 修改 | 装配阶段接入状态调整；三条终态路径写入轮次上下文；导出读取接口 |
| `src/app/index.ts` | 修改 | 生产装配新存储；反思改为有界执行并写入待处理事项；注册 continuity 动作 |
| `src/shared/contracts.ts` | 修改 | 新增 3 个 IPC 通道、请求类型与桥接接口 |
| `src/shared/validation.ts` | 修改 | 两个请求形状的严格校验 |
| `src/preload/index.ts` | 修改 | 暴露只读 continuity 桥接 |
| `src/app/ipc.ts` | 修改 | `ContinuityActions` 与 3 个处理器 |
| `src/app/ipc.test.ts` | 修改 | 新增 6 条（校验、路由、不可信来源、未装配时不注册） |
| `src/cognition/turn-context.test.ts` | 新增 | 10 条 |
| `src/cognition/pending-items.test.ts` | 新增 | 16 条 |
| `src/cognition/retrieval-attention.test.ts` | 新增 | 6 条 |
| `src/app/cognitive-continuity-phase24.integration.test.ts` | 新增 | 11 条（A–G 场景） |

共 16 个文件，新增 8 个。`main` 未动，PR #13 未合并。

---

## 2. 原先缺失的真实链路

调查结论（按任务书第四节逐项核对）：

| 环节 | 调查前状态 |
|---|---|
| 意图识别 → 检索策略 | **已工作**。`analyzeCognitiveTurnDetailed` → `policyForIntent` → `assembleContext` |
| 记忆检索 / 撤回 / 冲突 / 敏感度上限 | **已工作**。撤回与超限在装配器内部过滤 |
| 人格版本化 | **已工作**（`personality_profiles` + `personality_revisions`），且每轮读 `profile.version` 进提示词 |
| 情绪/注意力状态 | **数据与更新规则已工作**，但**只影响提示词措辞**，没有任何下游决策被它改变 |
| 轮次审计 | 只有 `TurnEvaluation`（意图/检索/载荷/provider/答案评分），**不含人格快照、状态前后值、本轮更新内容**，且**未落库**（仅事件日志） |
| 内部待处理事项 | **不存在**。`reflection_findings` 是一次性产物：无跨轮去重、无状态、无完成标记 |
| 跨轮端到端证据 | 部分存在，但都是**预置记忆**后提问，**没有走过"模型提议 → 用户接受 → 下一轮检索"的真实保存路径** |

因此本阶段补的是三处真实缺口，而不是重做已有能力：

1. **一条可落库、可回查的轮次上下文**，能回答"这次回答读了哪些记忆、用了哪版人格、处于什么状态、为什么产出、本轮改了什么"；
2. **状态必须真的改变下一轮的行为**，而不只是存进数据库；
3. **最小内部活动**：有去重键、有状态、能恢复、能完成的待办。

---

## 3. 每项能力的代码位置与调用路径

### 3.1 统一轮次上下文

- 类型与校验：`src/cognition/turn-context.ts`（`CognitiveTurnContext`、`buildCognitiveTurnContext`、`isCognitiveTurnContext`）
- 写入：`ChatService.recordContinuity`（`src/app/companion-service.ts`），由 `send()` 在**成功 / 失败 / 取消**三条终态路径分别调用
- 落库：`SqliteTurnContextRepository.upsert`（`src/persistence/cognitive-context-repository.ts`）
- 读取：`CompanionService.readTurnContext({ turnId })`

调用路径：`sendChat` → `ChatService.send` → `prepare()`（产生意图、检索调整、人格、状态）→ provider → 事实门控 → 落消息 → `recordContinuity()` → 上下文表。

记录内容（全部为 ID、类别、判定，**不含记忆正文与回答正文**）：意图、检索策略与生效上限、被投递记忆的 `id/status/sourceCategory/sensitivity/revision/updatedAt/score`、冲突组（仅谓词 + id）、人格版本快照、状态前后值、门控判定、provider 与失败分类、尝试次数、本轮待办 id。

### 3.2 状态参与认知

- 纯函数：`src/cognition/retrieval-attention.ts` 的 `adjustPolicyForState(policy, state)`
- 接入点：`ChatService.prepare()` —— **先读本轮开始时的状态**，再决定检索上限，最后才组装记忆。

这条顺序是刻意的：用"本轮事件应用之后"的状态去决定本轮证据，会让一轮对话用自己的事件给自己挑证据。

规则是**单向放宽**：`explorationPriority ≥ 0.08` 时上限 +2（绝对不超过 25）；绝不收紧、绝不改变谓词过滤、绝不改变敏感度上限；`maxMemories === 0` 的意图（如 `feedback`）**永远保持 0**。调整原因写入上下文的 `retrieval.adjustment`。

### 3.3 内部待处理事项

- 派生：`derivePendingItems`（冲突组、被门控拦下的事实类型）
- 存储：`SqlitePendingItemRepository`（`dedupe_key` 唯一索引）
- 服务：`PendingCognitionService`（`observeTurn` / `absorbReflection` / `listOpen` / `complete`）
- 有界执行：`runBounded(operation, { signal, budgetMs })`（开始前检查预算、执行中响应取消、失败返回而不抛）
- 反思桥接：`src/app/index.ts` 的 `runReflection` 在反思结束后把 findings 写入待办

去重键是**关切本身**而不是轮次（`conflict:<predicate>:<sorted ids>`、`evidence_gap:<kind>`、`reflection:<kind>:<digest>`），因此同一冲突在十轮里被看到仍是**一条**；已完成的事项**不会被重新激活**。

### 3.4 记忆影响回答

未新建模块，复用既有链路，本阶段补的是**证据**：场景 A 走真实保存路径（模型提议 → 用户接受 → `sourceCategory = model_inferred_confirmed`），并断言第二轮请求里出现该记忆 id，同时断言轮次上下文记录了它。

### 3.5 人格连续性

未新建机制，补的是**跨模型切换的证据**：切到 `spark` 后 `provider.id` 变化，而 `personality.version`、记忆、状态修订号、对话历史均连续；并断言多轮对话不会新增人格版本（只有显式保存才改人格）。

---

## 4. 数据结构、迁移与事务策略

### 4.1 迁移 v17（`cognitive-turn-context-and-pending-items`）

```sql
cognitive_turn_contexts(turn_id PK, conversation_id, status, recorded_at, payload_json)
cognitive_pending_items(id PK, dedupe_key UNIQUE, source, kind, summary, priority,
                        status, conversation_id, detail_json, created_at, updated_at, completed_at)
```

两张表均为 `STRICT`，沿用仓库既有约束风格（长度、`instr(..., char(0)) = 0`、枚举 CHECK）。`payload_json` 限长 20000 字符，防止单轮写入无界数据。

### 4.2 幂等与覆盖规则

| 场景 | 规则 |
|---|---|
| 同一轮重试 | `turn_id` 是主键，`upsert` 覆盖；但**已 `succeeded` 的记录不会被降级**（`WHERE status <> 'succeeded'`） |
| 同一关切重复出现 | `dedupe_key` 唯一；已 `done` 的事项**不重建、不降优先级、不复活** |
| 同一轮重复派生待办 | `observeTurn` 按 dedupe key 幂等，重复调用不产生第二行 |
| 重复完成 | `complete` 幂等，已完成再完成返回 `true` |

### 4.3 事务边界与顺序

- 消息落库、状态应用仍沿用既有 `afterPersist` 事务语义（未改动）。
- 轮次上下文与待办在**助手消息落库之后**写入，助手消息是这一轮的提交点。
- 因此存在一个很窄的崩溃窗口：若进程在"助手消息已写、上下文未写"之间退出，该轮**没有**上下文记录。这里选择**不重建**——敏感度上限与当轮载荷已不可观测，补一条猜出来的记录比留空更糟。下一轮读到的是持久化后的真实状态，不受影响。

---

## 5. 跨轮次测试

文件：`src/app/cognitive-continuity-phase24.integration.test.ts`（11 条，全部走 `CompanionService.sendChat`）。Provider 为**可控替身**，用于可重复性；它**不能**证明真实云模型的措辞或判断。

| 场景 | 断言要点 | 结果 |
|---|---|---|
| A 记忆连续性 | 真实保存路径存偏好；第二轮不问原句也能命中；上下文记录该记忆 id 与 `status=active`；上下文序列化后**不含**"咪咪" | 通过 |
| A' 单次陈述不自动成为事实 | 未审核前 `memories.list()` 为空 | 通过 |
| B 纠错与撤回 | 纠错不改库；撤回后请求与上下文都不再出现该记忆 | 通过 |
| C 人格与模型切换 | `provider.id` 由 deepseek 变 spark；人格版本、记忆、状态修订号、`systemRules` 连续；多轮不新增人格版本 | 通过 |
| D 状态跨轮影响 | 基线：探索意图 5 条；四轮明确探索后 `explorationPriority ≥ 0.08`；再问时 `adjustment = exploration_widened`、`effectiveMax = 7`、实际投递 **6 条** | 通过 |
| D' 状态不能放宽"本就不该回忆"的轮次 | `feedback` 意图 `baseMax = 0`、`effectiveMax = 0`、投递 0 条 | 通过 |
| E 失败与重试 | 失败轮不产出助手消息、不产状态事件，上下文 `failed + PROVIDER_NETWORK`；同 `turnId` 重试后只剩 1 条 user + 1 条 assistant，上下文升级为 `succeeded` | 通过 |
| E' 取消 | 取消后不交付，上下文 `cancelled`，下一轮仍可正常完成 | 通过 |
| F 重启恢复 | 关闭进程、同文件重开：人格版本、状态修订号、待办、对话历史全部恢复；下一轮仍命中记忆；待办数量不变（不重复） | 通过 |
| G 未知事实 | 模型编造车牌 → 门控重写、交付文本不含取值；待办记录 `evidence_gap:vehicle_plate`，**不含取值** | 通过 |
| G' 冲突隔离 | 只披露与问题相关的 `residence` 冲突组，另一主题的冲突值不进入该轮 | 通过 |

失败项：无（首次运行有 5 条失败，均为本阶段新增代码或测试自身的问题，已修复后重跑，见 §8.4）。

其他相关套件：`src/cognition/turn-context.test.ts` 10 条、`pending-items.test.ts` 16 条、`retrieval-attention.test.ts` 6 条、`src/app/ipc.test.ts` 新增 6 条（校验/路由/不可信来源/未装配时不注册通道）。

---

## 6. 真实执行记录

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx vitest run --maxWorkers=2` | 0 | **561 passed / 63 files**（本阶段前为 512 / 59） |
| `npm run evaluate` | 0 | `passed:true`，检索 precision/recall 1.0，各类泄漏 0 |
| `npm run evaluate:cognition` | 0 | 四套件 gate 全过；`offlineExecution.providerCalls = 0` |
| `npm run build` | 0 | 构建成功 |
| `npm run smoke` | **1（失败）** | 本机 Electron 渲染进程起不来：`renderer-load-failed` + GPU 进程反复 `exit_code=-1073741819`。**已做基线对照**：在同一台机器上切到 `872367c` 重新构建后，冒烟以**完全相同**的信息失败（`The built renderer did not expose its typed preload bridge`），因此这是本机渲染/GPU 环境问题，不是本阶段引入的回归。`out/preload/index.js` 构建产物本身正常且包含新增桥接方法 |

---

## 7. 真实模型验证

**未执行。** 本环境没有可用凭据：`MORROW_SPARK_API_KEY` / `SPARK_API_KEY` / `IFlyTek_API_KEY` / `DEEPSEEK_API_KEY` 均为 absent，凭据存放在 SafeStorage 中，无头脚本无法读取；按任务书要求未复制、未新建密钥配置。

因此本阶段所有多轮证据均来自**可控替身**，只能证明链路与不变量成立，**不能**证明真实模型在记忆使用、未知事实、纠错、人格连续性与状态影响上的行为质量。需要一个可复现的多轮云端实验（含模型 ID、代码 SHA、场景、运行次数、失败次数、结果摘要），本轮不做。

---

## 8. 已知缺陷与未完成能力

1. **真实模型未验证**（见 §7）。这是本阶段最大的证据缺口。
2. **崩溃窗口**：助手消息与轮次上下文之间不是同一事务；极端情况下该轮无上下文（选择留空而不猜）。
3. **状态影响只有一条通道**：目前只通过"检索广度"这一确定性决策体现。状态对措辞的影响是既有的，未新增其他下游行为（例如不改变记忆写入、不改变人格）。
4. **待处理事项有只读接口，但没有界面**：`continuity` 三个通道（列出待办、标记完成、读取某轮上下文）已接进 IPC 与预加载，校验、来源校验与"未装配时不注册"都有测试；但没有做待办面板。界面缺失是刻意的范围控制，不是链路缺口。
5. **反思仍是人工触发**：没有做"每轮结束后自动反思"。本轮把反思包进了 `runBounded`（预算 2000ms，超预算返回 `budget_exhausted`，失败返回 `STORAGE_ERROR`，不再伪造"已完成"）。需要说明的是：本地反思是同步实现，**预算只在开始前生效，执行中无法打断**——这一点写在代码注释里，不靠信号假装可取消。
6. **待办来源只启用了三种**（conflict / evidence_gap / reflection）。表结构保留了 `open_question`、`interest`，代码未产出，属预留而非已实现能力。
7. **阈值 0.08 是设计选择不是标定值**：按规则引擎的真实权重（单次探索约 +0.04），0.3 永远不会触发，故取"约两次明确探索"。该值未经真实用户校准。
8. **首轮失败的 5 条测试**暴露了两个真实问题并已修复：取消被记成失败（`send` 的 catch 未区分 `PROVIDER_CANCELLED`）；测试里保存的记忆默认敏感度为 sensitive 导致被上限拦下（后者是测试构造问题，非产品缺陷）。

---

## 9. 对照完成标准

| 标准 | 证据 |
|---|---|
| 1. 真实入口上的完整数据流 | 全部断言走 `CompanionService.sendChat`；无平行演示服务 |
| 2. 记忆跨轮检索、纠错、撤回并影响回答 | 场景 A / B，读实际 payload 与上下文 |
| 3. 人格与状态持久化、恢复、模型切换后连续 | 场景 C（切换）+ F（重启） |
| 4. 状态确实影响后续认知而非仅存储 | 场景 D：同一问题在状态变化前后投递条数 5 → 6，且 `adjustment` 被记录；D' 证明不会放宽不该回忆的轮次 |
| 5. 待办可创建、持久化、恢复、完成 | 场景 F + `pending-items.test.ts`（去重、不复活、重复完成幂等）；IPC 层可列出与完成，且有校验与来源拦截测试 |
| 6. 失败/重试/取消不重复写入或错误交付 | 场景 E / E'：1 user + 1 assistant；上下文状态正确 |
| 7. 端到端测试有实际运行结果 | §5、§6（555 passed） |
| 8. 类型检查、完整测试、构建、认知评估已执行 | §6，tsc / vitest / evaluate / evaluate:cognition / build 全部退出码 0；`smoke` 已尝试并失败，附基线对照证明与本阶段改动无关 |
| 9. 有条件则真实模型验证，无条件则明确标记 | §7 明确标记未执行及原因 |
| 10. 独立分支、可追踪提交、完整报告 | 分支已建；提交见 §10；本报告 |

---

## 10. 提交与后续建议

- 提交 SHA：`6121f5e`（主体实现与 A–G 测试）、`185b0a6`（IPC 与有界反思收口）；本报告随后提交在其之上
- 分支：`feat/cognitive-loop-v1-phase2-4-continuity`（基于 PR #13 HEAD `872367c`）
- 建议：以 **Draft PR** 形式向 `feat/cognitive-loop-v1-phase2` 提出，标题 `feat(cognition): Phase 2.4 continuity — turn context, state-driven retrieval, pending items`。
- 不合并、不发布、不动 `main`。

### 建议的下一步

1. 用授权环境跑一组小规模多轮云端实验（≥3 模型 × 记忆/未知/纠错/人格/状态 五类），产出可审查摘要；
2. 为待办事项补只读 IPC 与一个最小面板，让"内部活动"对用户可见、可完成；
3. 把反思从人工触发扩展为"轮次结束后的有界后台任务"，复用 `runBounded` 的预算与取消；
4. 若要让状态有第二条下游通道，优先考虑"检索优先级排序"而非再改上限，并用对照实验证明收益。

---

## 11. 收口补充（本轮追加）

首次交付后复审，发现两处"写了但没真正接入"的问题，与我在 §8.7 里批评的阈值死代码属于同一类，因此本轮补上：

### 11.1 待办与轮次上下文接入 IPC

- 新增通道：`morrow:continuity:pending:list`、`morrow:continuity:pending:complete`、`morrow:continuity:turn:read`
- 严格校验：`{ itemId }` / `{ turnId }` 必须是 UUID，未知字段一律拒绝（`INVALID_INPUT`）
- 来源校验：非可信主框架返回 `FORBIDDEN`，且**不会**触达动作
- 未装配 `continuity` 时**不注册**这些通道，避免暴露空实现
- 能力边界：唯一的写操作是把内部待办标记为完成；不能发消息、不能改记忆、不能改人格

### 11.2 让 `runBounded` 真正进入生产路径

此前 `runBounded` 只被单元测试使用——这正是"看起来有预算和取消、实际上没有调用方"的情形。现在 `runReflection` 通过它执行：

| 情况 | 返回 |
|---|---|
| 正常完成 | `ReflectionRunSummary`（并把 findings 写入待办） |
| 预算已耗尽 | `{ skipped: 'budget_exhausted' }`，**不再冒充已完成** |
| 执行抛错 | `ApplicationError('STORAGE_ERROR')`，由 IPC 层转成错误结果 |
| 已取消 | 取消结果不落成"已完成" |

局限已在代码注释与 §8.5 写明：本地反思是同步实现，预算只在开始前生效。

### 11.3 本轮验证

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx vitest run --maxWorkers=2` | 0 | **561 passed / 63 files**（较 §6 增加 6 条 IPC 测试） |
| `npm run build` | 0 | 构建成功（含 preload 与契约改动） |
| `npm run smoke` | 1 | 本机渲染进程起不来；基线 `872367c` 同样失败，非本阶段回归（见 §6） |

### 11.4 Phase 2.3 保护复核（第九节要求）

单独跑既有保护套件，确认本阶段没有破坏它们：

| 套件 | 条数 | 结果 |
|---|---|---|
| `answer-fact-guard.test.ts` | 29 | 通过 |
| `conflict-handling.integration.test.ts` | 12 | 通过 |
| `provider-retry.test.ts` | 12 | 通过 |
| `turn-reliability.integration.test.ts` | 3 | 通过 |
| `phase23-report-check.test.ts` | 10 | 通过 |
| 合计 | **66** | 5 文件全部通过 |

本阶段对既有实现的唯一修改是 `send()` 里对取消的分类（`failed` → `cancelled`），以及检索策略多了一层"只放宽上限"的状态调整；门控、冲突关联、重试与总预算、轮次幂等、报告校验均未改动，上述套件为证。
