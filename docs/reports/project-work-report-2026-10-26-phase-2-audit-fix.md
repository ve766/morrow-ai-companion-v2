# Morrow V2 · 第二阶段审计修复报告

> 本报告针对 PR #3 的审计意见，修复**真实 Provider 评测门禁**的三处缺陷，并补足记忆状态、敏感度、连续性、评测引擎与授权边界的证据。
> 所有结论都对应一次本次实际执行的命令输出。未执行、失败或无法验证的项目在 §F 与 §E 单独列明，**不与通过项混写**。

## 0. 一句话结论

审计指出的三项 P0 缺陷**全部属实，且比描述更严重**——第三项（失败回复检查）在最坏情况下是一个恒真断言，而 turn-4 的两个字段是**硬编码的 `true`**，根本不读取任何请求。三者已重写为对**解析后的请求结构**与**重新读取的数据库行**的断言，并配了能证明旧实现会误判通过的负向测试。

顺带发现并修复了第四个同类问题：离线评测的 fixture 解析器接受未知字段，一个拼错的断言名会让用例**静默通过**。

---

## A. 基线

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| PR | **#3**（`OPEN`，**未合并**）https://github.com/ve766/morrow-ai-companion-v2/pull/3 |
| base 分支 | `chore/phase-1-engineering-consistency`（堆叠 PR） |
| head 分支 | `feat/phase-2-companion-core` |
| 修复前 SHA | `f57989714b52ad2c695649e90ee141a4357eea0d` |
| 修复前 CI | [run 40324745303](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40324745303) — **success，3/3 Job** |
| 修复后 SHA（代码最后一提交） | `7bf2e54` |
| 报告提交 SHA（**首次引入本文件**） | `b2a16a3` |
| 修复后 CI | [run 40334673549](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40334673549) @ `b2a16a3` — **success，3/3 Job** |
| 规模 | 17 文件，+2280 / −230 |

### A.1 本次实际修改的文件

| 文件 | 类型 | 目的 |
|---|---|---|
| `src/evaluation/request-assertions.ts` | **新增** | 三个门禁的纯函数实现，可单测 |
| `src/evaluation/request-assertions.test.ts` | **新增** | 22 个用例，含 8 个负向用例 |
| `src/evaluation/report-path.ts` | **新增** | 报告路径守卫（两个 CLI 共用） |
| `src/evaluation/report-path.test.ts` | **新增** | 5 个路径用例 |
| `src/evaluation/real-provider-conversation.ts` | 重写 | 结构断言、哨兵、失败场景、schema v2 |
| `src/evaluation/real-provider-cli.ts` | 重写 | 路径守卫、blocked 不写报告、失败明细 |
| `src/evaluation/companion-core-cli.ts` | 修改 | 改用共用路径守卫，错误码归一 |
| `src/evaluation/companion-core-evaluation.ts` | 修改 | 封闭 schema、严格错误归因、结构化断言 |
| `src/evaluation/companion-core-evaluation.test.ts` | 修改 | 4 → 17 个用例 |
| `src/app/companion-service.ts` | 修改 | 导出 `HISTORY_POLICY`（**行为未变**） |
| `src/app/companion-core.integration.test.ts` | 修改 | 14 → 29 个用例 |
| `src/memory/memory-context-assembler.test.ts` | 修改 | 8 → 10 个用例 |
| `src/providers/provider-policy.test.ts` | 修改 | 7 → 10 个用例 |
| `evaluation/fixtures/companion-core-v1.json` | 修改 | 21 → 31 用例 |
| `evaluation/reports/real-provider-conversation-report.json` | 重新生成 | schema v2 证据 |
| `scripts/run-real-provider-conversation.mjs` | 修改 | 失败原因不再被吞掉 |
| `scripts/run-companion-core-evaluation.mjs` | 修改 | 同上 |

**未改动**：记忆打分函数、人格算法、内在状态算法、授权策略、任何数据库迁移（无 v16，无 schema 变更）、任何依赖、`package.json`、CI 工作流。

`companion-service.ts` 的唯一改动是把两个私有常量提成 `export const HISTORY_POLICY`，`prepare()` 改为读它——**取值与逻辑完全相同**，目的是让校验方不可能与生产实现漂移。

### A.2 修复后 CI

**结论对象是本文件所在提交 `b2a16a3`，不是修复前的 `f579897`。**

| 项 | 值 |
|---|---|
| Run | [40334673549](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40334673549) |
| head SHA | `b2a16a34c369877f0c52189db2e49768a31d494f` |
| 事件 / 分支 | `pull_request` / `feat/phase-2-companion-core` |
| 结论 | **success**（`completed`，2026-10-26T13:56:16Z） |

Job 级结论（3/3 全绿）：

| Job | 结论 |
|---|---|
| `Windows upgrade path (schema migrations under the real app)` | success |
| `Typecheck, tests, build and smoke (ubuntu-latest)` | success |
| `Typecheck, tests, build and smoke (windows-latest)` | success |

