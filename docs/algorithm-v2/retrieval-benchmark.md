# 检索基准结果：v1 与 v2 对照

- 数据集：`evaluation/fixtures/retrieval-benchmark-v1.json`（12 例，合成数据，`datasetVersion 1.0.0`）
- 报告：`evaluation/reports/retrieval-benchmark-v1.json`（本文件所有数字均来自该次实际执行）
- 运行命令：`npm run evaluate:retrieval`
- 被测对象：生产策略对象 `selectRetrievalStrategy('memory-retrieval-v1' | 'memory-retrieval-v2')`
- 参数：`RetrievalConfig v2.1.0`（两算法共用同一份配置类型与预算）

指标定义见 [`evaluation-protocol.md`](./evaluation-protocol.md)。

---

## 1. 汇总

| 指标 | v1（基线） | v2（多信号） | 变化 |
|---|---|---|---|
| Recall@1 | 0.6528 | **0.7361** | +0.0833 |
| Recall@3 | 1.0000 | 1.0000 | — |
| Recall@5 | 1.0000 | 1.0000 | — |
| MRR | 0.9167 | **0.9583** | +0.0416 |
| NDCG@5 | 0.9385 | **0.9692** | +0.0307 |
| 泄漏总数（必须为 0） | **1** | **0** | −1 |
| 顺序违规 | **1** | **0** | −1 |
| 重复对 | **6** | **0** | −6 |
| 主题覆盖 | 1.0000 | 1.0000 | — |
| 预算超限 | 0 | 0 | — |
| 确定性 | true | true | — |

门禁：`passed: true`，`failedChecks: []`。
`activation.recommendedAlgorithm: memory-retrieval-v2`。

---

## 2. 逐案例结果

| 案例 | 场景 | v1 返回 | v1 MRR | v1 泄漏 | v1 重复 | v2 返回 | v2 MRR | v2 泄漏 | v2 重复 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|
| repeated-preference-multiturn | 多轮重复偏好 | `pref-main, pref-echo-1, pref-echo-2` | 1 | 0 | 0 | `pref-main, pref-echo-1, pref-echo-2` | 1 | 0 | 0 | 持平 |
| explicit-correction-cross-record | 明确纠正 | `tea-restated, tea-corrected, tea-milk` | 0.5 | **1** | 0 | `tea-corrected, tea-milk` | **1** | **0** | 0 | v2 胜 |
| new-over-old-fact-conflict | 新旧事实冲突 | `work-old, work-new` | 1 | 0 | 0 | `work-new, work-old` | 1 | 0 | 0 | v2 胜 |
| stale-versus-recent-role | 过期 vs 近期 | `role-recent, role-stale` | 1 | 0 | 0 | `role-recent, role-stale` | 1 | 0 | 0 | 持平 |
| longterm-preference-versus-temporary-need | 长期偏好 vs 临时需求 | `food-temporary, food-preference` | 1 | 0 | 0 | `food-temporary, food-preference` | 1 | 0 | 0 | 持平 |
| same-topic-duplicate-cluster | 同主题大量重复 | `coffee-4, coffee-1, coffee-2, coffee-3, coffee-5, coffee-6` | 0.5 | 0 | **6** | `coffee-4, coffee-1, coffee-3` | 0.5 | 0 | **0** | v2 胜 |
| multi-topic-week-planning | 多主题召回 | `plan-health, plan-reading, plan-work, plan-work-2, plan-health-2, plan-reading-2` | 1 | 0 | 0 | `plan-health, plan-reading, plan-work, plan-work-2, plan-reading-2, plan-health-2` | 1 | 0 | 0 | 持平 |
| retracted-and-restricted-non-leak | 删除/权限防泄漏 | `（空）` | 1 | 0 | 0 | `（空）` | 1 | 0 | 0 | 持平 |
| low-confidence-inference-versus-explicit | 低置信推断 vs 高置信陈述 | `explicit-evening, infer-morning` | 1 | 0 | 0 | `explicit-evening, infer-morning` | 1 | 0 | 0 | 持平 |
| context-budget-long-conversation | 上下文预算 | `notes-12 … notes-04`（9 条） | 1 | 0 | 0 | `notes-12 … notes-04`（9 条） | 1 | 0 | 0 | 持平 |
| no-evidence-noise-query | 空证据/噪声 | `（空）` | 1 | 0 | 0 | `（空）` | 1 | 0 | 0 | 持平 |
| cross-session-stable-order | 跨会话一致 | `cs-style, cs-style-2` | 1 | 0 | 0 | `cs-style, cs-style-2` | 1 | 0 | 0 | 持平 |

