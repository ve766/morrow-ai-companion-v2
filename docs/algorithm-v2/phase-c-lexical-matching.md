# Phase C1：修复词法匹配缺陷

- 起点 HEAD：`5b2b279`
- 配置版本：`2.1.0`（substring）→ **`2.2.0`**（token）
- 旧冻结结果：`evaluation/reports/retrieval-benchmark-v1-frozen-config-2.1.0.json`（保留，未改写）

---

## 1. 缺陷

`src/memory/retrieval/retrieval-lexical.ts` 用**子串包含**判断词项命中：

```ts
const overlaps = queryTerms.reduce((count, term) => count + Number(normalized.includes(term)), 0)
const phraseMatch = phrase.length >= 2 && normalized.includes(phrase) ? 4 : 0
```

`queryTerms` 由 `retrievalTerms()` 产生，保留长度 > 1 的 token。因此 `an`、`is`、`do`、`ai` 这类短词会命中更长单词的内部。

实测到的后果：

| 查询 | 记忆 | 旧行为 |
|---|---|---|
| `What is the airspeed of an unladen swallow?` | `I work as a data analyst.` | `an` 命中 `analyst` → **召回** |
| `What pet do I have?` | `I have a dog named Pixel.` | `do` 命中 `dog` → **召回** |
| `Do I like scary movies?` | `I dislike horror films.` | `like` 命中 `dislike` → **召回** |

第一条在 Phase B 的 `dev-empty-evidence` 案例中造成了假阳性（「无相关记忆」却返回了一条）。

### 调用路径

`lexicalScore` 是全系统唯一进入模型上下文的词法评分：

- v1 `MemoryContextAssembler.run()`
- v2 / v3 `MultiSignalMemoryRetriever.retrieve()`

`SqliteMemoryRepository.search()` 也用了 `instr(lower(current_text), lower(?))`，但它是渲染层记忆列表的**用户主动搜索框**（`IPC_CHANNELS.memorySearch`），不进入模型上下文。子串语义对「筛选」是合理的，本阶段**不改**，仅在此记录差异。

---

## 2. 修复策略：按书写系统选择匹配单位

单一规则无法同时服务空格分词语言和中文。把英文词边界强加到 Han 文本上会直接破坏中文召回（中文没有空格）。

| 文本类型 | 匹配单位 | 规则 |
|---|---|---|
| 拉丁 / 数字 / 混合 token | **完整 token** | `tokens.has(term)` |
| 中文 | **相邻二字组（bigram）** | 该词项的所有 bigram 都必须存在于记忆中 |
| 中英混合 | 分 run 处理 | Han run 用 bigram，非 Han run 用连续 token |
| 短语 | 按 run 逐段 | 每段用自己的规则，全部命中才算短语命中 |

其他处理：

- **归一化**：`NFKC` + `toLocaleLowerCase`，在比较之前完成，因此全角、大小写、兼容形式不会切断匹配。
- **短词 / 数字 / 缩写**：作为完整 token 匹配。`26` 不再命中 `2026`，`ai` 不再命中 `said`。
- **标点与连字符**：token 由 `[\p{L}\p{N}]+` 切分，`state-of-the-art` 切出 `art`，`build_flag` 切出 `build` 与 `flag`。
- **中文多字词**：`喜欢素食` 对 `我更喜欢素食` 命中（`喜欢`/`欢素`/`素食` 三个 bigram 都在）；`食主` 不命中。

保留 `substring` 作为**显式模式**（`config.lexicalMatching`），只为让冻结基准可复现，不是默认值。

---

## 3. 回归测试

`src/memory/retrieval/retrieval-lexical.test.ts`，24 个用例。

设计原则：每个「不命中」用例都**同时断言旧模式仍然命中**，证明测试能区分两种行为，而不是只描述新行为：

```ts
expect(score(content, 'an')).toBe(0)                      // 新
expect(score(content, 'an', 'substring')).toBeGreaterThan(0)  // 旧
```

覆盖：

- 短词不跨词命中（`an`/`analyst`、`is`/`analysis`、`tea`/`steam`、`ai`/`said`、`26`/`2026`）
- 标点、大小写、全角归一化
- 连字符与下划线切分
- 中文二字词、多字词、错误 bigram 不命中
- 中英混合句（`咖啡 coffee` 命中短语加分，`咖啡 tea` 只命中中文词项）
- **两条检索路径都验证**：v1 组装器、v2 多信号、v3 混合
- 中文召回在两条路径上都不退化
- 配置模式校验（未知模式抛错，不静默回退）

**验证过测试能抓住旧实现**：把 `DEFAULT_RETRIEVAL_CONFIG.lexicalMatching` 临时改回 `'substring'` 后，端到端用例失败（v2、v3、默认值断言共 3 个），恢复后全部通过。

---

## 4. 对旧冻结基准的影响

同一份 12 例 fixture、同一对算法，只换匹配模式：

| 指标 | v1 (2.1.0) | v1 (2.2.0) | v2 (2.1.0) | v2 (2.2.0) |
|---|---|---|---|---|
| Recall@1 | 0.6528 | 0.6528 | 0.7361 | 0.7361 |
| Recall@5 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| MRR | 0.9167 | 0.9167 | 0.9583 | 0.9583 |
| NDCG@5 | 0.9385 | 0.9385 | 0.9692 | 0.9692 |
| 泄漏 | 1 | 1 | 0 | 0 |
| 顺序违规 | 1 | 1 | 0 | 0 |
| 重复对 | 6 | 6 | 0 | 0 |

