# Phase A 基线审计：Morrow V2.1 认知算法底座与记忆检索

- 审计对象仓库：`ve766/morrow-ai-companion-v2`
- 审计分支：`feature/algorithm-v2-phase-a`
- 基线分支：`main`
- 基线 SHA：`8b207b7d7b80b91ed4369d02fd6ef7e170b81133`
- 审计时工作区状态：干净（`git status --porcelain` 为空）
- 审计方法：直接阅读当前 `HEAD` 的源码、测试与 CI 运行记录；**未**依赖 README、历史验收报告或先前对话。

> 本报告的每一条结论都附带文件、函数或测试证据。分类严格遵循任务约定：
> **已实现且真实生效** / **已实现但只部分接线** / **仅有接口或测试替身** / **尚未实现** / **需要实验验证**。
> 「接口存在」不等于「功能闭环成立」。

---

## 0. 结论摘要

| 编号 | 结论 | 分类 |
|---|---|---|
| A | 检索流程 = SQL 取最近 1000 条 → 词法打分 → 置信度/新近度加成 → 排序 → 贪心装预算。无候选生成的多路召回，无重排，无去重/多样性 | 已实现且真实生效（但能力单薄） |
| B | 置信度参与打分；来源只做展示不参与打分；最近确认时间参与衰减；纠正链只靠「原地覆盖文本」；删除状态靠 `status` 过滤 + 硬删除 | 部分接线 |
| C | 用户明确表达与模型推断有 `sourceCategory` 区分并进入上下文文本，但**不影响排序**；「用户确认」只体现在 `lastConfirmedAt`/`confidence` | 部分接线 |
| D | 人格、内在状态、兴趣、自我模型均真实进入 Provider 请求上下文 | 已实现且真实生效 |
| E | 事件日志可复用；算法版本仅存在于评测器；确定性重放**未**覆盖检索；幂等有；评测器与生产检索**完全脱耦** | 部分接线 |
| F | 迁移 15 个版本；备份/恢复有删除边界日志；`memories` 表无 scope/uncertainty/kind 列 | 已实现且真实生效（与算法升级存在约束） |
| G | CI 在 `main` 上**红**：`ubuntu-latest` 的 Electron smoke 失败；Windows 两个 job 绿 | 实际执行且失败 |
| H | 评测集 11 例，仅 precision/recall/泄漏计数；无 MRR/NDCG；不测生产算法 | 仅有接口或测试替身 |

---

## 1. 模块与真实调用路径核对

实际布局与任务描述基本一致，但有差异需要记录：

| 任务描述路径 | 实际路径 | 说明 |
|---|---|---|
| `src/cognition/` | 存在 | `cognition.ts`、`cognitive-turn-analyzer.ts`、`cognitive-settings.ts` |
| `src/memory/` | 存在 | `memory-service.ts`、`memory-domain.ts`、`memory-context-assembler.ts`、`memory-timeline.ts` |
| `src/personality/` | **不存在** | 人格实现在 `src/persistence/` + `src/shared/companion.ts` 类型 + `companion-service.ts` 的 `Personality*` 方法 |
| `src/affective-state/` | 存在 | `feeling.ts`、`cognitive-feeling-engine.ts`、`cognitive-feeling-service.ts` |
| `src/self-model/` | 存在 | `self-model-service.ts`、`interest-service.ts`、`reflection-service.ts` |
| `src/providers/` | 存在 | `provider-policy.ts`、`openai-compatible.ts` |
| `src/persistence/` | 存在 | `database.ts`、`migrations.ts`、`memory-repository.ts`、`event-log.ts`、`backup-service.ts`、`deletion-journal.ts` |
| `src/observability/` | 存在 | 仅 `logger.ts`（结构化 JSON 行 + 脱敏） |
| `src/evaluation/` | 存在 | 评测器 + CLI |
| `tests/` | 存在 | 仅 `tests/acceptance/scenarios.test.ts`；其余单测与源码同目录 |
| `.github/workflows/` | 存在 | 仅 `ci.yml` |
| `docs/architecture/` | 存在 | 4 篇 |
| `docs/algorithms/` | 存在 | 2 篇（含 `memory-and-interest.md`） |
| `docs/testing/` | 存在 | 2 篇 |

