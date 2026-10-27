# Phase 2.1 — 多轮对话与持久化风险（任务 6）

## 6.1 逐项核对

| 场景 | 机制 | 证据 | 结论 |
|---|---|---|---|
| 快速连发多条 | 会话级 `locks`：同会话第二条立即 `CONFLICT` | 「rejects a second concurrent turn in the same conversation instead of interleaving」 | 已证实 |
| 同会话两请求交错返回 | 同上；`controllers` 每会话一个，覆盖前先 abort | 同上 + `cancel` 测试 | 已证实 |
| 切换会话后旧请求才返回 | 响应写入按 `requestId` 定位，不按"当前会话" | `requestId` 贯穿 `send` → `appendMessage` | 已证实（设计层） |
| Provider 超时 | 45s `setTimeout` → abort → `PROVIDER_TIMEOUT` | 「separates caller cancellation from the request timeout」 | 已证实 |
| Provider 拒绝/断开/异常格式 | `PROVIDER_RESPONSE`（无 stream 结束标记、空文本、>100KB） | 「rejects empty and malformed responses without inventing a reply」「rejects a truncated stream…」 | 已证实 |
| 用户重试同一请求 | `requestId` 相同 → 若已有 assistant 直接返回；用户文本变了则 `CONFLICT` | `companion-service.ts:747-773` | 已证实 |
| 记忆写入失败但回复已返回 | 失败被 `catch`，降级为"保留回复、不更新状态" | 「keeps the user turn, drops the partial text, and does not poison the next request」 | 已证实 |
| 请求或持久化中断 | 助手消息只在完整回复后写入；中止则不留半句 | 同上（断言 `afterCancel.filter(role==='assistant')` 为空） | 已证实 |
| 重启恢复历史 | 全部来自 SQLite，重开即读 | 「survives a restart: the memory and the conversation are still used afterwards」 | 已证实 |
| 多会话并行记忆隔离 | 记忆**全局**（跨会话回忆的前提）；消息历史按会话隔离 | `checkCrossSessionIsolation` | 已证实（隔离指消息与授权，不指记忆可见性） |
| 事务失败恢复 | 备份换库失败时保留原库可重开 | 「leaves the original database intact and reopenable when the swap fails」 | 已证实 |
| 备份恢复与 schema 升级 | v9 起为最低兼容版本；pre-journal 备份需显式确认 | 「restores a pre-journal backup only with explicit acknowledgement」 | 已证实 |

**本轮没有找到这一类的新缺陷。** 这不是因为检查得少，而是因为上一轮已把这块补过一轮，且失败路径几乎都有专门的故障注入用例。

## 6.2 本轮真机观察到的一条真实故障

`20261027T034149Z-35fd58` 的 `b3` 第二轮返回 `PROVIDER_RESPONSE`（回包无法解析），该用例被判 `needs_review` 而不是 `fail`。这正是上一轮拆 `error` / `failed` 的目的：**Provider 抖动不能被记成模型答错**。

同一现象在其他运行里没有复现（`T034200Z`、`T034212Z` 均正常），因此记为偶发，未作修复。

## 6.3 一个未被测试覆盖的降级路径

`prepare` 里认知/记忆装配失败会降级为纯词面检索（`companion-service.ts:923-929`），但**没有测试**注入一个会抛错的 `MemoryService`。当前属于"读代码可确认、自动测试未覆盖"。

风险等级：低（`assembleContext` 只依赖本地 SQLite 查询，抛出需要数据库层故障，而数据库层故障会先在别处暴露）。列为未验证项。

## 6.4 仍然存在的结构性问题（不在本轮修复）

- **同会话串行是硬互斥**：用户在模型响应期间再发一条会直接被拒（`CONFLICT`），UI 需要自己排队。这不是数据缺陷，是交互限制，已在上一轮风险清单里。
- **`requestId` 由客户端生成**：恶意或错误的 `requestId` 复用会命中幂等分支并返回旧回复。已被"内容不同即 `CONFLICT`"限制住，但同内容重放仍会拿到旧回复——这是幂等的本意。
