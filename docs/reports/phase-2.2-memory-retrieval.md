# Phase 2.2 — 记忆检索的结构性盲区（任务 1）

- 分支：`feat/phase-2.2-memory-reliability`
- 起点：`a57a55f`（继承 `e252d06` / PR #3）
- 相关提交：`2b536aa`
- 断言对象：序列化后的最终请求体，不是数据库行

## 1. 基线结论与修正

Phase 2.1 与 2.2 基线审计都提到「`score > 0` 过滤导致语义相关记忆无法进入候选集」。逐行核对后，这个说法需要修正：

`MemoryContextAssembler` 实际有三层：

| 层 | 进入条件 | 排序 | 上限 |
|---|---|---|---|
| `topic` | 与**本轮**查询有词面重叠（`score > 0`） | 相关度 + 置信度 + 近因 | `maxMemories` |
| `continuity` | 与本轮**零重叠** | 仅按来源质量（已确认 → 置信度 → 时间 → id） | 3 |

所以零重叠记录**并非**永不召回。真正的盲区是：

1. `continuity` 与话题无关。它保证「不把用户当陌生人」，但一个恰好排在 3 条之外、却与当前对话真正相关的记忆不会被带进来。
2. 查询扩展只在 `strategy === 'retrieve_memory'` 时发生（`companion-service.ts`），普通的代词/省略轮次不会带上相关前文。
3. `score()` 用 `normalized.includes(term)`，存在与 Phase C1 同类的子串误命中：`an`→`analyst`、`do`→`dog`、`like`→`dislike`。

## 2. 修改

### 2.1 词面匹配改为整词

- 拉丁/数字：先切 token，再比较**完整 token**；`an` 不再命中 `analyst`。
- 中文：仍用相邻二字组（无词边界，bigram 是最小诚实单位）。
- 短语加分增加词边界正则，`tea` 不再命中 `steam`。

### 2.2 新增 `context` 层

`prepare()` 把**最近 4 条历史消息**（截断到 2000 字符）作为 `conversationContext` 传入；`assemble()` 的签名扩展为第 7 个可选参数，默认空字符串，旧行为不变。

| 层 | 条件 | 标签 |
|---|---|---|
| `topic` | 与本轮有重叠 | 这是本轮在谈的 |
| `context` | 与本轮零重叠，但与最近对话有重叠 | 与最近对话相关，不是本轮原话 |
| `continuity` | 两者都零重叠 | 仅背景 |

`context` 层上限 5，仍然只从**已通过状态与敏感度过滤**的候选里取；预算仍是 3000 字符，超预算时从尾部丢弃。

### 2.3 明确不做的事

- 不引入嵌入模型或向量库。任务要求「语义检索作为可选增强，而不是强制引入大型模型依赖」，本阶段选择不做，因此「买表 ↔ 攒首付」这类**零词面、纯语用**的关联仍然不会召回。这是能力边界，不是阈值 bug。
- 不取消任何过滤。撤回、删除、敏感度上限在三个层上都生效。

## 3. 证据

### 3.1 单元测试（`src/memory/memory-context-assembler.test.ts`，18 例）

| 用例 | 断言 |
|---|---|
| 短词不命中长词 | 三个历史误命中全部不再召回，且 `continuity=0` 时结果为空 |
| 整词仍命中 | `coffee` → `topic` |
| 省略轮 + 前文 | 无前文 → `continuity`；有前文 → `context`（同一记录、同一查询） |
| 上下文不复活撤回/敏感 | 有前文时仍为空 |
| 冲突分组 | 同主题两条 → 同一 `conflictGroup`，不同主题不分组 |
| 波动性过期 | 120 天：`volatile` 过期、`stable` 不过期、`unknown` 过期 |

### 3.2 回归对照

| 数据集 | 修改前 | 修改后 |
|---|---|---|
| `context-memory-v1`（22 例） | 22/22，90 断言，hash `693b0a19…` | **22/22，90 断言，hash 不变** |
| `context-memory-v2`（30 例） | 不存在 | **30/30，110 断言，hash `b9cc7f03…`** |
| `companion-core-v1`（31 例） | 31/31 | **31/31** |
| 全量测试 | 435 | **452**（50 文件） |

v1 的 hash 未变很重要：它说明新层没有改变既有 22 个场景的投递结果，新增能力只在需要它的场景生效。

### 3.3 召回 / 错误召回 / 泄漏

| 指标 | 结果 | 来源 |
|---|---|---|
| 相关召回（新场景） | 8 个新用例全部通过 | v2 用例 `v2-elliptical-context` 等 |
| 错误召回 | `an`/`analyst` 等 3 例不再成为 `topic`；`v2-lexical-precision` 的 `memoryTopicCount = 0` | 单测 + v2 |
| 无关记录不被前文提升 | `v2-unrelated-not-promoted`：`猫` 在两轮都不是 `topic` | v2 |
| 撤回泄漏 | `v2-retracted-context`：撤回后 `memoryEntries = 0`，哨兵文本不出现 | v2 |
| 敏感度泄漏 | 未授权请求中敏感记录不出现（v1 B4/B10 与 `cognitive-loop` 集成测试） | 单测 |

### 3.4 真实模型（`qwen2.5:0.5b`）

| 运行 | 代码 / 状态 | 结果 |
|---|---|---|
| `20261027T064032Z-2132d7`（**clean**） | `c0d27ca` / clean | 1 pass / 2 fail / 2 needs_review |
| `20261027T062902Z-e0151c`（dirty） | `36a0629` / dirty | 0 pass / 3 fail / 2 needs_review |

clean 运行逐例：

| 用例 | 归因 | 判定 | 回复摘要 |
|---|---|---|---|
| `v2-elliptical-context` | — | **pass** | 提到了杭州 |
| `v2-conflict-group` | `delivered_but_not_used` | fail | 「你住在上海。」——只选一边 |
| `v2-correction-current` | `delivered_but_not_used` | fail | 「你住在哪个城市？」——反问，未用纠正值 |

两次运行 `notDelivered = 0`。也就是说：**系统把该送的东西送对了，模型没有用。** 这正是必须分开报告的两层。

同一 `v2-elliptical-context` 在 `e0151c` 里 fail、在 `2132d7` 里 pass，说明单次结果不能当作能力证据。

> **更正**：本节早先版本把 `e0151c` 写成 "clean tree"，实际是 `codeState: dirty`。已改用 clean 运行 `2132d7`，并保留 dirty 记录。

## 4. 残余风险

1. 无语义检索：零词面重叠的真正相关记忆仍不召回（已声明为能力边界）。
2. `context` 层最多 5 条，且依赖最近 4 条消息；更早的话题不会触发。
3. `context` 层会改变「为什么这条记忆在这里」的标签。Phase 2.1 中「零重叠 → continuity」的断言在**有前文**时现在得到 `context`；`companion-core.integration.test.ts` 的对应断言已按新语义更新，并保留撤回过滤断言。
4. 中文 bigram 仍可能跨词边界命中（未引入分词器）。

## 5. 回滚

`git revert 2b536aa` 即可回到「整词 + 无 context 层」之前的状态；`context-memory-v1` 与 `companion-core-v1` 的 hash 会回到基线，可用来确认回滚完整。
