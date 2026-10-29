# Stage 2 · 全仓审计与阶段一阻塞复核

审计时间：2026-10-29 14:20 (+08:00)
审计分支：`feat/stage-2-continuous-companion-cognition`（HEAD `d858cd9`）
审计方式：读取真实源码、迁移、测试与运行结果；不采信 README、旧报告或分支名。

---

## 1. 仓库基线与分支谱系

| 分支 | HEAD | 与 `main` 关系 | 说明 |
|---|---|---|---|
| `main` | `8b207b7` | — | 唯一已发布基线，本次未改动 |
| `feat/stage-2-continuous-companion-cognition` | `d858cd9` | 领先 60 / 落后 0 | **本次开发分支**，从认知线切出 |
| `feat/cognitive-loop-v1-phase2-4-continuity` | `d858cd9` | 同上 | 认知线当前顶端（Phase 2.4 收尾） |
| `feat/phase-2.2-memory-reliability` | `25e8000` | 领先 105 / 落后 0 | 记忆可靠性线，**与认知线已分叉** |

关键事实（`git merge-base` 实测）：

- 两条开发线与 `main` 的共同祖先都只有 `8b207b7`；
- `25e8000` 与 `d858cd9` 的共同祖先同样是 `8b207b7`，即**两条线各走各的**：记忆线有 105 个提交不在认知线里，认知线有 60 个不在记忆线里。

因此 §1.1.5 的警告是实打实成立的：不能按分支名判断"哪条更完整"，也不能整批合并。本次开发以认知线为准（Stage 2 的连续性、轮次上下文、finalization 都在这一侧），记忆线的独有提交未纳入。

规模：`main..d858cd9` 涉及 131 个文件；`src/` 非测试文件 84 个；测试文件 63 个；迁移 20 条（`CURRENT_SCHEMA_VERSION` 由最后一条推导）。

---

## 2. 真实执行链（用户发送 → 下一轮可读）

按实际代码逐段核对，行号取自 `d858cd9`。

| # | 环节 | 真实位置 | 事实 |
|---|---|---|---|
| 1 | UI 输入 | `src/renderer/*` → `src/preload/index.ts` | 经 contextBridge 暴露窄接口 |
| 2 | IPC 校验 | `src/app/ipc.ts`、`src/app/register-ipc.ts` | 白名单 + trusted-sender + UUID/字段校验 |
| 3 | 聊天入口 | `ChatService.send` `companion-service.ts:892` | 会话锁 `locks`、`CONFLICT` 幂等、长度/NUL 校验 |
| 4 | 已存在轮次短路 | `:901-928` | 同 requestId 已有 assistant → 直接返回已存结果，**不重复调用模型** |
| 5 | 准备阶段 | `prepare` `:1191` | 读历史、认知分析、记忆检索、人格/状态/兴趣块装配 |
| 6 | 同意门禁 | `consentPreview` + `authorize` `:938-940` | 用户拒绝即 `FORBIDDEN` |
| 7 | 载荷一致性 | `:948-949` | 重算 `prepare` 并比对 `hashProviderInput`，不一致 → `CONFLICT`（防止同意后上下文漂移） |
| 8 | 用户消息落库 | `:952-977` | 认知观测随消息一并写入，失败则降级为纯消息 |
| 9 | Provider 调用 | `dispatchToProvider` `:980` | 带 AbortSignal、流式回调 |
| 10 | 失败/取消分支 | `:981-1003` | 分别记 `failed` / `cancelled`，写终态上下文，**不写助手消息** |
| 11 | 回答持久化 + 收尾 | `prepareFinalization` `:1405` → `applyFinalization` `:1465` | 先写收尾意图，再在消息事务内提交派生数据 |
| 12 | 轮次评估 | `evaluateTurn` `:1146` | 生成 `TurnEvaluation` 并写入 append-only 事件日志 |
| 13 | 长期层 | `SelfModelLoopHooks.onTurnCompleted` `:695-717` | 兴趣 `observe` + `archiveStale`；显式自我事实写 self-model |
| 14 | 崩溃恢复 | `recoverInterruptedTurns` `:1491` | 按持久化意图补写，按 `turn_id` 落键 |
| 15 | 下一轮读取 | `buildContext` `:1326`、`turn-context.ts` | 记忆 id、人格版本、状态修订号进入下一轮 |

