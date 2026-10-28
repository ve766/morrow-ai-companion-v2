# Cognitive Loop V1 / Slice 1 — 真实对话连续性闭环

## 1. 基线与分支

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 起始分支 | `main` @ `8b207b7d7b80b91ed4369d02fd6ef7e170b81133`（与 `ssh/main` 一致） |
| 开发分支 | `feat/cognitive-loop-v1-slice1`（从 `ssh/main` 新建的工作树 `E:/opencode/morrow-v1-cognitive-v1`） |
| 开放 PR | #3 `feat/phase-2-companion-core`（`e252d06`）、#4（`25e8000`）、#6（`dca6486`）、#7（`34cb660`）、#8（`60a88b8`） |
| 与 PR 的关系 | 只读参考。没有合并、覆盖或 cherry-pick 任何 PR 分支；本轮改动全部基于 `main` 的真实代码 |

## 2. 核实到的真实调用链

`CompanionService.send()` → `prepare()`：

1. `analyzeCognitiveTurn(content, boundedHistory, messageId)` 产出 `CognitiveTurnAnalysis`（intent / strategy / topicSource / topicReferenceMessageId / signals）。
2. `prepare()` 用 `strategy` 决定检索查询，再调用 `MemoryService.assembleContext(query, max)`。
3. `system` 提示由「人格 → 认知提示 → 内在状态提示 → 自我模型上下文 → 记忆块 → 固定原则」拼成。
4. `makeRequestPayload()` 序列化后交给 Provider。

**确认的缺陷（`main` 上仍然存在）**：

```ts
memory = this.memories.assembleContext(
  firstPass.strategy === 'retrieve_memory' ? retrievalQuery : '',
  max
)
```

`main` 的 `MemoryContextAssembler` 只保留 `score > 0` 的记录，空查询 → `queryTerms=[]`、`phrase=''` → 所有记录得分为 0 → **一条记忆都不会被选中**。而 `strategy` 只有在「显式回忆 / 更正+自述 / 带记忆线索的追问」时才是 `retrieve_memory`，所以普通提问、情绪表达、探索、话题延续的**所有**轮次都拿不到记忆。

`if (!memory) memory = assembleContext(content, max)` 这个兜底只在认知关闭或分析抛错时生效，无法弥补上面的路径。

这与 PR #3 曾报告的问题同类；本轮用测试证明它仍在 `main` 上，并只修调用链，不重写检索算法。

## 3. 修改的文件与理由

| 文件 | 改动 | 理由 |
|---|---|---|
| `src/app/companion-service.ts` | 新增并导出 `buildRetrievalQuery()`；`prepare()` 改为始终用当前话语构造查询 | 修复上述缺陷：当前话语必须参与检索；追问用分析器解析出的**真实引用消息**扩展；显式回忆才额外并入上一条用户消息 |
| `src/app/companion-service.ts` | `clarify` 分支提示词改为「先澄清，记忆仅作背景」 | 旧文案要求「不要检索长期记忆」，与新行为矛盾 |
| `src/cognition/cognitive-turn-analyzer.ts` | `currentHasReference` 同时接受短追问模式（`那…呢`、`然后`、`所以`…） | 「那后天呢？」不含任何指示代词，旧规则无法解析引用；现在会把它绑定到真实的上一轮用户消息，没有上文时仍要求澄清 |
| `src/memory/memory-context-assembler.ts` | 选中 ≥2 条时，记忆块指令追加「同一事实出现不同取值时必须指出冲突，不得静默择一」 | 让冲突在**最终请求**里显式可见；本轮不做逐对冲突检测（见剩余风险） |
| `scripts/cognitive-slice1-benchmark.ts` | 新增固定八场景基准脚本 | 逐层记录理解/证据/载荷/模型四层结果，产出可复核 JSON |

没有新增数据库 schema，没有新依赖，没有改动人格、自我模型、内在状态引擎本身——它们本来就已接入请求（见第 6 节）。

## 4. 新增测试

