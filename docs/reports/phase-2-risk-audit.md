# 第二阶段风险审计（P0 / P1）

**审计基线**：`6348dac5cde5e452ad3027333a7e44893ebbb66c`（PR #3 head）
**审计方式**：读代码 + 实跑 + 突变注入。凡未亲手跑过的，标注为「未验证」而非「通过」。
**结论摘要**：未发现需要修改生产代码的 P0 缺陷；发现 1 个 P0 级测试覆盖缺口（重启后撤回未被验证），已补测试；P1 有 4 项遗留，其中 1 项是既有 CI 不稳定问题。

---

## 0. 证据分级约定

本文每条结论都必须落到下列四类之一，不允许含混：

| 标记 | 含义 |
|---|---|
| **代码确认** | 读过实现，能指出文件与行号，逻辑上必然成立 |
| **测试确认** | 有自动化用例，且该用例被证明「缺陷存在时会变红」 |
| **真机确认** | 本机真实 Provider 实跑得到的行为数据 |
| **未验证** | 没有证据，或只有推理 |

---

## P0-1 记忆纠错、撤回与删除

### P0-1.1 已撤回的记忆是否仍进入最终 Provider 请求

| 项 | 内容 |
|---|---|
| 代码位置 | `src/persistence/memory-repository.ts:99`（SQL `WHERE status='active'`）；`src/memory/memory-context-assembler.ts:73`（`record.status === 'active'`） |
| 复现 | 建一条记忆 → `retract` → 发一轮聊天 → 解析请求 system 消息里的 memory 块 |
| 修复 | 无需修复。**两层独立过滤**均正确 |
| 测试 | `companion-core.integration.test.ts:460`（topic / continuity / retrieve_memory 三条路由 + 唯一哨兵）；`context-memory-v1.json` 的 `b4-retracted` |
| 失败能力 | 突变 M1（移除 assembler 层）→ 仍绿；M1b（移除 SQL 层）→ 仍绿；**M1c（两层同移）→ `b4-retracted` 变红，退出码 2** |
| 结论 | **代码确认 + 测试确认** |

> 这一条的审计价值在于：如果只看到 assembler 那一行就下结论「单点保证」，那么任何删掉 SQL 过滤的重构都会被认为安全。事实相反——两层缺一不可，但缺一层不会立刻暴露。

### P0-1.2 纠错后旧文本是否仍可能出现

| 项 | 内容 |
|---|---|
| 代码位置 | `src/memory/memory-service.ts:165`（`correct` → `transition`，写 revision 并更新 `current_text`）；`memory-context-assembler.ts:92` 只序列化 `currentText` |
| 复现 | 记忆「住上海」→ `correct` 为「住杭州」→ 发「我现在住在哪？」→ 检查请求 |
| 测试 | `companion-core.integration.test.ts:212`（纠正后旧文本消失、新文本出现）；`b3-correction`（纠正后 `contextExcludes: ["上海"]`） |
| 结论 | **代码确认 + 测试确认** |

**能力边界（必须写明）**：纠正只影响**记忆块**。同一会话此前轮次里用户/助手说过的原文仍在 `history` 里，会随窗口一起发送。这不是缺陷——对话记录本来就该保留——但意味着「纠正」不能清除同会话的既有转录。见 §E 遗留 3。

### P0-1.3 删除

| 项 | 内容 |
|---|---|
| 代码位置 | `memory-service.ts:182`（`delete`）→ `memory-repository.ts` 物理删除 |
| 测试 | `companion-core.integration.test.ts:492`「drops a deleted memory on every route」，三条路由全覆盖 + `"memories":[]` |
| 结论 | **测试确认** |

### P0-1.4 记忆更新与请求构建之间的竞态

| 项 | 内容 |
|---|---|
| 代码位置 | `companion-service.ts:783` 首次 `prepare` → `:785` 授权 → `:794` 用最新历史与设置**再次** `prepare` → `:795` `hashProviderInput(verified.input) !== preview.payloadSha256` 则抛 `CONFLICT` |
| 分析 | 记忆在授权弹窗打开期间被改，会让第二次 `prepare` 生成不同 payload，哈希不等 → 拒绝发送。这不是「尽力而为」，是**失败关闭** |
| 测试 | `companion-core.integration.test.ts:675`「refuses to dispatch when the payload changes between the preview and the send」 |
| 结论 | **代码确认 + 测试确认** |

### P0-1.5 重启后失效记忆是否仍被排除 —— **本轮发现的覆盖缺口**