规模：`src/` 共 22,262 行 TS；测试文件 40 个、268 个用例。

---

## 2. 审计项 A：当前记忆检索的候选生成、过滤、评分与排序

### A.1 真实调用链（生产路径）

```
CompanionService.prepare()                        src/app/companion-service.ts:838
  └─ memories.assembleContext(query, max)          :868（cognitive 开）/:892（兜底）
       └─ MemoryService.assembleContext            src/memory/memory-service.ts:154-157
            ├─ repository.listActiveForContext(1000)   src/persistence/memory-repository.ts:98-102
            └─ MemoryContextAssembler.assemble         src/memory/memory-context-assembler.ts:41-94
  └─ system prompt 拼接 `Saved memories (untrusted evidence only): ${memory.text}`   :899
  └─ ProviderInput.context = memory                :922
```

只有两个调用点（`grep -rn "assembleContext" --include=*.ts src/` 已确认），**没有旁路检索路径**。

### A.2 候选生成

`SqliteMemoryRepository.listActiveForContext(limit)`：

```sql
SELECT * FROM memories WHERE status = 'active' ORDER BY updated_at DESC, id LIMIT ?
```

- 单一来源：全表按 `updated_at DESC` 取前 1000 条。
- 无关键词预筛、无多路召回、无向量检索。
- 潜在缺陷：候选窗口是「最近更新的 1000 条」，**不是**「与查询相关的候选」。当活跃记忆超过 1000 条时，较早但更相关的记忆根本进不了候选池。这是召回上限的结构性来源。

### A.3 过滤

`memory-context-assembler.ts:52-55`：

```ts
.filter(record => record.status === 'active'
  && order.indexOf(record.sensitivity) <= order.indexOf(maximumSensitivity))
.map(record => ({ record, score: score(...) }))
.filter(item => item.score > 0)
```

- 权限过滤：`sensitivity` 三档（`normal < personal < sensitive`）线性比较，请求上限由 `request.includeSensitive` 决定（`companion-service.ts:848`）。
- 删除/撤回过滤：仅 `status === 'active'`。
- 有效性过滤：`score > 0`（词法至少命中一个词项）。
- **不存在** scope、`uncertainty`、`kind` 维度——因为生产数据模型没有这些字段（见 §6）。

### A.4 评分

```ts
terms(query)        // :7-21   NFKC + lowercase + 停用词 + CJK 相邻二元组，上限 64 项
score(content, q, phrase)  // :23-28
  = (phrase.length >= 2 && content.includes(phrase) ? 4 : 0)
  + count(term => content.includes(term))
rankScore(item, now)       // :34-39
  = item.score + record.confidence / 50 + 2 * 0.5^(ageDays / 30)
```

- 词法分理论上界：`4 + 64`（phrase 4 分 + 最多 64 个词项各 1 分）。
- 置信度贡献上界 `2.0`（confidence 100/50）。
- 新近度贡献上界 `2.0`，30 天半衰期，参考点 `lastConfirmedAt ?? updatedAt`。
- 因此**词法占绝对主导**（最高 68 分 vs 非词法最高 4 分）。置信度与新近度只能在词法接近时打破平局，无法翻转「词法命中多但已过期/低置信」与「词法命中少但刚确认」的对比。

### A.5 排序

`memory-context-assembler.ts:56-59`：

```ts
.sort((l, r) => rankScore(r, now) - rankScore(l, now)
  || r.record.updatedAt.localeCompare(l.record.updatedAt)
  || l.record.id.localeCompare(r.record.id))
```

平局规则三级：分数 → `updatedAt` 降序 → `id` 升序。**在 `now` 固定时是确定性的**。

### A.6 预算裁剪