| 文件 | 数量 | 覆盖 |
|---|---|---|
| `src/app/cognitive-continuity.integration.test.ts` | 12 | 全部读取**最终序列化请求**：普通提问命中记忆、话题切换不注入、短追问依赖引用、新会话命中、改述命中、更正不静默改写、冲突双值+指令、撤回不投递、敏感度上限、引用/第三人称不写入事实、人格+自我模型+内在状态同请求、重试幂等 |
| `src/app/retrieval-query.test.ts` | 5 | 查询构造：始终含当前话语、含引用消息、仅显式回忆才并入上一条、去重、长度上限 |
| `src/cognition/cognitive-turn-analyzer.test.ts` | +1 | 短追问绑定上一轮；无上文时要求澄清 |

全量：**286 条通过 / 42 个文件**（`main` 基线 268 条，本轮 +18）。

先写测试再修复的顺序：`cognitive-continuity` 第 1 条在修复前失败（`Saved memories` 块中没有「咪咪」），第 3 条（短追问）在修 `currentHasReference` 前失败，均在对应修复后转绿。

## 5. 验证命令与真实结果

| 命令 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `vitest run --maxWorkers=4` | **42 文件 / 286 条全部通过** |
| `electron-vite build` | 通过（main / preload / renderer） |
| `npm run evaluate` | 通过（检索 11 条、提醒 19 条，precision/recall 1.0） |
| `npm run evaluate:cognition` | 通过（认知 26 / 情绪 34 / alpha 28，gate 全过） |

**关于一次全量失败（环境，不是代码）**：不加 `--maxWorkers` 的首轮运行出现 1 条失败，第二轮出现 2 条不同的失败（`backup preview` 与 `v9 迁移`），耗时都在 5.5s 左右；这两个文件单独运行 25/25 通过，限制并发后全量 286/286 通过。判定为并发负载导致的抖动，与本次改动无关，未修改任何断言或超时。

## 6. 既有能力的核查结论（未重写）

- **人格**：`savePersonality` → 每次请求都带 `version N; warmth/directness/humor/disagreement` 与用户规则，且有测试证明；本轮只加断言。
- **自我模型**：`buildSelfModelContextBlock()` 已进入 system，且只在 `analysis.signals.explicitSelfFact` 为真时写入 `fact`；引用/第三人称转述不会写入（新增测试证明）。
- **内在状态**：`feelingPromptGuidance()` 已进入 system；本轮未改动引擎。
- **认知分析**：`analysis` 通过 `cognitivePromptGuidance()` 影响提示，并通过 `strategy` 影响检索——修复后这条控制信号才真正作用于普通对话。

## 7. 固定多轮基准（真实本地模型）

- 模型：`qwen2.5:0.5b`（本地 Ollama，`http://127.0.0.1:11434/v1`，`modelInCatalog=true`）
- 脚本：`scripts/cognitive-slice1-benchmark.ts`（8 场景 × 5 轮 = 40 次真实调用）
- 原始结果：`evaluation/reports/cognitive-slice1-benchmark.2026-10-28T04-24-55-825Z-7ebcc8.json`
- 运行命令见脚本头部注释（esbuild 打包后以 `NO_PROXY=127.0.0.1` 运行）

| 场景 | 理解层（分析器输出） | 证据选择 | 进入最终请求 | 模型使用 | 失败层 |
|---|---|---|---|---|---|
| 普通提问用上一轮事实 | `information_query/answer` | 5/5 | **5/5** | 4/5 | model 1 |
| 新会话用已存事实 | `information_query/answer` | 5/5 | **5/5** | 3/5 | model 2 |
| 短追问依赖引用 | `information_query/answer` | 5/5 | **5/5** | 不评分 | — |
| 更正当轮 | `correction/retrieve_memory` | 5/5 | **5/5** | 不评分 | — |
| 话题切换 | `uncertain/answer` | 0/5（正确） | 0 泄漏 | 不评分 | — |
| 撤回 | `information_query/answer` | 0/5（正确） | 0 泄漏 | 不评分 | — |
| 敏感度上限 | `information_query/answer` | 0/5（正确） | 0 泄漏 | 不评分 | — |
| 重试幂等 | — | — | 消息数不变 | — | — |

