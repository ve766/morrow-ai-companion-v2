# Phase 2.1 — 基线审计（任务 1）

审计对象：`ve766/morrow-ai-companion-v2`，PR #3。本文只记录本轮**重新核实**的事实，不复用上一轮报告的结论或 SHA。

## 1.1 锁定的工作基线

| 证据 | 值 | 获取方式 |
|---|---|---|
| 仓库 | `https://github.com/ve766/morrow-ai-companion-v2.git` | `git config --get remote.origin.url` |
| 分支 | `feat/phase-2-companion-core` | `git rev-parse --abbrev-ref HEAD` |
| 起点 HEAD | `6bfe9101d18d3121ace3cd7504a2d61b449787eb` | `git rev-parse HEAD`，与本地/远端一致 |
| PR base | `chore/phase-1-engineering-consistency` @ `12f83e19172d02648ff5007ba14fa9ad9d640525` | `gh pr view 3 --json baseRefOid` |
| PR 状态 | OPEN / MERGEABLE / 36 commits | `gh pr view 3` |
| 工作区 | 干净（`git status --short` 无输出） | 同上 |
| 起点 CI | run `40439959438` @ `6bfe910`，success，3/3 Job，attempt 1 | `gh run list --branch … --json headSha` |
| 分支历史失败 | 20 次运行中 1 次失败：run `40322940570` @ `d84dcfa`（Windows `migrations.test.ts` 三个 5000ms 超时） | 同上 |

**旧提交的绿灯不构成本轮证据。** 本轮所有改动都发生在 `6bfe910` 之后，对应 CI 见最终报告 §CI。

## 1.2 真实请求是怎么组装出来的

这是本轮所有审计的落点。`ChatService.send` → `prepare()`（`src/app/companion-service.ts:870`）按固定顺序拼一条 system 消息：

```
[1] 人格：warmth/directness/humor/disagreementStyle + version
[2] 用户自定义风格规则（明确标注不是策略或权限）
[3] 认知引导（由本轮 analysis 决定，按 intent / signals 选择性加入）
[4] 内在状态措辞（仅当认知核心可用且本轮有 feelingEvent）
[5] 长期层：兴趣标签 + （条件性）逐字用户语句
[6] 记忆：记忆 JSON（含 instruction / match / stale / confidence / sourceCategory）
[7] 固定原则（不得声称意识、不得静默改人格、冲突要说明等）
```

随后是 `[8] 截断后的会话历史` + `[9] 本轮用户消息`。授权发生在请求被构建之后、发送之前：`consentPreview` → `authorize` → 重新构建并用 `hashProviderInput` 比对，不一致即 `CONFLICT`（TOCTOU 防护，测试见 `companion-core.integration.test.ts`「refuses to send when the payload changes…」）。

记忆来源固定为 `MemoryService.assembleContext`（`memory-service.ts:154`）→ `MemoryContextAssembler.assemble`（`memory-context-assembler.ts:62`），过滤条件两条：`status === 'active'` 与 `sensitivity <= maximumSensitivity`。

## 1.3 覆盖地图（测试实际断言了什么）

| 模块 | 测试文件／用例数 | 断言的真实对象 |
|---|---|---|
| 请求组装与多轮 | `companion-core.integration.test.ts`（32） | 序列化后的 `exactPayload`，不读数据库行 |
| 记忆上下文 | `memory-context-assembler.test.ts`（10） | 选中集合、`match`、`stale`、字符上限 |
| 记忆服务与迁移 | `memory-service.test.ts`（6）、`migrations.test.ts`（10） | revision、状态机、schema 升级 |
| 备份与删除边界 | `backup-service.test.ts`（15）、`deletion-journal.test.ts`（7） | 恢复后撤回/删除不被复活 |
| 长期层（兴趣／自我模型） | `cognitive-loop.integration.test.ts`（3） | 下一轮 system prompt 是否含该块 |
| 人格 | `companion-core.integration.test.ts`（版本注入／重启／回滚） | 请求中的 version 与四项数值 |
| Provider 策略与凭据 | `provider-policy.test.ts`（10）、`secrets*.test.ts`（8）、`security.test.ts`（10） | 寿命边界、loopback 门禁、无明文落库 |
| 评测器自身 | `context-memory-evaluation.test.ts`（31）、`verdict.test.ts`（10）、`human-review.test.ts`（9） | 数据集校验、判定、复核分离 |

总量：50 个测试文件 / **432 用例**（本轮起点为 413，+19）。