CI 内的步骤（步骤级结论，逐条核对自 API，不是凭印象）：两个 `Typecheck, tests, build and smoke` Job 均执行 `Install dependencies` → `Typecheck` → `Unit and integration tests` → `Offline evaluations` → `Build application bundles` → `Install Electron binary for smoke` → `Electron smoke (real app, isolated profile, no network egress)`，全部 `success`；`Install xvfb (Linux headless display for Electron)` 在 ubuntu Job 为 `success`、在 windows Job 为 `skipped`（该步骤本就只对 Linux 有意义，跳过属预期，不是失败）。`Windows upgrade path` Job 的 `Migration and persistence test pass (includes v1→v15 upgrade paths)` 为 `success` —— 这条与 §A.1「无 v16、无 schema 变更」的声明互相印证。

**这份 run 是对 `b2a16a3` 的一次独立执行**，覆盖了代码修复（`af91825..7bf2e54`）与本报告提交。CI **不含** `verify:real` —— 真实 Provider 验证需要本机 `ollama serve`，不在 CI 范围内；它的证据在 §D，且只对本机环境有效。

> 不要用修复前的 run 40324745303（`f579897`，同样 success）推断修复后的状态。两者是同一条流水线在两份不同代码上的结果，前者证明的是**有缺陷的代码**也能通过 CI —— 这本身说明 CI 只覆盖离线信号，不覆盖真实 Provider 行为。

---

## B. 审计发现与修复对应表

### B.1 P0-1 跨会话隔离检查（原 `conversation-isolated`）

| 项 | 内容 |
|---|---|
| 原始问题 | 用 `requestBytes` 不相等当作「新会话未携带旧会话内容」的证据 |
| 相关代码 | `src/evaluation/real-provider-conversation.ts:289`（原文件） |
| 代码原文 | `passed: Boolean(crossTurn?.containsMemory) && !(crossTurn?.requestBytes === turnThree?.requestBytes)` |
| 成因 | 把「两个请求长度不同」当成「内容不同」，再把「内容不同」当成「没有泄漏」。长度差异可以来自当前用户消息、系统提示词里的时间戳、模型上一轮回复长度，与泄漏无关；反过来，泄漏且长度恰好相同（几乎不可能但并非不可能）也会被判为通过。**它从未检查过旧会话的任何一条消息**。 |
| 更严重的同源问题 | 同文件 `:250-251` 把 `containsPreviousUserTurn` 与 `containsPreviousAssistantTurn` **硬编码为 `true`**，turn-4 记录里的这两个字段不来自任何计算，只是两个常量。报告曾把它们当作证据引用。 |
| 修复方式 | 会话 A 的每一轮用户消息带唯一哨兵（`SENTINEL-A7F3`、`SENTINEL-B8E1`）。会话 B 的请求被解析为消息数组后，逐条断言：① 非 system 消息**恰好 1 条**；② 该条就是当前用户消息；③ 任何消息都不含 A 的用户消息；④ 任何消息都不含 A 的助手回复（取自数据库，不是脚本变量）；⑤ 任何消息与 system 提示词都不含哨兵；⑥ system 提示词含记忆片段。 |
| 新增测试 | `checkCrossSessionIsolation` 的 6 个用例（1 正 5 负）；集成测试「真实数据层泄漏」1 个 |
| 修复前为何误通过 | 见 §B.1.a 的专门用例 |
| 修复后如何证明 | §C 的输出：`conversation-isolated` detail 为 `nonSystemMessages=1 foreignUser=3 foreignAssistant=3 memoryPresent=true` |

#### B.1.a 证明旧实现会误判通过

`request-assertions.test.ts` 里有一个用例专门构造这种情形：

```
leaked  = [system, A 的私密用户消息, A 的助手回复, B 的当前用户消息]
clean   = [system, B 的当前用户消息]
bytesDiffer           = true   ← 旧检查的全部依据
newCheckPasses(leaked) = false  ← 新检查的结论
```

用例名：`rejects the byte-length heuristic the previous version relied on`。它同时断言 `oldCheckWouldPass === true` 与 `newCheckPasses === false`，因此这条用例本身就在说明「旧门禁在这里会放过」。

另外还有一个端到端版本：`reports a leak when a faulty conversation layer hands conversation A to conversation B`。它不是在测试里手搓 JSON，而是替换 `ConversationService.read()`，让生产代码**真的**把 A 的消息当作 B 的历史发出去，然后由门禁判定为失败。

---

### B.2 P0-2 多轮历史完整性（原 `multi-turn-context`）

