# Morrow V2 · 第二阶段审计修复独立验收报告

> 本报告是**独立复验**，不是修复方自述的复述。所有结论只来自三处：`git` 对象里的代码、本次实际执行的命令输出、GitHub Actions 按 SHA 对齐的运行结果。
> 上一份修复报告（`project-work-report-2026-10-26-phase-2-audit-fix.md`）**未被当作证据来源**；本报告对它的每一处关键主张都回到代码与运行结果重新核对，核对结果见 §2.3。
> 未执行、无法执行、或只有代码可查而无运行证据的项目，在 §8 单独列明，**不与通过项混写**。

---

## 0. 验收结论

**部分通过。**

- 三个关键门禁**确实存在且具备失败能力**（§3、§4 有突变证据），旧的自证式判据已被移除。
- 记忆状态、敏感度、连续性、凭据、路径、评测分级等边界**已由代码确认**，其中大部分**已由自动化测试确认**。
- **没有**任何一项得到「真实模型行为」层面的确认：`quality.assessed: false`，真实运行只证明请求送达且结构正确，不证明模型理解了上下文。
- 本次复验**发现 1 个真实缺陷**：历史裁剪在生产侧与校验侧各有一份实现，注释声称「不会漂移」但实际只共享了常量。已修复并加了能失败的对照测试（§7）。这是本次唯一代码改动。
- 另记录 8 项残余风险（§8），其中 3 项属于**能力边界**而非缺陷，不应被当作待修 bug。

不给出「通过」的理由见 §10：`0.5B` 本地模型不足以产生任何质量结论，而本阶段的任务书要求区分「收到上下文」与「理解上下文」。

---

## 1. 审计基线（要求 1：准确的 head SHA）