| 项 | 内容 |
|---|---|
| 既有覆盖 | `companion-core.integration.test.ts:179` 覆盖了「敏感记忆重启后仍需授权」，**未覆盖撤回状态的重启持久化** |
| 风险 | 如果撤回归档只在内存里生效（或某次重构把状态写回做成异步/可丢），同进程测试全绿，**下次启动即泄漏** |
| 处理 | **新增测试** `companion-core.integration.test.ts`「keeps a retracted memory out of the request after a restart」：撤回 → 关库 → 重开 → 不再调用任何撤回 → 发一轮 → 断言请求不含哨兵且 `"memories":[]` |
| 失败能力 | 突变 M7（`retract` 返回记录但不写状态）→ 该文件 5 个用例变红，含新增的这一条 |
| 结论 | **测试确认**（缺口已补） |

### P0-1.6 缓存命中路径

项目**没有**记忆文本缓存：`assembleContext` 每轮从 SQLite 读 `listActiveForContext` 并重新装配（`memory-service.ts:154`）。因此「缓存命中导致失效记忆复活」这一失效模式在当前实现里不存在。

这不是「已验证安全」，而是「该路径不存在」。如果将来引入缓存，需要重新审计——已列入遗留。

---

## P0-2 敏感记忆与授权

### P0-2.1 授权范围与上限

| 项 | 内容 |
|---|---|
| 单点决定 | `companion-service.ts:880`：`const max: Sensitivity = request.includeSensitive ? 'sensitive' : 'personal'`。**只有这一处决定上限**，`assembleContext` 只是执行 |
| 第二道门 | `provider-policy.ts:91-113`：派发时从 `input.context.selected` **重新推导**实际最大敏感度，若为 `sensitive` 而 `consent.includeSensitive` 为假 → `sensitive_context_not_approved` → `FORBIDDEN` |
| 分析 | 即使 `prepare` 里把上限算错，派发前也会再拦一次。这是两条独立路径，不是同一判断的两次书写 |
| 测试 | `b2b-authorised-recall` 三轮：未授权（条目 0）→ 授权（以 topic 出现）→ 撤销授权（条目 0）。同一会话链上验证上限**逐轮生效、可撤销** |
| 失败能力 | 突变 M3（上限恒为 `sensitive`）→ 仅 `b2b` 变红 |
| 结论 | **代码确认 + 测试确认** |

### P0-2.2 「库里有就发」是否成立

不成立。默认上限是 `personal`，`sensitive` 类记忆在未显式授权时**条目不进块**（`b2b` 第一轮断言 `memoryEntries: 0`）。`normal` / `personal` 类记忆会被检索，但整份 payload 仍需用户逐轮批准（`authorize` 是必填依赖，`:785` 处 `if (!consent) throw FORBIDDEN`）。

**这里要说准**：`personal` 记忆不是「无需同意就发送」，而是「其内容被包含在需要用户批准的那份 payload 里」。这两者不同，报告不应混淆。

### P0-2.3 敏感内容经日志/错误/报告泄漏

| 检查 | 结果 |
|---|---|
| `real-provider-cli.ts` catch | 只输出 `{ failed: true, code }`，不输出 error 对象（fetch 错误可能携带请求） |
| `context-memory-real-cli.ts` catch | 同上 |
| 已提交报告扫描 | `grep -Ei "api[_-]?key\|bearer \|sk-[a-z0-9]{8,}\|authorization\|password\|<本机用户名>\|E:\\\\\|C:\\\\"` → 无命中 |
| 真实模型报告内容 | 只含 endpoint、模型名、node 版本、平台、回复文本与请求**摘要**（角色序列、条目数、字节数），不含请求原文与凭据 |
| 结论 | **代码确认**（扫描为一次性检查，不是持续保证） |

### P0-2.4 失败关闭测试

| 场景 | 覆盖 |
|---|---|
| 无授权 | `b2b` 第 1 轮；`companion-service.ts:786` `if (!consent) throw FORBIDDEN` |
| 授权撤销 | `b2b` 第 3 轮 |
| 会话范围不匹配 | 敏感记忆在**新会话**里仍需重新授权（`b2b` 三轮均为 `newConversation`） |
| 授权过期 | `provider-policy.ts:101-110`：`expiresAt > now` 且寿命 ≤ 5 分钟；`provider-policy.test.ts:194`「does not extend an approval past its own lifetime」用 1ms 两侧的边界值验证 |

