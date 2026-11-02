# PR #30 最终定点复审与修复（Issue #31）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`fix/stage-5-final-closeout`（在 PR #30 上继续提交）
- 复审基线：PR #30 文档 HEAD `5b5b29c902db770fc4b448a0831f86e220b5addc`，代码提交 `80851cf1e4bf67332496c76955ecb390cc79140d`
- 本轮代码 SHA：`0b9071e40dea5822ac770c3f66a4ce14e39d3b99`
- 结论：F1、F3、F6 已完成代码修复与运行证据；F5 的真人自然度保持 PENDING_HUMAN，第二 Provider 保持 NOT_RUN。

## 1. 发现总表

| ID | 严重度 | 领域 | 修复前 | 根因位置 | 状态 |
|---|---|---|---|---|---|
| F1 | P1 隐私/可靠性 | 关系来源校验 fail-open | 空消息表时跳过来源校验；查询异常被 catch 后继续用调用方文本投影；不校验 conversationId | `relationship-threads.ts` 旧 `observe()` | FIXED |
| F3 | P1 语义 | distress 语境与证据独立性 | 整句任意位置命中即可；引用/转述/否定/假设未区分；程度词/标点被当作独立 C | `expression-policy.ts` `assessDistressEvidence()` | FIXED |
| F6 | P1 并发 | 跨进程未验证 | 只有同进程 Promise 测试；claim/lease/删除/重放竞态未用真实进程验证 | `cognitive-outbox.ts` + `effect-ledger.ts` | FIXED（新增 4 个真实 OS 进程测试） |
| F5 | 外部 | 真人自然度/第二 Provider | PENDING / NOT_RUN | 环境/凭据 | 保持 PENDING / NOT_RUN |

## 2. F1 — 来源校验 fail-open

### 2.1 修复前代码实质

```ts
const anyMessage = db.prepare('SELECT 1 FROM messages LIMIT 1').get()
if (anyMessage && !db.prepare('SELECT 1 FROM messages WHERE id = ?').get(input.messageId)) {
  return { mutation: null, threadIds: [] }
}
// catch: "unit-test fixture" → 继续使用 input.text
```

两个生产风险：

1. 消息表为空时，旧的 pending obligation 仍可把调用方缓存的旧文本投影进关系系统。
2. 查询异常、表不可读、连接故障时，校验被跳过，继续处理未经来源验证的文本。

另外不校验 `conversationId`，跨会话的 message id 也能写入。

### 2.2 修复

- `observe()` 不再接受 `text`；签名改为 `{ messageId, conversationId, at }`。
- 在 `database.transaction()` 内读取 `messages` 的 body 与 conversation_id：
  - 不存在 → `skipped: 'source_missing'`，零写入；
  - 会话不匹配 → `skipped: 'source_conversation_mismatch'`，零写入；
  - 查询失败 → 抛 `RelationshipSourceError`（code `RELATIONSHIP_SOURCE_UNVERIFIABLE`），
    outbox 保留 pending 重试，零写入；
  - 合法 → 用数据库 body 规划 mutation，并在同一事务写入证据/线程/事件。
- 删除与投影并发：`BEGIN IMMEDIATE` 让来源读取与写入处于同一写事务；另一连接的删除
  不能在这两步之间插入。
- 投影器只传 id，不再传 `readUserMessage()` 的副本。
- 单元测试改为真实创建 conversation/message（`seed()`），不使用生产 bypass。

### 2.3 回归场景与结果

| 场景 | 结果 |
|---|---|
| 消息表为空 + 传入旧 obligation | 不投影；outbox done；无线程/证据 |
| 原消息已删除 + 另一连接持有旧 obligation | 不投影；线程保持 tombstone；证据 0 |
| 消息存在但 conversationId 不匹配 | `source_conversation_mismatch`，零写入 |
| SELECT 抛错/数据库异常 | 抛 `RelationshipSourceError`，零写入 |
| 合法来源 | 正常投影 |
| 删除与投影并发（真实进程） | 删除后不复活；证据 0 |
| 启动 reconcile / outbox replay / backup restore | 走同一 `observe()` 来源约束（源码核对 + 现有恢复测试） |

## 3. F3 — 语境作用域与 E/C 独立性

### 3.1 修复前

- 正则对整句任意位置匹配；引用、转述、否定、假设都可能被算作用户当前 E。
- `cueClasses` 把 `explicit` 与 `INTENSITY_CUE && explicit` 分别计数，同一短语/程度词
  被当成两个独立佐证。
- 例如“你刚才说我现在很烦”“我不是说我现在很烦”“如果我很烦……”都可能触发安慰。

