# Morrow V2 · 第二阶段工作报告：真实 AI 陪伴核心闭环

| 项 | 值 |
|---|---|
| 报告日期 | 2026-10-26 |
| 仓库 | `github.com/ve766/morrow-ai-companion-v2` |
| 工作分支 | `feat/phase-2-companion-core` |
| 阶段基线 | `12f83e1`（第一阶段分支 `chore/phase-1-engineering-consistency` 的头提交，其基线为 `main` @ `8b207b7`） |
| `main` 基线 | `8b207b7` |
| 本阶段提交 | `137113f` → `4b52731` → `5425653` → `ec53fb8`（核心源码）→ `30b74dd`（`testTimeout` 修复 + 报告修根因）→ `a8f82ab`、`aa2642b`、`d84dcfa`、本次（均为文档） |
| Pull Request | **#3** — https://github.com/ve766/morrow-ai-companion-v2/pull/3 |
| PR 状态 | **OPEN / 未合并**（等待人工审查与审计，按任务要求停止） |
| PR base | `chore/phase-1-engineering-consistency`（**堆叠 PR**，理由见 §15.2） |
| CI 运行 1 | [run 40321367137](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40321367137) @ `a8f82ab` — **success**（3 / 3 Job） |
| CI 运行 2 | [run 40321933436](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40321933436) @ `aa2642b` — **attempt 1 失败**（windows-latest 1 个 5000ms 超时，290/291）→ **attempt 2 success**（3 / 3 Job，未改代码） |
| CI 运行 3 | [run 40322940570](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40322940570) @ `d84dcfa` — **失败**（windows-latest 3 个 5000ms 超时，全在 `migrations.test.ts`，288/291） |
| CI 运行 4 | [run 40323987426](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40323987426) @ `30b74dd`（修 `testTimeout` 后）— **success**（3 / 3 Job） |
| CI 实测 | ubuntu-latest **42 文件 / 291 测试通过**；windows-latest **42 文件 / 291 测试通过**；windows 升级路径 6 文件 / 47 测试通过；双平台 smoke `Morrow smoke passed`；`evaluate:companion` 双平台 21/21、`replayStable: true`、`networkCalls: 0` |
| CI 抖动处置 | **已修**：`vitest.config.ts` 设 `testTimeout: 20_000`（原默认 5000ms）。**未改任何断言、未跳过任何测试、未降低并发**。完整失败记录与归因见 §12.4 |
| CI 覆盖范围 | **仅限 `.github/workflows/ci.yml` 定义的检查项**；**不含**真实 Provider 对话、**不含**安装包打包、**不含**任何质量评估（见 §1.2、§17 Q8） |
| 真实 Provider 验证 | **已执行并通过**：`status: verified`，4 / 4 轮，9 / 9 项客观检查 |
| 真实 Provider 环境 | 本机 Ollama `http://127.0.0.1:11434/v1`，模型 `qwen2.5:0.5b`（**0.5B 小参数模型**） |
| 本机测试 | `42` 文件 / `291` 测试通过（`--no-fsModuleCache --maxWorkers=2`） |
| 离线评估 | 3 组全部通过（`evaluate` / `evaluate:cognition` / `evaluate:companion`） |
| 云端 Provider 真实调用 | **未执行**（无凭据，未产生任何付费请求） |
| Windows 安装包 | **未执行**（本阶段未打包） |

本报告中的每一条事实都对应一次本次实际执行的命令输出。凡未执行、失败或无法验证的项目，均在 §12.5 与 §14 单独列明，**不与通过项混写**。模型自己说的话不作为记忆、情绪或人格的证据——所有关于「记忆是否进入请求」「人格是否进入请求」的结论，都来自**被拦截并序列化的请求体本身**，不来自模型自述。

---

## 1. 阶段目标与完成情况

目标：把 Morrow 从「有聊天、人格、记忆三个模块的桌面应用」变成「一次真实的多轮对话里，模型真的收到上下文、真的收到记忆、人格真的被表达、说错的话真的能被纠正」的陪伴核心。

| # | 工作包 | 状态 | 说明 |
|---|---|---|---|
| A | 真实模型交互 | **已完成** | 复用既有 `OpenAICompatibleProvider`（真实 `fetch` + SSE），本阶段未重写；用真实本地服务验证 4 轮 |
| B | 跨轮次上下文 | **已完成** | 顺序、隔离、重启、并发冲突均有测试；真实请求体已证实逐轮增长 |
| C | 连续记忆 | **已完成（含两处真实缺陷修复）** | 修复「普通轮次不注入任何记忆」与「零词面重叠记忆永不召回」两个缺陷（§2） |
| D | 稳定人格 | **已完成** | 人格版本与取值进入每一个请求；编辑、重启、从修订记录恢复均有测试 |
| E | 反馈修正 | **已完成** | 纠正后旧文本不再注入；撤回后整条记录不再注入；删除即失效；模型推断不得被静默升格 |
| F | 失败与边界 | **已完成** | 认证失败 / 超时 / 取消 / 并发 / 凭据泄漏 / 回环路由 全部覆盖 |
| G | 评估集、报告与 PR | **本文件 + PR #3** | 新增 10 维度 21 用例评估集，真实 Provider 验证记录随仓库提交 |

**完成状态的准确表述**：本阶段交付的**系统侧闭环**（上下文、记忆、人格、修正、失败处理）已经实现并被两级证据覆盖——离线确定性评估（可复现、无网络）与真实本地模型的客观检查（真请求、真响应）。但**这仍然不是「真实陪伴能力已验收」**：

- 真实模型是 **0.5B 小参数模型**，它在同会话回忆测试中**未能使用已送达的历史**（§7.4、§11.1）。这是模型能力边界，不是系统缺陷，但也意味着**「模型会用上下文」这件事在本地环境没有拿到正面证据**；
- 对话质量、人格表达的自然度、长期使用中的记忆负担，`quality.assessed` 明确为 `false`，**没有任何质量结论**；
- 云端 Provider、Windows 安装包、真实用户可用性均未验证（§12.5）。

CI 全绿的准确含义见 §1.2。

### 1.1 本阶段新建立的两级证据结构

这是本阶段最重要的方法论改动：**把「系统做到了什么」和「模型表现如何」拆成两类证据，只有前者设门禁。**

| 证据类型 | 是否设门禁 | 内容 | 存放位置 |
|---|---|---|---|
| **客观检查（checks）** | **是**，任一失败即 `status: failed` | 请求是否到达服务端、是否携带上一轮原文、是否携带记忆、是否声明了配置的模型、请求体是否含凭据、失败时是否伪造回复 | `evaluation/reports/real-provider-conversation-report.json` |
| **观察项（observations）** | **否**，只记录不判定 | 模型是否复述了人名 / 城市 | 同上 |
| **质量结论（quality）** | **不产出** | `assessed: false` + 说明为什么小模型不能作为质量证据 | 同上 |