| 项 | 值 | 证据来源 |
|---|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` | `gh pr view 3` |
| PR | **#3**，`state: OPEN`，`mergedAt: null`，`mergeable: MERGEABLE` | 同上 |
| base 分支 | `chore/phase-1-engineering-consistency` | 同上 |
| **base SHA** | `12f83e19172d02648ff5007ba14fa9ad9d640525` | `gh pr view 3 --json baseRefOid` |
| head 分支 | `feat/phase-2-companion-core` | 同上 |
| **审计起点 head SHA** | `e944799c3f422fddbe093a1d1947f0db142ce29e` | `gh pr view 3 --json headRefOid` |
| 该 SHA 的提交数 | 19（相对 base） | `gh pr view 3 --json commits` |
| 审计起点 CI | [run 40337895001](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40337895001) — `success`，3/3 Job | §6.5 |

本次复验的代码基线就是 `e944799`。§7 的最小修复叠在它上面，形成一个新提交；该提交的 SHA 与 CI 见 §6.5 第二行。

### 1.1 修复是否真的在当前代码里（要求 2）

不是读报告，而是把 `f579897`（修复前）与 `e944799`（修复后）的同一文件取出来逐行对照：

| 缺陷 | 修复前（`git show f579897:…`） | 修复后（当前工作树） |
|---|---|---|
| 跨会话隔离用字节数 | `:289` `passed: Boolean(crossTurn?.containsMemory) && !(crossTurn?.requestBytes === turnThree?.requestBytes)` | 已删除；改为 `checkCrossSessionIsolation`（`request-assertions.ts:189`） |
| 历史完整性依赖常量 | `:250-251` `containsPreviousUserTurn: true,` / `containsPreviousAssistantTurn: true,` | 字段已不存在；`real-provider-conversation.ts` 中再无 `containsPrevious*` |
| 失败回复自证 | `:193-194` 写 `responseChars: 0`，`:317-321` 断言 `responseChars === 0` | 字段已删除；改为 `checkFailurePersistence`（`request-assertions.ts:258`）读数据库行 |

核对命令与输出见 §11.2。结论：**三处修复真实存在于 `e944799` 的代码中**，且旧代码的缺陷形态与审计描述一致（`requestBytes` 判据位于 `:289`，两个硬编码 `true` 位于 `:250-251`）。

---

## 2. 证据分级约定（要求 3、6）

每个结论都标注下列四种之一，**不混用**：

| 标记 | 含义 | 判据 |
|---|---|---|
| **[代码]** | 已由代码确认 | 读源码/`git show` 可见，且能指出文件:行 |
| **[测试]** | 已由自动化测试确认 | 本次实际执行、exit 0，且该用例能失败（§4 有突变证据） |
| **[真模型]** | 已由真实模型实验确认 | 真实 socket 往返，且断言对象是**模型输出**，不是请求内容 |
| **[未验]** | 尚未验证 | 没有运行证据，或运行了但断言不覆盖该结论 |

### 2.3 对上一份修复报告的独立核对

逐条重查其关键数字，结果如下（不是照抄）：

| 上一份报告的主张 | 复核结果 |
|---|---|
| `request-assertions.test.ts` 22 用例 | **成立**（`grep -c "  it("` = 22） |
| `report-path.test.ts` 5 用例 | **成立** |
| 集成测试 14 → 29 | **成立**（29 个 `it`） |
| `companion-core-evaluation.test.ts` 4 → 17 | **成立** |
| 离线评估 31/31、10 维度、`stubDispatches: 59`、`networkCalls: 0` | **成立**，但字段是嵌套的：`offlineExecution.stubDispatches`、`offlineExecution.networkCalls`（顶层没有这两个键） |
| `replayStable: true` | **成立**，但字段嵌套在 `determinism.replayStable` |
| 真实报告 9/9 检查、5 个失败场景（3 真实 + 2 未执行） | **成立**（§6.4） |
| 修前 CI `f579897` 为 success | **成立**（run 40324745303） |

> 两次「字段好像不存在」都是我自己取错层级，不是报告造假。上一份报告的数字经得起复核；唯一不精确的是**没有写出字段的嵌套路径**，导致复核者容易误判。本报告补齐了路径。

---

## 3. 三个关键门禁：实现、测试、独立验证（要求 2、3）

### 3.A 跨会话隔离

| 项 | 内容 |
|---|---|
| 门禁实现 | `src/evaluation/request-assertions.ts:189` `checkCrossSessionIsolation` |
| 调用点 | `src/evaluation/real-provider-conversation.ts:331`（turn-4，会话 B） |
| 哨兵来源 | 用户消息正文内嵌 `SENTINEL-A7F3` / `SENTINEL-B8E1`（`real-provider-conversation.ts:56`） |
| 期望来源 | 会话 A 的**用户消息来自脚本常量**，**助手回复来自数据库重读**（`:283` 按 `turnId` 取回），不是脚本变量 |
| 测试位置 | `request-assertions.test.ts:146-231`（6 用例，5 负向）；`companion-core.integration.test.ts:665`（端到端泄漏） |

断言内容（逐条对照源码）：非 system 消息必须**恰好 1 条**且等于当前提问（`:225-231`）；任何消息不得含 A 的用户原话、A 的助手回复、两个哨兵（`:200-216`）；system 提示词不得含哨兵（`:221-223`）；system 必须含记忆片段（`:232-234`）。

**[代码] [测试]** 门禁按消息对象比对，不按整包子串，不按字节数。旧判据已被 `rejects the byte-length heuristic the previous version relied on` 明确钉死（同时断言旧判据会通过、新判据不通过）。

关于哨兵设计的有效性（我主动质疑过这一点）：如果 A 的消息被逐字复制进 system 提示词，**哨兵会跟着一起过去**，因为哨兵就嵌在消息正文里。所以「只在 system 里查哨兵」这一条足以覆盖「system 里混入旧会话 transcript」的故障形态。
**边界**：如果复制方对内容做了语义改写或删掉了括号里的编号，哨兵会失效——但那种情况已经属于「记忆抽取」，不是「会话泄漏」，两种判据不应混用。此边界列入 §8 第 6 条。

### 3.B 多轮历史完整性

| 项 | 内容 |
|---|---|
| 门禁实现 | `src/evaluation/request-assertions.ts:120` `checkHistoryCompleteness` |
| 裁剪实现 | `src/evaluation/request-assertions.ts:91` `selectRetainedHistory` → 委托 `companion-service.ts:94` `retainedHistoryTail`（**本次修复后**） |
| 生产裁剪 | `companion-service.ts:939` `const recent = retainedHistoryTail(history, (message) => message.body.length)` |
| 期望来源 | 发送**前**从 SQLite 读该会话消息（`real-provider-conversation.ts:254`），再套生产裁剪 |
| 测试位置 | `request-assertions.test.ts:50-120`（6 负向）；`history-bound.test.ts`（8 用例，本次新增）；离线 `ctx-02`（20 轮） |

断言内容：首条必须是 system、末条必须是当前用户消息（`:133-140`）；条数必须精确等于 `1 + 保留 + 1`（`:142-145`）；历史逐位比较 `role` 与 `content`（`:147-163`）；被判定可裁剪的消息不得出现（`:165-168`）。

裁剪规则是可验证的：`maxMessages=12`、`maxCharacters=6000`，**从最新往回取，遇到第一条放不下的即停止**（是后缀，不是任意子集）。3 轮实测共 4 条历史，不触发裁剪；裁剪边界由离线 `ctx-02` 的 20 轮用例覆盖。

**[代码] [测试]** 期望值取自数据库而非脚本轮次表，这一点很关键：某轮若没写进库，会被判成「缺失」而不是「按策略裁掉」。我在阅读时专门确认了 `before` 是 `sendChat` **之前**的读取，因此不含当前轮，与 `prepare()` 里 `history` 的定义（`:755` 过滤掉当前 `turnId`）一致。

### 3.C 失败后的持久化一致性

| 项 | 内容 |
|---|---|
| 门禁实现 | `src/evaluation/request-assertions.ts:258` `checkFailurePersistence` |
| 调用点 | `src/evaluation/real-provider-conversation.ts:636`（`failureRecord`） |
| 记录来源 | `companion.readConversation(...).messages` —— **重新读 SQLite**，不是 catch 块里的对象 |
| 错误码校验 | `failureRecord` 额外要求 `errorCode === expectedCode`（`:642-644`），防止「没报错也算过」 |
| 测试位置 | `request-assertions.test.ts:232-268`（5 用例，4 负向）；`companion-core.integration.test.ts:725`、`:751` |

**生产事务语义（读自 `companion-service.ts`，不是猜的）**：

1. `:717` 同一会话有在飞请求 → `CONFLICT`（不排队、不交错）；
2. `:772` 用户消息在 `dispatchToProvider`（`:797`）**之前**写入 → 任何 Provider 失败后仍然存在；
3. `:798` 流结束后**再查一次** `controller.signal.aborted` → `PROVIDER_CANCELLED`；
4. `:813/:818` 助手消息只在 `dispatchToProvider` 正常返回后写入，写入内容 `output.text` 是**完整文本**；
5. 流式增量只经 `onDelta` 转发，**没有任何持久化路径**——所以「失败后残留半截回复」在当前实现里不可能由流产生。

因此门禁的判据是：**用户 1 条 / 助手 0 条 / 用户文本与发送内容一致**，且按 `turnId` 过滤（不会把别的轮次算进来）。这与生产语义一致，不是「失败后一律不许有助手消息」的臆造规则。

**[代码] [测试]** 该门禁曾在真实 socket 上被抓红过，见 §4 的 M-D：在失败路径故意写一条助手消息后，真实运行 `status: failed`，`no-fabricated-reply-on-failure` 变红，`executed=3 failed=3`，并把实际存下的行文本回显出来。

**必须说明的语义边界**：本系统**不持久化「失败状态」本身**——没有 failed 列、也没有 chat 失败事件写入 `event_journal`（`tryRecord` 的调用点只有 app 生命周期、记忆、感受、兴趣，见 §11.3）。所以「验证失败状态」只能验证：错误码经 API 抛出 + 消息行符合事务设计。要求一个不存在的持久化字段会变成发明语义，我没有那样做。

---

## 4. 门禁是否真有失败能力（要求 3：突变测试）

光跑绿不能证明门禁有效——负向用例也可能写得永远通过。所以我对**校验层**和**生产层**各注入真实缺陷，看谁变红，然后逐次还原。

| 编号 | 注入的缺陷 | 位置 | 预期 | 实际 |
|---|---|---|---|---|
| **M-A** | 让 `checkCrossSessionIsolation` 恒返回 `passed: true` | `request-assertions.ts:231` | 隔离类用例变红 | **6 failed / 45 passed**，含端到端 `reports a leak when…` |
| **M-B** | 历史比较改成**无序多重集**（保留内容、丢失顺序） | `request-assertions.ts:142` | 顺序类用例变红 | **4 failed / 18 passed**，含 `fails when the messages are in the wrong order…` |
| **M-C** | `checkFailurePersistence` 容忍 1 条助手消息 | `request-assertions.ts:267` | 伪造回复类用例变红 | **2 failed / 49 passed**，含端到端 `reports a fabricated assistant turn…` |
| **M-D** | **生产代码**在 Provider 失败时写一条助手消息 | `companion-service.ts:797` | 集成测试变红 | **3 failed / 26 passed**，含 `propagates an authentication failure…`、`keeps the user turn, drops the partial text…` |
| **M-E** | 共享裁剪函数 `>=` 改 `>`（少裁一条） | `companion-service.ts:102` | 边界用例变红 | **3 failed / 27 passed**（含 2 个本次新增用例） |

M-D 另做了**真实 Provider** 层面的验证（这是最强的一条，因为它证明真门禁不是自证的）：

```
（在 M-D 生效时运行 npm run verify:real）
status: failed
no-fabricated-reply-on-failure  FAIL  executed=3 failed=3
  cancel                  assistantStored=1   stored 1 assistant message(s) for a failed turn: "（部分回复，请求失败前已生成）"
  server-rejected-model   assistantStored=1   同上
  endpoint-unreachable    assistantStored=1   同上