| 项 | 内容 |
|---|---|
| 原始问题 | 只检查「上一条用户消息是否出现在整包字符串里」+「字节数是否增长」 |
| 相关代码 | `src/evaluation/real-provider-conversation.ts:279-285`（原文件） |
| 代码原文 | `passed: turnThree?.containsPreviousUserTurn && turnTwo?.containsPreviousAssistantTurn && turnThree.requestBytes > turnTwo.requestBytes`，其中 `containsPreviousUserTurn` 为 `rawRequest.includes(previousUser)` |
| 成因 | ① 只覆盖 turn-2 的用户消息与 turn-1 的助手回复，**turn-1 的用户消息从未被检查**；② 子串命中无法区分「在 system 提示词里」与「在历史消息里」；③ 不检查角色、顺序、条数；④ 字节数增长是必要非充分条件，删掉一条旧消息同时新增一条新消息仍然增长。 |
| 修复方式 | 每一轮发送**前**从 SQLite 读出该会话全部消息，用 `selectRetainedHistory`（读 `HISTORY_POLICY`，即生产常量）算出「按规则应保留」与「按规则可裁剪」两段；发送后把请求解析成消息数组，逐位比较 `role` 与 `content`，条数必须精确等于 `1 + retained + 1`，末尾必须是当前用户消息，被判定为可裁剪的消息**不得**出现。 |
| 期望值来源 | 来自数据库里真实存下的消息，**不是**脚本里的轮次数组。这样「某轮没写进库」不会被误当成「按规则裁掉了」。 |
| 裁剪规则 | `maxMessages=12`、`maxCharacters=6000`，从最新往回取，遇到第一条超预算的消息即停止（是后缀，不是任意子集）。3 轮对话共 4 条历史，不触发裁剪；裁剪边界由离线 `ctx-02`（20 轮）覆盖。 |
| 新增测试 | `checkHistoryCompleteness` 的 8 个用例（2 正 6 负）；`selectRetainedHistory` 2 个；离线 `ctx-03` 用 `history` 做逐位断言 |
| 修复后输出 | `turn-1:system\|user` / `turn-2:system\|user\|assistant\|user` / `turn-3:system\|user\|assistant\|user\|assistant\|user` |

#### B.2.a 证明新检查能失败

负向用例覆盖：**缺一条应保留的消息**、**顺序颠倒但内容齐全**、**角色错但内容相同**、**当前用户消息不在末位**、**本该裁掉的消息仍在**、**多出一条外来消息**。全部要求 `passed === false` 并命中对应的失败文案。

`ctx-02` 顺带纠正了报告作者自己的一个算错：原来写「保留窗口从第 15 轮开始」，实际上当前轮不计入历史，窗口是第 14–19 轮 + 当前第 20 轮。**这是断言写错，不是代码问题**，严格断言把它抓了出来，已按实际行为改正。

---

### B.3 P0-3 失败回复检查（原 `no-fabricated-reply-on-failure`）

| 项 | 内容 |
|---|---|
| 原始问题 | `catch` 分支自己把 `responseText`/`responseChars` 置空，随后断言 `responseChars === 0` |
| 相关代码 | 写：`src/evaluation/real-provider-conversation.ts:193-194`（原文件）；读：`:317-321`（原文件） |
| 代码原文 | catch 内 `responseText: ''`、`responseChars: 0`；检查为 `turns.every(turn => turn.errorCode === null \|\| turn.responseChars === 0)` |
| 成因 | 检查的字段由被检查的代码在失败分支里赋值，因此**恒真**。它不可能发现「失败后仍写入了一条助手成功回复」，因为这恰恰是它自己清空的那个字段要表达的东西。 |
| 生产语义（先读代码再定规则） | `ChatService.send`：用户消息在 `dispatchToProvider` **之前** `appendMessage`，所以任何 Provider 失败都会留下用户轮次；助手消息只在 `dispatchToProvider` **resolve 之后**才写入，且之后还有 `if (controller.signal.aborted) throw PROVIDER_CANCELLED`。**不存在部分流式内容落库的路径**。`OpenAICompatibleProvider.readStream` 的增量只交给 `onDelta`，不落库。 |
| 因此规则是 | 失败轮次：**用户消息存 1 条，助手消息存 0 条**；已发出的增量文本不得出现在存储或下一轮请求中。 |
| 修复方式 | 失败后从 SQLite `readConversation()` 重新读取，按 `turnId` 过滤，断言上述规则。`RealProviderTurnRecord` 增加 `storedUserMessages` / `storedAssistantMessages`，**全部来自数据库读取**；catch 分支不再设置任何被断言字段。 |
| 新增覆盖 | 真实 socket 上可触发 3 种：**流中途取消**（由第一个 delta 触发，`PROVIDER_CANCELLED`）、**服务端拒绝未知模型**（真实 404 → `PROVIDER_MODEL`）、**端口无监听**（`PROVIDER_NETWORK`）。 |
| 未覆盖 | **认证失败（401/403）与超时**无法用一台正常工作的本地 Ollama 触发。二者标为 `not_exercised`，`passed` 为 `false` 且在 CLI 输出中显示为 `null`，**不计入通过**；离线评测的 `fail-auth` / `fail-timeout` 覆盖其代码路径。 |
| 负向测试 | `request-assertions.test.ts` 4 个；集成测试「失败路径遗留助手消息」1 个（先验证健康路径通过，再手工写入一条助手消息，验证门禁报错） |

---

### B.4 P1-1 记忆状态过滤（逐路径核实）

