# Phase B 最终报告：混合检索、语义召回与独立评测

- 仓库：`ve766/morrow-ai-companion-v2`
- 工作分支：`feature/algorithm-v2-phase-a`（沿用，未新开分支，未重置任何人的工作）
- 开始时远端 HEAD：`2b6373bc4717e7dfe16331bceb17287937bef8b8`（与 Phase A 报告一致，未被人推进）
- 结束时 HEAD：`51935e3`
- Draft PR：#1（未合并）

本报告逐条回答任务 §9 的验收问题。所有数字来自本机实际执行；未执行的项目单独标注。

---

## 1. 交付物索引

| 阶段 | 文档 | 代码 |
|---|---|---|
| 一 · 复核 | `phase-b-audit.md` | `retrieval-integrity.test.ts` |
| 二 · 评测集 | `phase-b-semantic-evaluation.md` §1–3 | `evaluation/fixtures/semantic-retrieval-{dev,validation,holdout}-v1.json` |
| 三 · 方案对比 | `phase-b-semantic-evaluation.md` §4–8 | `src/evaluation/semantic-retrieval-benchmark.ts`、`scripts/run-semantic-retrieval-benchmark.mjs` |
| 四 · 实现 | `phase-b-hybrid-retrieval.md` §1–5 | `retrieval-v2.ts`（v3 模式）、`retrieval-semantic.ts`、`onnx-semantic-encoder.ts` |
| 五 · 闭环 | `phase-b-hybrid-retrieval.md` §6 | `src/app/semantic-request-context.integration.test.ts` |
| 六 · 回归 / CI | 本文件 | — |

---

## 2. 阶段一复核：发现并修复了两个 Phase A 缺陷

| 缺陷 | 证据 | 处理 |
|---|---|---|
| 检索未使用回合固定时刻 | `prepare()` 持有 `evaluationAt` 却调用 `assembleContext(q, max)`；`prepare` 每回合跑两次（同意预览、实际派发），派发前有 `hashProviderInput(verified.input) !== preview.payloadSha256` 校验 | 已修：两次检索都传入 `{ now: evaluationAt }` |
| 纠正链窗口静默截断 | `MAX_SUPERSEDED_STATEMENTS = 200`，按 `updated_at DESC` 取窗口，超出部分无声丢弃 | 已修：上限 2000，按 `cap+1` 读取使截断可观测，决策记 `correctionChain.truncated` |

两条都有回归测试，且**验证过测试能抓住原缺陷**：把修复临时回退后，时钟用例报 `expected 2 to be 1`。

同时确认了一个更重要的结论：**Phase A 报告的 v2 指标是在被报告的同一批 12 个案例上调参得到的**（`git log -S "diversityPenalty: 0.2"` → `7d35a1c` 引入 0.20；`12e5093` 改成 0.05 并与基准同批提交）。因此本阶段没有沿用那些数字作基线。

---

## 3. 逐条回答验收问题

### 3.1 语义召回是否真正解决了不同措辞的问题？

**部分解决，且不是全部。**

留出集 12 例（方案冻结后只跑一次）的逐案例结果：

| 场景 | 词法 | 混合 | 判定 |
|---|---|---|---|
| 同义改写（milkshake ↔ lactose intolerant） | 空 | 命中 | ✅ 修好 |
| 关键词歧义（bank = 金融机构 vs 河岸） | 错召回河岸 | 正确 | ✅ 修好 |
| 同主题错记忆（早/晚） | 顺序反 | 顺序对 | ✅ 修好 |
| 跨语言（中文记忆 + 英文问题） | 空 | 命中 | ✅ 修好 |
| 跨语言（中文问题 + 英文记忆，爱好） | 空 | 仍空 | ❌ 失败 |
| 间接表达（买表 ↔ 攒首付） | 空 | 仍空 | ❌ 失败 |
| 语义矛盾 / 纠正 / 删除 / 低置信 / 空证据 | 正确 | 正确 | ✅ 保持 |

**11 个语义场景：修好 5 个，保持 4 个，仍有 2 个失败。**

失败的两类不是「再调参数就能过」，而是双编码器的能力边界：它擅长「字面不同、语义相近」，不擅长「需要语用推理才能关联」（买表→影响攒首付）和部分跨语言的抽象概念（爱好→收藏黑胶）。

### 3.2 相比 Phase A，Recall@K / MRR / NDCG 有何变化？

留出集（可信估计）：