其余 8 项检查仍为 ok
进程退出码: 2
```

三点值得单独说：

1. **只有目标检查变红，其余 8 项仍绿** —— 门禁是判别的，不是一坏全坏。
2. **失败信息里带出了真实存储的行文本** —— 证明它读到的是 SQLite 里的行，不是 catch 块里造的对象。
3. **退出码 2** —— 检查失败会传导到进程退出码，不会被 CI 当成功。

每次突变后都用备份还原，并用 `git status` 确认工作树回到干净状态；还原后重跑 M-A/C/D 涉及的 51 个用例，**51/51 全绿**（§6.1 第 2 行）。

---

## 5. 其余关键边界（要求 4，逐项）

### 5.1 记忆纠正/撤回/删除/恢复后，旧内容还会进请求吗

| 结论 | 等级 | 依据 |
|---|---|---|
| 三条检索路径（主题/连续性/显式回忆）共用**同一个**装配器，且只喂 `status='active'` 的记录 | [代码] | `memory-service.ts:156` `listActiveForContext(1000)` → `memory-context-assembler.ts:73` 再过滤一次 `status === 'active'` |
| 纠正后旧文本不再出现在**记忆块** | [测试] | `companion-core.integration.test.ts:407`：断言 `memoryContents(system)` 含 `MEM_SENTINEL_NEW_…`、不含 `MEM_SENTINEL_OLD_…` |
| 撤回后在三条路径上都不出现 | [测试] | 同文件 `:425`，分别走主题（含词面重叠）、连续性（零重叠）、显式回忆（`response route=retrieve_memory`）三路 |
| 删除后在三条路径上都不出现 | [测试] | 同文件 `:457` |
| 恢复后重新可用 | [测试] | 同文件 `:475` |
| 旧版本内容不会经由「历史/缓存/连续性候选」回流 | [代码] | 装配器只读 `current_text`（`memory-repository.ts:99` 起的 active 查询）；`memory_revisions` 不参与装配 |

**必须写清楚的边界**：纠正只能清掉**记忆块**里的旧文本，**清不掉同一会话早前轮次里已经发出去的原文**。对话历史是逐字留存的，那是 transcript 的定义。审计问「旧内容是否**仍可能**进入模型请求」——答案是**会，但只经由历史消息，而不是经由记忆**，且这不是缺陷而是转写语义。测试断言的层级也正是记忆块（`memoryContents`），不是整个请求体，这一点是对的（按整包断言会被用户自己的原话误伤，见 §5.2）。

### 5.2 敏感记忆的授权与敏感度边界

| 结论 | 等级 | 依据 |
|---|---|---|
| 上限由 `includeSensitive` 单一决定，缺省 `personal` | [代码] | `companion-service.ts:853` `const max = request.includeSensitive ? 'sensitive' : 'personal'`；`includeSensitive` 非布尔直接 `INVALID_INPUT`（`:716`） |
| 过滤在装配器入口，三路共用 | [代码] | `memory-context-assembler.ts:73` `sensitivity <= maximumSensitivity` |
| 敏感记忆只在显式提高上限时进入 | [测试] | `companion-core.integration.test.ts:494`（三路都不含）、`:518`（提高后含、撤回后不含） |
| 重启后上限不变 | [测试] | 同文件 `:544` |
| 授权只在有效期内、且绑定被发送的 payload | [代码] [测试] | `provider-policy.ts:100-113`（有效性与 `payloadSha256`）；`provider-policy.test.ts` 10 用例含 1ms 边界 |

**默认上限是 `personal` 而非 `normal`**：这意味着「普通对话」会把 `personal` 级记忆发出去，只有 `sensitive` 需要逐次授权。这是设计选择，不是缺陷，但容易被误读成「默认不发送个人信息」。列入 §8 第 4 条。

**记忆建议路径**（`MemorySuggestionService`）：`context.selected` 恒为空（`:1054`），只发送用户自己的那条消息，不携带任何既有记忆——所以它不存在「记忆越权」的问题；它把 `maximumSensitivity` 设为 `sensitive`（`:1056`）反而使授权更严格。**[代码]**。该路径**没有测试**，因此**不作安全性结论**，列入 §8 第 5 条。

### 5.3 连续性记忆会不会引入不相关/过期/冲突信息

| 结论 | 等级 | 依据 |
|---|---|---|
| 连续性层最多 3 条，且只取**零词面重叠**的候选 | [代码] | `memory-context-assembler.ts:55,81-82` |
| 排序是纯结构的（用户确认优先 → 置信度 → 参考时间 → id），不读时钟 | [代码] | `:44-53` |
| 有词面重叠时主题命中排在连续性之前 | [测试] | `memory-context-assembler.test.ts` 10 用例，含紧预算优先主题 |
| 过期记录带 `stale: true` 并指示模型表达不确定 | [代码] [测试] | `:117` + 提示词 `:91`；`companion-core.integration.test.ts:589` |
| 冲突记录**同时**进入，并指示模型说明冲突；系统不做结构化冲突标记，也不静默合并 | [代码] [测试] | 装配器无去重/合并逻辑；`:606` 断言两侧都在且指令在 |
| 来源与确认状态不被提升 | [测试] | `:622`（模型推断的记录不会被呈现为「用户确认」） |

**这是设计取舍，不是缺陷**：无关问题（例如「今天有点累。」）也会带最多 3 条零重叠的旧记忆，目的是消除「你是谁来着」的断裂感。代价是可能带出与当前话题无关的个人信息。审计要求「不要全删也不要 indiscriminately 全塞」，当前实现正是中间态（有界、有标签、有排序）。**是否真的更好，本阶段无法回答**——那需要模型行为指标，列入 §9 的 `P3-CON-01`。

### 5.4 失败/超时/并发/迟到回调

| 结论 | 等级 | 依据 |
|---|---|---|
| 同会话并发被拒绝而不是交错 | [代码] [测试] | `:717` `locks` + `:748/839`；`companion-core.integration.test.ts:331` |
| 超时映射为 `PROVIDER_TIMEOUT` 且不落助手消息 | [代码] [测试] | `openai-compatible.ts:140-143,187`；离线 `fail-timeout` 断言 `errorCode` + `storedAssistantCount: 0` + `storedUserCount: 1` |
| 认证失败不落助手消息 | [代码] [测试] | `:163` + 离线 `fail-auth`；集成 `:317` |
| 取消：流中途取消后不落半截回复 | [测试] [真模型] | 集成 `:751`；真实运行 `cancel` 场景 `assistantStored=0`，note 记录「首个 delta 到达后取消」 |
| 迟到回调不会覆盖新状态 | [代码] | 增量只经 `onDelta` 转发，无持久化路径（§3.C 第 5 点）；写入以 `turnId` 为键，旧轮次的迟到写入不会覆盖新轮次 |

**边界**：迟到增量仍可能被送到 UI 的 `onDelta`（渲染层），本阶段**没有** UI 级测试，因此「界面不会闪回旧文本」**未验证**。列入 §8 第 7 条。

### 5.5 请求体、日志、报告是否泄漏凭据

| 结论 | 等级 | 依据 |
|---|---|---|
| 凭据只进 HTTP 头，不进 body | [代码] | `openai-compatible.ts:153-158`：`headers.authorization = Bearer key`，`body = JSON.stringify(payload)` |
| 真实运行 7 个请求体均无 `authorization`/`bearer` | [测试] [真模型] | `no-credential-in-body` 检查 `requests=7` |
| 评测进程的密钥库只在内存 | [代码] | `evaluation-secret-store.ts`（`Map`，无文件写入） |
| 已提交产物无密钥痕迹 | [代码] | 对 `evaluation/ docs/ tests/` 做正则扫描（`sk-…`、`Bearer …`、`api_key=…`）**零命中** |
| 异常不把请求带进日志 | [代码] | `real-provider-cli.ts` 失败只输出 `{ failed: true, code }` |

**边界**：`no-credential-in-body` 断言的是**捕获到的 consent payload**，不是抓包。二者等价的依据是 `generate()` 原样 `JSON.stringify(input.requestPayload)`（§5.6）。若将来 Provider 在发送前改写 body，该检查不会察觉。列入 §8 第 2 条。

### 5.6 门禁断言的到底是「最终请求」吗

这是一个我必须主动回答的问题，因为整个门禁体系的成立与否取决于它。

- 捕获点：`authorize(preview)` 里的 `preview.exactPayload`（`real-provider-conversation.ts:229`），即 `stableJson({endpoint, body})`（`provider-policy.ts:146`）。
- 发送前的一致性：生产在 `dispatchToProvider` 之前**重算一次**并比对哈希（`companion-service.ts:768`），不一致即 `CONFLICT`。
- 发送时的形态：`openai-compatible.ts:158` `body: JSON.stringify(payload)`，`payload` 就是 `input.requestPayload`，**中间无任何改写**；`:127` 还要求 `input.endpoint === config.endpoint + '/chat/completions'`。

**[代码]** 因此「consent payload ≡ 实际请求体」在当前实现里成立（差别只有 JSON 键序，不影响语义）。
**边界**：这是代码等价，不是抓包证据。中间人代理、系统级抓包、或将来 Provider 改写 body，都会让这个等价失效。列入 §8 第 2 条。

### 5.7 认知评测是在检查行为还是只查字段

| 结论 | 等级 | 依据 |
|---|---|---|
| 认知/感受/对抗三组评测都按**逐例期望标签**算准确率与精确率/召回率 | [代码] | `cognitive-evaluation.ts:160-207` |
| 与「多数类基线」比较，必须严格优于基线才算通过 | [代码] | `:187-198, 218-222` |
| 双跑哈希一致才算确定 | [代码] [测试] | `:161-164, 208, 224` |
| 14 项具名检查全过才 `gate.passed` | [代码] | `:209-226` |
| 离线陪伴评测的用例断言解析后的**消息结构**（角色序列、历史逐位、排除内容、存储行数） | [代码] | `companion-core-evaluation.ts` 的 `CompanionCoreExpectation` |

**[测试]** 这些不是「固定字符串」判据：准确率/召回率是相对期望标签计算的，且与多数类基线比较，一个只会输出单一意图的实现在 `improvesIntentOverBaseline` 上必挂。

### 5.8 离线模拟与真实模型是否被明确区分

| 结论 | 等级 | 依据 |
|---|---|---|
| 离线报告自带 `evidenceClass: 'offline_deterministic_stub'` | [代码] | `companion-core-evaluation.ts:586`；产物实测该值 |
| 离线报告自带 `offlineExecution: {stubDispatches: 59, networkCalls: 0, networkGuarded: true, providerClass: 'deterministic_stub'}` | [代码] [测试] | 产物实测；`companion-core-evaluation.test.ts` 断言 |
| 真实报告自带 `evidenceClass: 'real_provider'`，且 `quality.assessed: false` | [代码] [真模型] | 产物实测 |
| 真实报告不产生任何质量结论 | [代码] | `quality.note` 明写；`observations` 单独存放且不参与 `passed` |

**[代码]** 两种证据在产物里是互斥的标签，不会混淆。这一点做得对。

---

## 6. 验证命令与真实结果（要求 4、5、6）

环境：Windows `win32-x64`、Node `v22.22.2`、本地 Ollama `http://127.0.0.1:11434/v1`（`qwen2.5:0.5b`）。

