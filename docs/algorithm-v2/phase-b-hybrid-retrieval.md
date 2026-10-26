# Phase B 阶段四 / 五：混合检索实现与真实闭环验证

- 阶段四：把通过评测的混合方案接入生产检索路径，带可回退与降级
- 阶段五：用**实际构建的 Provider 请求体**验证语义召回真的进入了模型上下文

---

## 1. 架构

```
CompanionService.sendChat
  └─ ChatService.prepare (async)
       └─ MemoryService.assembleContextWithSemantic(query, max, { now }, encoder)
            ├─ encoder 存在？ 否 → assembleContext()（纯词法，v2）
            ├─ buildSemanticSignals(query, 全部候选文本)   ← 一次批量编码
            │     └─ 失败 / 超时 1.5s → null → 退回纯词法
            └─ RetrievalStrategy.retrieve(request{ ..., semantic })
                  └─ memory-retrieval-v3-hybrid
```

关键设计：**检索算法保持同步且确定**。向量在检索之前算好，以 `SemanticSignals`（`similarity(memoryText) => number | null`）注入，算法内部只做查表与算术。

这样做的原因：

- 同模型 + 同文本 = 同向量，检索可重放，不引入异步不确定性；
- 算法可在没有 130 MB 模型的机器上单测；
- 编码失败时只需返回 `null`，不需要在算法里处理异常路径。

---

## 2. 处理顺序（不可调换）

`MultiSignalMemoryRetriever` 对每个记忆的处理顺序：

```
1. status !== 'active'            → retracted            ← 删除/撤回
2. sensitivity > 请求上限          → sensitivity          ← 权限
3. 纠正链判定为 resurrected        → superseded_statement ← 纠正语义
4. 词法相关 或 语义 ≥ candidateFloor → 否则 irrelevant
5. 打分（词法 + 语义融合 + 置信度 + 来源 + 确认 + 衰减 + 时间敏感）
6. 去重（完全同文 / Jaccard ≥ 0.9）
7. MMR 多样性
8. 预算裁剪（25 条 / 3000 字符）
9. 写决策 trace 与事件
```

第 3 步在**任何相关性打分之前**。这是语义阶段最容易出错的地方：如果先算分再判纠正，一条被用户纠正掉的旧陈述会因为语义相似度高而拿到高分，随后很难再被正确排除。测试 `dev-semantic-contradiction` / `hold-semantic-contradiction-coffee` 专门覆盖这一点。

---

## 3. 融合方式与「语义相似度不是事实置信度」

采用**归一化加权**（实验未发现 RRF 更优，理由见 `phase-b-semantic-evaluation.md` §5.4）：

```
semanticNorm = clamp01((cosine − floor) / (ceiling − floor))      // floor 0.2, ceiling 0.6
relevance    = w.lexical × (lexicalScore / ceiling)               // 各自先归一化
             + w.semantic × semanticNorm
baseScore    = relevance
             + w.confidence × (confidence/100)
             + w.provenance × provenanceScore[sourceCategory]
             + w.confirmation × (hasConfirmed ? 1 : 0.5)
             + w.recency × decay(age, halfLife(stability))
             + w.timeSensitivity × decay(age, 7d)   // 仅时效敏感回合
```

语义项只出现在 `relevance` 里，**从不**参与置信度或来源项。一条语义很像的模型推断不会因为「像」就获得事实地位——它仍然受 `provenance`（0.45–1.0）与 `confidence` 约束。

归一化是显式的：词法除以理论上界（4 + 词项数），语义用 floor/ceiling 映射到 0–1。**没有**把原始余弦与词项计数直接相加。

---

## 4. 配置与回退

```ts
// retrieval-config.ts
semantic: {
  enabled: false,                    // 只有 v3 会自动置 true
  modelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  floor: 0.2, ceiling: 0.6,          // 归一化区间
  weight: 0.5,                       // 与 w.lexical 同量级
  fusion: 'weighted',                // 'weighted' | 'rrf'
  rrfK: 20,
  candidateFloor: 0.28               // 低于此不进入候选
}
```

回退矩阵：

| 情形 | 行为 |
|---|---|
| 没有 encoder | `algorithm = memory-retrieval-v2`，纯词法 |
| 模型文件缺失 | 加载失败 → `embed` 抛错 → `buildSemanticSignals` 返回 null → 纯词法 |
| 编码超时（>1.5 s） | 同上，纯词法 |
| 某条记忆无向量 | 该条语义分按 0 处理，其余照常 |
| 运行时包未安装 | 动态 import 失败 → 纯词法，不崩溃 |

所有回退都会在 `retrieval.decision` 事件里记 `semantic: { modelId, applied }`。`applied: false` 且 `modelId: null` 表示「没有 encoder」；`modelId` 有值但 `applied: false` 表示「有配置但这次没拿到信号」——两种状态不同，不能混为一谈。

**回退不会绕过任何规则**：过滤顺序在打分之前，与是否启用语义无关。

---

## 5. 分发与开关