| 指标 | Phase A（v2 词法） | 本阶段（v3 混合） | 变化 |
|---|---|---|---|
| Recall@1 | 0.4583 | **0.7917** | +0.3334 |
| Recall@5 | 0.5833 | **0.8333** | +0.2500 |
| MRR | 0.5417 | **0.8333** | +0.2916 |
| NDCG@5 | 0.5526 | **0.8333** | +0.2807 |
| 顺序违规 | 1 | **0** | −1 |
| 泄漏 | 0 | 0 | — |

**必须同时说明**：开发集与验证集上混合方案的 MRR/NDCG 都是 **1.0000**，留出集只有 0.8333。这说明前两段存在乐观偏差（我确实在开发集上核对了阈值分布），**0.83 才是应该被引用的数字**。

### 3.3 是否增加了错误相关召回？

**没有，反而下降。** 指标定义：返回结果中属于 `irrelevantIds`（词面相似但不相关）的比例。

| 集合 | 词法 | 混合 |
|---|---|---|
| 开发集 | 0.1410 | 0.1410 |
| 验证集 | 0.2500 | **0.2083** |
| 留出集 | 0.1250 | **0.0833** |

泄漏（`forbiddenIds`）在三个集合、两个臂上全部为 **0**。

### 3.4 纠正、删除和撤回语义是否仍然安全？

**是。** 关键在于处理顺序：`status → sensitivity → 纠正链 → 相关性打分`。纠正链判定在**任何打分之前**，所以一条被用户纠正掉的旧陈述不会因为「语义很像」而先拿到高分。

- 三个集合的 `semantic_contradiction` / `correction_safety` / `deletion_safety` 场景全部通过；
- 真实模型闭环测试中，「纠正后旧陈述不复活」「删除后不回流」都用**实际下发的请求体**验证过。

### 3.5 模型不可用时是否可靠回退？

**是，四条路径都验证过：**

| 情形 | 行为 | 验证方式 |
|---|---|---|
| 无 encoder | 直接走 v2 词法 | 集成测试（无 encoder） |
| 模型文件缺失 | 加载失败 → 词法 | `tryCreateOnnxSemanticEncoder` 返回 null |
| 编码抛错 | `buildSemanticSignals` 捕获 → 词法 | 集成测试（抛错 encoder），回合不失败 |
| 编码超时（>1.5 s） | `Promise.race` → 词法 | 代码路径 + 规模上限分析 |

所有回退都在决策里记 `semantic: { modelId, applied }`，**不会**用「全部相似度为 0」冒充，也不会绕过删除与权限规则。

### 3.6 Windows 资源消耗是否可接受？

实测（Windows 11，Node 22 / Electron 44）：

| 项目 | 实测 |
|---|---|
| 模型目录 | 130 MB（113 MB q8 ONNX + tokenizer） |
| 可选运行时 | `@huggingface/transformers` 47 MB + `onnxruntime-node`（win32 x64 约 50–60 MB） |
| 冷启动（离线、已缓存） | 2.1 s |
| 单条文本编码 | 6.2 ms |
| 一次检索（5 条记忆 + 查询） | 17.9 ms |
| 常驻内存 | RSS 496 MB / heap 227 MB |
| 安装包影响 | 约 +150–200 MB |

**判断：延迟可接受，体积与内存不算轻。** 这不是我能单方面决定的事——所以本阶段**没有**把运行时写进 `dependencies`，也没有把模型打进安装包。当前状态是「能力已实现并验证，分发未启用」。

**已知规模上限**：每次检索要编码全部候选（≤1000 条）。按线性外推，1000 条约 3.5 s，会触发 1.5 s 超时并退回词法。没有做向量缓存或索引，因此不存在索引与主表不同步的问题，但代价就是这个上限。

### 3.7 是否真实进入模型请求上下文？

**是。** `src/app/semantic-request-context.integration.test.ts` 的 6 个用例使用**真实 ONNX 模型**，断言对象是**实际下发的 HTTP 请求体**（`messages[0].content`），不是数据库行：

1. 长期偏好 → 不同措辞提问 → system 含 `vegetarian meals`、不含 `Osaka`，决策 `algorithm = memory-retrieval-v3-hybrid`、`semantic.applied = true`
2. 语义相同但已被纠正 → 含新陈述、不含旧陈述
3. 删除后 → 不含被删内容
4. 重启后 → 结果一致
5. 30 条记忆 → `characterCount ≤ 3000`
6. 无相关记忆 → `"memories":[]`