### 6.1 命令与退出码

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `npm run typecheck` | **0** | 无输出错误（修复前后各跑一次，均 0） |
| 2 | `npx vitest run --no-fsModuleCache --maxWorkers=2` | **0** | `Test Files 45 passed (45)` / `Tests 359 passed (359)`；修复前 108.81s、修复后 94.16s |
| 2b | 同上，仅 `request-assertions` + `integrations` | **0** | `2 passed` / `51 passed`（突变还原后复跑） |
| 3 | `npm run evaluate` | **0** | 通过 |
| 4 | `npm run evaluate:cognition` | **0** | 通过 |
| 5 | `npm run evaluate:companion` | **0** | 31/31 用例、10 维度、`gate.failedChecks: []`、`determinism.replayStable: true`、`resultHash 9e192774…`、`stubDispatches 59`、`networkCalls 0` |
| 6 | `npm run build` | **0** | `✓ built in 3.83s`（修复后再跑一次仍 0） |
| 7 | `npm run verify:real` | **0** | `status: verified`，4 轮，9/9 检查，3 个真实 socket 失败场景 |
| 8 | **Lint** | **不适用** | **仓库没有 lint 配置，也没有任何 lint 依赖**（§6.2） |
| 9 | `npm run smoke` | **未执行** | 本机 Electron 渲染问题，由 CI 覆盖（CI 的 `Electron smoke` 为 success，§6.5） |

