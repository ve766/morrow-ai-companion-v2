# Morrow V2 — Phase 2.4 审查整改与真实行为验证

分支：`feat/cognitive-loop-v1-phase2-4-continuity`
整改起点：`813be5a`（Phase 2.4 首轮交付）
代码提交：`713bea3`
报告提交：见 §9（在其后）

本报告只覆盖本轮整改与验收，不重复首轮交付内容（见 `cognitive-loop-v1-phase2-4.md`）。

---

## 1. P0：反思待办的隐私边界

### 1.1 问题确认

`pendingItemFromReflection()` 把 `input.statement` 截断后直接写入 `summary`：

```ts
summary: input.statement.slice(0, 500)   // 修复前
```

而反思发现本身可能带用户内容：

| 发现类型 | 是否携带用户内容 | 来源 |
|---|---|---|
| `memory_gap` / `bias_hint` | 否（只有计数） | 事件计数 |
| `consistency_note` | **是**：引用自我模型条目原文（≤120 字） | `entry.statement` |
| `interest_candidate` | **是**：引用记忆派生的主题词 | `deriveInterestLabel(memory.currentText)` |

因此"反思 → 待办"这条路径确实会把用户原话落到 `cognitive_pending_items.summary`，而待办又会经 `continuity.listPendingItems` 返回给渲染层。

### 1.2 修复

1. **签名层面断掉原文**：`pendingItemFromReflection` 不再接受 `statement`，只接受 `statementDigest`（16 位 hex，格式校验）。调用方 `absorbReflection` 在边界处哈希后即丢弃文本——不是"记得去掉"，而是**根本传不进去**。
2. **summary 改为类别模板**（`reflectionSummaryFor(kind)`），与具体内容无关；未知类型回落为通用句。
3. **detail 收敛**为 `{ runId, statementDigest, summaryPolicy: 'category_template_v1' }`。
4. **上游也修**：`consistency_note` 改为引用条目 id，`interest_candidate` 改为引用记忆 id，不再引用原文或话题词。
5. **哈希的定性**：代码注释与本文都明确写——摘要用于去重与追溯，**不是匿名化、不是加密**；短且可猜的句子可以被穷举确认。

### 1.3 历史数据处理（迁移 v18）

升级时对 `source = 'reflection'` 的既有行执行 **UPDATE**：

- `summary` 换成同类别模板；
- `detail_json` 收敛为 `runId + statementDigest + summaryPolicy`（非法 JSON 时只写 policy）；
- **保留** 行 id、`dedupe_key`、`priority`、`status`、`created_at`、`updated_at`、`completed_at`。

只改内容，不删行。数据库升级路径本身在迁移前会做 `VACUUM INTO` 校验备份，原文仍可从该备份恢复，因此这次改写是**可恢复**的；测试断言改写后行数不变、身份与工作流状态不变。

非 `reflection` 来源（冲突、证据缺口）**不动**——它们的 summary 本来就是模板。

### 1.4 负向测试（虚构敏感信息）

`pending-items.test.ts` 构造了一条含"青霉素 / 过敏 / 京A12345"的虚构反思陈述，断言：

- `listOpen()` 返回对象的整体序列化不含这些词；
- 数据库整行（所有列拼起来）不含这些词；
- 仍保留 `kind`、16 位 digest 与 `summaryPolicy`；
- 已知类别模板不含用户内容，未知类别回落通用句。

`self-model.test.ts` 增加：反思发现序列化后不含被引用的条目原文（`用户可能偏好简洁回答`）、记忆原文（`jasmin tea`、`花生`）。

日志侧复查：`statement` 不出现在任何 `console.*` 调用中（`grep` 为 0）；IPC 返回值只来自待办行，已被上述断言覆盖。

---

## 2. P1：轮次上下文写入的可靠性

### 2.1 修复前的事务边界

```
provider 返回 → 事实门控 → appendMessage(助手消息, afterPersist 内只写情绪状态)
             → （事务外）写待办 → （事务外）写轮次上下文
```

助手消息与轮次记录不同步：进程若在两者之间退出，该轮**有回答、无记录**，且没有任何东西能补。

### 2.2 现在的做法：持久化"收尾意图"

新增表 `cognitive_turn_finalizations`（v18），在**消息提交之前**写入：

```
turn_id, conversation_id, user_message_id, assistant_message_id,
payload_json = { contextTemplate, pendingDrafts, feelingEventId }, created_at
```

随后 `appendMessage(..., { messageId, afterPersist })`，在**消息事务内**完成：情绪状态 → 待办写入 → 上下文写入 → 删除意图。

三条设计取舍：