| 路径 | 状态过滤发生位置 | 结论 | 测试 |
|---|---|---|---|
| 主题检索 | `SqliteMemoryRepository.listActiveForContext` 的 `WHERE status='active'`，再由 `MemoryContextAssembler` 的 `status === 'active'` 二次过滤 | 已撤回/已删除不进入 | 集成「topic 路由」+ 离线 `ret-01` |
| 连续性补充 | 复用同一个 `candidates` 集合（先按状态与敏感度过滤，再切分 topic/continuity） | 同上，**无独立旁路** | 集成「continuity 路由」+ 离线 `ret-02` |
| 显式回忆 | 与主题检索共用 `assembleContext`，只是查询串被加宽 | 同上 | 集成「retrieve_memory 路由」+ 离线 `ret-01` |
| 冲突提示 | 不参与上下文选择，`detectConflicts` 只写事件日志 | 不构成召回路径 | 代码核对 + 离线 `conflict-01` |
| 已删除 | 物理 `DELETE`，`memories` 表中不存在 | 不进入 | 集成「delete 三路由」+ 离线 `del-01` |
| 已纠正的旧文本 | `correct` 覆盖 `current_text`；旧文本只留在 `memory_revisions`（追加式历史），而装配器**只读 `memories` 表，从不读 revisions** | 旧文本不进入 | 集成「correction」+ 离线 `corr-01`/`corr-02` |
| 已恢复 | `restore` 仅允许从 `retracted` 迁回 `active`，随后重新可召回 | 可用，且**这是刻意的** | 集成「restore」+ 离线 `ret-03` |

**必须说清的限制**：如果旧文本是**用户在对话里说过的**，它仍留在对话历史里并会被发送。那不是记忆泄漏，是聊天记录本身；本轮修复只保证「记忆」这一路不再携带旧文本，测试用**从未在对话中出现过的哨兵**来区分这两件事。

**另一个限制**：`restore` 会把 `lastConfirmedAt` 刷新为当前时间（`transitionMemory` 的 `retract` 分支才保留原值）。因此一条 400 天前的记录被恢复后**不会**被标记为 stale。这是既有语义，本轮未改，属于遗留风险（§E 第 4 条）。

---

### B.5 P1-2 敏感度过滤（逐路径核实）

| 项 | 结论 |
|---|---|
| 上限由谁决定 | `ChatService.prepare`：`const max = request.includeSensitive ? 'sensitive' : 'personal'`。**默认上限是 `personal`，不是 `normal`**——`personal` 级记忆在普通对话中就会被发送。 |
| 过滤在哪 | `MemoryContextAssembler` 的 `order.indexOf(record.sensitivity) <= order.indexOf(maximumSensitivity)`，在切分 topic/continuity **之前**执行，因此连续性层无法绕过。 |
| 二次闸门 | `assessProviderRequest` 用**实际入选记忆的最大敏感度**与 `input.maximumSensitivity` 取大，若为 `sensitive` 则要求 `consent.includeSensitive`，否则 `FORBIDDEN` 且不派发。 |
| 显式回忆能否绕过 | 不能。集成测试用认知分析器的 `retrieve_memory` 路由（并在断言中确认 `response route=retrieve_memory`）验证 `花生` 级记忆仍被排除，`"memories":[]`。 |
| 连续性能否绕过 | 不能，已测。 |
| 重启后 | 同一规则，已测。 |
| 撤回后 + `includeSensitive: true` | 仍被排除，已测（状态过滤先于敏感度过滤，两者叠加）。 |
| 最终请求体 | 所有断言都落在**解析后的 system 消息里的 memory 条目**或整包上，不落在 `MemoryRecord` 或数据库行上。 |

> 一处断言方式的修正值得记录：最初用 `raw.not.toContain('花生')`，测试失败——因为**用户自己问的是「花生能吃吗？」**。原始子串无法区分「记忆泄漏」与「用户原话」。改为解析 memory 条目后通过。这正是审计反对「表面字符串断言」的具体例子。

---

### B.6 P1-3 连续性相关性（评估而非删除机制）

| 问题 | 结论 | 证据 |
|---|---|---|
| 完全无关时是否引入不必要的个人信息 | **会引入，但被显式标注**：条目带 `match:"continuity"`，提示词同时说明「背景而已，不能当作当前问题的答案」。这是设计意图（避免每轮像初见），不是泄漏。 | 集成「continuity 标注」+ 离线 `integ-03` |
| 相关记忆优先 | 是。`eligible` 先 topic 后 continuity，排序与截断都按此顺序 | 集成 + 离线 `cont-01`（5 条记忆 → 1 topic + 3 continuity） |
| 多条过期记忆是否被当作确定事实 | 不会。`stale:true` + 固定原则要求「说出疑虑」 | 集成「stale」+ 离线 `stale-01`/`unk-02` |
| 冲突是否被静默合并 | **不会合并，但也未自动标注冲突**：两条记录都进入请求，靠固定原则要求模型说明冲突。系统侧不生成「这两条互相矛盾」的标记。 | 集成「conflict」+ 离线 `conflict-01` |
| 来源与确认状态是否被错误提升 | 不会。`sourceCategory`、`confidence` 原样透传 | 集成 + 离线 `prov-01`/`xmem-02` |
| 预算不足时是否丢掉当前问题所需的记忆 | 不会。topic 先入，continuity 后被预算挤掉 | `memory-context-assembler.test.ts`「spends a tight budget on the record the question needs」 |