测试数量变化：修复前 **44 文件 / 351 用例** → 修复后 **45 文件 / 359 用例**（+8，全部为新增 `history-bound.test.ts`）。

**没有删除任何用例，没有放宽任何断言，没有加 `skip`/`only`/`retry`，没有改 `testTimeout`。**

### 6.2 Lint 为什么是「不适用」而不是「通过」

```
$ ls .eslintrc* eslint.config.* .prettierrc* biome.json   → 无
$ node -e "…扫描 dependencies+devDependencies…"            → 0 个 eslint/prettier/biome 包
$ node -e "…Object.keys(package.json.scripts)…"            → 无 lint 脚本
```

依赖总数只有 7 个，没有 linter。**本阶段不安装 linter**：那是新增依赖 + 全仓库格式化，属于任务书禁止的「未经评估的大规模改动」。因此审计要求的 Lint 一项**保持未验证**，并在 §8 第 8 条列为工程缺口——`lint 未配置` 意味着「未使用的变量/误用 any/浮动 promise」这类问题只能靠 `tsc --noEmit` 和测试兜住。

### 6.3 离线评测的字段路径（给后续复核者）

上一份报告写 `stubDispatches: 59`、`replayStable: true`，字段路径不完整，我第一次复核时误判为「字段不存在」。正确路径：

```
evaluation/reports/companion-core-report.json
  .determinism.replayStable   → true
  .determinism.resultHash     → 9e1927744a7de4283967c63f08daba4f531202aa9dafba0ca541ca5a2305c8ae
  .offlineExecution.stubDispatches → 59
  .offlineExecution.networkCalls   → 0
  .offlineExecution.networkGuarded → true
  .offlineExecution.providerClass  → deterministic_stub
```

`resultHash` 在两次相隔约 1 小时的运行中**完全一致**，这是可复现性的直接证据。

### 6.4 真实 Provider 运行（`verify:real`）

`status: verified`，4 轮完成，9/9 检查通过：

| 检查 | 结果 | 说明 |
|---|---|---|
| `provider-reachable` | ok | `/models` 返回 `nomic-embed-text:latest, qwen2.5:0.5b` |
| `first-turn-answered` | ok | turn-1 存下 1 条助手消息 |
| `multi-turn-history-complete` | ok | 三轮角色序列逐位匹配 |
| `conversation-isolated` | ok | `nonSystemMessages=1 foreignUser=3 foreignAssistant=3 memoryPresent=true` |
| `memory-reaches-real-model` | ok | 记忆片段在 system 消息中 |
| `personality-in-request` | ok | 4/4 请求含 `version 2`、`warmth 60/100`、`用中文回答` |
| `configured-model-used` | ok | 4/4 声明 `qwen2.5:0.5b` |
| `no-credential-in-body` | ok | 7 个请求体均无认证串 |
| `no-fabricated-reply-on-failure` | ok | 3 个真实 socket 场景，全部「用户 1 / 助手 0」 |

