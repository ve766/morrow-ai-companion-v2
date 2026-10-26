# 检索评测协议（Evaluation Protocol）

本文件定义 Morrow V2.1 记忆检索的离线评测规范：数据集格式、指标计算方式、运行入口、以及这些数字**不能**证明什么。

相关文件：

| 文件 | 作用 |
|---|---|
| `evaluation/fixtures/retrieval-benchmark-v1.json` | 固定评测集（合成数据） |
| `src/evaluation/retrieval-benchmark.ts` | 指标计算与门禁（纯函数，可单测） |
| `src/evaluation/retrieval-benchmark-cli.ts` | 命令行入口 |
| `scripts/run-retrieval-benchmark.mjs` | esbuild 打包后执行 CLI |
| `evaluation/reports/retrieval-benchmark-v1.json` | 最近一次实际运行的报告（随仓库提交） |

---

## 1. 与既有 M3 评测器的区别（重要）

仓库原有的 `npm run evaluate`（`src/evaluation/offline-evaluation.ts`）**不测生产检索**。它的 `runBaseline` / `runCandidate` 是两段独立重写的匹配逻辑，既不 import `MemoryContextAssembler`，也不打开生产数据库，报告里自己写明 `candidateActivation: offline-review-only`。

本协议要求：

> **被评测对象必须是生产代码。** 评测器只能调用 `selectRetrievalStrategy()` 拿到的真实策略对象，参数必须是 `RetrievalConfig`。

因此本基准的可信度来自「跑的就是用户拿到的那段代码」，而不是指标公式本身有多复杂。

---

## 2. 运行方式

```bash
npm run evaluate:retrieval
```

可选参数（路径必须落在 `evaluation/` 内）：

```bash
node scripts/run-retrieval-benchmark.mjs --dataset retrieval-benchmark-v1.json --output retrieval-benchmark-v1.json
```

退出码：

- `0`：门禁全部通过；
- `1`：任一门禁失败（stderr 会打印失败项名称）。

该命令同时被 `npm run verify` 与 `.github/workflows/ci.yml` 调用，因此「未执行的测试」不会出现在验收报告里。

---

## 3. 数据集格式

```jsonc
{
  "schemaVersion": 1,
  "datasetId": "morrow-retrieval-benchmark",
  "datasetVersion": "1.0.0",
  "source": "synthetic",          // 只接受 synthetic
  "seed": 20261025,
  "cases": [
    {
      "id": "explicit-correction-cross-record",
      "version": 1,
      "scenario": "explicit_correction",   // 必须是 12 个场景之一
      "query": "what tea do I like",
      "maximumSensitivity": "personal",
      "now": "2026-10-25T00:00:00.000Z",   // 固定评测时刻，禁止用真实时钟
      "memories": [
        {
          "id": "tea-corrected",
          "text": "I prefer black tea now.",
          "sourceCategory": "user_explicit_input",   // 三选一，与生产枚举一致
          "status": "active",                        // active | retracted
          "sensitivity": "personal",                 // normal | personal | sensitive
          "confidence": 85,                          // 1..100，必填
          "createdAt": "2026-03-01T00:00:00.000Z",
          "updatedAt": "2026-09-01T00:00:00.000Z",
          "lastConfirmedAt": "2026-09-01T00:00:00.000Z"
        }
      ],
      "supersededStatements": [
        { "memoryId": "tea-corrected", "revision": 1, "text": "I like green tea.",
          "supersededAt": "2026-09-01T00:00:00.000Z",
          "supersedingConfirmedAt": "2026-09-01T00:00:00.000Z" }
      ],
      "expectedRelevantIds": ["tea-corrected"],   // 必须被检索到
      "forbiddenIds": ["tea-restated"],           // 绝不允许出现
      "requiredOrder": ["tea-corrected", "tea-milk"],  // 相对顺序约束
      "topics": { "tea-corrected": "drink" }      // 用于主题覆盖
    }
  ]
}
```

约束（`validateBenchmarkDataset` 强制执行，违反即抛错，不做静默修正）：

- `id` 唯一；`scenario` 必须在 12 个枚举内；
- 记忆字段类型与生产 `MemoryRecord` 一致，`confidence` 必须是 1..100 的整数（**缺失或 0 不会被当成高置信度**，直接判非法）；
- `expectedRelevantIds` / `forbiddenIds` / `requiredOrder` / `topics` 引用的 id 必须真实存在；
- `supersededStatements[].memoryId` 必须存在于本案例；
- 时间戳必须是规范 UTC ISO 字符串。

**数据来源**：全部为合成数据，不含任何真实用户对话。不要往这里放脱敏不彻底的真实数据。

---

## 4. 指标定义

设某案例的期望集合为 `E = expectedRelevantIds`，禁止集合为 `F = forbiddenIds`，算法返回的有序列表为 `S`（长度即 `selected` 数量），`K` 为截断位次。

### 4.1 Recall@K

```
Recall@K = |E ∩ S[0..K)| / |E|      （|E| = 0 时定义为 1）
```

报告 `K ∈ {1, 3, 5}`。K=5 与生产预算（25 条）无关，是**可比性**选择：小 K 更能反映「是否把最该用的放在前面」。

### 4.2 MRR（Mean Reciprocal Rank）

```
RR = 1 / (S 中第一个属于 E 的下标 + 1)      （E 为空时定义为 1；未命中为 0）
MRR = 所有案例 RR 的算术平均
```

### 4.3 NDCG@K

二值增益（属于 E 记 1，否则 0）：