| 项 | 现状 |
|---|---|
| 运行时依赖 | `@huggingface/transformers` **未写入 `package.json`**（评测与本地运行用 `npm install --no-save`） |
| 模型 | 不随仓库提交；`.models/` 已加入 `.gitignore`；由 `scripts/fetch-semantic-model.mjs` 显式下载 |
| 应用内开关 | `MORROW_SEMANTIC_MODEL_DIR`（默认 `<userData>/models`）、`MORROW_SEMANTIC_MODEL_ID`、`MORROW_SEMANTIC_DISABLED=1` |
| 启动行为 | 仅当模型目录存在时才预热；否则完全不加载（不占内存、不拖慢启动） |
| 网络 | 运行时强制 `allowRemoteModels = false`；唯一的联网动作是手动执行 fetch 脚本 |

**为什么没有直接写进生产依赖**：加上运行时后安装包增大约 150–200 MB，这是产品决策，不该由算法阶段单方面决定。当前状态是「能力已实现并验证，分发未启用」，见 §7。

---

## 6. 真实闭环验证

`src/app/semantic-request-context.integration.test.ts`（9 个用例，全部通过）。断言对象是**实际下发的 HTTP 请求体**（`messages[0].content`），不是数据库行。

其中 6 个用例使用**真实 ONNX 模型**（模型文件缺失时自动 skip，绝不静默替换成 stub）：

| # | 场景 | 断言 |
|---|---|---|
| 1 | 长期偏好 → 不同措辞提问 | system 含 `vegetarian meals`，不含 `Osaka`；决策事件 `algorithm = memory-retrieval-v3-hybrid`、`semantic.applied = true`、`modelId` 正确 |
| 2 | 语义完全相同但已被纠正 | system 含 `avoid crowded parties`，**不含** `love crowded parties` |
| 3 | 删除后语义索引 | system 不含 `shellfish` |
| 4 | 重启后 | 同一问题仍命中 `vegetarian meals` |
| 5 | 30 条记忆 + 预算 | `characterCount ≤ 3000` |
| 6 | 无相关记忆 | system 为 `"memories":[]` |

另外 3 个用例不依赖模型，验证接线与降级：

| # | 场景 | 断言 |
|---|---|---|
| 7 | 手工构造的编码器 | 语义信号确实改变返回集合（证明管线通了，**不**声称语义质量） |
| 8 | 编码器抛错 | 回合不失败，退回词法命中；决策记录 `semantic: { modelId: null, applied: false }` |
| 9 | 完全没有 encoder | 词法检索正常 |

### 6.1 Electron 主进程内实测

最大的集成风险是 `onnxruntime-node` 能否在 Electron 的 Node ABI 下加载。实测（Electron 44.9.3，Windows x64）：

```
ELECTRON_OK dim=384 values=768
```

在真实 Electron 主进程中成功加载模型并编码，**无需 rebuild**（N-API 稳定 ABI）。

> 复现注意：本机环境设置了 `ELECTRON_RUN_AS_NODE=1`，会让 electron 退化为普通 Node 并导致 `require('electron')` 返回路径字符串。测试时需 `env -u ELECTRON_RUN_AS_NODE`。

### 6.2 一致性（纠正 / 删除 / 备份恢复）

- 没有引入向量索引或向量缓存，因此**不存在**「索引与主表不同步」的问题：每次检索都用当前活跃记忆重新编码。
- 代价是每次检索要编码全部候选（≤1000 条）。实测 5 条记忆 17.9 ms；1000 条时按线性外推约 3.5 s，会被 1.5 s 超时截断并退回词法。**这是已知的规模上限**，见 §7。
- 删除 / 撤回 / 权限仍然以主表 `status` 与 `sensitivity` 为唯一权威，语义层不持有第二份事实来源。

---

## 7. 未完成 / 风险

| 项 | 状态 | 说明 |
|---|---|---|
| 生产依赖与安装包 | **未启用** | 需要把运行时写入 `dependencies`、在 `electron-builder.files` 中放行 `node_modules/@huggingface/**` 与 `node_modules/onnxruntime-node/**`，并对 `.node`/`.dll` 配置 `asarUnpack`。未做，因此**打包后的应用目前不会加载模型** |
| 向量缓存 / 索引 | 未做 | 每次全量重编码。1000 条候选会触发 1.5 s 超时并退回词法，属于当前设计的规模上限 |
| 模型分发 | 未做 | 需用户手动运行 fetch 脚本；无 UI 引导 |
| CI 覆盖 | 未做 | 语义评测未进入 CI（原因见阶段六报告），且模型不在仓库中 |
| 间接表达 | 能力缺口 | 「买表」↔「攒首付」这类需要语用推理的关联，双编码器做不到 |
| 一个跨语言方向 | 能力缺口 | 「我有什么爱好」↔「I collect vinyl records」失败 |

---

## 8. 回退方式

保留两条完整的回退路径，都不需要改代码：

1. **运行时**：`MORROW_SEMANTIC_DISABLED=1`，或移走模型目录 → 立即退回 v2 纯词法。
2. **调用级**：`assembleContextWithSemantic(..., config: { algorithm: 'memory-retrieval-v2' })` 显式钉住 v2，即使 encoder 可用。

Phase A 的 v1 也仍然可选（`memory-retrieval-v1`），继续作为基准对照臂。