1. **派生数据写失败不吞掉回答**：`afterPersist` 内部逐项 try/catch，失败只置 `complete = false`，意图保留；用户仍然拿到回答。
2. **恢复只写能确定的内容**：意图里存的就是当轮真实计算出的模板与草稿，不是重新推测。
3. **`feeling.applied` 反推**：用持久化状态里的 `sourceEventId` 是否等于 `feelingEventId` 判定，不靠布尔占位。

### 2.3 恢复规则

`recoverInterruptedTurns()`（启动时调用，也可重复调用）：

| 持久化证据 | 结果 |
|---|---|
| 助手消息存在 | 按意图补齐待办与上下文，`status = succeeded` |
| 助手消息不存在 | 写 `status = failed`、`errorKind = INTERRUPTED`，不产出待办 |
| 会话已删除 / 存储不可用 | 保留意图，计 `dropped`，留待下次 |

按 `turn_id` 落键（不是模板里的 turnId），否则一条坏模板会覆盖另一轮的记录——这条有专门的测试。

幂等性来自三处：待办按 dedupe key 去重、上下文按 turn_id 覆盖且不降级、意图删除后不再处理。

### 2.4 故障注入证据

测试用一个可编程的 `TurnContextPort`，在 `upsert` 时抛错，模拟"消息已写、上下文写入失败"：

1. 发送一轮产生冲突的回答；
2. 断言：**回答已交付**（1 条 assistant）、上下文为 `null`、意图行存在、待办已生成；
3. 调 `recoverInterruptedTurns()` → `{ completed: 1, interrupted: 0, dropped: 0 }`；
4. 断言：上下文 `status = succeeded`、`assistantMessageId` 等于真实消息 id、`pendingItemIds` 长度为 1、意图已删除、**待办 id 列表与恢复前完全一致**（无重复）；
5. 再次恢复 → 全 0，待办数量不变。

另两条：未提交消息的轮次被记为 `INTERRUPTED` 且无待办；坏模板不会覆盖既有轮次记录。

### 2.5 未降低既有保护

记忆撤回、敏感度上限、事实门控、用户授权的代码路径未改动。Phase 2.3 五个保护套件 66 条全过（见 §6）。

---

## 3. P1：真实模型多轮验证

**未执行。** 本机五个凭据变量全部 absent：

```
MORROW_SPARK_API_KEY=absent  SPARK_API_KEY=absent  IFlyTek_API_KEY=absent
DEEPSEEK_API_KEY=absent      MORROW_DEEPSEEK_API_KEY=absent
```

应用凭据存放在 Electron SafeStorage 中，无头脚本无法读取；按任务书要求没有复制密钥、没有新建密钥配置、没有产生云端调用。

因此以下场景**全部只有替身证据，没有真实模型证据**：偏好跨轮使用、纠错撤回、无证据拒绝、模型切换连续性、状态影响、失败与取消。首轮报告 §7 已作同样标注，本轮结论不变。

需要一个可复现的多轮云端实验（记录模型 ID、代码 SHA、场景、次数、判定依据）才能关闭此项。

---

## 4. P1：桌面冒烟与回归

### 4.1 同环境基线与当前对照

| 项目 | 值 |
|---|---|
| 操作系统 | Windows `10.0.26200` |
| Node | `v22.22.2` (win32 x64) |
| Electron | `44.9.3` |
| 构建 | 两次均 `npm run build` 退出码 0 |

| 构建 | 冒烟退出码 | 关键错误 |
|---|---|---|
| 基线 `872367c` | **1** | `The built renderer did not expose its typed preload bridge` / `window load failed {code: renderer-load-failed}` / `GPU process exited unexpectedly: exit_code=-1073741819` |
| 当前 `713bea3` | **1** | 同上，逐条一致 |

结论：**冒烟失败与本阶段改动无关**，是这台机器的 Electron 渲染进程/GPU 环境问题（GPU 进程反复崩溃导致窗口加载失败，preload 桥因此从未被暴露）。

可复现命令与日志：

```bash
npm run build
npm run smoke        # 退出码 1
# 日志落点：/tmp/smoke-current.log 与 /tmp/smoke-baseline.log（本次会话）
```

### 4.2 明确限制

- 冒烟在本机**不可通过**，且原因在环境而非代码；仓库中 `out/preload/index.js` 构建产物正常，包含全部桥接方法。
- 未尝试修改 GPU/渲染参数去"让冒烟变绿"——那会掩盖环境问题，也会偏离验证真实桌面路径的目的。
- CI 未运行（本会话无 CI 触发），因此也没有 Linux/xvfb 下的对照结论。