结论：**主聊天链是真实闭环**，且第 7 步的载荷哈希校验是本仓库最强的同意边界实现——它不是"展示了预览"，而是"发送前重算并比对"。

---

## 3. 模块清单（按任务书 §2.3 分类）

### 3.1 已实现且有源码证据

| 模块 | 证据 |
|---|---|
| 会话与消息幂等 | `conversation-service.ts`、`send` 的 `CONFLICT` 分支 |
| 意图判断（12 标签） | `cognition/intent-decision.ts`，规则打分，置信度 0–100 且自标 `unvalidated_rule_strength` |
| 轮次分析 | `cognition/cognitive-turn-analyzer.ts`：signals、uncertainty、topicSource、strategy(clarify/retrieve/answer) |
| 记忆生命周期 | `memory/memory-service.ts`、`fact-slot.ts`、`retrieval-policy.ts`：版本链、撤回、冲突披露 |
| 记忆上下文装配 | `memory/memory-context-assembler.ts`（预算截断） |
| 人格版本化 | `PersonalityService`（`companion-service.ts:516-604`），版本 + 回滚 |
| 内在状态 | `affective-state/`：事件驱动、幂等键、半衰期衰减、跨会话持久化 |
| 兴趣与自我模型 | `self-model/`：`interest-service.ts`、`self-model-service.ts` |
| 有界反思（服务层） | `self-model/reflection-service.ts`，含限流与候选上限 |
| 轮次上下文持久化 | `cognition/turn-context.ts` + `SqliteTurnContextRepository` |
| 崩溃恢复 | `cognitive_turn_finalizations` + `recoverInterruptedTurns` |
| 安全边界 | `security/`：DPAPI/safeStorage、回环门禁、日志脱敏、IPC 白名单 |
| 迁移体系 | `persistence/migrations.ts`，20 条，名称+版本双重校验，失败回滚 |

### 3.2 已接入但缺真实行为证据

| 项 | 缺什么 |
|---|---|
| 兴趣晋升 → 影响后续检索 | `interests.observe` 在轮次结束时确实被调用（`:697`），但"晋升后的兴趣进入下一轮真实请求"只有离线评测，无真实模型证据 |
| 内在状态 → 影响回复策略 | 状态确实写入并进入上下文块；S5 场景从未对真实模型跑过 |
| 记忆跨会话召回 | 有集成测试与离线评估，无真实模型端到端证据 |
| 自我模型演化 | 写入路径存在，纠正/失效链无真实运行证据 |

### 3.3 已实现但未接入主调用链

| 项 | 证据 |
|---|---|
| **反思（ReflectionService）** | `grep -c -i reflection src/app/companion-service.ts` = **0**。服务已实现、IPC 可查（`ipc.ts:120-121`），但**聊天轮次结束后不会触发任何反思**。§6.4 / §9 要求的"轮次完成后按事件触发反思"目前不成立 |
| 兴趣的手动控制 | `listInterests` / `setInterestStatus` 仅在 IPC 层暴露，聊天路径不消费用户的状态变更 |

### 3.4 尚未实现

| 项 | 说明 |
|---|---|
| 渐进式个性化状态 | 无 `personalization_state`、无 `p←clip(p+ηwe)` 更新算法 |
| 加权意图置信度 | 只有单一规则强度，无 `w_r R + w_s S + w_m M`，无模型语义层（`source` 恒为规则） |
| 上下文块优先级 `U(c)` | 装配器按相关度+新近度+预算截断，无该公式与逐块取舍记录 |
| 轮次状态机 | 现有 `CognitiveTurnStatus` 只有 `succeeded/failed/cancelled`，缺 `received→analyzed→context_ready→awaiting_consent→requesting→response_received→committed` 与细分失败态 |
| 话语行为（speechActs） | 只有布尔 signals，无独立言语行为集合 |
| 参数登记表 / 消融实验 | 无 |