失败场景：`cancel`（首个 delta 后取消，`PROVIDER_CANCELLED`）、`server-rejected-model`（真实 404 → `PROVIDER_MODEL`）、`endpoint-unreachable`（端口无监听 → `PROVIDER_NETWORK`）为真实 socket；`auth-rejected`、`timeout` 标 `not_exercised`、`passed: false`，**不计入通过**。

**这些全部是「请求侧/系统侧」证据，没有一条是模型质量证据。**

### 6.5 CI 证据（要求 5：必须与 SHA 对齐）

| head SHA | Run | 结论 | 说明 |
|---|---|---|---|
| `e944799` | [40337895001](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40337895001) | **success**，3/3 Job | 本次审计的代码基线 |
| `8d81155` | 随下一行同组推送，无独立 run | — | §7 的最小修复（源码 + 测试） |
| `dbff261` | [40345324766](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40345324766) | **success**，3/3 Job，**首次 attempt 即绿** | 本次修复 + 本报告 |

`e944799` 的三个 Job：`Typecheck, tests, build and smoke (ubuntu-latest)`、`Typecheck, tests, build and smoke (windows-latest)`、`Windows upgrade path (schema migrations under the real app)` 全部 success；步骤级：`Typecheck` / `Unit and integration tests` / `Offline evaluations` / `Build application bundles` / `Electron smoke` 均 success，`Install xvfb` 在 Windows Job 为 `skipped`（该步骤仅对 Linux 有意义）。

**CI 偶发失败的历史必须写清**（审计明确要求，不得只报最终绿）：上一提交 `c4aecc3`（纯文档）的第 1 次 attempt 在 `Windows upgrade path` Job 上因 `src/persistence/backup-service.test.ts:254` 超时 20000ms 而失败，第 2 次 attempt 全绿；该文件在本 PR 中一行未改，同一份代码 4 绿 1 红。本次修复提交的 attempt 次数在 PR Checks 中可见，若出现红/绿交替，**不能**用它推断代码正确性——判断依据是 §4 的突变证据与 §6.1 的本地结果。

**CI 不含 `verify:real`**：真实 Provider 验证需要本机 `ollama serve`，不在流水线内。CI 绿只排除「离线套件被打破」，不证明任何真实模型行为。

---

## 7. 本次发现的问题、修复内容（要求 6）

### 7.1 缺陷：历史裁剪有两份实现，只共享了常量

| 项 | 内容 |
|---|---|
| 位置 | 生产 `companion-service.ts:912-919`（修复前）与校验 `request-assertions.ts:90-103`（修复前）各有一段**结构相同但彼此独立**的裁剪循环 |
| 成因 | 上一轮只把 **常量** `HISTORY_POLICY` 提为 export，注释写成「so this cannot silently drift」，但**算法本体仍是两份**。常量一致、循环不一致时，门禁会拿一个生产永远不会产生的窗口去比对 |
| 当前是否已产生错误结论 | **否**。两段循环逐行等价（同为「从最新往回、超预算即停、反转」），所以今天的行为一致。这是**可维护性缺陷**，不是当前的行为 bug——这一点必须说清楚，不能夸大成「已发生漂移」 |
| 修复 | 把循环提成 `companion-service.ts:94` 的 `retainedHistoryTail<T>(history, sizeOf, policy)`，`prepare()` 与 `selectRetainedHistory()` 都调用它；校验侧改为委托 |
| 新增测试 | `src/evaluation/history-bound.test.ts`，8 用例：6 个语义用例（含「不跳过超预算消息去取更旧的」「预算按字符不按字节」）+ 1 个两组入口在 11 种形状上的一致性对照 + 1 个空历史 |
| 如何证明该测试能失败 | 突变 **M-E**（`>=` 改 `>`）：**3 failed / 27 passed**，其中 2 个是本次新增用例 |
| 行为是否有变化 | **无**。`prepare()` 的入参、出参、循环语义完全一致；`npm run typecheck` 0、全量 359 用例全绿、离线 31/31 与 `resultHash 9e192774…` 未变 |
| 规模 | 2 个文件 +24/−8，新增 1 个测试文件 |

### 7.2 未修复、但已确认的观察（不是缺陷）

| 观察 | 为什么不动 |
|---|---|
| 报告路径守卫有 3 份实现（`report-path.ts` 被 2 个 CLI 复用；`cognitive-core-cli.ts` 与 `scripts/run-cognitive-core-evaluation.mjs` 各有一份内联副本） | 三份功能等价，且认知侧的文件名是**硬编码常量**、不接受外部输入，无可利用路径。合并需要改 3 个入口 + 构建脚本，收益是防未来漂移，风险大于收益，列为 §8 第 3 条 |
| `checkHistoryCompleteness` 判「该裁未裁」用 `content` 全等（`:166`） | 若用户在两轮说了完全相同的话，可能误报。方向是**宁严不宽**（假红而非假绿），且现有 20 轮用例未触发。列为 §8 第 6 条 |
| 装配器的 `now` 默认取系统时钟（`memory-context-assembler.ts:68`），生产调用未注入时钟 | 实测 `resultHash` 跨 1 小时两次运行一致，**没有观察到不稳定**；改动要穿透 `MemoryService` 签名到热路径，属于为未观测到的问题改架构。列为 §8 第 1 条 |

---

## 8. 残余风险（要求 6）