---

## 3. 变好的场景

### 3.1 明确纠正的旧信息不再复活（`explicit_correction`）

**现象**：v1 把 `tea-restated`（"I like green tea."）排在第一位返回，把用户纠正后的 `tea-corrected`（"I prefer black tea now."）挤到第二。

**原因**：v1 的排序是 `词法 + confidence/50 + 2·0.5^(age/30)`。`tea-restated` 创建时间更晚（2026-09-10），新近度更高，于是压过了 2026-09-01 的纠正记录。v1 完全不知道这条文本已被另一条活跃记忆的早期修订取代。

**v2 的做法**：`listSupersededStatements()` 从 `memory_revisions` 读出被取代的文本；`classifySupersession()` 发现 `tea-restated` 与 `tea-corrected` 的修订 1 归一化后完全相等，且 `tea-corrected` 仍然 active，判定为 `resurrected`，以 `superseded_statement` 理由**硬排除**。

**结果**：泄漏 1 → 0，MRR 0.5 → 1.0。

这是本次升级唯一涉及安全语义的改进，也是唯一无法用「调权重」达成的改进——它需要一条 v1 根本不存在的判断。

### 3.2 旧的高置信事实不再压过新的低置信事实（`new_old_conflict`）

**现象**：`work-old`（confidence 95，2025-06）排在 `work-new`（confidence 85，2026-09）之前。

**原因**：v1 中置信度贡献 `confidence/50` 最多 2 分，而词法命中每项 1 分。`work-old` 文本更长、命中更多词（"work"、"where"），词法优势直接盖过 110 天的新近度差距。

**v2 的做法**：词法信号被归一化到 0..1（除以 `4 + 词项数`），置信度、来源、确认、衰减都变成同量级的加权项，衰减按稳定性类别选择半衰期（显式陈述 180 天）。

**结果**：顺序违规 1 → 0。

### 3.3 同主题重复记忆不再占满预算（`same_topic_many_duplicates`）

**现象**：v1 把 6 条几乎同义的咖啡偏好全部返回，占用 6 个预算槽位。

**原因**：v1 没有任何去重或多样性控制。

**v2 的做法**：完全相同的归一化文本先合并（保留分高者，其余记 `duplicate`）；选择阶段用 MMR，词项 Jaccard ≥ 0.9 的候选直接以 `duplicate` 排除。

**结果**：重复对 6 → 0，返回 3 条，MRR 持平（0.5，因为两者都把 `coffee-4` 排在第一——见 §5.2）。

---

## 4. 没有变化的场景（且是应该没有变化的）

| 场景 | 为什么应当持平 |
|---|---|
| 多轮重复偏好 | 生产侧 `create()` 的归一键去重已在入库阶段处理；检索层无需再改。三条文本 Jaccard < 0.9，不构成"重复对"，两算法都保留。 |
| 过期 vs 近期 | v1 的新近度项已足以让 `role-recent` 胜出；v2 保持。这条是**回归护栏**，不是改进点。 |
| 长期偏好 vs 临时需求 | 两者都正确返回两条。v2 的差别在内部：`food-preference` 用 180 天半衰期，`food-temporary` 用 7 天，所以前者不会被"临时需求"挤掉；但最终顺序两者一致。 |
| 删除/权限防泄漏 | v1 的 `status` + `sensitivity` 过滤本来就是正确的。v2 必须证明**没有**把它改坏。 |
| 低置信推断 vs 高置信陈述 | v1 的 `confidence/50` 已让 `explicit-evening`（92）排在 `infer-morning`（45）之前。v2 增加了来源权重，结果不变。 |
| 上下文预算 | 两算法都返回 9 条、均在 3000 字符内。v2 的 MMR 循环同样"装不下就跳过、不中止"。 |
| 空证据/噪声 | 词法 0 命中即排除。两算法一致——**没有伪造语义相似度**。 |
| 跨会话一致 | 两算法在固定 `now` 下都确定性。 |