这么做的原因很直接：如果把人名复述设成门禁，0.5B 模型一失败，整条验证就变成红色，而系统其实完全正常；反过来，如果把模型复述当成「记忆有效」的证据，就等于用模型自述证明记忆在工作——任务明令禁止。**唯一既诚实又能自动化的做法，是只对「请求里到底有什么」设门禁。**

### 1.2 「通过」的准确含义

本报告所有「通过」字样，均限定在下列范围内：

- **离线评估通过** = 在确定性 stub Provider 上，21 个用例的 10 个维度断言全部成立，且两次运行结果哈希一致（`replayStable: true`），且 `networkCalls: 0`。它证明**系统行为可复现、逻辑正确**，不证明**真实模型会照做**。
- **真实 Provider 验证通过** = 9 项客观检查成立，即**请求已正确组装并真的送达真实服务端**。它不证明回复内容好、不证明模型用了上下文。
- **测试通过** = 代码在断言层面符合预期。
- **CI 通过** = 仅 `.github/workflows/ci.yml` 定义的那几项检查通过。

**以上任何一项都不能单独推出「这是一个可用的 AI 陪伴产品」。**

---

## 2. 工程勘察结论：三个真实缺陷

按任务要求，先勘察再动手。勘察不是读代码猜，而是写探针脚本在真实链路上打印**实际发出去的请求体**。三个缺陷都是这样被抓到的。

### 2.1 缺陷 1（严重）：普通轮次从未注入任何记忆

`src/app/companion-service.ts` 的 `prepare()` 原来是：

```ts
memory = this.memories.assembleContext(firstPass.strategy === 'retrieve_memory' ? retrievalQuery : '', max)
```

只有认知分析器把这一轮判为「显式回忆」时，查询串才是当前这句话；其余所有情况（也就是**绝大多数日常对话**）查询串是空字符串 `''`。空串与任何记忆的词面重叠都是 0，于是 `assemble()` 内部的 `score > 0` 过滤把**全部记忆**丢掉。

后果非常具体：**用户保存了「我住在杭州」，下一轮说「今天有点累」，请求里一条记忆都没有，陪伴体表现得像第一次见面。**

探针证据（修复前）：

```
payloadHasHangzhou=false   // 普通轮次
payloadHasHangzhou=true    // 仅显式回忆轮次
```

修复：查询串**永远**是当前这一轮；显式回忆路由只是在它之上**加宽**（追加被引用消息与上一轮用户消息），而不是「只有它才查」。

### 2.2 缺陷 2（严重）：零词面重叠的记忆永远召回不到

`MemoryContextAssembler.assemble()` 的 `eligible` 直接是 `.filter(item => item.score > 0)`，而 `score` 是纯词面（token 交集 + 短语包含）。**没有任何语义成分**。

于是「林一住在杭州，做后端开发」这条记忆，在用户说「有点累」时**永远**不会进入上下文——不是排序靠后，是根本不在候选里。

修复：新增**有界的连续性层（continuity）**。零重叠记录按**结构性顺序**补最多 3 条：用户确认过的优先 → 置信度高优先 → 参考时间新优先 → id 兜底。这个排序**不读时钟**（时间字段来自记录本身），因此可重放、可断言。

为什么是有界的小补丁而不是重写检索：任务明确禁止改记忆召回算法。连续性层是**在既有算法之外补一个漏口**，不改原有打分、不改排序、不改 `maxMemories` 语义。用构造参数 `new MemoryContextAssembler(0)` 可以完全退回旧行为，并且这条退化路径**有单独的测试**（见 `memory-context-assembler.test.ts`）。

### 2.3 缺陷 3（中等）：澄清路由的提示词与实际上下文自相矛盾

原提示词在 `clarify` 路由下写的是：

> Ask one concise clarifying question instead of guessing **or retrieving long-term memories**.

它向模型承诺「没有检索记忆」。但修复缺陷 1 之后，记忆**总是**在上下文里。这句话会让模型在明明看到记忆的情况下仍然假装什么都没看到，或反过来被上下文与提示词的矛盾带偏。

修复：改为「列出的是背景，但**不构成回答模糊指代的许可**；不要用记忆替代提问」。语义上把「记忆存在」和「该不该用它消解歧义」拆开。

### 2.4 勘察中确认「本来就是真的」的部分（未改动）

避免误伤，明确记录：以下能力经勘察确认为真实实现，本阶段**未重写**。

- `OpenAICompatibleProvider` 是真实 `fetch` + SSE 流解析（含 `[DONE]` 终止符）、45s 超时与调用方 `AbortController` 分离、错误码映射（401/403→`PROVIDER_AUTH`、429→`RATE_LIMIT`、404→`MODEL`、408/504→`TIMEOUT`）。**不是 mock。**
- TOCTOU 防护：`prepare()` → 用户同意 → **再次** `prepare()` → 比对 SHA-256 才发送。
- 本地 Provider 回环门禁 `security/url-gate`：由 URL 文本自证回环，**不做 DNS 信任**。
- 记忆域的状态机（`active` / `retracted`）、来源分类（`user_explicit_input` / `model_inferred_confirmed` / `turn_derived_confirmed`）、`revision`、`lastConfirmedAt`、`MEMORY_STALE_DAYS = 180`。
- 人格的版本化（`personality_profiles` + `personality_revisions`，`changeType: user_edit | restored`）。

---

## 3. 代码改动清单