---

## P0-3 跨会话与跨用户隔离

### P0-3.1 跨会话

| 项 | 内容 |
|---|---|
| 机制 | 请求只由「当前会话的 history」+「记忆库」+「当前轮」组成（`companion-service.ts:939-944`）。历史按 `conversationId` 读取 |
| 测试 | `b10-isolation`（新会话请求不含上一会话的工号）；`a5-two-sessions`（第二个会话不含第一个会话的人名）；`companion-core.integration.test.ts:124`「keeps conversations isolated when two sessions run back to back」 |
| 真机 | `verify:real` 的 `conversation-isolated` 检查解析真实请求的 messages 逐个比对 |
| 结论 | **代码确认 + 测试确认 + 真机确认（投递层）** |

**必须写明的边界**：跨会话能带过去的**只有已保存的记忆**。`b10` 断言工号不会跨会话，这不是缺陷而是当前设计——会话内容本身不共享。任何「AI 记得我们上次聊过什么」的宣传都不适用于未保存为记忆的内容。

### P0-3.2 跨用户 —— **不支持，因此不声称**

代码中不存在 `userId` / `tenant` / `account` 维度：`src/shared/companion.ts` 与 `src/persistence/database.ts` 中无相关字段（`grep` 无命中）。这是一个**单用户本地桌面应用**，数据库文件即隔离边界。

因此：

- 本轮**没有**验证多用户隔离，也**不得**在任何材料中声称已验证。
- 真正的隔离边界是「操作系统用户 + 应用数据目录」。若同一 OS 账号下多人共用，应用层不区分。
- 这条列入遗留 5，若产品要走多用户，需要独立的威胁建模，不是补几个测试能解决的。

### P0-3.3 并发与迟到回调

| 场景 | 机制 | 测试 |
|---|---|---|
| 同一会话并发两条 | `companion-service.ts:744` `if (this.locks.has(conversationId)) throw CONFLICT` | `companion-core.integration.test.ts:366`「rejects a second concurrent turn in the same conversation instead of interleaving」 |
| 取消后迟到增量 | `:825` `if (controller.signal.aborted) throw PROVIDER_CANCELLED` —— 在**写助手消息之前** | `companion-core.integration.test.ts`「cancelled turn leaves no partial reply」；`verify:real` 的 `cancel` 真实 socket 场景 |
| 旧请求晚到覆盖新状态 | 每条请求有独立 `requestId`；助手消息按 `turnId` 查找，不按「最后一条」 | `requestId`/`turnId` 查找见 `:827-832` |

**未验证的部分**：取消后，Provider 端可能仍会推送一两个 token，`onDelta` 回调会把它们交给调用方（IPC → 渲染层）。服务层不持久化它们，但**UI 是否会短暂显示**没有自动化证据（没有渲染层测试台）。列入遗留 2。

---

## P1-1 迟到的异步结果与流式增量

已在上表覆盖服务层，此处只记录边界：

- `readStream` 只把 delta 转发给 `onDelta`，不写库。
- 取消后的中止检查在持久化之前，因此「取消却留下半条回复」在当前实现里走不通（有测试）。
- **未验证**：UI 层同一会话内快速切换时，旧回调是否会被渲染到新会话的视图里。这需要渲染层集成测试，本轮不具备条件。

## P1-2 真实 Provider 失败路径

| 场景 | 状态 | 证据 |
|---|---|---|
| 取消（流开始后） | **真机确认** | `verify:real` `cancel`，`PROVIDER_CANCELLED` |
| 模型不存在（真实 404） | **真机确认** | `server-rejected-model`，`PROVIDER_MODEL` |
| 端点不可达 | **真机确认** | `endpoint-unreachable`（`127.0.0.1:9`），`PROVIDER_NETWORK` |
| 认证失败 | **未验证** | 本地 Ollama 无鉴权；标 `not_exercised`、`passed: false`，不计入通过 |
| 超时 | **未验证** | 需要可控慢响应；标 `not_exercised` |
| 空响应 / 异常响应体 | **未验证** | 无确定性模拟服务器；见遗留 4 |

`verify:real` 报告里这两个场景是 `passed: false` 且 `executedAgainst: not_exercised`，含义是「没跑」，**不是「跑挂了」**。报告与 CLI 都把 `null` 与 `false` 分开表达。

## P1-3 请求内容与消息顺序

