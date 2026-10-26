# Phase B 阶段二 / 三：独立评测集与候选方案对比

- 阶段二：建立开发 / 验证 / 留出三段独立评测集与指标定义
- 阶段三：比较词法、词法+扩展、词法+本地 embedding 的真实成本与收益
- 全部数字来自本机实际执行，命令见 §6

---

## 0. 结论

| 问题 | 答案 |
|---|---|
| 语义召回是否解决了「不同措辞」？ | **部分解决。** 留出集 Recall@1 0.4583 → 0.7917，MRR 0.5417 → 0.8333。同义改写、跨语言（一半）、关键词歧义三类明显变好；**间接表达与一个跨语言案例仍然失败** |
| 是否增加错误相关召回？ | **没有，反而下降。** 错误相关率 0.125 → 0.0833（留出集） |
| 纠正 / 删除 / 撤回语义是否仍安全？ | **是。** 三个集合泄漏均为 0，纠正链在语义打分之前生效 |
| 代价 | 模型 130 MB，常驻内存 +约 500 MB RSS，冷启动 2.1 s，单条查询 6 ms |
| 是否值得进生产 | **值得，但必须可选。** 见 §5 的取舍 |

---

## 1. 为什么必须重建评测集

Phase B 阶段一的复核发现：Phase A 的 `diversityPenalty` 是在被报告的那 12 个案例上调出来的（`7d35a1c` 引入 0.20，`12e5093` 改成 0.05 并与基准报告同批提交）。因此 Phase A 报告的 v2 指标带有乐观偏差，**不能**作为语义方案的对照基线。

本阶段据此把数据切成三段，并且**不修改**原有 12 例的预期答案（它们继续作为 Phase A 回归门禁 `npm run evaluate:retrieval`）。

| 集合 | 文件 | 用途 | 是否参与调参 |
|---|---|---|---|
| 开发集 | `semantic-retrieval-dev-v1.json`（13 例） | 选融合方式、核对阈值分布 | 是 |
| 验证集 | `semantic-retrieval-validation-v1.json`（12 例） | 比较候选方案、确认泛化 | 是（仅比较，不回头改 dev） |
| 留出集 | `semantic-retrieval-holdout-v1.json`（12 例） | 方案冻结后跑一次 | **否** |

三段的**内容互不重叠**（不同领域、不同措辞），但覆盖同一组场景。标签在跑任何模型之前写好。

---

## 2. 场景覆盖

每段都覆盖 11 类：

| 场景 | 检验什么 |
|---|---|
| `paraphrase` | 同义改写，无共享实词 |
| `indirect_expression` | 自然语言间接表达 |
| `cross_lingual` | 中英互查（两个方向） |
| `lexical_trap` | 关键词重叠但语义无关（spring / bank） |
| `similar_topic_wrong_memory` | 同主题不同事实（早/晚、上午/下午） |
| `semantic_contradiction` | 语义高度相似但事实相反 |
| `temporary_need_vs_longterm_preference` | 短期需求 vs 长期偏好 |
| `correction_safety` | 纠正后的旧陈述不得复活 |
| `deletion_safety` | 撤回 / 超权限记忆不得回流 |
| `low_confidence_inference` | 低置信推断不得压过高置信陈述 |
| `empty_evidence` | 无相关记忆时应返回空 |

每个案例显式标注：`expectedRelevantIds`（必须召回）、`irrelevantIds`（词面相似但不相关，召回即算错误相关）、`forbiddenIds`（绝不可出现）、`requiredOrder`（相对顺序）、`topics`、以及 `rationale`（判定依据）。

---

## 3. 指标

沿用 Phase A 的定义（见 `evaluation-protocol.md`），新增一项：

```
falseRelevantRate = |S ∩ irrelevantIds| / |S|
```

即「返回结果里有多少是词面相似但实际不相关的记忆」。这是任务要求的「错误相关召回率」。

其余：Recall@1/3/5、MRR、NDCG@5、leakCount、orderViolations、duplicatePairs、topicCoverage、budgetOverruns、determinism。

---

## 4. 阈值的事前设定与事后核对

语义候选门限 `candidateFloor = 0.28`、归一化区间 `floor 0.2 / ceiling 0.6` 是**写代码时的设计猜测**，在看到任何相似度数据之前就定下。

事后用 dev + validation 的全部记忆测量余弦分布：

| 分组 | min | p25 | median | max | n |
|---|---|---|---|---|---|
| 期望召回 | **0.300** | 0.404 | 0.556 | 0.845 | 23 |
| 不相关 / 禁止 | −0.029 | 0.041 | 0.331 | **0.568** | 22 |
| 中性 | 0.179 | 0.260 | 0.369 | 0.656 | 5 |