改动规模：**20 个文件，+2089 / −19 行**（`git diff 12f83e1..ec53fb8 --stat`，不含本报告）。

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/app/companion-service.ts` | 修改 | 缺陷 1 修复（+ 3 条 `fixedPrinciples` + 澄清提示词改写） |
| `src/memory/memory-context-assembler.ts` | 修改 | 缺陷 2 修复：连续性层 + `match` / `stale` 标注 |
| `src/shared/companion.ts` | 修改 | `ContextMemory` 增加 `match: 'topic' \| 'continuity'` 与 `stale?: boolean` |
| `src/memory/memory-context-assembler.test.ts` | 扩充 | 3 → 8 个测试（连续性、topic/continuity 排序、上限/撤回/敏感排除、`(0)` 退化、stale 标注） |
| `src/providers/provider-policy.test.ts` | 修改 | fixture 补 `match` 字段（类型要求） |
| `src/app/companion-core.integration.test.ts` | **新增** | 14 个端到端测试，断言**请求体**而非数据库 |
| `src/evaluation/companion-core-evaluation.ts` | **新增** | 10 维度评估执行器（450 行） |
| `src/evaluation/companion-core-evaluation.test.ts` | **新增** | 4 个测试：维度全覆盖、可重放且零网络、未知维度拒绝、重复 id 拒绝 |
| `src/evaluation/companion-core-cli.ts` | **新增** | 评估 CLI（路径越界 / 符号链接 / 原子写） |
| `src/evaluation/evaluation-secret-store.ts` | **新增** | 无头 `SecretStore`（避免把 Electron `safeStorage` 拖进 bundle） |
| `src/evaluation/real-provider-conversation.ts` | **新增** | 真实 Provider 验证驱动（checks / observations 分离） |
| `src/evaluation/real-provider-cli.ts` | **新增** | 退出码 0 已验证 / 2 失败 / 3 已阻塞 |
| `evaluation/fixtures/companion-core-v1.json` | **新增** | 21 个用例 / 10 维度 |
| `scripts/run-companion-core-evaluation.mjs` | **新增** | `npm run evaluate:companion` |
| `scripts/run-real-provider-conversation.mjs` | **新增** | `npm run verify:real` |
| `evaluation/reports/real-provider-conversation-report.json` | **新增** | 真实请求 SHA-256、字节数、消息角色、回复原文 |
| `evaluation/reports/cognitive-alpha-adversarial-report.json` | 重新生成 | 澄清提示词变长（281→380 字符），报告记录该事实，门禁仍 `passed: true` |
| `package.json` | 修改 | 新增 `evaluate:companion`、`verify:real`，`verify` 链加入第三组评估 |
| `.github/workflows/ci.yml` | 修改 | 离线评估步骤加入 `npm run evaluate:companion` |
| `.gitignore` | 修改 | 允许提交真实 Provider 验证报告 |
| `vitest.config.ts` | 修改 | `testTimeout: 20_000`（原为默认 5000ms）。**唯一一处超出工作包 A–F 的改动**，原因见 §12.4 |
| `README.md` | 修改 | 验证命令块、`verify:real` 语义与「退出码 3 = blocked 不算通过」 |

**未改动**：记忆召回的打分函数、人格算法、内在状态算法、授权策略、任何数据库迁移（无 v16，无 schema 变更）、任何新依赖、**任何测试断言**、**任何测试的跳过标记**。

---

## 4. 七个产品原则分别落在哪里

| 原则 | 落点 | 可核对的证据 |
|---|---|---|
| 不假装记得 | 无记忆时 `memories: []` 且提示词要求「Do not invent user facts」 | 集成测试 `states that nothing is known…`；用例 `unk-01/02` |
| 不假装有感受 | 内在状态是计算变量，提示词禁止宣称主观体验 | 既有 `fixedPrinciples`（未改）+ `evaluate:cognition` 门禁 |
| 不静默改人格 | 人格只由用户编辑路径写入 | 集成测试 `puts the stored personality and its version…`；`persists…/restores` |
| 不越权决策 | 权限与同意策略未改 | 既有 `provider-policy` 测试 7 项，断言**未改**，仅补了 fixture 的 `match` 字段 |
| 修正必须生效 | 纠正替换文本、撤回整条失效 | `stops injecting the old text after a correction…`；`corr-01`/`ret-01`/`del-01` |
| 冲突要显式 | 新增原则：记忆互相矛盾时**说出来**，不静默择一 | `conflict-01`；`fixedPrinciples` 新增行 |
| 不确定要说 | 陈旧记忆要表达疑虑而非断言 | `match`/`stale` 标注 + `stale-01` |

---

## 5. 工作包 A–F 的逐项交付说明

### A · 真实模型交互

未重写 Provider（勘察确认其为真实实现，§2.4）。本阶段做的是**让它可被真实服务验证**：新增 `verify:real`，直接驱动**生产代码路径**（`CompanionService.sendChat`）打到真的在监听的 OpenAI 兼容服务。

关键设计：验证器**不替换 Provider**，只在 `authorize` 回调里截获 `preview.exactPayload`——即**真正会被发出去的那份字节**。因此报告里的 `requestSha256` / `messageRoles` / `containsMemory` 全部来自真实请求，不是构造出来的期望值。

### B · 跨轮次上下文

| 断言 | 证据 |
|---|---|
| 同一会话逐轮累积且顺序正确 | 集成测试 `carries earlier turns … in order`；真实请求 roles 从 `[system,user]` 增长到 `[system,user,assistant,user,assistant,user]` |
| 会话之间隔离 | `keeps conversations isolated…`；真实 turn-4 为新会话，字节数 1923 ≠ turn-3 的 2149 |
| 重启后仍可用 | `survives a restart…`（真实 SQLite 重开） |
| 并发不交错 | `rejects a second concurrent turn…`（`CONFLICT`） |
| 预算有界 | `maxHistoryMessages = 12`、`maxHistoryCharacters = 6000`、`MAX_PROVIDER_PAYLOAD_BYTES = 64_000`（未改） |

### C · 连续记忆

两处缺陷修复（§2.1、§2.2）+ 每条记忆附带 `match` 与 `stale` 元信息。

上下文容量：零重叠补位最多 3 条，整体仍受 `maxMemoryContextCharacters = 3000` 与 `MAX_PROVIDER_PAYLOAD_BYTES = 64_000` 约束。**代价是每轮多几百字节**，实测 turn-3 请求 2149 字节、turn-4 请求 1923 字节，远低于上限。

### D · 稳定人格

`personality-in-request` 检查在**真实请求体**中同时找到 `version 2`、`warmth 60/100`、`用中文回答`。人格编辑后版本递增，重启后保持，可从修订记录恢复（`changeType: restored`）。

### E · 反馈修正

- **纠正**：`memories.correct()` 后，旧文本不再出现在请求里，新文本出现。
- **撤回**：`status: 'retracted'` 后整条记录不进候选（`assemble` 的 `status === 'active'` 过滤）。
- **删除**：记录消失，后续请求不再含其内容。
- **不升格**：模型推断的陈述（`sourceCategory: 'model_inferred_confirmed'`）不会被静默改写成 `user_explicit_input`，`revision` 不变。
- **冲突**：两条记忆矛盾时，提示词要求明确说出冲突，优先最近一次用户确认，必要时反问。

### F · 失败与边界

| 场景 | 期望 | 证据 |
|---|---|---|
| 401 / 403 | 抛 `PROVIDER_AUTH`，**不存 assistant 轮次** | `propagates an authentication failure and stores no assistant turn`；`fail-auth` |
| 超时 | `TIMEOUT`，不伪造回复 | `fail-timeout` |
| 用户取消 | `CANCELLED`，不写半截消息 | `fail-cancel` |
| 凭据 | 请求体无 `authorization` / `bearer` | 真实检查 `no-credential-in-body`；集成测试同名用例 |
| 回环 | 本地 Provider 只允许回环端点 | `routes a local provider request only to a loopback endpoint…` |
| 载荷完整性 | `payloadSha256` 与同意时一致 | `integ-01/02/03` |

---

## 6. 新增离线评估集：`companion-core-v1`

### 6.1 十个维度与用例分布

| 维度 | 用例数 | 用例 id |
|---|---|---|
| `multi_turn_context` | 2 | `ctx-01`, `ctx-02` |
| `cross_session_memory` | 2 | `xmem-01`, `xmem-02` |
| `correction_update` | 1 | `corr-01` |
| `retraction_invalidation` | 2 | `ret-01`, `del-01` |
| `stale_conflict` | 2 | `stale-01`, `conflict-01` |
| `personality_consistency` | 2 | `pers-01`, `pers-02` |
| `intent_clarify` | 2 | `clar-01`, `clar-02` |
| `uncertainty_no_evidence` | 2 | `unk-01`, `unk-02` |
| `provider_failure` | 3 | `fail-auth`, `fail-timeout`, `fail-cancel` |
| `payload_integrity` | 3 | `integ-01`, `integ-02`, `integ-03` |
| **合计** | **21** | |

### 6.2 这次评估的自我披露

评估结果自带出口自证，避免「通过」被误读：

```json
"offlineExecution": { "stubDispatches": 47, "networkCalls": 0, "networkGuarded": true, "providerClass": "deterministic_stub" }
```

即：这次通过是 **47 次 stub 派发、0 次网络调用**换来的。固定时间 `2026-10-26T00:00:00.000Z`、确定性 id 工厂，因此两次运行结果哈希必须一致（`replayStable: true`）。

**防御性设计**（属主动加固，非任务要求）：
- 未知维度**拒绝执行**而不是记 0 分——防止维度改名后评估静默空转；
- 重复用例 id **拒绝执行**——防止新增用例被旧用例遮蔽。

---

## 7. 真实 Provider 多轮验证记录

### 7.1 环境

| 项 | 值 |
|---|---|
| 端点 | `http://127.0.0.1:11434/v1`（Ollama，回环） |
| 模型 | `qwen2.5:0.5b` |
| 服务端可见模型 | `nomic-embed-text:latest`, `qwen2.5:0.5b` |
| 凭据 | 无（本地服务不需要） |
| 人格设置 | `warmth 60` / `directness 70` / `humor 15` / `balanced` / `用中文回答，尽量简短。` |
| 运行命令 | `npm run verify:real` |
| 结果 | `status: verified`，`turnsRequested 4 / turnsCompleted 4 / turnsFailed 0` |