### 4.3 回归与静态检查

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无输出 |
| `npx vitest run --maxWorkers=2` | 0 | **569 passed / 63 files**（首轮 561，本轮 +8） |
| `npm run build` | 0 | 成功 |
| `npm run evaluate` | 0 | `passed:true` |
| `npm run evaluate:cognition` | 0 | 四套件 gate 全过，`providerCalls = 0` |
| `npm run verify:phase23` | 0 | `ok:true`（humanCorrect 98/100，reviewCoverage 1） |
| Phase 2.3 五套件 | 0 | **66 passed**（门控 29 / 冲突 12 / 重试 12 / 可靠性 3 / 报告校验 10） |
| `npm run smoke` | 1 | 见 §4.1，基线与当前一致 |

### 4.4 新增 IPC 的边界复查

| 检查项 | 结果 |
|---|---|
| 来源校验 | 非可信主框架 → `FORBIDDEN`，且动作未被调用（有测试） |
| 请求校验 | `itemId` / `turnId` 必须 UUID；未知字段 → `INVALID_INPUT`（有测试） |
| 未装配 | 未注入 `continuity` 时不注册这三个通道（有测试） |
| 权限边界 | 唯一写操作是把内部待办标记完成；不能发消息、不能改记忆、不能改人格 |

---

## 5. 文件范围

| 文件 | 变更 |
|---|---|
| `src/cognition/pending-items.ts` | 去掉 statement 入口，类别模板，两段式派生/持久化 |
| `src/cognition/pending-items.test.ts` | 隐私负向测试、模板与摘要校验 |
| `src/self-model/reflection-service.ts` | 发现改为引用 id，不引用原文 |
| `src/self-model/self-model.test.ts` | 断言发现不含被引用文本 |
| `src/persistence/migrations.ts` | v18：历史待办改写 + 收尾意图表 |
| `src/persistence/migrations.test.ts` | 改写不丢行、不动非反思项 |
| `src/persistence/cognitive-context-repository.ts` | `SqliteTurnFinalizationRepository` + 载荷校验 |
| `src/app/companion-service.ts` | 收尾意图、事务内收尾、恢复、按 turnId 落键 |
| `src/app/index.ts` | 装配 finalizations，启动时恢复并记事件 |
| `src/app/cognitive-continuity-phase24.integration.test.ts` | 新增 H 组 3 条故障注入 |

---

## 6. 完成标准对照

| 标准 | 证据 |
|---|---|
| 反思待办不再无审查地复制原始陈述 | 签名不含 statement；模板 summary；负向测试断言数据库整行无敏感词 |
| 崩溃恢复有实现和故障注入证据 | §2.2–2.4；3 条测试，含"交付成功 + 记录缺失 + 恢复补全不重复" |
| 真实模型多轮实验有证据，或如实标记 | §3 明确标记未执行及原因 |
| 所有执行过的命令、退出码、失败项与修复被记录 | §4.3；冒烟失败与基线对照在 §4.1 |
| 独立分支提交、文件范围、SHA、剩余风险、PR 建议 | §5、§9 |
| 不合并、不发布、不改 main | `origin/main` 仍为 `8b207b7` |

---

## 7. 剩余风险

1. **摘要哈希不等于匿名化**。对短句可被穷举确认；它只用于去重与追溯。
2. **历史 `reflection_findings` 未改写**。它们是用户自己的审计记录、只通过本机 UI 展示给用户本人，本轮只修了生成侧；若要求历史行也去文本化，需要单独方案（会损失审计价值）。
3. **意图表可能滞留**。若会话被删除且恢复始终失败，意图行会保留（`dropped`），需要人工或后续清理策略；当前选择"保留证据"而非静默删除。
4. **收尾仍在消息事务内同步执行**，派生数据量大时会拉长事务；当前规模（≤5 条待办 + 1 条上下文）可接受，未做异步化。
5. **冒烟在本机不可用**，桌面路径的真实渲染未被验证（见 §4.2）。
6. **真实模型行为仍未验证**（见 §3）。

---

## 8. 后续建议

1. 在具备凭据的环境跑多轮云端实验，关闭 §3；
2. 在能正常启动 Electron 的环境（或 Linux + xvfb CI）跑 `npm run smoke`，补上桌面路径证据；
3. 给 `cognitive_turn_finalizations` 加一个"滞留超时告警"，而不是无限保留；
4. 若要处理历史 findings 文本，先评估审计价值，再决定是否提供"导出后清除"的用户操作。

---

## 9. 提交

- 代码与测试：`713bea3`
- 本报告：随后提交（见 `git log`）
- 分支：`feat/cognitive-loop-v1-phase2-4-continuity`
- 建议：以 Draft PR 合入 `feat/cognitive-loop-v1-phase2`；**不合并、不发布、不改 `main`**。