`memory-context-assembler.ts:61-93`：`maxMemories = 25`、`maxCharacters = 3000`（默认参数）。逐条尝试加入，编码后长度超限则跳过（不是停止），最终 `omitted = eligible.length - selected.length`。

- 该「跳过而非停止」行为有测试覆盖：`memory-context-assembler.test.ts:48-55`（超长候选不得挤掉后续可放入的候选）。
- 无去重、无多样性控制。语义重复的记忆会同时占满预算。

### A.7 A 项结论

**已实现且真实生效**，但能力边界明确：

- 有：候选生成、权限/删除过滤、多信号（词法+置信度+新近度）打分、确定性排序、预算裁剪。
- 无：语境重排、去重、多样性、决策记录、指标统计。

---

## 3. 审计项 B：置信度、来源、最近确认时间、纠正链、删除状态是否真正参与检索决策

| 信号 | 是否参与排序 | 证据 | 判定 |
|---|---|---|---|
| 置信度 `confidence` | **是** | `memory-context-assembler.ts:38` `confidence/50` | 已实现且真实生效（权重极低） |
| 来源 `sourceCategory` | **否** | 仅在 `encode()` 的 JSON 中输出（`:64-73`），`rankScore` 不读取 | 仅展示，不参与决策 |
| 最近确认时间 `lastConfirmedAt` | **是** | `:35` `lastConfirmedAt ?? updatedAt` 进入 30 天半衰期衰减 | 已实现且真实生效 |
| 纠正链 | **仅原地覆盖** | `memory-domain.ts:107` `currentText = transition.content`；旧文本只留在 `memory_revisions` | 部分接线（见 B.2） |
| 删除状态 | **是（两条路径）** | `status === 'active'` 过滤；`delete()` 为硬删除 `memory-repository.ts:148-154` | 已实现且真实生效 |
| 过期 `MEMORY_STALE_DAYS = 180` | **否** | `isStaleMemory` 定义于 `memory-domain.ts:142`，全仓仅被 `memory-extensions.test.ts:128-130` 调用 | **仅有接口或测试替身** |

### B.1 `docs/algorithms/memory-and-interest.md` 的声明与代码的差距

文档写道：「系统只在检索排序上保证『纠正后的版本』以更高新近度胜出」。

代码事实：`transitionMemory` 在 `correct` 时把 `lastConfirmedAt` 刷新为 `changedAt`（`memory-domain.ts:134`），且 `currentText` 被替换。因此在**同一 memory id 内**该声明成立。

### B.2 纠正链的真实缺口（关键发现）

纠正只改写了**同一条记录**的文本。系统没有记录「哪条陈述被哪条陈述取代」的跨记录关系。后果：

1. 用户先存「我喜欢喝绿茶」，随后纠正为「我现在喜欢喝红茶」。记录 `m1.currentText = '我现在喜欢喝红茶'`，旧文本只存在于 `memory_revisions[0]`。
2. 之后用户（或模型建议经用户接受）再次说出「我喜欢喝绿茶」→ `create()` 的归一键（`normalizedMemoryKey`）与 `m1.currentText` **不同**，`memory-service.ts:85-92` 的去重不会命中 → **新建一条 active 记录 `m2`**。
3. 此时 `m1`（红茶）与 `m2`（绿茶）都是 active，词法分接近，排序只能靠 `updatedAt`/`id` 平局规则决定。被纠正的旧事实**以新记录的形式复活**，没有任何机制识别它是已被取代的陈述。

这不是理论问题：`tests/acceptance/scenarios.test.ts:163-184` 的 scenario B 只验证了「同一 id 原地纠正」，**没有覆盖**上述跨记录场景。

### B.3 冲突检测是建议性的，且未接入排序

`detectConflicts`（`memory-service.ts:116-135`）在共享 ≥2 个显著词项时记 `memory.conflict_flagged` 事件，但：

- 唯一生产调用点是「接受记忆建议之后」`companion-service.ts:1020`；
- 返回的 `conflictsWith` 只用于审计，**不进入检索**；
- 用户手工创建的记忆完全不触发冲突检测。