### 7.2 逐轮请求证据（来自被拦截的真实请求体）

| 轮 | 会话 | 用户输入 | 请求字节 | 消息角色 | 含记忆 | 回复字符 |
|---|---|---|---|---|---|---|
| 1 | a | 我叫林一，住在杭州，做后端开发。 | 1621 | `system,user` | 否 | 57 |
| 2 | a | 我平时喝手冲咖啡。 | 1882 | `system,user,assistant,user` | 否 | 47 |
| 3 | a | 你还记得我叫什么、住在哪里、做什么工作吗？ | 2149 | `system,user,assistant,user,assistant,user` | 否 | 74 |
| 4 | **b（新会话）** | 我住在哪里？ | 1923 | `system,user` | **是** | 12 |

> 说明：第 1 轮不存在「上一轮」，其 `containsPreviousUserTurn` 为真空通过，不作为证据。真正的证据是第 3 轮——字节数从 1882 增长到 2149，角色从 4 条增长到 6 条，且请求体中**确实包含**第 1、2 轮的用户原文。

### 7.3 九项客观检查（全部通过，这是门禁）

| 检查 | 结果 | 明细 |
|---|---|---|
| `provider-reachable` | ✅ | 服务端返回模型列表 |
| `first-turn-answered` | ✅ | 真实 HTTP 调用返回非空回复（57 字符） |
| `multi-turn-context` | ✅ | turn-3 请求 2149 字节 > turn-2 1882 字节，且含前两轮原文 |
| `conversation-isolated` | ✅ | 新会话 1923 字节 ≠ turn-3 的 2149，含记忆、不含旧会话 |
| `memory-reaches-real-model` | ✅ | 请求体含「林一住在杭州」 |
| `personality-in-request` | ✅ | 含 `version 2`、`warmth 60/100`、`用中文回答` |
| `configured-model-used` | ✅ | 声明模型 `qwen2.5:0.5b` |
| `no-credential-in-body` | ✅ | 请求体无 `authorization` / `bearer` |
| `no-fabricated-reply-on-failure` | ✅ | 失败轮次数 0，无「报错却存了回复」的情况 |

### 7.4 观察项（**不设门禁**，仅记录）

| 观察 | 实际内容 |
|---|---|
| 同会话回忆 | turn-3 模型回复：「对不起，我现在不支持用户记忆用户的隐私。我们可以使用更高级的隐私设置或创建一个完全信任的关系来保护您的隐私……」——**未提到林一 / 杭州 / 后端任何一项**，尽管这三项都在它收到的请求体里 |
| 跨会话回答 | turn-4（新会话，无历史、只有记忆）模型回复：「**我住在杭州，做后端开发。**」——正确使用了注入的记忆 |

这两条并列出现，恰好说明了为什么要分级：同一套系统，同一次运行里，模型在一次回忆上失败、在另一次上成功。**系统侧（请求组装）两次都是对的。**

### 7.5 该验证不能证明什么

- 不能证明回复「好」、人格「自然」、用户「会觉得被陪伴」；
- 不能证明换更大的模型就一定通过同会话回忆（未测）；
- 不能代表云端 Provider 的行为（未测）。

`quality.assessed` 恒为 `false`，就是为了不让这份记录被当成质量验收。

---

## 8. 记忆是否真的影响后续回复？

分三层回答，不含糊：

| 层次 | 结论 | 证据 |
|---|---|---|
| **记忆是否进入请求** | **是，已确证** | 真实请求体含「林一住在杭州」（turn-4）；集成测试在 4 种场景下断言 `exactPayload` 含记忆原文；离线评估 `xmem-01/02` |
| **记忆是否在模型可见的位置** | **是** | 记忆位于 `messages[0]` 的 system 内容中，不仅是「在某个字段里」；`messageRoles` 与 SHA-256 记录了完整载荷 |
| **模型是否据此改变了回复内容** | **部分确证** | turn-4 回复「我住在杭州，做后端开发」直接来自记忆，且该会话无任何历史 → 这个回答的**唯一**信息来源就是记忆。而 turn-3 失败，说明不是必然 |

**关键区分**：本阶段能保证的是「记忆被正确、稳定、可审计地送达模型」；**不能**保证「模型一定用」。后者是模型能力，换模型才可能改变。

另外要说明一处容易被误读的地方：修复前，记忆「是否送达」这件事本身是坏的（§2.1、§2.2 两个缺陷）。所以本阶段之前，任何关于「记忆有效」的说法都缺少最基础的前提。**现在这个前提成立了。**

---

## 9. 人格是否进入请求并跨会话保持？

| 问题 | 结论 | 证据 |
|---|---|---|
| 人格进入请求？ | **是** | 真实请求体同时含 `version 2`、`warmth 60/100`、`用中文回答`；集成测试断言每个请求都带版本号 |
| 跨会话保持？ | **是** | 新会话（turn-4）请求同样携带人格版本与取值；`personality_consistency` 维度 2 个用例 |
| 跨重启保持？ | **是** | 集成测试 `keeps the personality across a restart and restores it from a recorded revision`（真实 SQLite 重开 + 从修订记录恢复） |
| 编辑后生效？ | **是** | `pers-01/02`：编辑后版本递增，新取值出现在下一请求 |
| 模型是否「表达」了人格？ | **未评估** | 0.5B 模型的表现不足以作为人格表达质量的证据；`quality.assessed: false` |