合计：**40 个场景-运行单元，37 个通过本轮判定**；失败 **3 个全部在 MODEL 层**，`payload` 层失败 0 次。

分层结论：

1. **理解层**：普通提问被判为 `information_query/answer`（修复前这类轮次检索为空）；更正被判为 `correction/retrieve_memory`；话题切换判为 `uncertain/answer`。规则强度是未校准提示，不作为用户事实。
2. **证据层 / 载荷层**：预期记忆 5/5 进入请求；撤回、敏感、无关场景 0 次进入。这一层现在是可复现的。
3. **模型层**：3 次失败的具体表现——被问猫名时反而复述记忆 ID 并反问；被问所在城市时回答「我不太了解你自己所在的城市」「作为语言模型我无法获取您所在地」。
4. **必须一起读的反例**：撤回场景虽然 0 次泄漏记忆，但模型在 3/5 轮里**编造了猫名**（"Nemo"、"Meow"）；更正场景有一轮说出从未出现过的「北京」。这些不是记忆泄漏，而是 0.5B 模型的事实性问题，不能用「载荷正确」掩盖。

## 8. 工程结论与模型结论（分开）

- **工程正确性：通过。** 调用链缺陷已复现并修复；286 条测试、类型检查、构建、两套评测通过；最终请求逐条断言；撤回/敏感/无关路径 0 泄漏。
- **真实模型行为：未达标，且不作为本切片失败。** 40 次真实调用中 3 次未使用已投递证据，另有若干编造。0.5B 模型不能用于证明产品级对话质量；本切片只证明「证据确实到达模型、边界仍然有效」。

## 9. 已知限制与剩余风险

1. **检索仍是词面匹配**：只共享单个汉字不会命中（例：库里「…的猫」，问「那只猫」）。这是 `main` 既有算法，本轮按要求没有重写；测试用共享二元组的改述证明连续性，单字场景列为限制。
2. **冲突只在提示层处理**：选中 ≥2 条时给出「不得静默择一」的指令，但没有逐对冲突检测；模型是否遵守未验证。
3. **`includedMemoryCount` 在重试路径返回 0**：只是返回值语义瑕疵，不影响请求内容，未在本次范围内修改。
4. **规则分类器未校准**：`confidenceScore` 是规则强度，不是概率；`intent` 误判不会写记忆，但会影响提示与检索范围。
5. **评测报告再生成**：分析器改动使 `cognitive-alpha-adversarial-report.json` 的 `promptGuidanceCharacters` 与哈希变化（291→352 等），指标与 gate 不变；该文件随本轮一并提交。
6. **本地模型结论不可外推**：`qwen2.5:0.5b` 的表现不代表更强模型。

## 10. 回滚

无 schema 变更、无迁移、无数据写入格式变化。回滚方式：删除分支 `feat/cognitive-loop-v1-slice1` 即可；如需保留基准脚本，单独保留 `scripts/cognitive-slice1-benchmark.ts` 与 `evaluation/reports/cognitive-slice1-benchmark.*.json`。

## 11. 下一步建议（Slice 2）

1. 用可解释的事实槽位（属性 + 值）替代纯词面匹配，先解决「单字不命中」与「改述不命中」。
2. 把冲突从提示层提升到结构层：同一槽位多值 → 明确标记 `unresolved`，并在评测里统计披露率。
3. 在更强且已授权的模型上重跑本基准，把「模型层失败」从 3/40 压下去，再讨论产品级质量。
4. 把 `includedMemoryCount` 等返回值语义补齐，避免审计时误读。

---

# 附：PR #9 收尾（统计口径、负向误注入、最终验证）

## A1. 修正真实模型评测统计

`scripts/cognitive-slice1-benchmark.ts` 的 schema 从 1 升到 2，按层拆开指标，并给出分子/分母：