另外在**真实 Electron 主进程**内验证了运行时可用：`ELECTRON_OK dim=384`（Electron 44.9.3，win32 x64，无需 rebuild）。

### 3.8 哪些能力已验证，哪些仍只是接口或模拟？

| 能力 | 状态 |
|---|---|
| 语义召回在真实请求上下文生效 | **已验证**（真实模型 + 真实 HTTP body） |
| 纠正 / 删除 / 撤回在语义阶段仍安全 | **已验证** |
| 编码失败回退到词法 | **已验证** |
| 重启后一致 | **已验证** |
| Electron 主进程可加载 ONNX 运行时 | **已验证**（手工探针） |
| 打包后的应用能加载模型 | **未验证**（未改 electron-builder，运行时未进 `dependencies`） |
| 1000 条候选下的性能 | **未验证**（只有 5 条实测 + 线性外推） |
| 真实用户数据上的效果 | **未验证**（全部为合成数据） |
| 间接表达 / 部分跨语言 | **已知失败**，不是接口问题 |

### 3.9 CI 是否实际运行了新评测？

**没有。** 且**没有**通过绕过权限、删步骤或降断言来制造绿色。

当前状态（实测）：

```
$ gh auth status          → Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
$ gh api .../actions/permissions → {"enabled":true,"allowed_actions":"all",...}
$ git show HEAD:.github/workflows/ci.yml | grep -c evaluate:retrieval → 0
```

仓库 Actions 是开启的，限制在**凭据缺少 `workflow` 作用域**：推送包含 `.github/workflows/*` 的提交会被拒绝（`refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope`）。

**需要补齐的内容（精确到文件与权限）：**

- 文件：`.github/workflows/ci.yml`
- 位置：`verify` job 的 `Offline evaluations` 步骤
- 改动：追加一行 `npm run evaluate:retrieval`（Phase A 的生产检索回归门禁）
- 所需权限：具备 **`workflow`** 作用域的凭据（classic PAT 勾选 `workflow`，或 GitHub App 授予 Workflows: write）
- 操作步骤：
  1. `gh auth refresh -s workflow`（设备码授权，需账号持有人本人完成）
  2. 恢复那一行改动
  3. `git push`
- 语义评测（`run-semantic-retrieval-benchmark.mjs`）**不建议**进 CI：需要 130 MB 模型 + 可选运行时，会给每次 PR 增加数分钟与大量下载；它应当作为发布前的本地/手动门禁。

---

## 4. 修改了哪些文件

**检索层**

| 文件 | 改动 |
|---|---|
| `src/memory/retrieval/retrieval-config.ts` | 新增 `RETRIEVAL_ALGORITHM_V3_HYBRID`、`SemanticPolicy` 与范围校验 |
| `src/memory/retrieval/retrieval-v2.ts` | 构造函数接受算法 id；新增混合模式、归一化加权、RRF、候选门限；纠正链移到打分之前 |
| `src/memory/retrieval/retrieval-semantic.ts` | 新增。`SemanticSignals` / `SemanticEncoder` 端口、余弦、批量构建 |
| `src/memory/retrieval/onnx-semantic-encoder.ts` | 新增。可选 ONNX 适配器 + 惰性加载 |
| `src/memory/retrieval/retrieval-trace.ts` | 新增 `factors.semantic`、`decision.semantic`、`decision.correctionChain` |
| `src/memory/retrieval/retrieval-strategy.ts` | 请求增加 `semantic`、`supersededTruncated` |
| `src/memory/retrieval/retrieval-registry.ts` | 注册 v3 |
| `src/memory/memory-context-assembler.ts` | 因子与决策字段同步 |
| `src/memory/memory-service.ts` | 新增 `assembleContextWithSemantic`、超时、纠正链截断标记 |

**应用层**

| 文件 | 改动 |
|---|---|
| `src/app/companion-service.ts` | `prepare` 改为 async；检索固定到回合时刻；传入 encoder |
| `src/app/index.ts` | 模型存在时才创建惰性 encoder；环境变量开关 |

**评测**