**关键发现：两组分布大幅重叠**（期望最低 0.300，不相关最高 0.568）。因此：

1. 单一余弦阈值**不可能**把「相关」和「不相关」分开——这印证了「不得把语义相似度当作事实置信度」；
2. `0.28` 恰好略低于期望样本的最低值 `0.300`，是能保住全部期望样本的上界附近，事前的猜测被数据佐证；
3. 真正的判别力来自**融合后的排序**（置信度、来源、纠正链、去重/多样性），而不是语义分本身。

**没有**据此回头调整阈值——调了就是在 dev 上过拟合。

---

## 5. 候选方案对比

四个候选：

| 代号 | 方案 | 说明 |
|---|---|---|
| C1 | 词法 v1 | Phase A 之前的原始检索 |
| C2 | 多信号 v2（仅词法） | Phase A 的默认算法 |
| C3 | v3 混合 · 归一化加权 | 词法归一化 + 语义归一化后加权 |
| C4 | v3 混合 · 倒数排名融合（RRF） | 两路排序融合，与量纲无关 |

### 5.1 开发集（13 例，参与调参）

| 指标 | C2 词法 | C3 加权 | C4 RRF |
|---|---|---|---|
| Recall@1 | 0.5769 | **0.9615** | **0.9615** |
| Recall@5 | 0.5769 | **1.0000** | **1.0000** |
| MRR | 0.6154 | **1.0000** | **1.0000** |
| NDCG@5 | 0.5856 | **1.0000** | **1.0000** |
| 泄漏 | 0 | 0 | 0 |
| 错误相关率 | 0.1410 | 0.1410 | 0.1410 |
| 顺序违规 | 0 | 0 | 0 |

### 5.2 验证集（12 例，用于比较方案）

| 指标 | C2 词法 | C3 加权 | C4 RRF |
|---|---|---|---|
| Recall@1 | 0.7917 | **0.9583** | **0.9583** |
| Recall@5 | 0.7917 | **1.0000** | **1.0000** |
| MRR | 0.8333 | **1.0000** | **1.0000** |
| NDCG@5 | 0.8011 | **1.0000** | **1.0000** |
| 泄漏 | 0 | 0 | 0 |
| 错误相关率 | 0.2500 | **0.2083** | **0.2083** |
| 顺序违规 | 0 | 0 | 0 |

### 5.3 留出集（12 例，方案冻结后跑一次）

| 指标 | C2 词法 | C3 加权 | C4 RRF |
|---|---|---|---|
| Recall@1 | 0.4583 | **0.7917** | **0.7917** |
| Recall@5 | 0.5833 | **0.8333** | **0.8333** |
| MRR | 0.5417 | **0.8333** | **0.8333** |
| NDCG@5 | 0.5526 | **0.8333** | **0.8333** |
| 泄漏 | 0 | 0 | 0 |
| 错误相关率 | 0.1250 | **0.0833** | **0.0833** |
| 顺序违规 | **1** | **0** | **0** |

### 5.4 加权与 RRF 没有分出胜负

**在三个集合、37 个案例上，C3 与 C4 的返回列表逐例完全相同。** 本数据集无法区分这两种融合方式。

因此选型理由**不是**「加权更好」，而是：

- 加权融合的每个因子都是可读的数值，能直接写进决策 trace 供人复核；
- 归一化（floor/ceiling）已经把「余弦与词项计数不同量纲」的问题显式处理掉了，不需要再靠排名来回避；
- RRF 需要额外两趟排序，在本数据集上没有换来任何收益。

**这个选择的证据强度是「未发现差异」，不是「已证明更优」。** 若将来换模型导致相似度分布变化，应重新比较。

### 5.5 留出集的逐案例结果（诚实版）