**未做的改动**：没有降低连续性条数上限，也没有把全部活动记忆塞进上下文。审计要求「最小、可解释」的改动，本轮判断现有机制在有标注的前提下成立，因此只补证据与一条预算优先级测试，**不改算法**。§E 第 3 条记录了它仍缺少的语义保证。

---

### B.7 P1 认知与记忆评测的真实断言

逐项核对结果：

| 审计问题 | 修复前 | 修复后 |
|---|---|---|
| 每个 fixture 字段是否被解析 | **否**。`...candidate` 整体透传，只读已知字段 | 是。case / step / memory / expect 全部对白名单封闭 |
| 每个断言是否真正执行 | 是（11 个 expect 字段都有对应代码） | 是，且新增 3 个结构化字段各配可失败测试 |
| 未知字段是否被拒绝 | **否**。拼错 `systemContain` 会静默通过 | 是。`UNKNOWN_FIELD:<case>:<key>` 直接中止 |
| 测试失败是否导致非零退出码 | 是（`process.exitCode = 2`） | 是，未改 |
| 通过数量是否由实际执行结果生成 | 是 | 是，未改 |
| 是否存在只查固定字符串、没查结构的测试 | **是**。`rawContains` / `rawExcludes` 对整包做子串 | 保留（作为补充），新增 `history` 逐位、`excludeContents` 逐消息、`memoryCount` 计数 |
| 是否存在未执行/被跳过的测试 | 未发现 `skip`/`todo` | 未发现，已复核 |
| 离线与真实是否清晰区分 | 有 `offlineExecution`，但报告未显式声明证据等级 | 报告新增 `evidenceClass: 'offline_deterministic_stub'` / `'real_provider'` |
| **错误归因** | **有洞**：只记录「最后一个错误」，第 1 步意外抛错、第 3 步抛出期望错误时，用例仍通过 | 严格化：不允许抛错时任何一步抛错即失败；允许抛错时**恰好一步**抛错、必须是最后一步、错误码必须匹配 |

新增 8 个 schema 用例 + 6 个「断言确实执行」用例（其中 5 个要求失败）。

---

### B.8 P1 Provider 请求与授权边界

| 审计要求 | 结论 | 证据 |
|---|---|---|
| 最终请求体与授权预览一致 | 是。`dispatchToProvider` 收到的是 `preview` 所用的同一个 `input.requestPayload`（`JSON.stringify` 逐字节相等） | `provider-policy.test.ts`「hands the provider exactly the payload that was previewed」 |
| hash 绑定最终请求而非未发送的预览 | 是。`hashProviderInput = sha256(stableJson({endpoint, body}))`，endpoint 与 body 都在内；改 endpoint 也会失效 | 同文件「binds the approval to the endpoint as well as the messages」 |
| 授权过期/内容变化不静默沿用 | 是。过期、内容变更、provider 不符、有效期超 5 分钟均 `invalid_consent`；边界前后 1ms 各测一次 | 同文件「does not extend an approval past its own lifetime」 |
| 密钥不进消息/日志/报告 | 是。密钥只进 `authorization` 头；请求体断言无 `test-only-secret`；离线用例断言无 `evaluation-only-secret`；报告与异常信息都不含请求内容 | `openai-compatible.test.ts`（既有）+ `integ-01/02` + CLI 只输出错误码 |
| 本地 Provider 只能访问回环 | 是。`isLoopbackEndpoint` 要求 URL 文本自证：无凭据段、IPv4 必须 127/8、IPv6 仅 `::1`、不接受 DNS 名、`0.0.0.0`、`169.254.169.254`、`[::ffff:127.0.0.1]`、`ftp:`/`file:`、`127.0.0.1:8080@evil.example`、`127.0.0.256` | 既有 17 个拒绝项 + 6 个接受项，本轮未改 |
| 迟到回调不覆盖新状态 | 是。取消后 `signal.aborted` 在落库前被复查，增量文本不落库；下一轮请求不含被取消内容 | 集成「cancelled turn leaves no partial reply behind」+ 真实 socket `cancel` 场景 |
| 并发不交错 | 是。`locks` 使同会话第二个请求直接 `CONFLICT`，不排队、不拼接 | 既有用例，本轮复核未改 |

**本轮唯一相关的新增代码行为**：`ChatService` 在 `authorize` 前后各 `prepare()` 一次并比较 hash（既有实现）。新增了一个真正触发它的 TOCTOU 用例：在 `authorize` 回调里改人格，第二次 `prepare` 结果不同 → `CONFLICT`，且 `generate` 未被调用、库里没有残留消息。

---

### B.9 P2 评测脚本健壮性