## 1.4 五项分类

### A. 已由源码与测试证明的能力

- 记忆的状态机：`active / retracted` 双向迁移，每次迁移写 revision，`transition` 用 `WHERE revision = ?` 防并发覆盖。
- 撤回与删除的**双层**拦截：SQL（`memory-repository.ts:99` `WHERE status='active'`）+ 汇编器（`memory-context-assembler.ts:73`）。删除则会写 `deletion_journal`，恢复旧备份时重放该日志，被删/被撤回的记忆不会复活。
- 会话隔离：历史来自 `conversations.read(conversationId)`，跨会话串线有一个专门的故障注入测试（「reports a leak when a faulty conversation layer hands conversation A to conversation B」）。
- 敏感度上限：`includeSensitive=false` → `maximumSensitivity='personal'`，`sensitive` 记忆在 topic / continuity / 显式回忆三条路径上都被排除。
- 凭据不入请求体、不入库明文、本地 Provider 只允许回环（URL 文本自证，不做 DNS 信任）。
- 请求级 TOCTOU 防护与按会话互斥锁（同会话第二条并发请求直接 `CONFLICT`）。

### B. 已由真实模型实验观察到的能力

- 跨会话回忆**存在**但**不稳定**：同一请求在同一构建上三次给出三种答案（见 §C）。
- 记忆确实进入请求：所有真机运行的 `not_delivered` 恒为 0，即失败从来不是"系统没给"。

### C. 已观察到的失败与不稳定行为

| 行为 | 观察次数 | 表现 |
|---|---|---|
| 冲突记忆静默选边 | 4/4（`b7`） | 每次只答"用户住在上海"，从不说明两条记忆冲突 |
| 冲突/过期当确定事实 | 4/4（`c4`） | 只给一个城市，且城市在运行间翻转（杭州/杭州/杭州/上海） |
| 过期记忆不降级 | 3/3（`b5`，人工读） | 把 200 天未确认的记忆当现状，其中一次虚构 `confidence:85`（请求中无此约定） |
| 跨会话回忆 | 5 次历史 + 6 次本轮 | 命中与未命中都出现过；同一请求字节三次给三种答案 |
| 自我复述（echo） | 1/5（`b3`） | 回复尾部整段复制 system prompt |

### D. 只有设计、没有实现的能力

- **自我模型不是自我模型。** `explicitSelfFact`（`cognitive-turn-analyzer.ts:30`）匹配的是"我喜欢／我住在／我确诊"，记录内容是 `input.content.slice(0,2000)` 即**用户原话**，注入时却叫"self-knowledge"。这是把用户陈述与陪伴者自身状态混为一谈。
- **人格的"有依据调整"没有实现。** 人格只由用户编辑改变，没有从长期互动中调整的写路径。这是刻意的（单轮对话不得改人格），但意味着"人格会随长期互动演化"目前只是设计意图。
- **冲突记忆没有系统级标记**：`detectConflicts` 只写事件日志，不进请求、不降权，模型只能靠读两条记录自行发现——真机证明做不到。

### E. 本轮认定最值得修复的真实缺陷

按优先级，附可复现依据：

1. **P0 — 逐字用户语句绕过敏感记忆同意。** `buildSelfModelContextBlock` 把最多 3 条用户原话放进**每一次**请求，与 `includeSensitive` 无关；这些字符串没有任何敏感度标注。勾选框对这条通道不生效，且此前**零测试覆盖**。已修（见最终报告）。
2. **P0 — 评测把"提到词"当"回答了"。** 上一轮 7 个 pass 中 2 个不是回答；本轮又观察到"回复复述请求却被判 pass"。已改为四态判定 + 复述检测。
3. **P1 — `b7`/`c4` 的冲突处理是稳定缺陷**，不是采样噪声（4/4）。修复属于产品行为，不在本轮范围，已列入遗留风险。
4. **P1 — 兴趣标签无敏感度分类**，仍可能把敏感话题的 bigram 带进请求。修复需要 `interests` 表加 sensitivity 列（迁移），本轮只记录。

## 1.5 未验证项（本报告不作结论）

- 云端 Provider（DeepSeek）行为：本轮所有真实调用都是本地 `qwen2.5:0.5b`，无凭据、无付费调用。小模型行为不能外推到云端模型。
- 多用户／多设备：不覆盖。
- Electron 打包产物的运行行为：仅由 CI 的 smoke 与升级路径 Job 覆盖。