| 案例 | 场景 | 词法 | 混合 | 说明 |
|---|---|---|---|---|
| `hold-paraphrase-lactose` | 同义改写 | 空 | ✅ 命中 | 「milkshake」↔「lactose intolerant」 |
| `hold-indirect-deposit` | 间接表达 | 空 | ❌ 仍空 | 「买表」↔「攒首付」需要语用推理，双编码器做不到 |
| `hold-cross-lingual-zh-memory` | 跨语言 | 空 | ✅ 命中 | 中文记忆 + 英文问题 |
| `hold-cross-lingual-zh-query` | 跨语言 | 空 | ❌ 仍空 | 「我有什么爱好」↔「I collect vinyl records」失败 |
| `hold-lexical-trap-bank` | 关键词歧义 | 错召回 river bank | ✅ 正确 | 语义把「bank=金融机构」分辨出来 |
| `hold-similar-topic-evening` | 同主题错记忆 | 顺序反了 | ✅ 顺序修正 | 顺序违规 1 → 0 |
| `hold-semantic-contradiction-coffee` | 语义矛盾 | ✅ | ✅ | 纠正链在语义之前生效 |
| `hold-correction-job-title` | 纠正安全 | ✅ | ✅ | — |
| `hold-deletion-safety` | 删除安全 | ✅ | ✅ | — |
| `hold-low-confidence-cuisine` | 低置信推断 | ✅ | ✅ | — |
| `hold-temporary-vs-longterm` | 短期 vs 长期 | 0.5 | 0.5 | 两条都返回；r1=0.5 是「期望 2 条、只有 1 个首位」的指标口径，不是失败 |
| `hold-empty-evidence` | 空证据 | ✅ 空 | ✅ 空 | — |

**11 个语义场景里，混合方案修好了 5 个、保持 4 个、仍有 2 个失败。**

---

## 6. 运行方式与可复现性

```bash
# 1) 安装可选运行时（不写入 package.json，避免污染生产依赖）
npm install --no-save @huggingface/transformers@3

# 2) 显式下载模型（唯一的联网动作，113 MB q8）
node scripts/fetch-semantic-model.mjs

# 3) 跑三个集合
node scripts/run-semantic-retrieval-benchmark.mjs --split dev
node scripts/run-semantic-retrieval-benchmark.mjs --split validation
node scripts/run-semantic-retrieval-benchmark.mjs --split holdout
```

报告写入 `evaluation/reports/semantic-retrieval-<split>-report.json`（含逐案例结果与 `rationale`）。

确定性：每个算法在每个案例上连续执行两次并比较完整指标对象的规范化 JSON；三个集合均 `deterministic: true`。

模型不可用时，混合臂退化为纯词法并在报告中记录 `encoder.available: false`，**不会**伪造语义能力。

---

## 7. 资源与分发成本（实测）

| 项目 | 实测值 | 说明 |
|---|---|---|
| 模型目录 | **130 MB** | 含 113 MB q8 ONNX + tokenizer/config |
| 可选运行时 | `@huggingface/transformers` 47 MB + `onnxruntime-node`（Windows x64 约 50–60 MB） | 打包时可按平台裁剪 |
| 冷启动（已缓存、离线） | **2.1 s** | `allowRemoteModels=false` 下测得 |
| 单条文本 | 6.2 ms | — |
| 一次检索（5 条记忆 + 1 查询） | 17.9 ms | 批次 |
| 常驻内存 | RSS **496 MB** / heap 227 MB | 含 ONNX 运行时 |
| 网络 | **0**（模型就位后） | 运行时强制 `allowRemoteModels = false` |

对 Windows 安装包的影响：Electron 本体之外再增约 **150–200 MB**。这是本方案最实在的代价。

---

## 8. 顺带发现的既有缺陷（未在本阶段修复）

`lexicalScore` 用**子串包含**判断词项命中：

```ts
normalized.includes(term)
```

后果：短词项会在更长的单词内部命中。实测例子——查询 `What is the airspeed of an unladen swallow?` 命中记忆 `I work as a data analyst.`，因为词项 `an` 出现在 `analyst` 里。

- 这是 Phase A 之前就存在的问题（`retrieval-lexical.ts` 是从原组装器逐字抽取的）；
- 它同时影响词法臂与混合臂的词法部分，因此**不改变 v2 → v3 的相对比较**；
- 但它抬高了两个臂的错误相关率，并让 `empty_evidence` 场景在词法侧产生假阳性。

修复方向明确（ASCII 词项要求词边界，CJK 二元组保持子串），但会让 Phase A 的冻结基准数字整体变化，因此**单独处理**，不在语义评测中途改动基线。

---

## 9. 本阶段结论

1. 语义召回在「同义改写 / 跨语言 / 关键词歧义 / 同主题顺序」上带来可测且可复现的收益。
2. 收益不是全面的：间接表达与一个跨语言案例仍然失败，说明双编码器的能力边界就是「字面不同、语义相近」，而不是「需要推理才能关联」。
3. 安全语义没有退化：泄漏 0、错误相关率下降、纠正链先于语义打分。
4. 代价是真实的：130 MB 模型 + 约 500 MB RSS + 2 s 冷启动。
5. 融合方式的选择**没有**实验依据支撑「加权优于 RRF」，只是「未发现差异 + 加权更可审计」。