| # | 风险 | 级别 | 状态 / 为什么 |
|---|---|---|---|
| 1 | **评测的时钟封闭性**：`assemble(..., now = new Date())` 在生产调用链上未被注入，`stale` 与排序含时钟依赖。若某条夹具记忆落在 180 天边界附近，`resultHash` 可能随时间改变 | 低 | 未修复。当前无观测到的不稳定（跨 1 小时两次 `resultHash` 相同）。修法是把 `ChatService.now()` 透传进 `assembleContext`，属穿透性改动，需单独评估 |
| 2 | **门禁断言的是 consent payload，不是抓包** | 中 | 未修复（属证据边界的固有属性）。代码层面 `JSON.stringify(input.requestPayload)` 无改写、endpoint 强校验，等价成立；但代理/抓包/未来 Provider 改写会破坏等价。缓解：`no-credential-in-body` 与结构断言都在 payload 上，一旦 Provider 改写，`configured-model-used` 会先红 |
| 3 | **路径守卫三份实现** | 低 | 未修复，见 §7.2 |
| 4 | **默认敏感度上限是 `personal`** | 低 | 设计如此。`personal` 级记忆在普通对话即发送，只有 `sensitive` 需逐次授权。容易被误读为「默认不发个人信息」 |
| 5 | **记忆建议路径无测试** | 低 | 代码确认其 `context.selected` 为空、只发用户自己那条消息、上限设为 `sensitive`，但**本轮未写测试**，故不作安全性结论 |
| 6 | **哨兵可被语义改写绕过；「该裁未裁」判据用内容全等** | 低 | 两个都是判据边界的固有局限，方向均为「宁严不宽」 |
| 7 | **迟到增量对 UI 的影响未验证** | 中 | 持久化层已确认无路径；`onDelta` 到渲染层的行为**无测试**。本阶段未做 UI 验证 |
| 8 | **Lint 未配置** | 中 | 无 linter、无 lint 脚本，依赖仅 7 个。属工程基线缺口，非本 PR 引入 |
| 9 | **真实模型质量完全未评估** | 高（对产品）/ 不适用（对本阶段） | `quality.assessed: false`。`qwen2.5:0.5b` 不足以判断陪伴质量；审计明确禁止把「收到正确上下文」当作「理解上下文」。质量结论必须由 §9 的框架在新阶段产出 |
| 10 | 云端 Provider（DeepSeek）真实调用未验证 | 中 | 无凭据、零付费请求。请求结构、哈希绑定、模型名由离线用例覆盖，真实链路未验证 |
| 11 | `auth-rejected` / `timeout` 未在真实 socket 上触发 | 中 | 工作中的本地 Ollama 不产生 401/超时。离线 `fail-auth` / `fail-timeout` 覆盖代码路径，不能替代真实服务端行为 |

---

## 9. 第三阶段能力基线（要求 7）

前提声明，也是本节的立论基础：

> **模型收到正确上下文 ≠ 模型正确理解上下文。**
> 本阶段的 9 项检查全部属于「投递证据」。第三阶段必须把度量对象从**请求**移到**回复**，并且每一项都要有「上下文缺失时门禁必须变红」的负向测试——否则度量的是脚手架，不是能力。

统一约定（七项评测共用）：

- **成功案例 / 失败案例**成对存在，失败案例必须是「同样输入、去掉关键上下文」或「同样上下文、加入干扰」的对照，不能是随手编的反例。
- **负向测试**针对**系统**：把必要上下文从请求里拿掉，对应门禁必须变红（复用本阶段的 `checkHistoryCompleteness` / `checkCrossSessionIsolation`）。
- **量化指标**必须写成带分子分母的比率，并与「平凡基线」比较（例如「一律回答不知道」的基线）。
- **真实模型验证方法**：同一批条目跑 N 次（N≥3）报告逐条结果与不一致率；**不做模型自评**（0.5B 自评无意义），小样本人工标注为准。
- 每条结论只允许标注为**[真模型]**当且仅当度量对象是回复文本；否则一律标 **[测试]**。

| ID | 能力 | 成功案例 | 失败/对照案例 | 负向测试（系统门禁） | 量化指标 | 真实模型验证方法 |
|---|---|---|---|---|---|---|
| `P3-REF-01` | 多轮指代与语境理解 | 第 1 轮「我养了只叫豆豆的猫」，第 3 轮「它几岁了」→ 回复明确针对豆豆 | 同问但删掉第 1 轮 → 模型应**反问「谁」**，而不是编一个年龄 | 删掉先行轮次后，`checkHistoryCompleteness` 必须红（证明「先行语不在请求里」被系统识别） | 指代消解正确率；无先行语时的**反问率**（目标 ≥0.8）与**编造率**（目标 0） | 20 条模板 × 3 次；人工标注「是否正确指向 / 是否反问」；报告逐条结果，不报单一总分 |
| `P3-XS-01` | 跨会话事实回忆 | 会话 A 说「我对花生过敏」，新会话问「我能吃花生吗」→ 回复明确避开 | 删除该记忆 → 回复不得声称知道，应说明没有相关信息 | 记忆被撤回后，`memoryContents(system)` 必须为空（复用本阶段三路用例） | 事实召回率；**无记忆时的编造率**（目标 0） | 3 种问法（直接/间接/否定式）× 3 次；标注「是否用到了该事实」与「是否越界断言」 |
| `P3-COR-01` | 用户纠正后的记忆更新 | 「我住南京」→「我搬到杭州了」→ 问住哪 → 答杭州 | 纠正后仍答南京（旧值残留） | 纠正后旧哨兵不得出现在记忆块（本阶段已有 `:407`） | 旧值残留率（目标 0）；新值命中率 | 纠正后间隔 1/3/5 轮再问，测「新值是否被后续轮次冲掉」 |
| `P3-CFL-01` | 新旧事实冲突 | 「我住南京」+「我住杭州」，未纠正 → 回复**指出存在两个说法**并请求确认 | 静默选一个并当作事实 | 两条都在请求里（本阶段 `:606`）；**缺一条**时门禁红 | 冲突披露率（目标 ≥0.8）；静默择一率（目标 0） | 同一冲突跑 3 次，看是否稳定披露而非随机择一；记录「选了哪条」 |
| `P3-EXP-01` | 过期与撤回信息隔离 | 200 天前未确认的记忆 + 当前提问 → 回复带不确定措辞（「你之前提过…如果没变的话」） | 把过期记忆当确定事实陈述；撤回后仍提及 | 撤回后三路均为空（本阶段 `:425`）；`stale: true` 必须在请求中 | 不确定措辞出现率；过期信息**断言化**率（目标 0）；撤回后泄漏率（目标 0） | 对比「stale=true 与 false 同一内容」的两组回复，看措辞是否可区分 |
| `P3-CLR-01` | 证据不足时的澄清 | 「那个事怎么办」且无相关记忆 → 反问指什么 | 编造一个「那件事」并给建议 | 无记忆时 `memoryContents` 为空（本阶段 `:250` 的「明说不知道」用例） | 澄清率（目标 ≥0.8）；**无依据断言率**（目标 0） | 10 条模糊指代 × 3 次；标注「是否反问」 |
| `P3-PER-01` | 人格跨会话/跨情境一致性 | 同一人格下，新会话与旧会话的称呼、直接度、幽默度可辨识为同一人 | 新会话变成客服腔；情绪化提问时人格崩塌 | 每个请求都含人格块与版本号（本阶段 `personality-in-request`） | 风格标记一致率（人工 3 维打分：暖度/直接度/幽默度）；跨会话方差 | 4 个情境（日常/求助/冲突/闲聊）× 2 个会话 × 3 次；人工盲评（不知道哪条来自哪个会话） |