### B.4 B 项结论

**部分接线**。置信度/最近确认时间/删除状态真实生效；来源与过期标记不生效；纠正链只在单记录内成立，跨记录复活是真实缺口。

---

## 4. 审计项 C：是否区分用户明确表达、模型推断、用户确认、已被纠正

数据模型层面有区分：

- `MEMORY_SOURCE_CATEGORIES = ['user_explicit_input', 'model_inferred_confirmed', 'turn_derived_confirmed']`（`memory-domain.ts:6`）。
- 初始置信度按来源分档：显式 85 / 推断经确认 70 / 轮次派生 60（`memory-service.ts:80`；`docs/algorithms/memory-and-interest.md` 表格一致）。
- 模型推断**不能**直接入库：必须经 `MemorySuggestionService.review` 接受（`companion-service.ts:1011-1028`），接受时以 suggestion id 作 `correlationId` 记审计事件。

但检索决策层面**不区分**：

- `rankScore` 不读 `sourceCategory`；一条 85 分的 `user_explicit_input` 与一条 85 分的 `model_inferred_confirmed` 排序完全相同。
- 「用户确认」只通过 `confirm()` 提升 `confidence`（+5，上限 100）与刷新 `lastConfirmedAt` 间接影响排序，没有独立的「确认」信号。
- 「已被纠正」在检索中没有可识别的标记（见 B.2）。

**结论：部分接线。** 区分存在于存储与提示词文本，未进入排序决策。

---

## 5. 审计项 D：内在状态、人格、兴趣、自我模型如何进入 Provider 请求上下文

全部真实进入，且都有断言到实际 payload 的测试。

`CompanionService.prepare` 组装 `system`（`companion-service.ts:893-901`）：

| 组成 | 代码位置 | 数据来源 | 测试证据 |
|---|---|---|---|
| 人格（warmth/directness/humor/disagreementStyle + systemRules） | `:894-895` | `this.personality.get()` → `personality_profiles` | `companion-service.test.ts:230-247` |
| 认知回合解读与策略引导 | `:896` `cognitivePromptGuidance(analysis)` | `analyzeCognitiveTurn` | `companion-service.test.ts:336-345` |
| 内在状态（feeling）引导 | `:897` `feelingPromptGuidance` | `CognitiveFeelingService` | `companion-service.test.ts:336-339`；scenario G |
| 自我模型块 | `:898` `this.selfModel?.contextBlock()` | `SelfModelService` | scenario G/H |
| 记忆上下文 | `:899` | `MemoryContextAssembler` | `companion-service.test.ts:341` |
| 固定原则 | `:900` | 常量 | — |

关键约束已被测试固定：

- feeling 块声明「不是 Morrow 的内部状态」（`:336`）。
- 认知引导长度 ≤1200 且不回显用户原文（`:343-345`）。
- 认知与 feeling 默认关闭，需显式开启（`companion-service.test.ts:330-331`）。

**结论：已实现且真实生效。** 这一层是本阶段唯一不需要改造的闭环。

---

## 6. 审计项 E：事件日志、算法版本、确定性重放、幂等、评测器可否复用

### E.1 事件日志：可复用

- `MorrowEvent` 结构（`event-log.ts:16-27`）含 `sourceModule`、`eventType`（命名空间化，正则 `^[a-z0-9_-]{2,32}(\.[a-z0-9_-]{2,32}){1,3}$`）、`actor`、`subjectType/subjectId`、`correlationId`、`payload`。
- 校验很严：payload ≤32 字段、单值序列化 ≤2000 字符（`event-log.ts:73-78`）。
- `tryRecord` 吞掉异常，永不阻断业务（`:123-129`）。
- 记忆模块已通过 `MemoryEventSink` 接口解耦注入（`memory-service.ts:27-29`），**不需要**新建平行日志体系。
- 已用事件类型：`memory.created`、`memory.created_inferred`、`memory.corrected`、`memory.retracted`、`memory.restored`、`memory.confirmed`、`memory.conflict_flagged`。