### 3.2 修复

流水线：

```
规范化 → 按句读/逗号分句 → 逐句判定引用/否定/假设/转述 → 显式 E →
独立 C（仅中性分句的躯体/行为线索）→ 前序 T → D → 策略
```

- 否定作用域限定在**同一分句、情绪词之前的否定词**；后续分句不受影响。
- 引用（引号）、转述（你/他/朋友/听说…说）、假设（如果/要是/假如…）都不计入 E。
- 宽松情绪词只用于判定边界语境，不单独提高 E。
- C 只来自中性分句中的独立躯体/行为线索；程度词、重复、标点属于 E，不再二次计权。
- T 仍来自有界 feeling state，不把当前句重复计入。
- 无法可靠判定时返回 no-distress / boundary reason，不用关键词黑名单压制正例。

### 3.3 成对对照

见 `src/affective-state/distress-evidence.test.ts`：

| 语境 | 输入 | E | 结果 | rationale |
|---|---|---|---|---|
| 肯定 | 我现在很烦 | 1 | distress | explicit_emotion_statement |
| 否定 | 我不是说我现在很烦 | 0 | no | negated_emotion |
| 否定 | 我不难过，你不用安慰我 | 0 | no | negated_emotion |
| 引用 | 你说“我现在很烦” | 0 | no | quoted_emotion |
| 转述 | 你刚才说我现在很烦 | 0 | no | reported_emotion |
| 转述 | 我朋友说我最近很焦虑 | 0 | no | reported_emotion |
| 假设 | 如果我很烦，我就先暂停一下 | 0 | no | hypothetical_emotion |
| 混合 | 我不是真的难过，只是有点累 | 0 | no | negated_emotion |
| 轻度 | 我有点累 | 0.6 | no | mild_without_independent_context |
| 轻度+独立佐证 | 我有点累，睡不着，也没力气（T=1） | 0.6 | distress | contextual_corroboration |
| 直接请求 | 我现在很烦，别安慰我，直接给修复方法 | — | answer_directly | explicit_direct_request |

## 4. F6 — 跨进程不变量

### 4.1 机制审查

- `CognitionOutbox.drain`：按 `(turn_id, module, handler_version)` 取 pending；
  每个模块通过 `CognitiveEffectLedger.begin()` claim。
- `begin()` 在一个 `database.transaction()` 内插入/更新 ledger 行，条件为
  `state IN ('pending','failed_retryable')` 或 `state='running' AND lease_until < now`；
  只有 changed=1 的 worker 获得 claim，其余返回 `busy` 或 `applied`。
- 成功后 `ledger.complete()` → outbox `done`；失败 `ledger.fail()` → `failed_retryable`
  或 `terminal_failed`，outbox 回 pending 或 failed。
- 删除消息：`cognitive_outbox_cancel_with_message` 把 pending 行置 cancelled；
  v46 触发器删除证据并 tombstone。
- `observe()` 在写事务内读来源，删除与投影不会交错。

### 4.2 真实进程测试

`src/app/stage5-final-audit-repair.multiprocess.test.ts` 用 esbuild 打包
`evals/stage-5/final-audit-repair/worker.ts`，`spawn` 为独立 Node 进程，每个进程
打开自己的 SQLite 连接：

| 用例 | 结构 | 不变量 |
|---|---|---|
| 两进程争抢 | A claim 后停在文件屏障；B 在租约有效期内尝试 | 只有一个 owner；`done=1`、`busy≥1`；证据 1、ledger applied 1 |
| claim 后崩溃 | A 在 projector 内 exit 9；B 在 T+61s 接管 | 租约过期可接管；恰好投影一次 |
| 删除与投影并发 | A claim 后停在屏障；测试用另一连接删除消息；放行 A | A 读到来源缺失 → 不投影；证据 0；无 active 线程 |
| 旧任务 vs 新纠正 | 旧消息的 pending obligation 在新纠正之后由 worker 重放 | 新值 active；旧值 superseded |
| 重复 drain | 同一 obligation 再跑 worker | pending=0；证据仍 1 |

屏障使用 `ready-*` / `go` 文件与 `Atomics.wait`，不是随机 sleep；20s timeout 仅作挂死保护。

## 5. 未解决/外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN（盲评包 v2，含 3 个语境样本） |
| 第二 Provider | NOT_RUN（无凭据） |
| 本机 Electron smoke | 按环境结果单独记录；CI 另列 |
| 多进程多机 | 单机多进程已验证；跨机器不适用（本地 SQLite） |
| 规则计划器覆盖 | 模式外句式落到无操作/澄清，方向保守 |
