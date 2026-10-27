# Phase 2.2.8 — A3 中文检索误命中修复

日期：2026-10-28  
分支：`fix/memory-reliability-v0.1`

## 1. 问题与修复

诊断中的无关查询：

- 查询：`给我一个完全无关的问题。`
- 误召回：`我一直住在杭州。`
- 原因：中文二元组 `我一` 偶然重合，旧实现将任意非零词面分视为 `topic`。

修复不再把任意二元组重合当作主题证据。`topic` 入选必须满足至少一项：

1. 查询短语被记忆完整包含；
2. 存在内容型词面重合；以功能字开头的二元组（如 `我一`）不计；
3. 查询与记忆属于同一明确事实族：居住、项目、偏好、学习、工作、宠物；
4. 查询与记忆存在明确安全关系：过敏/禁忌记忆 + 饮食问题。

`context` 层使用相同证据门槛，不只看最近对话是否出现。`continuity` 不再无条件补“最近三条”；只在共享事实族或明确安全约束时补充，默认上限 1。

## 2. 可解释结果

`AssembledMemoryContext` 新增可选 `decisions`，每条记录包含：

- `included`；
- `match`: topic / context / continuity / null；
- `lexicalScore`；
- `contextScore`；
- `semanticScore: null` —— 明确表示没有语义测量，不是零相似度；
- `reason`: selected / inactive / unauthorized / below_relevance_threshold / budget_excluded。

最终 payload 仍只使用原有记忆块，未增加实验字段。

## 3. 中文误召回回归集

新增 `evaluation/fixtures/retrieval-context-v2.json`（9 例）：

- 无关中文二元组陷阱；
- 居住、偏好、学习改述；
- 带上下文的省略问；
- 冲突双方；
- 撤回值；
- 未授权敏感值；
- 英文词边界。

新增 `src/evaluation/retrieval-context-v2.test.ts`（6 条聚合测试）。

## 4. 前后对照指标

同一 fixture、同一标签，冻结 legacy 基线 vs 当前候选。

### retrieval-context-v2（新增，9 例）

| 指标 | legacy 基线 | 修复后 |
|---|---:|---:|
| Recall@3 | 0.8333 | **1.0000** |
| Precision@3 | 0.8333 | **1.0000** |
| MRR | 0.8333 | **1.0000** |
| 误召回数 | 2 | **0** |
| 泄漏数 | 0 | 0 |
| 平均检索条数 | 0.8889 | 0.7778 |

逐例关键变化：

- 无关二元组陷阱：基线召回杭州，修复后为空；
- `那后来呢？`：基线不召回，修复后通过最近上下文召回 Blender；
- 冲突杭州/大阪：两侧都保留；
- 撤回 RED-2：不出现；
- 未授权过敏记忆：不出现；
- `do` 不再命中 `dog`。

### retrieval-context-v1（既有，12 例）

| 指标 | legacy 基线 | 修复后 |
|---|---:|---:|
| Recall@3 | 0.75 | **0.875** |
| Precision@3 | 0.75 | **0.875** |
| 误召回数 | 3 | **0** |
| 泄漏数 | 0 | 0 |

已知语义缺口 `我有什么爱好？` → `我收集黑胶唱片。` 仍两边都未召回。**没有语义分数，也没有伪造 semanticScore。**

## 5. 既有 fixture 的调整及理由

行为要求从“最近记忆可无条件作为 continuity 注入”改为“没有相关性证据不得注入”，因此有两个旧 fixture 需要同步：

1. `b8-miss`：原来要求问天气时生日记忆仍以 `continuity` 进入，这与新验收条件直接冲突。现改为 `memoryEntries=0` 且上下文不得包含“三月十二日”，断言更严格。
2. `b6-provenance`：原第二条记忆是无关的“可能喜欢徒步”，依赖旧 continuity 才凑到两条。现在改为同为工作主题的“可能从事设计工作”，仍检查两种来源都送达，不改变来源断言。

`b9-bounded` 的“最多 3 条”仍通过（现在实际 0 条），说明它只限制上限、不强制注入。

没有删除类别，没有降低断言；`b8` 从“允许注入”收紧为“禁止注入”。

同一调整同步到 `context-memory-v1.json`，因为 CI 的 `evaluate:context` 默认仍读取 v1；否则离线门禁会继续要求旧的无关 continuity 行为。调整后本地 `evaluate:context` 为 **22/22 通过**。

## 6. 测试

- `memory-context-assembler.test.ts`：21 条通过；
- `retrieval-context-v2.test.ts`：6 条通过；
- `retrieval-benchmark.test.ts`：9 条通过；
- `context-memory-evaluation.test.ts`：34 条通过；
- `request-assertions.test.ts`：22 条通过；
- `tsc --noEmit` 通过。

## 7. 限制

- 修复提高的是**词面/事实族精度**，不是语义检索能力。
- 没有向量模型，`semanticScore` 保持 null；不能宣称语义相关已解决。
- 安全关系的连续性仅覆盖过敏/忌口等明确词，仍有漏召回。
- 指标基于合成标签集，不代表开放域分布。
- 最终 payload 的实际系统提示将在 A4 用请求拦截再次检查。