人格是**只由用户编辑改变**的：模型、情绪、单轮对话都没有写入路径。这一点本阶段未改动，也未放宽。

---

## 10. 纠正 / 撤回后是否停止使用旧信息？

| 操作 | 期望 | 结论 | 证据 |
|---|---|---|---|
| 纠正（改内容） | 旧文本不再出现，新文本出现 | **成立** | 集成测试 `stops injecting the old text after a correction and the whole record after a retraction`；`corr-01` |
| 撤回（`status: retracted`） | 整条记录不进候选 | **成立** | 同上；`ret-01`（候选集层面断言，不是只看数据库字段） |
| 删除 | 记录消失，后续请求不含其内容 | **成立** | `del-01` |
| 模型推断被「确认」 | 不得静默升格为用户明述 | **成立** | `never upgrades a model-inferred statement into a user-confirmed fact`；`xmem-02` |
| 冲突 | 显式说出冲突，不静默择一 | **提示词层面成立，模型层面未评估** | `conflict-01`；`fixedPrinciples` 新增行 |

要强调的一点：这些断言检查的是**请求体中不再出现旧内容**，不是「数据库里 `status` 字段变了」。前者才是「停止使用」的判据。

---

## 11. 认知闭环仍然断裂的地方（已知问题，未修）

按严重度排序。前三条是本阶段**新发现**的，后几条是既有债务。

| # | 问题 | 严重度 | 状态 / 说明 |
|---|---|---|---|
| 1 | **模型收到上下文却不使用**（turn-3） | 高 | 系统侧已尽责；`qwen2.5:0.5b` 能力不足。**未换模型验证**。这是当前「真实陪伴」最硬的短板 |
| 2 | **检索仍是词面匹配** | 高 | 连续性层只补「零重叠」这一种漏，同义改写（「住处」vs「住在」）仍可能漏。语义检索需换算法，**任务禁止**，未做 |
| 3 | **连续性层可能引入无关背景** | 中 | 最多 3 条、按结构排序，与当前话题无关时会占用预算。已用 `match` 标签让模型区分，但增大了 token 成本 |
| 4 | 认知分析器是手写正则 | 中 | 未校准。`clarify` 仅在**无历史的首轮**触发；有历史时同一句话会被判为 `answer`（实测 8 种说法）。这限制了澄清能力 |
| 5 | 上下文预算会截断长对话 | 中 | `maxHistoryMessages = 12` / `6000` 字符；超过后早期轮次被裁掉，记忆成了唯一的长程通道 |
| 6 | 每轮云端请求需人工逐次同意 | 中 | 安全优先的设计选择，**未改**；真实使用中摩擦仍在 |
| 7 | 陈旧判定用固定 180 天 | 低 | `MEMORY_STALE_DAYS = 180` 一刀切，未按主题差异化 |
| 8 | 兴趣 / 自我模型无 UI | 低 | 数据有、界面无（既有债务） |
| 9 | 本地 Electron 冒烟无法在本机验证 | 低 | 见 §12.3，属环境问题，CI 覆盖 |
| 10 | 记忆写入仍靠显式操作 | 设计约束 | 模型不能自行写记忆，这是刻意的红线；代价是记忆覆盖率取决于用户操作频率 |
| 11 | **测试并发超时抖动（跨环境）** | 中 | **已修**（唯一超出工作包范围的改动）：`vitest.config.ts` 增至 `testTimeout: 20_000`。原有 5000ms 在 Windows 上会把「SQLite fsync 抖动」误判成「逻辑失败」。未改任何断言/跳过/并发。证据与量化见 §12.4 |

---

## 12. 验证证据：实际执行的命令与结果

### 12.1 本机环境

| 项 | 值 |
|---|---|
| OS | Windows（`win32-x64`） |
| Node | 见 `verify:real` 报告的 `environment.node` |
| 包管理 | npm（`package-lock.json` 锁定） |
| 数据库 | `node:sqlite` 内置（`ExperimentalWarning` 属正常输出） |
| 本地模型服务 | Ollama，`qwen2.5:0.5b` + `nomic-embed-text:latest` |

### 12.2 逐项结果

| 命令 | 结果 | 关键输出（原文摘录） |
|---|---|---|
| `npm run typecheck` | **通过**（exit 0） | 无输出即无错误 |
| `npx vitest run --no-fsModuleCache --maxWorkers=2` | **通过** | `Test Files 42 passed (42)` / `Tests 291 passed (291)` |
| `npm run evaluate` | **通过** | `candidatePrecision 1`、`candidateRecall 1`、各类 leak 均为 0、`deterministicHash 209d8d37…` |
| `npm run evaluate:cognition` | **通过** | cognitive 26 用例、feeling 34、alpha 28，各准确率 1.0，`gate.passed: true`，`networkCalls 0` |
| `npm run evaluate:companion` | **通过** | `21/21`、`replayStable: true`、`stubDispatches: 47`、`networkCalls: 0`、`deterministicHash b41b643d…` |
| `npm run build` | **通过**（exit 0） | electron-vite 产物生成成功 |
| `npm run verify:real` | **通过**（`verified`） | `4/4` 轮、`9/9` 检查，见 §7 |
| `npm run smoke` | **未执行（本阶段）** | 理由见 §12.5 |

测试数量变化：`main` 40 文件 / 268 测试 → 本分支 **42 文件 / 291 测试**（+2 文件 / +23 测试）。明细：新增集成测试 14 个 + 记忆装配器 3→8（+5）+ 评估自测 4 个 = 23。

### 12.3 本地测试抖动：已证伪为环境问题（不是本阶段引入）

本机默认并发下 `vitest` 会间歇出现 `Error: Test timed out in 5000ms.`。为排除「本阶段改坏了」，做了对照实验：

**在完全未修改的 `origin/main`（`8b207b7`）上，连续跑两次默认并发：**

```
=== MAIN baseline run 1 (default workers) ===
 Test Files  40 passed (40)
      Tests  268 passed (268)
=== MAIN baseline run 2 (default workers) ===
 FAIL  src/persistence/backup-service.test.ts > ...
 FAIL  src/persistence/migrations.test.ts > ...
 Test Files  2 failed | 38 passed (40)
      Tests  2 failed | 266 passed (268)
```

**在同一台机器的 Phase-2 分支上，默认并发：**

```
 FAIL  src/app/cognitive-loop.integration.test.ts > ... (5000ms timeout)
 FAIL  src/persistence/backup-service.test.ts > ... (5000ms timeout)
 FAIL  src/persistence/migrations.test.ts > ... (5000ms timeout)
 Test Files  3 failed | 39 passed (42)
      Tests  3 failed | 288 passed (291)
```

