# Phase C2：语义召回失败根因分析

- 基准：留出集 `semantic-retrieval-holdout-v1.json`（12 例，Phase B 修复词法缺陷后重跑）
- 诊断工具：`node scripts/diagnose-retrieval-case.mjs --dataset <fixture> --case <caseId>`
- 逐案例输出：候选结果、词法分、余弦、归一化语义分、融合前后排名、排除原因、最终交给模型的上下文文本
- 真实请求体验证：`src/app/retrieval-failure-diagnosis.integration.test.ts`（3 例，用真实 ONNX 模型，断言实际下发的 `messages[0].content`）

---

## 0. 结论

| 任务列出的类别 | 是否发现案例 | 根因 |
|---|---|---|
| 1. 语用关联（买表 ↔ 攒首付） | **是** | 余弦 **0.056**，远低于候选门限 0.28。双编码器把两句话映射到近正交方向。**不是阈值问题** |
| 2. 跨语言（我有什么爱好 ↔ I collect vinyl records） | **是** | 余弦 **0.246**，恰低于门限 0.28。**排序是对的**（0.246 vs 0.050），是门限边界 |
| 3. 语义相似但事实不同 | 未发现失败 | 相似度更高的被纠正项（余弦 0.660）被纠正链正确排除 |
| 4. 关键词相似但实际无关 | 未发现失败 | 混合排序把语义分压过词法分 |
| 5. 相关记忆未进候选集 | **是**（1、2 两例） | 候选门限 |
| 6. 候选正确但排序错误 | 修复后未发现 | 修复前 `hold-similar-topic-evening` 属此类，词法修复已解决 |
| 7. 排序正确但被预算裁掉 | 未发现 | 语义三段集没有超预算案例（见 C3 计划） |

---

## 1. 「买表 ↔ 攒首付」：语用推理，不是相似度

```
case: hold-indirect-deposit (indirect_expression)
query: Should I buy this expensive watch?
expected: deposit   irrelevant: plant
id          lex  cosine  semN   rankL rankH  incl  reason
deposit       0   0.056   0.00    -      -     no  irrelevant
plant         0  -0.098   0.00    -      -     no  irrelevant
最终上下文: {"memories":[]}
```

**根因**：`cosine(查询, "I am saving for a house deposit.") = 0.056`。

模型卡说明：`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`，Apache-2.0（HF API 实测），384 维，`max_seq_length 128`，均值池化。它是**释义/语义检索**模型，不做常识推理。

「买手表」与「攒首付」的关联是**经济约束推理**：需要知道买表会减少储蓄。这不是字面改写，也不是分布相似性。0.056 接近零，说明两句话在该模型的向量空间里几乎正交。

**为什么不调阈值**：0.056 低于不相关基线的**中位数**（0.331，见 C1 校准表）。把门限降到 0.05 会把大量无关记忆放进上下文，空证据场景会立即失效。**这是能力边界，不是参数问题。**

**证据与不确定性**：证据充分（余弦值、上下文为空、真实请求体）。不确定的是「其他 embedding 模型是否也一样」——本阶段未测第二个模型。

---

## 2. 「我有什么爱好」↔ `I collect vinyl records`：门限边界

```
case: hold-cross-lingual-zh-query (cross_lingual)
query: 我有什么爱好？
expected: vinyl   irrelevant: commute
id          lex  cosine  semN   rankL rankH  incl  reason
vinyl         0   0.246   0.12    -      -     no  irrelevant
commute       0   0.050   0.00    -      -     no  irrelevant
最终上下文: {"memories":[]}
```

**根因**：`cosine = 0.246`，门限 `candidateFloor = 0.28`，差 0.034。

与案例 1 不同：这里**排序是对的**。正确的记忆（0.246）远高于无关记忆（0.050）。如果它进入候选集，融合后会排第 1。问题只在**准入门限**。

模型的多语言能力实测有效：同向（中文记忆 + 英文问题）在 `hold-cross-lingual-zh-memory` 上成功（余弦 0.4+），反向这一条失败。失败发生在「需要把『爱好』这个抽象类目映射到『收藏黑胶』这个具体行为」的位置——中文的「爱好」是个上位词，而英文记忆没有提任何类目词。

**为什么不改门限**：这是一个**留出集**案例。用它来调 `candidateFloor` 就是在留出集上调参，任务明确禁止。

 disciplines:
- 开发/验证集里没有任何期望记忆的余弦落在 0.20–0.30 区间（期望样本最低 0.300），因此**没有证据**支持把门限降到 0.28 以下；
- 降门限会直接威胁 `empty_evidence` 场景（空证据保护），而那是安全性要求。