**缺口：没有任何检索决策事件。** 无法回答「这次为什么选了这 5 条」。

### E.2 算法版本：只在评测器里

- `COGNITIVE_ANALYZER_VERSION = 'rules-v2'`（`cognition.ts:5`）——认知分析器有版本。
- 检索算法**没有版本标识**。`MemoryContextAssembler` 是单例类，参数（25 条 / 3000 字符 / 30 天半衰期 / 权重 4、50、2）**硬编码在方法默认参数与函数体里**（`memory-context-assembler.ts:37-38,46-48`），没有集中配置，没有范围校验，无法新旧对比。
- 旁证：`companion-service.ts:77` 的 `maxMemoryContextCharacters = 3000` 是**未被使用的死常量**——阈值事实上散落在两处且不同步。这正是任务禁止的形态。

### E.3 确定性重放：检索路径不满足

- 组装器接受 `now` 参数（`:48`），传入固定值时是确定性的。
- 但 `MemoryService.assembleContext`（`memory-service.ts:154-157`）**没有把 `this.clock()` 传给组装器**，组装器退回 `new Date().toISOString()`。`MemoryService` 明明注入了 `clock`（`:70`）却不用于检索。
- 后果：同一份数据、同一份查询，跨时刻调用会产生不同排序（新近度项随时间变化）。**检索无法重放**。
- 幂等：`sendChat` 有 `requestId` 幂等键；记忆转移有 `revision` 乐观锁（`memory-repository.ts:132-146`）。这部分可用。

### E.4 评测器：与生产检索完全脱耦

`docs` 与报告 `limitations` 明确写着（`offline-evaluation.ts:651`）：

> 「The evaluator reads only the named synthetic dataset and algorithm JSON specs; it does not open the production memory database or call a model.」

代码事实：

- `runBaseline`（`:344-352`）是**独立重写**的 ASCII 小写子串匹配，连 `sensitivity` 都不过滤。
- `runCandidate`（`:354-390`）是**独立重写**的 token 覆盖率匹配。
- 二者都不 import `MemoryContextAssembler`，都不碰 `MemoryRepository`。
- `candidateActivation: { state: 'offline-review-only', activated: false, automaticPromotion: false }`（`:640`）——评测结果从不影响线上。

因此现有 `npm run evaluate` 输出的「baseline 0.4 / candidate 1.0 precision」比较的是**两个玩具算法**，不是「生产算法 vs 新算法」。**不能**作为本次升级的验收证据。

### E.5 E 项结论

**部分接线**：事件日志可复用（这是唯一被真正复用的基础设施）；算法版本、确定性重放、评测器与生产脱耦三项都不满足需求。

---

## 7. 审计项 F：SQLite 迁移、备份恢复、事件日志、删除边界对算法升级的约束

### F.1 迁移

`migrations.ts` 共 **15** 个版本（`grep "version: [0-9]*,"` 确认到 `version: 15`）。全部 `STRICT` 表 + `CHECK` 约束。

`memories` 表当前列（迁移 2 定义，后续迁移追加）：

```
id, original_text, current_text, source_category, status,
created_at, updated_at, revision, sensitivity, confidence, last_confirmed_at
```

**没有** `scope` / `uncertainty` / `kind` / `applicable_scopes`。

**约束结论**：新增检索算法**不应**为了对齐评测器模型而改表结构。评测器的 `scope`/`uncertainty`/`kind` 是评测专用概念，生产没有对应数据。正确做法是：算法只使用生产真实存在的字段，评测集也必须使用同样的字段语义。

### F.2 备份/恢复与删除边界

- `deletion_journal` 记录 `deleted` / `retracted` / `unretracted`（`deletion-journal.ts:8`）。
- `transition()` 与 `delete()` 都会写入（`memory-repository.ts:143-144,151`）。
- 恢复时按 `recorded_at` 合并，新的覆盖旧的（`mergeDeletionJournal`），并把 journal 一并写回 staged 库（`backup-service.ts:392-393`）。
- 备份校验包含 `deletionJournalEntries` 计数（`:115-116,352`）。