| 审计要求 | 修复前 | 修复后 |
|---|---|---|
| Provider 不可达应以 blocked 退出 | 是（exit 3） | 是，另加：**blocked 时不写报告** |
| 检查失败返回非零 | 是（exit 2） | 是，未改 |
| 报告不得越出允许目录 | **否**。`resolve(root, outputName)` 接受任意路径，可覆盖仓库外文件 | 是。`resolveReportPath`：仅接受 `*.json` 裸文件名、限定 `evaluation/reports`、拒绝 `..`、拒绝符号链接、原子重命名 |
| 报告状态与执行结果一致 | 基本一致 | 是，新增 `checkTotals`、`failureScenarios[].passed = null`（未执行）与 `reportWritten` |
| 敏感信息不入报告/fixture/日志 | 是（已复核） | 是，CLI 异常只输出错误码，不输出 error 对象（fetch 错误可能携带请求） |
| 评测数据与生产数据隔离 | 是（临时目录 SQLite + 内存 secret store） | 是，未改 |
| 记录 endpoint/模型/时间/环境/失败原因 | 部分（无失败原因） | 是，`checks[].failures` 逐条给出 |

三个实测：

```
MORROW_REAL_PROVIDER_OUTPUT='../../evil.json' → exit 1, code INVALID_REPORT_NAME, 仓库外无文件
MORROW_REAL_PROVIDER_ENDPOINT='http://127.0.0.1:9/v1' → exit 3, status blocked, reportWritten false
                                                          且上一次 verified 报告的 sha 未变
```

**blocked 不写报告是刻意的**：blocked 没有产生任何证据，用一份 `blocked` 覆盖掉上一次 `verified` 会销毁唯一的验证记录；写一份看起来像结果的文件则更糟。blocked 的结论通过 stdout 与退出码表达。

---

## C. 测试结果

运行环境：Windows（`win32-x64`）、Node `v22.22.2`、本地 Ollama `http://127.0.0.1:11434/v1`（`qwen2.5:0.5b`）。

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `npm run typecheck` | **0** | 无错误 |
| 2 | `npx vitest run --no-fsModuleCache --maxWorkers=2` | **0** | `Test Files 44 passed (44)` / `Tests 351 passed (351)` |
| 3 | `npm run evaluate` | **0** | `passed: true`（既有三组评估不变） |
| 4 | `npm run evaluate:cognition` | **0** | `passed: true` |
| 5 | `npm run evaluate:companion` | **0** | 31/31，10/10 维度，`replayStable: true`，`stubDispatches: 59`，`networkCalls: 0`，hash `9e192774…` |
| 6 | `npm run build` | **0** | 构建通过 |
| 7 | `npm run verify:real` | **0** | `status: verified`，4/4 轮，**9/9 检查**，3 个真实 socket 失败场景 |
| 8 | `npm run smoke` | **未执行** | 本机 Electron 渲染问题，第一阶段已证伪为环境限制，由 CI 覆盖 |

测试数量变化：**291 → 351（+60）**，文件 **42 → 44**。

| 文件 | 前 | 后 |
|---|---|---|
| `request-assertions.test.ts` | — | 22 |
| `report-path.test.ts` | — | 5 |
| `companion-core.integration.test.ts` | 14 | 29 |
| `companion-core-evaluation.test.ts` | 4 | 17 |
| `memory-context-assembler.test.ts` | 8 | 10 |
| `provider-policy.test.ts` | 7 | 10 |

**没有删除任何既有用例，没有放宽任何既有断言，没有加 `skip`/`only`/`retry`，没有改 `testTimeout`。**

`--maxWorkers=2` 的说明沿用第二阶段报告 §12.3：本机默认并发下 I/O 密集型套件偶发 5000ms 超时（已在未修改的 `origin/main` 上复现），CI 是权威判据。

### C.1 新增测试的「失败能力」

审计要求新增测试必须**能够**失败。逐项证明：

| 断言 | 被破坏时 | 证明 |
|---|---|---|
| 跨会话隔离 | A 的消息进入 B 的请求 | `request-assertions.test.ts` 3 个负向 + 集成端到端 1 个 |
| 历史完整性 | 缺一条 / 顺序反 / 角色错 / 末位错 / 多一条 / 该裁的没裁 | 6 个负向用例逐个覆盖 |
| 失败持久化 | 失败后残留助手消息 / 用户消息丢失 / 内容不符 | 4 个负向 + 集成端到端 1 个 |
| 记忆状态 | 旧文本仍在 / 撤回记录仍进 / 恢复后仍不可用 | 集成 4 个 + 离线 4 个 |
| 敏感度 | 任一路由泄漏 / 撤回后仍进 | 集成 3 个 + 离线 4 个 |
| 未知字段 | 拼错断言名 | 5 个 schema 用例 |
| 错误归因 | 多步抛错 / 非末步抛错 / 该抛未抛 | 3 个用例 |
| 报告路径 | 越界 / 嵌套 / 绝对路径 / 非 json | 5 个用例 |

---

## D. 真实 Provider 证据（三类分离）