**三项必须先立的护栏**（否则上面的指标会被自己骗）：

1. **投递与理解分开记分**：每条结果同时记「上下文是否送达（系统）」与「回复是否正确（模型）」。前者红则后者不计分。
2. **禁止用提高上下文投递量来刷分**：连续性上限（3 条）在评测期间固定，否则「多塞记忆」能人为抬高召回率。
3. **禁止模型自评**：判分只能来自人工标注或确定性匹配（如是否含新值哨兵、是否含反问句式）。0.5B 模型的自评不可作为证据。

**本阶段不实现上述任何评测**——它属于第三阶段，且需要先确定可用模型。此处只给基线设计。

---

## 10. 验收结论（要求 8）

**部分通过。**

理由逐条对应审计要求：

| 审计要求 | 结论 | 等级 |
|---|---|---|
| 三个关键门禁真实存在且非自证 | **是** | [代码] + [测试] + 突变 [测试] |
| 负向测试证明门禁能失败 | **是**，5 组突变全部变红，含 1 组生产层 + 1 组真实 socket 层 | [测试] + [真模型]（仅失败路径） |
| 记忆状态/敏感度/连续性边界有针对性检查 | **是** | [代码] + [测试] |
| 所有测试结果可复核 | **是**，命令、退出码、用例数在 §6.1 | [测试] |
| 最新 SHA 的 CI 有直接证据 | **是**，`e944799` 的 run 40337895001 success；本次提交的 run 在 PR Checks 按 SHA 可查 | 运行记录 |
| 真实 Provider 结果与质量观察分开 | **是**，`quality.assessed: false`，§6.4 与 §5.7 分离 | [真模型] 仅限投递 |
| 未解决风险列明 | **是**，§8 共 11 条 | — |
| 修复报告已提交到 PR 分支 | **是**（本文件） | — |
| PR #3 保持 OPEN、未合并 | **是**（§1） | `gh pr view` |

**为什么不给「通过」**：本阶段能证明的是「系统把该送的东西按正确结构送到了，且失败时不留假回复」；**不能**证明「模型理解了」。审计原文要求「不得把模型收到正确上下文等同于模型已经正确理解上下文」，因此在没有 §9 那类回复侧证据之前，任何「通过」都会越界。称其为「部分通过」是当前证据允许的最强表述。

**为什么不给「不通过」**：三项 P0 缺陷已被真实修复且有失败能力证据，没有发现伪造、放宽或自证；本次复验发现的唯一缺陷（裁剪实现重复）已修复且不改变行为。没有阻塞性缺陷。

---

## 11. 附录：复现

### 11.1 完整命令

```bash
npm run typecheck
npx vitest run --no-fsModuleCache --maxWorkers=2      # 45 files / 359 tests
npm run evaluate && npm run evaluate:cognition && npm run evaluate:companion
npm run build
npm run verify:real                                   # 需本机 ollama serve；不可达时 exit 3 且不写报告
node -e "…读 companion-core-report.json 的 .determinism / .offlineExecution…"
```

### 11.2 修复前后代码对照（证明修复真的在代码里）

```bash
git show f579897:src/evaluation/real-provider-conversation.ts | sed -n '193,194p;250,251p;289p;317,321p'
git show e944799:src/evaluation/real-provider-conversation.ts | grep -c containsPrevious   # → 0
git grep -n "checkCrossSessionIsolation\|checkHistoryCompleteness\|checkFailurePersistence" e944799 -- src/
```

### 11.3 「失败状态未被持久化」的依据

```bash
git grep -n "tryRecord(" e944799 -- src/   # 仅 app 生命周期、记忆、感受、兴趣；无 chat 失败事件
```

### 11.4 突变测试的复现方式

每次突变都是「备份 → 改一处 → 跑目标测试 → 还原 → `git status` 确认干净」。改动点与预期结果见 §4 表格；本次未提交任何突变代码（`git status` 除 §7 的修复与报告外为空）。

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 第 1 版 | 2026-10-26 | 独立复验初版。基线 `e944799`；含 5 组突变证据、1 个缺陷修复（裁剪实现去重）、11 条残余风险、第三阶段 7 项评测基线 |
| 第 2 版 | 2026-10-26 | 回填 §6.5 的真实 CI：`dbff261` 的 run 40345324766，3/3 Job success，首次 attempt 即绿。统一全文行号为最终代码位置（修复后 `request-assertions.ts` 三个门禁分别在 120/189/258 行）。本行为纯文档提交，不改变任何结论 |