### 3.5 发现缺陷

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| D1 | **自我模型写入原始用户文本**：显式自我事实时 `statement: input.content.slice(0, 2000)` | `companion-service.ts:704-713` | 与 §3.1「不得复制原始敏感消息」冲突；自我模型表成为第二份原文副本，删除消息后无法随消息边界清理 |
| D2 | 轮次上下文 schema 精确匹配 1 | `turn-context.ts:21`、`isCognitiveTurnContext` | 任何字段扩展都会让**历史轮次记录整体失效**（被判定为不存在），必须先升 v2 并保留 v1 读兼容 |
| D3 | 认知附属失败被静默吞掉 | `:714-716`、`:970-972`、`:923-925` | 降级本身符合"不阻塞聊天"，但**只 `console.warn`，不写事件日志**，事后无法统计降级发生率 |
| D4 | 两条开发线已分叉 105/60 | 见 §1 | 后续若合并会引入大范围冲突；Stage 2 必须明确只基于认知线 |

### 3.6 被环境阻塞

见 §4。

---

## 4. 阶段一阻塞复核（2026-10-29 14:20 实测）

不是沿用旧报告，而是重新执行：

| 项 | 实测 | 结论 |
|---|---|---|
| `MORROW_SPARK_API_KEY` / `SPARK_API_KEY` / `DEEPSEEK_API_KEY` / `MORROW_DEEPSEEK_API_KEY` / `MORROW_SPARK_MODEL_2` | 全部 absent | 无凭据 |
| `curl https://maas-api.cn-huabei-1.xf-yun.com/v1/models` | **401** | 端点可达，仅缺凭据 → 阻塞项是凭据不是网络 |
| 最小 Electron 应用（6 行，加载 `data:text/html`），默认开关 | `GONE:crashed:-2147483645` + `ERR_FAILED (-2)` | 渲染进程在提交任何页面前崩溃 |
| 同一应用加 `no-sandbox` | `LOAD_OK`，正文 `hi` | 崩溃源自本机渲染沙箱无法初始化 |

补充（本会话 13:16–13:30 于同一提交实测）：Morrow 自身 `npm run smoke` 失败；加 `--no-sandbox` 后改为**主进程** `0xC0000005`（3221225477）。即沙箱开→渲染崩、沙箱关→主进程崩，两条路都不通。

结论：**阶段一的两项阻塞原样成立**，且已被最小复现证明为环境问题而非产品代码缺陷。Stage 2 不得据此宣称阶段一已通过。

---

## 5. 对 Stage 2 的直接影响

1. §14.3 真实模型、§14.4 桌面端**必然 BLOCKED**，除非补凭据并在可用环境运行。
2. 可先行完成且不受阻塞影响的部分：轮次契约 v2（含 v1 读兼容）、加权意图置信度、渐进式个性化、`U(c)` 排序、状态机补全、D1/D3 修复、评测集与消融。
3. D2 是**所有契约扩展的前置条件**：不先处理 schemaVersion，后面每加一个字段都会让历史记录失效。

---

## 6. 下一步（本分支内执行，不逐项等待确认）

1. 修 D1：自我模型只存 digest/引用，不存原文；迁移清理历史行。
2. 修 D3：降级写入事件日志，可统计。
3. 轮次上下文 v2 + v1 读兼容（解 D2）。
4. §4.3 加权置信度 + speechActs。
5. §6.2 渐进式个性化（迁移 + 有界更新 + 接线）。
6. §10 `U(c)` 上下文排序。
7. 评测集 A–L + 消融；报告按 §14.6 格式，结论保持 BLOCKED/PARTIAL。

---

*本文件是开发记录，不替代后续编码与实测。*