**结论**：同一个 `main` 提交，两次运行一次全绿一次红。失败全部是 **5000ms 超时**，且集中在 I/O 密集型套件（SQLite 迁移、备份文件系统、回环 HTTP 服务）——不是断言失败，是没跑完。**本阶段没有改动这三个文件**。以 `--maxWorkers=2` 运行时 291 个测试全绿。

判定：**本机资源/并发环境问题**，与代码无关。

**但必须补充一个反向证据**：这个问题**不只在本机出现**。§12.4 记录了同一份纯文档提交在 CI 上 attempt 1 失败、attempt 2 通过，以及随后另一次纯文档提交再次失败。所以准确结论是：**这是一个既有的、跨环境的并发超时抖动**，本机更容易触发（沙箱 + 多核抢占），CI 的 Windows runner 也会触发。**它已在 §12.4 被修掉**（`testTimeout: 20_000`），修完后本机默认并发连跑两次均 291/291 全绿。

补充一条本机特有的坑：在本沙箱里 `npx vitest run` 会在启动阶段报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`（文件操作钩子拦截了 vitest 清理 `node_modules/.vitest-cache` 的 97 个文件）。因此本机必须加 `--no-fsModuleCache`。**这是沙箱限制，CI 上不存在，`npm test` 脚本本身未改。**

### 12.4 GitHub Actions 实际结果

本阶段有两次 run，**其中一次失败过**，如实记录如下。

#### run `40321367137` @ `a8f82ab`（源码 + 报告初版）

| Job | 结果 | 关键输出 |
|---|---|---|
| `Typecheck, tests, build and smoke (ubuntu-latest)` | **success** | `Test Files 42 passed (42)` / `Tests 291 passed (291)`；`evaluate:companion` 21/21、`replayStable: true`、`networkCalls: 0`、hash `b41b643d…`；`Morrow smoke passed` |
| `Typecheck, tests, build and smoke (windows-latest)` | **success** | `Test Files 42 passed (42)` / `Tests 291 passed (291)`；`evaluate:companion` 同上；`Morrow smoke passed` |
| `Windows upgrade path (schema migrations under the real app)` | **success** | `Test Files 6 passed (6)` / `Tests 47 passed (47)`（含 v1→v15 升级路径） |

合计 **3 / 3 Job success**。

#### run `40321933436` @ `aa2642b`（仅文档：补入 CI 记录）

**第 1 次尝试：失败。** 失败详情原文摘录：

```
FAIL src/persistence/migrations.test.ts > versioned local SQLite storage
     > migrates a v1 database without losing its records or falsely changing their source
Error: Test timed out in 5000ms.
 ❯ src/persistence/migrations.test.ts:40:3
 Test Files  1 failed | 41 passed (42)
      Tests  1 failed | 290 passed (291)
 Isolate    42 workers spawned · ~167ms startup each
```

同一 run 的 ubuntu-latest 与 windows 升级路径 job 均 success，只有 windows-latest 的单元测试 job 因这 1 个超时失败。

**第 2 次尝试（`gh run rerun --failed`，未改任何代码）：3 / 3 Job success。**

#### run `40322940570` @ `d84dcfa`（仅文档：记录上面的失败）

**再次失败，仍是 windows-latest，仍全部是 `migrations.test.ts` 的 5000ms 超时**（这次 3 个用例同时超时，288/291）：

```
FAIL src/persistence/migrations.test.ts > upgrades v9 cognitive observations and settings ...
FAIL src/persistence/migrations.test.ts > retains a verified recovery snapshot ...
FAIL src/persistence/migrations.test.ts > upgrades an existing v3 goal database ...
Error: Test timed out in 5000ms.
 Test Files  1 failed | 41 passed (42)
      Tests  3 failed | 288 passed (291)
    Isolate    42 workers spawned · ~168ms startup each
```

#### 频率对比：这是被本阶段「压塌」的既有抖动，不是纯环境

| 分支 | 测试文件数 | windows-latest 结果 |
|---|---|---|
| `main` / 第一阶段 | 40 | **4 / 4 全绿**（`40308680325`、`40309704692`、`40312875507`、`40313380826`） |
| 本分支 | 42 | **4 次尝试中 2 次失败**（`40321933436` attempt 1、`40322940570`），失败点固定在 `migrations.test.ts` |

所以准确的归因是：**配置本身早就有问题（本机在未修改的 `main` 上也能复现超时，§12.3），但本阶段新增的 2 个重量级测试文件把并发压力推过了临界点，使它从「几乎不出现」变成「约 50% 出现」**。这不是「和我无关的环境噪音」，我不能这样写。

#### 处置：修根因，而不是重跑到绿

先量化单测真实成本：

```
$ npx vitest run --no-fsModuleCache src/persistence/migrations.test.ts
 ✓ src/persistence/migrations.test.ts (10 tests) 2323ms
   ✓ migrates a v1 database ... 406ms
   ✓ upgrades v8 data ... 325ms
   ✓ upgrades v9 cognitive observations ... 410ms