| 指标 | 定义 | 本轮结果 |
|---|---|---|
| 记忆选择正确率 | 期望记忆是否被选中（仅统计有期望的场景） | **15 / 15 = 1.0** |
| 最终 Payload 正确率 | 无 call/evidence/payload 失败 / 全部运行 | **44 / 45 = 0.9778** |
| 证据使用正确率 | 回答包含期望证据 / 有评分且调用成功的运行 | **2 / 10 = 0.2**（未测量 35） |
| 无证据编造率 | 无任何证据时给出具体事实 / 无证据运行 | **0 / 5** |
| 撤回泄漏 | payload / 回答分别计数 | **0 / 5，0 / 5** |
| 敏感泄漏 | payload / 回答分别计数 | **0 / 5，0 / 5** |
| 调用失败 | Provider 报错，不计入模型错误 | **1 / 45** |

规则落实：
- `modelUsed === null`（无评分场景）计入 `notMeasured`，**不计入**通过；
- 失败分层为 `call / evidence / payload / model / fabrication`，调用失败单独统计；
- 撤回与敏感场景的 payload 与回答分别断言；敏感场景用记忆独有的「肾上腺素笔」判定泄漏，避免把用户自己说的「花生」误判为泄漏；
- 编造判定从子串改为车牌模式：第一版把模型回显用户原话（含「车牌号」）误判为编造，已修正并重跑；
- 原始记录、失败样例与分母都在 `evaluation/reports/cognitive-slice1-benchmark-v2.2026-10-28T05-14-03-522Z-3c33c9.json`。

失败样例（全部为 MODEL 层）：被问猫名答「喵喵」、被问城市答「你住在北京」、直接回显记忆 ID。1 次 `PROVIDER` 调用失败发生在话题切换场景，单独记为 call failure。

## B1. 负向误注入测试与最小修复

新增 5 条测试（`src/app/cognitive-continuity.integration.test.ts`），全部断言最终序列化请求：

| 用例 | 修复前 | 修复后 |
|---|---|---|
| 「我不喜欢这个方案」vs「我不喜欢吃香菜」 | 被注入（score 3） | 不注入 |
| 「我最近在学吉他」vs「我最近在学做饭」 | 被注入（score 4） | 不注入 |
| 「明天要交报告」vs「我明天要去医院复查」 | 被注入（score 2） | 不注入 |
| 正向对照：「我不喜欢香菜的味道」 | — | 仍命中「香菜」 |
| 正向对照：短追问「那后天呢？」 | — | 仍命中「杭州」 |

修复（`src/memory/memory-context-assembler.ts`）：把「我不 / 不喜 / 喜欢 / 我最 / 最近 / 近在 / 在学 / 明天 / 今天 / 这个 / 那个」视为**语法框架**，任何与框架位置重叠的二元组不算证据；紧邻框架的内容词保留（「我最近在学吉他」仍产出「吉他」）。这是查询侧过滤，没有改动存储、没有引入向量检索。

断言同时检查内容与记忆 id，避免块结构变化后只断言内容造成假通过。

## C1. 最终验证

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 通过 |
| 全量测试 | `vitest run --maxWorkers=4` | **291 / 291，42 文件**（+5 条负向/正向） |
| 构建 | `electron-vite build` | 通过 |
| 真实模型 | 9 场景 × 5 轮 = 45 次调用，`qwen2.5:0.5b` @ `http://127.0.0.1:11434/v1` | 44 成功 / 1 调用失败，见上表 |

本轮结论：
- 工程层：**通过**。选择率 1.0、payload 0.9778（唯一失败是调用失败）、泄漏 0。
- 模型层：**未达标**。有评分的 10 次里仅 2 次使用证据；0.5B 模型不能代表产品质量。
- 是否阻塞合并：**否**（无未披露的高风险失败；模型层问题已如实记录，不作为工程阻塞）。
- 是否建议转 Ready for review：**建议**，但需审查者接受「模型层未达标」这一已知限制。