---

## 5. 退化与代价（必须如实记录）

### 5.1 没有全局退化，但有局部持平与一处调参

`regressions: []`。但要注意：

- **`same_topic_many_duplicates` 的 MRR 持平在 0.5，不是 1.0。** 两算法都把 `coffee-4`（"Black coffee is what I drink every morning."）排第一，因为查询 "what coffee do I drink" 里的 "what" 恰好命中它。期望的 `coffee-1` 排第二。这不是 v2 引入的问题，但也没有被 v2 修好。

### 5.2 `diversityPenalty` 从 0.20 下调到 0.05（一次实测调参）

初版 `diversityPenalty = 0.20`。实测发现它在重复簇里把 `coffee-1` 从第 2 位压到第 3 位（MRR 0.5 → 0.33），原因是候选的 `baseScore` 差异只有约 0.01–0.02 量级，而 MMR 惩罚项可达 0.20，多样性项完全主导了排序。

下调到 0.05 后：重复对仍为 0（重复由 `duplicateOverlapThreshold` 硬排除，不依赖这个权重），MRR 恢复到 0.5。

**这个值是在这 12 个案例上选出来的，存在过拟合风险。** 它只影响主题多样性，不影响任何安全语义；若后续真实数据表明排序被多样性扰动过多，应优先把这个权重继续调低而不是调整门禁。

### 5.3 v2 的固定成本

- 每次检索多读一次 `memory_revisions`（`listSupersededStatements`，上限 200 行，单条 SQL）。
- MMR 选择是 O(n²)（n = 候选数，上限 1000），最坏约 10⁶ 次词项比较，在本机实测中不构成瓶颈，但比 v1 的一次排序更贵。
- 决策 trace 每次检索构造一次候选数组；事件日志只写入 ≤8 个 id 的摘要。

---

## 6. 结论与激活决定

v2 在 12 个场景上：

- 消除了 v1 唯一的泄漏（跨记录纠正链）；
- 消除了唯一一处顺序违规（新旧事实）；
- 消除了全部 6 对重复；
- Recall@1 / MRR / NDCG@5 全部上升；
- 没有任何指标下降。

因此 `DEFAULT_RETRIEVAL_ALGORITHM` 由 `memory-retrieval-v1` 切换为 `memory-retrieval-v2`，并在真实对话路径生效（见 `docs/algorithm-v2/phase-b-delivery.md` 的闭环验证一节）。

**这个结论的边界**：它是「在这 12 个合成场景上、按本文件定义的指标、无退化」的意思，不是「检索已经足够好」。真正未解决的问题列在下一节。

---

## 7. 已知未解决

1. **没有语义检索。** 查询 "what should I eat today" 无法召回 "I prefer vegetarian meals"，因为没有共享词项。基准里把查询改成 "which meals should I eat today" 才能命中——这暴露的是能力缺口，不是测试写法问题。引入嵌入模型属于下一阶段，且需要先论证资源与隐私成本。
2. **稳定性分类靠关键词。** `喜欢/偏好/通常` 判为长期，`今天/今晚/暂时` 判为临时。中英混杂、反讽、引述他人语句都会误判。误判代价被限制在「衰减半衰期选错」，不会导致泄漏。
3. **跨记录纠正只处理完全相同的文本。** 用户把 "I like green tea" 纠正为 "I prefer black tea"，之后又说 "green tea is my favourite" —— 文本不同，不会被识别为复活。要解决需要语义等价判断，当前不具备。
4. **`requiredOrder` 是人工标注。** 顺序违规的绝对值意义有限，趋势才有意义。
5. **案例数 12，统计意义为零。** 任何结论都不应外推到真实用户分布。