> 下面三类证据的强度**不同**，前两类通过**不**意味着第三类通过。

### D.1 链路证据（请求是否真的到达模型服务、内容是否正确）

`status: verified`，4 轮全部完成，9/9 客观检查通过。端点 `http://127.0.0.1:11434/v1`，模型 `qwen2.5:0.5b`。

| 轮次 | 会话 | 请求消息角色序列 | 字节 |
|---|---|---|---|
| turn-1 | A | `system, user` | 1653 |
| turn-2 | A | `system, user, assistant, user` | 2311 |
| turn-3 | A | `system, user, assistant, user, assistant, user` | 2579 |
| turn-4 | B（新建） | `system, user` | 1923 |

turn-3 请求体里逐位还原：`user` 带 `SENTINEL-A7F3` 的原话、turn-1 的助手回复、`user` 带 `SENTINEL-B8E1` 的原话、turn-2 的助手回复、当前提问。**角色、内容、顺序全部逐位匹配**，这是 `multi-turn-history-complete` 检查的对象。

turn-4 非 system 消息**只有 1 条**（当前提问），system 提示词含「林一住在杭州」。A 会话的 3 条用户消息、3 条助手回复、2 个哨兵在 turn-4 请求中**均不存在**。

### D.2 系统行为证据（记忆过滤、历史边界、失败处理）

| 检查 | 结果 | 依据 |
|---|---|---|
| `multi-turn-history-complete` | pass | 三轮逐位匹配，见 D.1 |
| `conversation-isolated` | pass | `nonSystemMessages=1 foreignUser=3 foreignAssistant=3 memoryPresent=true` |
| `memory-reaches-real-model` | pass | system 消息含记忆片段 |
| `personality-in-request` | pass | 主阶段 4 个请求全部含 `version 2` / `warmth 60/100` / `用中文回答` |
| `configured-model-used` | pass | 4 个请求全部声明 `qwen2.5:0.5b` |
| `no-credential-in-body` | pass | 7 个请求体均无 `authorization`/`bearer` |
| `no-fabricated-reply-on-failure` | pass | 3 个真实 socket 失败场景，全部「用户 1 条 / 助手 0 条」 |

失败场景明细：

| 场景 | 触发方式 | 错误码 | 用户/助手消息 |
|---|---|---|---|
| `cancel` | 第一个 delta 到达后调用取消（**确为流中途**） | `PROVIDER_CANCELLED` | 1 / 0 |
| `server-rejected-model` | 请求不存在的模型，服务端真实 404 | `PROVIDER_MODEL` | 1 / 0 |
| `endpoint-unreachable` | 回环端口无监听 | `PROVIDER_NETWORK` | 1 / 0 |
| `auth-rejected` | **未执行** | — | — |
| `timeout` | **未执行** | — | — |

> 取消场景的 note 字段由程序写入：`the first delta arrived, the caller aborted mid-stream, and the partial text was not persisted as a reply` —— 即「确实先收到了增量再取消」，不是「请求还没发出就取消」。

### D.3 模型质量证据

**本阶段不产出质量结论**，`quality.assessed: false`。

本次运行的两个观察项（**仅供信息，不设门禁**）：

- turn-3：回复提到 `林一`、`杭州`、`后端` —— 本轮**答对了**。
- turn-4：新会话、无历史、仅靠注入记忆，回复提到 `杭州`。

**必须同时说明的反例**：在修复前的同一套脚本（`f579897`，旧门禁）运行中，turn-3 的回复是「对不起，我现在不支持用户记忆用户的隐私……」，`林一/杭州/后端` 三项**全为 false**；同一份请求证据显示历史确实送达。

也就是说：**同一个模型、同一套请求结构，一次答对一次答错。** 这正是把「请求里有什么」设为门禁、把「模型做了什么」只作观察的原因——任何依赖模型自述的验证都会因此随机变绿或变红。

`qwen2.5:0.5b` 规模过小，不适合判断陪伴质量；本轮**没有**做质量评估，也没有据此宣称产品可用。

---

## E. 剩余风险