**对算法升级的约束**：任何新检索路径都必须继续以 `status` 为唯一权威的删除判据，不得从 `memory_revisions` 里「捞回」已撤回内容——`memory_revisions` 在 `delete()` 时因 `ON DELETE CASCADE` 一并删除，但 `retract()` 只改 `status`，**revisions 仍然完整保留**。这是「已撤回记忆从备用路径泄漏」的真实风险面。

### F.3 F 项结论

**已实现且真实生效**，但给出了明确约束：算法升级只能消费现有列；撤回内容仍存在于 `memory_revisions`，新算法必须显式拒绝把非 active 记录的修订当作可用证据。

---

## 8. 审计项 G：CI 真实状态

`gh run list` 显示 `main` 上最近 3 次运行全部 `failure`。最新一次 `40204094648`（`8b207b7`）的分 job 结果：

| Job | 结果 | 说明 |
|---|---|---|
| Typecheck, tests, build and smoke (ubuntu-latest) | **失败** | 仅 `Electron smoke` 步骤失败；Typecheck / 40 文件 268 用例 / Offline evaluations / Build 全部通过 |
| Typecheck, tests, build and smoke (windows-latest) | 通过 | 同一套步骤，smoke 输出 `Morrow smoke passed: ...` |
| Windows upgrade path (schema migrations under the real app) | 通过 | `npx vitest run src/persistence` |

Linux 失败的确切信息（`gh api .../jobs/121201219126/logs`）：

```
Morrow smoke failed during M5 secure Provider credential save, restart persistence,
and explicit deletion without network access:
The password field must clear after each save attempt.

false !== true
```

判定：

- **与本次算法升级无关**（M5 是 Provider 凭据保存的 UI 断言）。
- 属于渲染/时序类断言在 Linux + xvfb 下的不稳定，而非被削弱的真实回归。
- **不得**通过删除该断言或跳过该步骤来「修绿」。本阶段只如实记录，不做掩盖。

---

## 9. 审计项 H：现有评测数据与指标的覆盖度

### H.1 数据

`evaluation/fixtures/retrieval-v1.json`：**11 个案例**、`datasetVersion 1.0.0`、`source: synthetic`、`seed: 1729`。

案例 id：`explicit-green-tea`、`restricted-account-detail`、`scope-bound-work-detail`、`retracted-memory`、`deleted-tombstone`、`unverified-expectation`、`explicit-current-fact`、`no-evidence-unknown`、`ordinary-preference`、`explicit-sensitive-opt-in`、`injected-text-is-data`。

覆盖到的：权限/scope/撤回/删除/未知/提示注入。
**未覆盖**的（对应任务 §5 要求）：

- 多轮对话中的重复偏好
- 用户明确纠正旧信息（跨记录）
- 新旧事实冲突竞争
- 过期信息 vs 近期信息竞争
- 长期偏好 vs 当前临时需求冲突
- 同主题大量重复记忆
- 多主题对话的相关记忆召回
- 低置信度推断 vs 高置信度陈述竞争
- 长对话上下文预算限制
- 跨会话/跨重启一致性

### H.2 指标

`AlgorithmMetrics`（`offline-evaluation.ts:69-87`）只有：precision、recall、sourceAttributionAccuracy、unsupportedRate、各类 leak 计数、crossSampleConsistencyViolations。

**没有** MRR、没有 NDCG@K、没有排序位置类指标、没有去重率、没有主题覆盖、没有预算超限次数、没有过期误召回率。由于不产出排序位置评分，无法判断「纠正后的信息是否排在旧信息之前」这类顺序问题——而这恰恰是本次升级的核心。

### H.3 现有评测实际运行结果（本轮实测）