```

**单个用例只要 320–410ms，整个文件 2.3 秒。**也就是说 5000ms 超时意味着这个 worker 被饿到了 **15 倍以上**。根因不是测试慢，而是：Windows 上每条迁移都要真开 SQLite、跑完整 v1→v15 升级并 fsync，几个这样的文件共享 worker 池时，单次 fsync 抖动就会把某个用例顶过 5 秒。

修法（`vitest.config.ts`）：`testTimeout: 20_000`。

**为什么这不是「为了过 CI 而放宽测试」**：
- 没有删除、修改或跳过任何一个断言或测试（291 个测试数量不变，全部仍然执行）；
- 没有降低并发、没有加 `retry`；
- 20 秒仍是**硬上限**，真实死锁/挂起照样失败，只是不再把「I/O 抖动」误判为「逻辑失败」；
- 修完后本机**默认并发**连跑两次都是 `42 passed (42)` / `291 passed (291)`（此前默认并发在本机必挂，§12.3）。

这是本阶段**唯一一处超出原工作包 A–F 的代码改动**，已在 §3 与 §14 单独标出。

#### 修复后：run `40323987426` @ `30b74dd`

**3 / 3 Job success**（ubuntu-latest、windows-latest、windows 升级路径），windows-latest 上 `42 passed (42)` / `291 passed (291)`。

**不把 rerun 通过写成「一次通过」**，是本报告的基本要求；同理，也不把「修完之后绿了一次」写成「从此不再抖动」——抖动类问题的正确结论只能是**已发生的尝试序列**，而不是一次结果。上面四次运行就是完整序列。

已知告警（非阻塞，属既有债务，本阶段未处理）：`actions/checkout@v4` 与 `actions/setup-node@v4` 触发 Node 20 弃用提示；`ubuntu-latest` 将于 2026-10-19 迁移到 Ubuntu 26。

> 关于本报告**自身**最后这次（纯文档）提交的 CI 结果：报告无法在不追加新提交的前提下记录自己的 CI 结果，因此以 PR #3 的 checks 列表为准。

### 12.5 本阶段未执行 / 无法验证的项目

| # | 项目 | 状态 | 说明 |
|---|---|---|---|
| A | **云端 Provider 真实调用** | **未执行** | 未使用任何云端凭据，未产生任何付费请求。OpenAI / DeepSeek 等真实端点的行为、限流、错误码均未验证 |
| B | **Windows 安装包打包** | **未执行** | 未运行 `npm run package:win`，未产出 `.exe`，未验证安装/升级/卸载/签名 |
| C | **本地 `npm run smoke`** | **未执行** | 第一阶段已查明本机 Electron 渲染进程无法加载页面（`window load failed` + GPU `0xC0000005`），且在未修改的 `main` 工作树上同样复现，判定为环境问题；由 CI 覆盖。本阶段未重复该实验 |
| D | **换更大模型复测同会话回忆** | **未执行** | 本机仅有 0.5B 模型可用；换模型需下载，未做 |
| E | **长对话（>12 轮）验证** | **未执行** | 预算截断行为由常量与既有权衡决定，未做长程实测 |
| F | **真实用户可用性 / 质量评估** | **未执行** | 无真实使用数据；`quality.assessed: false` |

---

## 13. 哪些部分需要用户凭据或授权

| 能力 | 是否需要 | 说明 |
|---|---|---|
| 本阶段全部验证 | **不需要** | 全部跑在回环 Ollama 上，无凭据、无外网、无付费 |
| 云端 Provider（OpenAI / DeepSeek / 其他） | **需要 API Key + 逐轮同意** | Key 经 `safeStorage` 加密存入 `secrets/*.bin`，**任何表都不存明文**；每次调用前弹同意框，SHA-256 不变才发送。**本阶段一次都没有使用** |
| 敏感记忆（`sensitivity: 'sensitive'`） | **需要显式勾选** | `includeSensitive` 为真才进入请求，且授权记录绑定载荷哈希 |
| 在其他机器/模型上复跑 `verify:real` | **需要环境变量** | `MORROW_REAL_PROVIDER_ENDPOINT` / `MORROW_REAL_PROVIDER_MODEL`；端点必须是回环地址，否则被 `security/url-gate` 拒绝 |
| 打包与发布 | **需要**（阶段外） | 证书、签名、Release 权限均未使用 |

---

## 14. 与原始任务的偏差

| 偏差 | 原因 | 影响 |
|---|---|---|
| **PR base 指向第一阶段分支，而非 `main`** | README 验证命令块与 CI 评估步骤在阶段一已被改动，直接基于 `main` 会产生文本冲突 | 堆叠 PR；阶段一合并后 GitHub 会自动改指向 `main`。**未合并任何代码** |
| **未换更大模型复测** | 本机只有 0.5B | 同会话回忆的失败原因只能归因于「模型能力」，**不能**排除「更大模型也会失败」 |
| **未跑 `npm run smoke`** | 本机环境已知不可用（阶段一已证伪） | 由 CI 覆盖；本报告不声称本地冒烟通过 |
| **重新生成了 `cognitive-alpha-adversarial-report.json`** | 澄清提示词变长（281→380 字符），该报告记录了 `promptGuidanceCharacters` | 属预期产物更新，门禁仍 `passed: true`；未改任何门槛 |
| **记忆装配器测试从 3 个扩到 8 个** | 新增行为需要断言，且需要一条「退回旧行为」的退化测试 | 只增不减，**未删除或放宽任何既有断言** |
| **修了 `vitest.config.ts`（超出原工作包）** | 本阶段新增 2 个重量级测试文件后，windows-latest 在 4 次尝试中失败 2 次（40 文件时 4/4 全绿）。把这个抖动原样交给审计，等于交付一条不可信的 CI 信号 | 只改 `testTimeout` 一处，**未动任何断言/测试/并发**（§12.4）。这是本阶段唯一超出 A–F 的改动，已单独披露 |
| **未把 `verify:real` 接入 CI** | 它需要一台跑着 Ollama 的机器；GitHub runner 上装模型不可行，也不该在 CI 里消耗真实推理 | 真实模型验证只能手工执行（本阶段已执行并留档）。**这是真实的覆盖缺口**，不是疏忽 |

---

## 15. 风险与回滚

### 15.1 行为变化与风险

| 变化 | 风险 | 缓解 |
|---|---|---|
| 每轮都注入记忆（不再只在显式回忆时） | 请求体变大；无关背景可能干扰回答 | 硬上限 `maxMemoryContextCharacters = 3000`；连续性层最多 3 条；`match` 标签让模型区分；真实测量 1923–2149 字节 |
| 提示词新增 3 条原则 + 改写 1 条 | 提示词变长，挤占上下文预算 | 记忆装配器的「超大候选」测试覆盖了预算边界（曾因提示词过长导致该测试失败，已通过把行为指导移到 `fixedPrinciples`、JSON 里只留极短标签解决） |
| `ContextMemory` 增加必填字段 `match` | 类型破坏性变更 | 仅内部类型；全部调用点已更新，`typecheck` 通过 |
| 离线评估纳入 `verify` | `verify` 变慢（+约 0.5s） | 可接受 |

### 15.2 为什么用堆叠 PR

阶段一 PR #2 尚未合并。阶段二修改的 README 验证块与 CI 评估步骤**在阶段一已被改过**，若直接基于 `main` 开分支，两处必然冲突，且会在阶段二 PR 里重复展示阶段一的 diff（评审噪音）。堆叠后：本 PR 的 diff **只含阶段二的 5 个提交**；阶段一合并后 GitHub 自动改基到 `main`。

依赖的阶段一改动，明确列举：`README.md` 的验证命令块（阶段一新增了 SQLite 说明与 `verify` 链）、`.github/workflows/ci.yml` 的离线评估步骤（阶段一删除了 `npm rebuild better-sqlite3`）、`package.json` 的 `version: 2.0.0`（阶段一统一）。**阶段二的运行时代码不依赖阶段一的任何改动**——两者只是文档与 CI 的文本相邻。

### 15.3 回滚

- 整体回滚：`git revert ec53fb8 5425653 4b52731 137113f`（逆序），或直接删除分支（未合并，无副作用）。
- 只回滚记忆行为：`new MemoryContextAssembler(0)` 即可退回「纯词面匹配」，该路径有测试保护；同时需还原 `companion-service.ts` 中 `assembleContext(retrievalQuery, max)` 一行。
- 数据影响：**无**。本阶段没有数据库迁移，没有 schema 变更，没有新增表或列。回滚后旧数据完全可用。

---

## 16. 交付清单

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 代码改动（20 文件 / +2089 −19） | 分支 `feat/phase-2-companion-core` |
| 2 | 端到端集成测试（14 个） | `src/app/companion-core.integration.test.ts` |
| 3 | 记忆装配器测试（3→8 个） | `src/memory/memory-context-assembler.test.ts` |
| 4 | 新评估集（21 用例 / 10 维度） | `evaluation/fixtures/companion-core-v1.json` |
| 5 | 评估执行器 + 自测 + CLI | `src/evaluation/companion-core-evaluation{,.test}.ts`、`companion-core-cli.ts` |
| 6 | 真实 Provider 验证器 + CLI | `src/evaluation/real-provider-conversation.ts`、`real-provider-cli.ts` |
| 7 | 真实 Provider 验证记录 | `evaluation/reports/real-provider-conversation-report.json` |
| 8 | npm 脚本与 CI 接入 | `package.json`、`.github/workflows/ci.yml` |
| 9 | 本报告 | `docs/reports/project-work-report-2026-10-26-phase-2.md` |
| 10 | Pull Request #3（未合并） | https://github.com/ve766/morrow-ai-companion-v2/pull/3 |
| 11 | CI 运行记录（run 1：3/3 success；run 2：attempt 1 失败 → attempt 2 3/3 success） | https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40321367137 · https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40321933436 |

---

## 17. 任务要求的问答（逐条直答）

**Q1 · Morrow 现在能做什么？**

它能用真实模型进行多轮对话，逐轮把对话历史、已保存的记忆、当前人格配置一起组装成一次有界请求发出去；记忆可以跨会话使用，可以在重启后存活；用户纠正或撤回一条记忆后，旧内容不再出现在后续请求中；人格有版本号，每次请求都带版本与取值，编辑后版本递增、重启后保持；失败（认证/超时/取消）不会被伪装成正常回复。这些都由本次实际运行验证，不是设计意图。

**Q2 · 哪些能力是真实模型验证过的，哪些只有自动化测试？**

见下表。核心区别：**「请求里有什么」是真实模型验证的（因为可以拦截真实载荷）；「模型照着做了什么」只有部分观察，没有保证。**

| 能力 | 证据等级 |
|---|---|
| 请求真的到达真实服务并返回 | **真实模型** |
| 多轮历史进入真实请求（含原文、逐轮增长） | **真实模型** |
| 跨会话记忆进入真实请求 | **真实模型** |
| 人格版本与取值进入真实请求 | **真实模型** |
| 请求体不含凭据 | **真实模型**（回环场景） |
| 模型使用了跨会话记忆 | **真实模型观察，非门禁**（turn-4 回答正确） |
| 模型使用了同会话历史 | **真实模型观察，失败**（turn-3 未回忆） |
| 人格跨会话 / 跨重启保持 | 仅自动化测试 |
| 纠正 / 撤回 / 删除后停止使用旧内容 | 仅自动化测试 + 离线评估 |
| 零词面重叠记忆被注入 | 仅自动化测试 + 离线评估 |
| 失败不伪造回复 | 仅自动化测试 + 离线评估 |
| 云端 Provider 行为 | **未验证** |
| 安装包 | **未验证** |
| 回复质量 / 陪伴感 | **未评估** |

**Q3 · 记忆是否真的影响后续回复？**

记忆**确实进入了请求**，这一层已确证。模型**是否据此改变回答**，在跨会话场景拿到了正面证据（turn-4 回答「我住在杭州，做后端开发」，该会话无任何历史，唯一信息来源就是记忆），在同会话场景拿到了反面证据（turn-3 忽略已送达的历史）。所以准确表述是：**系统已能可靠送达，模型的使用是概率性的，取决于模型能力。**

**Q4 · 人格是否进入请求并跨会话保持？**

是。真实请求体同时含 `version 2`、`warmth 60/100`、`用中文回答`。新会话、重启后、从修订记录恢复后都保持，编辑后版本递增。人格只由用户编辑改变，模型无写入路径。**但「人格是否被表达得自然」未评估。**

**Q5 · 纠正 / 撤回后是否停止使用旧信息？**

是。判据是**请求体中不再出现旧内容**（不是数据库字段变了）：纠正后旧文本消失、新文本出现；撤回后整条记录不进候选；删除后记录消失。另外，模型推断出的陈述不会被静默升格为用户明述，`revision` 不变。

**Q6 · 认知闭环还剩哪些断裂？**

见 §11，最要紧的三条：① 0.5B 模型收到上下文却不使用；② 检索仍是词面匹配，同义改写会漏；③ 连续性层是「补漏」而非语义检索，可能带入无关背景。其余为既有债务（正则分析器未校准、`clarify` 仅首轮触发、12 条消息预算、逐轮同意摩擦、180 天一刀切、兴趣/自我模型无 UI）。

**Q7 · 哪些需要用户凭据 / 授权？**

本阶段全部验证**不需要**（全在回环 Ollama）。云端 Provider 需要 API Key + 逐轮同意，本阶段一次都没有使用，未产生任何付费请求；敏感记忆需要显式勾选；在其他环境复跑需要设置 `MORROW_REAL_PROVIDER_ENDPOINT` / `MORROW_REAL_PROVIDER_MODEL`，且端点必须是回环地址。

**Q8 · CI 全绿是否等于真实陪伴能力已验收？**

**不等于。** CI 只覆盖：类型检查、291 个测试、三组离线评估、构建、Electron 冒烟。它**不包含**真实 Provider 对话（`verify:real` 需要本机服务，未接入 CI）、不包含安装包打包、不包含任何质量评估。本阶段唯一的真实模型证据来自 §7 那次**手工执行**的运行，其结论也仅限于「请求被正确组装并送达」。**「Morrow 是一个好用的 AI 陪伴产品」这句话，本阶段既没有证明，也没有试图证明。**

---

## 18. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 第 1 版 | 2026-10-26 | 初版，随 PR #3 提交（`a8f82ab`） |
| 第 2 版 | 2026-10-26 | 补入 CI 实际结果（`run 40321367137`，3/3 success）；修正 `provider-policy` 测试数量表述（7 项，非「43 项族」）；修正交叉引用编号 |
| 第 3 版 | 2026-10-26 | 补入 `run 40321933436` 的 **attempt 1 失败**记录（windows-latest 1 个 5000ms 超时，290/291）与 attempt 2 通过；新增根因定位（`vitest.config.ts` 无 `testTimeout`）；§11 新增第 11 条遗留债务；§14 新增两条偏差 |
| 第 4 版 | 2026-10-26 | 补入 `run 40322940570` **再次失败**；新增频率对比（40 文件 4/4 绿 vs 42 文件 2/4 失败）；**修掉根因**：`vitest.config.ts` 设 `testTimeout: 20_000`，附单测真实耗时测量与「为何不算放宽测试」的论证；§3、§11、§14 同步更新 |
| 第 5 版 | 2026-10-26 | 补入修复后 `run 40323987426` **3 / 3 success**；表头补齐运行 1–4 的完整序列；明确「抖动类问题只能报尝试序列，不能报单次结果」 |

> 第 2、3 版只补事实与修正表述。**第 4 版新增了一处代码改动**（`vitest.config.ts`），已在该版明确标注并单列理由。
