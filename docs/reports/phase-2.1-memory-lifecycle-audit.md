# Phase 2.1 — 记忆生命周期与授权审计（任务 2）

范围：沿真实调用链（`send` → `prepare` → `assembleContext` → 序列化请求）核对十个生命周期场景。断言对象是**最终请求体**，不是数据库行。

## 2.1 十个场景的结论

| # | 场景 | 源码位置 | 自动测试 | 结论 |
|---|---|---|---|---|
| 1 | 新信息形成记忆 | `memory-service.ts:75` `create` | `memory-service.test.ts` | 已证实：写入 `sourceCategory`、`confidence`（直接输入 85 / 推断 60）、`lastConfirmedAt`、revision 1 |
| 2 | 需确认的信息不当作确定事实 | `companion-service.ts:1044`（`model_inferred_confirmed`） | 「never upgrades a model-inferred statement into a user-confirmed fact」 | 已证实：推断来源的 confidence 固定 70，且 `sourceCategory` 进入请求，模型能看到来源差别 |
| 3 | 用户纠正后新旧正确处理 | `memory-service.ts:165` `correct` | 「stops injecting the old text after a correction」 | 已证实：旧文本不再出现，`currentText` 与 revision 更新 |
| 4 | 冲突保留双方而非选一条 | `memory-context-assembler.ts`（两条都进请求） | 「carries both sides of a conflict and the instruction to surface it」 | **系统层已证实，模型层 4/4 失败**（见 §C） |
| 5 | 过期降级或要求澄清 | `memory-domain.ts:142` `isStaleMemory`（>180 天） | 「flags a stale record and instructs the model to voice the doubt」 | 系统层已证实（`stale:true` + 指令）；模型层 3/3 当现状，其中一次虚构 `confidence:85` |
| 6 | 撤回后不再进入请求 | SQL `WHERE status='active'` + 汇编器 `status==='active'` | 「drops a retracted memory on the topic route, the continuity route and the explicit recall route」 | 已证实：三条路由都覆盖，且重启后仍成立 |
| 7 | 删除后不会被旁路重新引入 | `DELETE` + `deletion_journal` | 「drops a deleted memory on every route」 | 已证实：搜索 SQL 也带 `status='active'`；恢复旧备份时重放删除日志 |
| 8 | 用户否认（"那不是我的信息"） | 无自动写路径 | **本轮新增**「does not silently rewrite a memory when the user denies it in conversation」 | 已证实：**系统不自动改写**，记录与 revision 不变，请求带"最新陈述是本轮更正、不得静默改记忆"的指令 |
| 9 | 备份恢复后状态/授权一致 | `backup-service.ts:386` `applyDeletionBoundary` | 「keeps memories deleted after the backup out of the model context after restore」等 4 条 | 已证实：撤回/删除被重放，未撤回的被恢复为 active |
| 10 | 事务失败不产生部分写入 | `transition` 带 `WHERE revision = ?`；`deletion-journal` | 「leaves the original database intact and reopenable when the swap fails」 | 已证实（备份换库路径）；记忆状态机为单语句 CAS，无多表部分写 |

场景 8 是本轮唯一新增的测试，因为它此前完全没有覆盖，而它决定了"用户说记错了"时系统会不会自作主张。

## 2.2 授权边界：三条通道，两条有门禁

这是本轮最重要的发现，也是唯一的 P0 生产代码修复。

| 通道 | 内容 | 是否受 `includeSensitive` 约束 | 修复前 |
|---|---|---|---|
| 记忆 | 记忆 JSON（含 `sensitivity`） | 是，`maximumSensitivity` 过滤 | 正常 |
| 兴趣标签 | 单个 bigram 主题词 + 置信度 + 证据次数 | 否（无 sensitivity 标注） | 保留，已记录残余风险 |
| 逐字用户语句 | `input.content.slice(0,2000)`，最多 3 条 | **否，且完全未检查** | **已修：未授权时不注入** |

`explicitSelfFact`（`cognitive-turn-analyzer.ts:30`）匹配 "我喜欢 / 我住在 / 我偏好 / 我确诊"，命中后把**用户原话**存成 `kind:'fact'`，注入时标签是 "self-knowledge"。也就是说：勾选框只对记忆生效，用户原话走的是另一条完全不受控的路。

复现与修复证据：「withholds verbatim user statements unless the turn is authorised for sensitive content」（`cognitive-loop.integration.test.ts`）。该用例写入一条含"抑郁症"的原话，断言 `includeSensitive:false` 的请求里不含该词、且兴趣块仍在（证明是定向关闭而非整块删除），`includeSensitive:true` 时才出现。

## 2.3 哪些字段真的被消费

| 字段 | 消费点 | 副作用是否存在 |
|---|---|---|
| `confidence` | 排序（`confidence/50`，最多 2 分）+ 进入请求 | 是 |
| `lastConfirmedAt` | `isStaleMemory` 的参考时间 + 排序 recency | 是 |
| `updatedAt` | 参考时间回退 + 排序 | 是 |
| `revision` | 进入请求，供模型区分版本 | 是 |
| `sourceCategory` | 进入请求；决定默认 confidence | 是 |
| `sensitivity` | 汇编器过滤 | 是（记忆通道） |
| `status` | SQL 与汇编器双重过滤 | 是 |
| `match`（topic/continuity） | 进入请求 + 指令区分 | 是 |
| `stale` | 进入请求 + 指令 | 是 |
| 自身模型 `confidence` | 进入请求文本 | 是 |
| 自身模型 `sensitivity` | **不存在该字段** | **否——本轮修复的是它的后果** |

## 2.4 检索失败时的降级

`prepare` 把认知与记忆装配包在 `try` 里，失败时 `memory = undefined`，随后在 `companion-service.ts:929` 回退到 `assembleContext(content, max)`（不做意图扩写）。也就是说：认知层失败会**降级为纯词面检索**，不会发出空记忆的请求，也不会抛错中断聊天。

这一条没有测试直接覆盖（需要注入一个会抛错的 MemoryService）。**列为未验证项**，理由：需要构造破坏性替身，本轮时间预算用于更关键的授权缺陷。

## 2.5 本节遗留风险

1. **兴趣标签无敏感度分类**（P1）。标签是单个 bigram，保真度远低于整句，但仍可能把"抑郁"一类话题带进默认请求。修复需要给 `interests` 加 sensitivity 列（迁移 v16），本轮只记录。
2. **"用户否认"没有对话内的处理路径**（P1）。系统不误改，但也**不提供**"要不要撤回这条？"的一步操作；用户必须自己进记忆管理界面。这是产品缺口，不是数据缺陷。
3. **冲突没有系统级标记**（P1）。`detectConflicts` 只写事件，请求里两条记录并列，靠模型自己发现——4/4 失败。