```
npm run evaluate
→ passed:true, cases:11,
  baselinePrecision 0.4, baselineRecall 1,
  candidatePrecision 1, candidateRecall 1,
  candidateSourceLeaks 0, candidateScopeLeaks 0,
  candidateRestrictedLeaks 0, candidateUnknownLeaks 0,
  m2Safety true, deterministicHash 209d8d37…
```

注意 `baselinePrecision 0.4`：这是**独立重写的** ASCII 子串匹配，连敏感度都不过滤，**不是**生产组装器。生产组装器的 precision 未被任何评测测量过。

### H.4 H 项结论

**仅有接口或测试替身**（就「衡量生产检索质量」这一目标而言）。评测框架的结构（schema 校验、确定性 hash、gate、limitations 自述）质量很高、可以复用；但被测对象与指标集都不满足本阶段要求。

---

## 10. 缺口清单（决定第二阶段要做什么）

按「只补真正缺失的能力」原则，逐项判定：

| 缺口 | 现状 | 是否本阶段必须补 | 理由 |
|---|---|---|---|
| 检索算法版本标识 | 无 | **是** | 新旧对比的前提；`docs` 已宣称算法但代码无版本 |
| 集中式类型安全参数配置 + 范围校验 | 无（阈值硬编码，且有死常量） | **是** | 任务 §3.1 明确禁止阈值散落 |
| 检索决策结构化追踪 | 无（事件日志可用但无检索事件） | **是** | 任务 §3.2；复用 `MemoryEventSink`，不建平行日志 |
| 检索确定性重放 | 部分（组装器可，服务不可） | **是** | 把 `clock()` 接进 `assembleContext` 即可，成本极低 |
| 跨记录纠正链识别 | 无 | **是** | 语义规则 §4.3.2 的硬要求；也是 B.2 的真实缺陷 |
| 去重与多样性 | 无 | **是** | §4.1 步骤 5；同主题重复记忆会挤占预算 |
| 生产算法的对照评测（Recall@K/MRR/NDCG/泄漏/过期/重复/覆盖/预算） | 无 | **是** | §4.4 + §5；现有评测器不可用 |
| 覆盖 12 类场景的固定评测集 | 11 例、缺 10 类 | **是** | §5 |
| 请求上下文闭环集成测试（纠正 + 删除 + 重启） | 部分（scenario B 只到 service 层） | **是** | §6 明确要求验证最终请求上下文 |
| 语义（向量）相似度 | 无 | **否** | §4.3.6：不存在语义模型时不得伪造 |
| 在线自动调参 | 无 | **否** | §3.1 明确禁止 |
| 表结构变更（scope/uncertainty/kind） | 无 | **否** | 生产无对应数据；为对齐评测器改表属于重复建设 |
| 人格/内在状态/兴趣/自我模型改造 | 已闭环 | **否** | §8 明确不做 |
| 微服务/消息队列/新数据库 | 无 | **否** | §3.4 禁止 |

---

## 11. 本阶段不做什么（与任务 §8 对齐）

- 不重写人格、内在状态、兴趣、自我模型、反思算法。
- 不引入 Agent 控制系统。
- 不新增付费 API 调用、不默认开启网络。
- 不把工程计算出的内在状态表述为主观意识。
- 不以「新增目录/文档/测试数量」冒充认知能力提升。

---

## 12. 下一步

1. 最小底座：版本化配置 + 决策追踪 + 确定性时钟接线（复用事件日志）。
2. 新检索算法：保留现有组装器为 v1 基线，新增 v2（多信号 + 纠正链 + 去重/多样性），二者共用同一策略接口。
3. 评测：新建**跑生产代码**的对照基准，指标含 Recall@K / MRR / NDCG@K / 纠正排序正确率 / 泄漏 / 过期误召回 / 重复率 / 主题覆盖 / 预算超限，并输出逐案例结果。
4. 闭环：断言最终 Provider 请求 payload，覆盖纠正、删除、重启。
5. 只有在基准上可验证收益、且无安全退化时，才把 v2 设为默认；否则保留 v1 并记录实验结果。