| 文件 | 改动 |
|---|---|
| `src/evaluation/retrieval-benchmark.ts` | 新增语义场景枚举、`irrelevantIds`、`requiredScenarios`、错误相关指标；导出指标函数 |
| `src/evaluation/semantic-retrieval-benchmark.ts` | 新增。多臂对照运行器 |
| `src/evaluation/semantic-retrieval-cli.ts` | 新增。CLI |
| `scripts/run-semantic-retrieval-benchmark.mjs` | 新增。esbuild 打包运行（运行时外部化） |
| `scripts/fetch-semantic-model.mjs` | 新增。唯一允许联网下载模型的入口 |
| `evaluation/fixtures/semantic-retrieval-{dev,validation,holdout}-v1.json` | 新增。37 例 |
| `src/memory/retrieval/retrieval-integrity.test.ts` | 新增。阶段一两条缺陷的回归 |
| `src/app/semantic-request-context.integration.test.ts` | 新增。真实请求体闭环 |

**文档**：`phase-b-audit.md`、`phase-b-semantic-evaluation.md`、`phase-b-hybrid-retrieval.md`、本文件。

---

## 5. 实际执行的命令与结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | **通过** |
| `npm test` | **通过**：46 文件 / **323** 用例（本阶段开始 44 / 311） |
| `npm run evaluate` | **通过**（M3 检索 + M4 提醒） |
| `npm run evaluate:cognition` | **通过**（`networkCalls: 0`） |
| `npm run evaluate:retrieval` | **通过**：v1 泄漏 1 / v2 泄漏 0，MRR 0.9167 → 0.9583（与 Phase A 一致，未被本轮改动影响） |
| `node scripts/run-semantic-retrieval-benchmark.mjs --split dev` | 通过，13 例 |
| `... --split validation` | 通过，12 例 |
| `... --split holdout` | 通过，12 例（冻结后一次） |
| `npm run build` | **通过**；`out/main/index.js` 保留了对可选运行时的动态 import |
| `npm run smoke`（本地 Windows） | **执行但失败**：GPU 进程访问冲突 → `renderer-load-failed`，属环境阻塞（与上一轮同一现象） |
| Electron 主进程探针 | **通过**：`ELECTRON_OK dim=384` |
| **CI run `40274455249`（HEAD `f4c80b3`）** | **3/3 通过**：ubuntu verify 1m12s（`317 passed \| 6 skipped`，Electron smoke 通过）、windows verify 2m12s、Windows upgrade path 1m11s |

CI 的 `317 passed | 6 skipped` 是重要证据：跳过的正是 6 个需要真实模型的用例，说明它们**不会**在没有模型的环境里被 stub 顶替成"通过"。

未执行：`package:win` 打包（不在本阶段验收范围，且运行时不进生产依赖）。

---

## 6. 提交记录

| SHA | 内容 |
|---|---|
| `8e88e0c` | 阶段一：修复检索时刻与纠正链截断 + 复核报告 |
| `a84e1ca` | 阶段二/三：混合算法 + 三段评测集 + 多臂对照（单独可编译、可测试） |
| `51935e3` | 阶段四/五：接入真实对话路径 + 请求体闭环验证 |

每个提交都单独通过 `typecheck` 与 `test`（`a84e1ca` 用 stash 隔离验证过）。

---

## 7. 已知未完成

1. **分发未启用**：运行时不在 `dependencies`，模型不随包发布，`electron-builder` 未配置 `asarUnpack`。打包后的应用目前不会加载模型。
2. **无向量缓存**：每次全量重编码，1000 条候选会触发超时并退回词法。
3. **CI 未接入**（缺 `workflow` 作用域），补齐步骤见 §3.9。
4. **两个语义场景仍失败**（间接表达、一个跨语言方向），属模型能力边界。
5. **`lexicalScore` 的子串匹配缺陷未修**：`includes(term)` 让 `an` 命中 `analyst`，抬高了两臂的错误相关率。它是 Phase A 之前就有的问题，修它会改变 Phase A 冻结基准的全部数字，因此单独处理。
6. **基准仅 37 例合成数据**，无统计意义。
7. **本地 smoke 仍受 GPU 环境阻塞**，CI 是权威判断。

---

## 8. 下一阶段建议

1. 补 `workflow` 作用域，把 `evaluate:retrieval` 接进 CI；语义评测作为发布前手动门禁。
2. 决定是否分发语义能力：若要，需完成依赖 + `asarUnpack` + 模型下载 UI，并接受 +150–200 MB 安装包。
3. 修 `lexicalScore` 的子串匹配，然后整体重跑 Phase A 基准与三段语义集，重新冻结数字。
4. 若候选规模会上千，引入向量缓存（按记忆 `revision` 失效），否则超时回退会成为常态。
5. 间接表达类失败需要 reranker 或 LLM 辅助改写，属于新方案，需先论证成本与隐私。