| 项 | 证据 |
|---|---|
| 角色与顺序 | `request-assertions.ts` 逐位比对；`evaluate:context` 90 条断言中大量 `historyRoles` |
| 历史截断 | `HISTORY_POLICY`（12 条 / 6000 字符）与 `retainedHistoryTail` 共享实现；`history-bound.test.ts` 11 种形状对照 |
| 失败能力 | 突变 M6（窗口 12→1）→ `a1`、`a2`、`b1`、`c5` 变红 |
| 空内容 / 重复消息 | `sendChat` 对空内容抛 `INVALID_INPUT`；`requestId` 幂等（`:749` 同一 `requestId` 内容不同则 `CONFLICT`） |

## P1-4 记忆质量边界

| 边界 | 机制 | 本轮观测 |
|---|---|---|
| 过期 | `isStaleMemory` 180 天（`memory-domain.ts:142`），条目带 `stale: true`，prompt 有对应原则 | 投递正确（`b5`）；真机上模型**未**表达不确定（`c4` 失败） |
| 冲突 | 两条冲突记忆**同时**以 topic 投递 + 冲突原则 | 投递正确（`b7`）；真机上模型直接答「用户住在上海」（`b7` 失败）——静默选边，正是要防的行为 |
| 被纠正的事实 | 只发 `currentText` | 投递正确（`b3`）；真机上模型答「你的位置是哪里？」（`b3` 失败，未使用已投递的杭州） |
| 检索未命中 | 词面得分为 0 的条目降级为 `continuity`，且 prompt 明示「不得当答案」 | 投递正确（`b8`） |
| 无关记忆干扰 | 连续性上限 3 条、不晋升 topic | 投递正确（`b9`，突变 M4 可证） |

**这一节的诚实结论**：系统在**投递**层面把该给的证据和该给的告诫都给了；在**行为**层面，0.5B 模型基本没有兑现。这两件事必须分开报告，见 `phase-3-context-memory-baseline.md` §5。

---

## 本轮新发现的问题（不在原 P0/P1 列表中）

### N-1 Windows 持久化测试超时未根治（P1）

`30b74dd` 把 `testTimeout` 从 5s 提到 20s，理由写得很诚实（I/O 密集、Windows fsync）。但 `c4aecc3` 首轮仍在 **20s** 超时，说明根因不是阈值。

- 影响：CI 偶发红，降低信号可信度；可能掩盖真实回归。
- 未做：没有在本轮调参或改并发（那属于「为修绿而改测试」，任务书禁止）。
- 建议：把 `src/persistence` 的用例改为显式传入超时，或拆分重负载 fixture，并测量单例真实耗时分布。

### N-2 失败状态本身不持久化

`tryRecord` 没有 chat 失败事件，`messages` 表没有 failed 列。因此「失败后的持久化一致性」只能验「用户消息在 / 助手消息不在 / 错误码对不对」，**不能**验「有一条失败记录」。要求一个不存在的字段等于发明语义。列入遗留 6。

### N-3 记忆建议请求的 `maximumSensitivity` 标为 `sensitive`（轻微）

`companion-service.ts:1076`：记忆建议请求的 `context` 是空的（不下发任何记忆），但 `maximumSensitivity` 硬编码为 `'sensitive'`。后果仅是授权预览可能显示「敏感」，属标注问题，不泄漏。未修改（避免为一行展示文案动生产代码）。

---

## 遗留问题与优先级

| # | 问题 | 优先级 | 为什么本轮不修 |
|---|---|---|---|
| 1 | Windows 持久化用例 20s 仍超时 | **P1** | 需先测量而非调参；擅自加超时/重试是掩盖 |
| 2 | 取消后迟到 delta 对 UI 的影响 | P1 | 无渲染层测试台 |
| 3 | 纠正清不掉同会话历史里的既有原文 | P2（语义使然） | 属对话转录语义，非缺陷；需产品决策 |
| 4 | 空响应 / 异常响应体未测 | P1 | 需确定性模拟服务器，工作量独立 |
| 5 | 多用户隔离不存在 | P2 | 产品定位是单用户本地应用；需威胁建模 |
| 6 | 失败状态不持久化 | P2 | 需 schema 变更（v16），超出本轮范围 |
| 7 | 云端 Provider 未真实调用 | P1 | 无授权凭据，且任务书禁止向用户索要 |
| 8 | 记忆建议请求的敏感度标注 | P3 | 仅展示问题 |
| 9 | 冲突记忆无系统级标记 | P2 | 目前靠模型读两条记录自行发现，真机证明不可靠（`b7`） |