```
DCG@K  = Σ_{i=0..K-1} rel(i) / log2(i + 2)
IDCG@K = Σ_{i=0..min(|E|,K)-1} 1 / log2(i + 2)
NDCG@K = DCG@K / IDCG@K          （IDCG = 0 时定义为 1）
```

不做分级增益：本阶段没有可信的相关度分级标注，编造等级会让指标看起来更精细但更假。

### 4.4 泄漏计数（leakCount）

```
leaks(case)  = S ∩ F
leakCount    = Σ_cases |leaks(case)|
```

`F` 覆盖三类：已撤回（`status: retracted`）、超权限（`sensitivity` 高于请求上限）、被纠正取代（`supersededStatements` 中的旧陈述）。**该指标是硬门禁，必须为 0。**

### 4.5 顺序违规（orderViolations）

对 `requiredOrder = [a, b, c]` 中每一对 `(x, y)`（x 在 y 之前）：若两者都被返回且 `index(x) > index(y)`，记 1 次违规。缺失项不计违规（由 Recall / leak 覆盖）。

用于表达「纠正后的信息必须排在旧信息之前」「高置信度陈述必须排在低置信度推断之前」这类**位置**要求——单纯的 precision/recall 看不出来。

### 4.6 重复对数（duplicatePairs）

在返回集合内部，对每一对记忆计算词项集合的 Jaccard 相似度；`≥ 0.9` 记为一对重复。

```
duplicatePairs(case) = #{(i, j) : i < j, Jaccard(terms_i, terms_j) ≥ 0.9}
```

不用「归一化文本相等」是因为生产去重已覆盖完全相同的情况；这里要抓的是**换句话说的同一件事**。

### 4.7 主题覆盖（topicCoverage）

```
expectedTopics = { topics[id] : id ∈ E }
covered        = { topics[id] : id ∈ S }
topicCoverage  = |expectedTopics ∩ covered| / |expectedTopics|   （expectedTopics 为空时定义为 1）
```

### 4.8 预算超限（budgetOverrun）

```
budgetOverrun = (characterCount > config.maxCharacters) ∨ (|S| > config.maxMemories)
```

`characterCount` 是最终写入模型上下文的 JSON 文本长度，与生产完全一致（共用 `encodeMemoryContext`）。

### 4.9 确定性（deterministic）

每个案例对每个算法连续执行两次，比较**完整指标对象的规范化 JSON**。任一案例不一致则整体 `deterministic = false`。

---

## 5. 逐案例胜负判定

`compare(v1, v2)` 按固定优先级字典序比较（高优先级先决定）：

1. 泄漏更少（`-leaks`）
2. 顺序违规更少（`-orderViolations`）
3. 重复对更少（`-duplicatePairs`）
4. Recall@5 更高
5. MRR 更高
6. NDCG@5 更高
7. 主题覆盖更高
8. 未超预算

泄漏排在第一位，是因为「把用户删掉/纠正掉的东西重新喂给模型」是安全性问题，不是排序偏好问题。

---

## 6. 门禁（gate）

`npm run evaluate:retrieval` 只有在以下**全部**成立时退出码为 0：

| 检查 | 含义 |
|---|---|
| `v2NoLeaks` | v2 泄漏总数 = 0 |
| `v2NoBudgetOverrun` | v2 无预算超限 |
| `v2Deterministic` / `v1Deterministic` | 两算法重复执行结果一致 |
| `noRecallRegression` | `recall@5(v2) ≥ recall@5(v1)` |
| `noMrrRegression` | `MRR(v2) ≥ MRR(v1)` |
| `noNdcgRegression` | `NDCG@5(v2) ≥ NDCG@5(v1)` |
| `fewerLeaks` | `leaks(v2) ≤ leaks(v1)` |
| `fewerOrderViolations` | `orderViolations(v2) ≤ orderViolations(v1)` |
| `fewerDuplicates` | `duplicatePairs(v2) ≤ duplicatePairs(v1)` |
| `noTopicCoverageRegression` | `topicCoverage(v2) ≥ topicCoverage(v1)` |
| `coversEveryScenario` | 12 个场景全覆盖 |

门禁失败时 `activation.recommendedAlgorithm` 会自动回到 `memory-retrieval-v1`，报告仍会写出——**失败的升级会被记录，而不是被隐藏**。

---

## 7. 新增案例的流程

1. 在 `evaluation/fixtures/retrieval-benchmark-v1.json` 增加案例，`scenario` 选已有枚举（新增枚举需同时改 `BENCHMARK_SCENARIOS`）。
2. 明确写出 `expectedRelevantIds` / `forbiddenIds` / `requiredOrder`，并在 `docs/algorithm-v2/retrieval-benchmark.md` 记录判定依据。
3. 运行 `npm run evaluate:retrieval`，确认门禁仍然通过。
4. 若新案例导致 v2 失败：**不要**放宽门禁或删除案例。要么修正算法，要么把失败如实记录进基准文档。

---

## 8. 这些数字不能证明什么

- 案例是合成的、规模很小（12 例）。它们证明「在这些写明的场景上行为符合预期」，不证明真实用户准确率，也不提供统计显著性。
- `expectedRelevantIds` 是设计判断，不是用户标注的真值。
- 项目没有嵌入模型，因此**不报告任何语义相似度指标**。检索仍要求记忆与查询至少共享一个词项——这是能力边界，不是评测缺陷。
- 词法稳定性分类（长期偏好 / 临时需求）是关键词启发式，案例特意包含了它能识别的线索；真实文本上的表现会差于基准。
- 基准直接调用策略对象，不经过 IPC、数据库、Provider；跨重启一致性由 `src/memory/retrieval/retrieval-closed-loop.test.ts` 和 `tests/acceptance` 覆盖。