| # | 风险 | 级别 | 状态 |
|---|---|---|---|
| 1 | **认证失败（401/403）与超时未在真实 socket 上验证** | 中 | 未修复。本地 Ollama 正常工作时不产生这两个响应，无法在无凭据、无付费的前提下触发。离线 `fail-auth` / `fail-timeout` 覆盖代码路径，但**不能**替代真实服务端行为。真实报告中二者明确标为 `not_exercised`、`passed: false`。 |
| 2 | **无法验证模型是否使用了上下文** | 高 | 无法在本阶段解决。系统侧只能保证「送达且结构正确」；同一模型同一次会话内即可出现一成一败（§D.3）。 |
| 3 | **冲突记忆没有系统级标记** | 中 | 未修复。两条冲突记录会同时进入请求，靠提示词要求模型说明冲突；系统不生成「互相矛盾」的结构化标记，因此模型可能自行选一条。测试只能证明「两条都在 + 指令在」。 |
| 4 | **`restore` 刷新确认时间** | 低 | 未修复（既有语义）。一条 400 天前的记忆被撤回再恢复后，`lastConfirmedAt` 变为当前时间，不再被标记 stale。属 `transitionMemory` 的既有行为，本轮未改。 |
| 5 | **默认敏感度上限是 `personal`** | 低 | 设计如此，非缺陷，但容易被误解。`personal` 级记忆在普通对话中即发送，只有 `sensitive` 需要逐次显式授权。已在 §B.5 写明。 |
| 6 | 记忆建议（memory-proposal）路径未加测试 | 低 | 代码核对显示其 `context.selected` 为空、只发送用户自己的那条消息，但**本轮未写测试**，不作安全性声明。 |
| 7 | 云端 Provider（DeepSeek）未真实调用 | 中 | 无凭据、未产生任何付费请求。模型名、endpoint、hash 绑定均由离线用例与代码核对覆盖，**真实链路未验证**。 |
| 8 | Windows 安装包未打包 | 中 | 未执行。 |
| 9 | `>12` 轮长对话未实测 | 低 | 真实运行只有 3 轮（4 条历史，不触发裁剪）。裁剪边界由离线 `ctx-02`（20 轮）覆盖。 |
| 10 | 本地 `vitest` 默认并发偶发超时 | 低 | 既有问题（`testTimeout: 20_000` 已在本 PR 前一提交修复）。本轮全部使用 `--maxWorkers=2` 执行。 |
| 11 | 报告路径守卫的符号链接分支未单测 | 低 | `assertNoSymlink` 只在真实符号链接上触发，Windows 上创建符号链接需要额外权限，本轮只做了「不存在路径不误报」的负向对照。 |

---

## F. 本阶段未执行的项目

- 云端 Provider 真实调用（**无凭据，零付费请求**）
- Windows 安装包打包
- 本地 `npm run smoke`（本机 Electron 渲染问题，第一阶段已证伪，由 CI 覆盖）
- 认证失败 / 超时在真实 socket 上的触发（§E 第 1 条）
- 换更大模型复测同一会话
- 超过 12 轮的长对话实测
- 任何质量、可用性、陪伴感评估

---

## G. 偏差与说明

| 偏差 | 原因 | 影响 |
|---|---|---|
| 修改了 `companion-service.ts`（提常量） | 校验方需要与生产实现共用同一个历史边界，否则会漂移 | 纯导出，取值与逻辑不变，无行为影响 |
| 新增了两个模块而非只改一个文件 | 三个门禁需要能被负向测试直接调用，否则「能失败」无法证明 | 见 §B.1.a；这是审计要求的直接后果 |
| 真实失败场景只做了 3 种而非 4 种 | 401 与超时无法用工作中的本地服务触发 | 已标 `not_exercised`，未计入通过，列入 §E |
| blocked 时不再写报告 | 避免用无证据的结果覆盖唯一一份已验证证据 | 行为变更，已在 §B.9 说明理由并实测 |
| 修正了 `ctx-02` 的期望值 | 原期望「窗口从第 15 轮开始」算错了，实际是第 14–19 轮 | **是断言写错，不是放宽标准**：同一用例同时新增了 `excludeContents` 与 `rawContains` 两条更强的断言 |
| `花生` 断言从整包改为 memory 条目 | 用户自己的提问里就有「花生」，整包子串无法区分泄漏与原话 | 断言变强，不是变弱 |

---

## H. 复现

```bash
npm run typecheck
npx vitest run --no-fsModuleCache --maxWorkers=2
npm run evaluate && npm run evaluate:cognition && npm run evaluate:companion
npm run build
npm run verify:real          # 需要本机 ollama serve；不可达时退出码 3 且不写报告

# 负向验证：证明门禁会拒绝越界路径
MORROW_REAL_PROVIDER_OUTPUT='../../evil.json' npm run verify:real    # 期望 exit 1
MORROW_REAL_PROVIDER_ENDPOINT='http://127.0.0.1:9/v1' npm run verify:real  # 期望 exit 3
```

---

## I. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 第 1 版 | 2026-10-26 | 初版，随审计修复提交（代码最后一提交 `7bf2e54`） |
| 第 2 版 | 2026-10-26 | 回填 §A.2 的真实 CI 证据：run **40334673549** @ `b2a16a3`，3/3 Job success。修正 §A.1 中 `request-assertions.test.ts` 的用例数为 22。本行为纯文档提交，不改变任何代码结论。 |
| 第 3 版 | 2026-10-26 | 把「本文件所在提交」改为「**首次引入本文件**的提交」。原措辞在后续纯文档提交后必然失真——任何声称「本文件所在提交 = 某 SHA」的句子在写下时即已过期，故只声明引入提交，不声明当前 head。 |

> 任何提交的 CI 结论都可用 `gh run list --branch feat/phase-2-companion-core --json headSha,conclusion` 按 head SHA 对齐核验；PR #3 的 Checks 页同样按 SHA 分组。本报告只对**已明确写出 SHA 的 run** 作出结论，不对「分支最新」作任何未经核对的推断。