**正确路径**：把它记录为已知边界。若下一阶段要放宽门限，必须先构造一个**新的开发集**，其中包含余弦在 0.20–0.28 区间的正例与更接近 0 的负例，用那批数据重新定门限，再冻结、再跑一次新留出集。

---

## 3. 语义相似但事实不同：防护有效，且证据很强

```
case: hold-semantic-contradiction-coffee (semantic_contradiction)
query: Do I still drink coffee?
expected: coffee-quit   forbidden: coffee-restated
id                 lex  cosine  semN   rankL rankH  incl  reason
coffee-quit          1   0.643   1.00     1     1   yes
coffee-restated      0   0.660   0.00     -     -    no  superseded_statement
最终上下文含: "I stopped drinking coffee."（不含 "two coffees a day"）
```

**这是整个阶段最重要的证据。** 被禁止的记忆（`coffee-restated`，用户明确替换掉的旧陈述，且被再次创建为新记忆）的余弦是 **0.660，比正确答案的 0.643 还高**。

它仍然被排除，原因是纠正链判定发生在**任何打分之前**。

这直接回应了任务的要求：「不得让相似但错误的旧记忆压过用户明确纠正后的新事实」「不得把语义相似度当作事实置信度」。语义模型在这里已经**错了**，但系统没有跟着错。

---

## 4. 关键词相似但实际无关：排序被语义纠正

```
case: hold-lexical-trap-bank (lexical_trap)
query: Which bank do I use?
id           lex  cosine  semN   rankL rankH  incl
bank-money     0   0.370   0.42     -     1   yes
bank-river     1   0.221   0.05     1     2   yes
```

词法上 `bank-river` 独占命中（`bank` 一词只在它里面以 token 形式出现），所以纯词法排第 1，与期望相反。

混合后 `bank-money` 的语义分（0.42）压过 `bank-river`（0.05），顺序被修正为 1、2。两个都在返回集里，`bank-river` 按 fixture 标注记为错误相关——所以错误相关率仍非零，但**正确答案排到了第 1 位**。

这正是「语义相似度作为相关性信号、而非事实信号」的正确用途。

---

## 5. 类别 6 与 7

**6. 候选正确但排序错误**：修复前 `hold-similar-topic-evening`（`I do yoga before bed.` vs `I go running before breakfast.`）属于此类，纯词法把早晨跑步排在前面，且顺序违规 1 次。词法修复后该案例顺序正确。**修复后全部分割的顺序违规为 0**，未再发现此类案例。

**7. 排序正确但被预算裁剪**：现有语义三段集没有超过 25 条 / 3000 字符的案例，因此**未观察到**此类失败。这不是「不存在」，而是「数据集没覆盖」——已列入 C3 要补的场景（同主题大量重复 + 预算限制）。

---

## 6. 真实 Provider 请求体验证

`src/app/retrieval-failure-diagnosis.integration.test.ts`，3 个用例，全部使用真实 ONNX 模型，断言**实际下发的 `messages[0].content`**：

| 用例 | 断言 |
|---|---|
| 买表 ↔ 攒首付 | `decision.algorithm = v3-hybrid`，`semantic.applied = true`，`selected = 0`，system 含 `"memories":[]`，不含 `house deposit` |
| 中文爱好问题 | `applied = true`，`selected = 0`，system 含 `"memories":[]`，不含 `vinyl` |
| 对照：纠正防护 | system 含 `I stopped drinking coffee`，**不含** `two coffees a day` |

第三个是对照：证明这些失败不是「管道没通」——同样的管道在语义矛盾场景下正确工作。

---

## 7. 复现

```bash
node scripts/diagnose-retrieval-case.mjs --case hold-indirect-deposit
node scripts/diagnose-retrieval-case.mjs --case hold-cross-lingual-zh-query
node scripts/diagnose-retrieval-case.mjs --case hold-semantic-contradiction-coffee
node scripts/diagnose-retrieval-case.mjs --case hold-lexical-trap-bank
```

需要先 `npm install --no-save @huggingface/transformers@3` 与 `node scripts/fetch-semantic-model.mjs`；加 `--no-encoder` 可看纯词法路径。

---

## 8. 仍不确定的部分

1. **其他模型的跨语言/语用能力**：只测了一个模型。换 `multilingual-e5-small` 或更大的模型是否解决这两个案例，未验证。
2. **门限的留出集边界**：0.246 这个值属于留出集，按纪律不能用来调参。若下一阶段放宽门限，需要新开发集支撑。
3. **预算场景**：无数据覆盖，C3 补齐。
4. **更大候选规模下的表现**：无数据覆盖（现有案例最多 30 条记忆）。