**聚合指标完全不变。** 逐案例只有 1 例（`multi-topic-week-planning`）的第 4–6 位顺序变化，前三位不变。

原因很直接：这 12 个案例的查询都包含足够长的内容词，substring 与 token 匹配在它们上面结论一致。这也说明 **Phase A 的冻结基准从未覆盖到这个缺陷** —— 缺陷是在 Phase B 的语义数据集里被发现的。

旧结果保留为 `evaluation/reports/retrieval-benchmark-v1-frozen-config-2.1.0.json`，新报告通过 `config.lexicalMatching` 字段自述所用的匹配模式。

---

## 5. 对语义三段集的影响

### 5.1 开发集（13 例）

| 臂 | Recall@1 | MRR | NDCG@5 | 错误相关率 |
|---|---|---|---|---|
| v2 词法 | 0.5769 → **0.5000** | 0.6154 → 0.5385 | 0.5856 → 0.5087 | 0.1410 → **0.0385** |
| v3 混合 | 0.9615 → 0.9615 | 1.0000 → 1.0000 | 1.0000 → 1.0000 | 0.1410 → **0.0641** |

### 5.2 验证集（12 例）

| 臂 | Recall@1 | MRR | NDCG@5 | 错误相关率 |
|---|---|---|---|---|
| v2 词法 | 0.7917 → **0.6250** | 0.8333 → 0.6667 | 0.8011 → 0.6344 | 0.2500 → **0.0833** |
| v3 混合 | 0.9583 → 0.9583 | 1.0000 → 1.0000 | 1.0000 → 1.0000 | 0.2083 → **0.0833** |

### 5.3 留出集（12 例）

| 臂 | Recall@1 | MRR | NDCG@5 | 错误相关率 | 顺序违规 |
|---|---|---|---|---|---|
| v2 词法 | 0.4583 → **0.5417** | 0.5417 → 0.5833 | 0.5526 → 0.5511 | 0.1250 → **0.0833** | 1 → **0** |
| v3 混合 | 0.7917 → 0.7917 | 0.8333 → 0.8333 | 0.8333 → 0.8333 | 0.0833 → 0.0833 | 0 → 0 |

### 5.4 纯词法召回下降是「误命中被移除」，不是回归

开发集与验证集的 v2 词法召回下降，逐案例核对后全部来自**旧的偶然子串命中**：

| 案例 | 旧命中来源 | 新行为 | 混合臂 |
|---|---|---|---|
| `dev-low-confidence` | `like` 命中 `dislike` | 词法不再命中 | v3 仍以语义命中，排第 1 |
| `val-correction-pet` | `do` 命中 `dog` | 词法不再命中 | v3 仍以语义命中 |
| `dev-empty-evidence` | `an` 命中 `analyst` | **返回空**（这才是正确结果） | v3 也返回空 |

也就是说：旧的词法召回里有相当一部分是**因为错误的原因命中的**。移除它们降低了词法召回数字，但提高了正确性——错误相关率在三个集合上全部下降，`empty_evidence` 场景首次全部返回空。

混合臂的 Recall@1 / MRR / NDCG 在三段上**完全不变**，说明语义信号没有依赖这些假阳性。

### 5.5 留出集的重复运行说明

Phase B 已用留出集跑过一次（方案冻结后）。本次是**修复缺陷后重跑**，不是调参后挑好的结果。两次结果都保留：

- 修复前（Phase B）：v3 Recall@1 0.7917 / MRR 0.8333 / NDCG 0.8333 / 错误相关率 0.0833
- 修复后（本阶段）：v3 Recall@1 0.7917 / MRR 0.8333 / NDCG 0.8333 / 错误相关率 0.0833

**v3 在留出集上没有任何变化**——这是好事：说明 Phase B 的语义结论不是靠词法假阳性撑起来的。

---

## 6. 版本关系

| 版本 | 含义 |
|---|---|
| `RetrievalConfig 2.1.0` | substring 匹配（有缺陷），Phase A/B 的全部旧数字 |
| `RetrievalConfig 2.2.0` | token 匹配（默认），本阶段起的新数字 |
| `BENCHMARK_RUNNER_VERSION 1.0.0 → 2.0.0` | 报告新增 `config.lexicalMatching` 自述字段 |
| 报告文件 | 旧：`retrieval-benchmark-v1-frozen-config-2.1.0.json`（只读保留）<br>新：`retrieval-benchmark-v1.json`（每次运行覆盖，字段自述版本） |

旧指标**没有被静默改写**：冻结文件仍在仓库中，且与 Phase A 报告的数字一致。

---

## 7. 未做

- 没有为中文引入分词器（如 jieba）。当前用 bigram，能覆盖召回需求，代价是可能出现跨词边界的 bigram 命中（`食主` 这类）。若将来出现实际问题，再评估引入词典分词。
- 没有改动 `SqliteMemoryRepository.search()` 的子串语义（用户主动搜索框，见 §1）。
- 没有重新标注语义三段集的期望答案——修复改变的是召回原因，不是正确答案。
