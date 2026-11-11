# Phase B 阶段一：复核 Phase A 的真实性

- 复核对象：`feature/algorithm-v2-phase-a` @ `2b6373bc4717e7dfe16331bceb17287937bef8b8`
- 复核时远端 HEAD：`2b6373bc4717e7dfe16331bceb17287937bef8b8`（与报告一致，未被他人推进）
- 工作区：干净
- 方法：直接读代码 + 跑命令 + 查 git 历史；**不采信 Phase A 文档的自述**。

---

## 0. 结论表

| # | 复核项 | 结论 | 判定 |
|---|---|---|---|
| 1 | `diversityPenalty` 默认值与配置来源 | 0.05，唯一来源 `DEFAULT_RETRIEVAL_CONFIG`，无数据库/环境变量覆盖 | **成立** |
| 2 | v1 与 v2 是否确实调用生产检索策略 | 生产与评测共用 `selectRetrievalStrategy()` | **成立** |
| 3 | 评测案例是否被用于调参 | **是**。0.20 → 0.05 与基准提交同属一次提交 | **不成立（污染）** |
| 4 | 固定时钟是否贯穿生产检索调用链 | **否**。`prepare()` 持有 `evaluationAt` 却未传入检索 | **不成立 → 已修** |
| 5 | 纠正链是否处理多修订与缺失历史 | 多修订 ✓；缺失历史降级 ✓；但窗口静默截断 200 条 | **部分 → 已修** |
| 6 | 删除/撤回/权限过滤是否在语义召回与融合之前 | 当前顺序正确；但语义阶段会改变「词法为 0 即淘汰」的前提 | **需在阶段四重构** |
| 7 | 实际 HTTP 请求体是否遵循最终检索结果 | 6 个集成用例断言请求体，全部通过 | **成立** |
| 8 | `npm run evaluate:retrieval` 是否可独立重复运行 | 两次运行除 `generatedAt` 外字节相同 | **成立** |
| 9 | CI 是否执行该评测 / 缺门禁的真实原因 | 未执行。原因：token 缺 `workflow` 作用域 | **成立（如实记录）** |

**总体判定：Phase A 的算法与闭环结论成立，但「指标提升」这一条被调参污染，不能作为 Phase B 的比较基线。** 阶段二必须用独立数据重新建立基线。

---

## 1. 逐项证据

### 1.1 `diversityPenalty` 默认值与来源

```
src/memory/retrieval/retrieval-config.ts:95   diversityPenalty: 0.05
src/memory/retrieval/retrieval-config.ts:83   export const DEFAULT_RETRIEVAL_CONFIG
src/memory/retrieval/retrieval-config.ts:113  'timeSensitivity', 'diversityPenalty'   // 参与范围校验
```

`grep -rn "diversityPenalty" src/` 的全部命中只有：类型声明、默认值、校验键列表、v2 的 MMR 计算。

生产调用链 `MemoryService.assembleContext` → `resolveRetrievalConfig(options.config)`，而 `CompanionService.prepare` 调用时不传 `config`，因此**运行时实际取 0.05**。没有数据库配置表、没有环境变量、没有第二处定义。

**判定：成立。** 唯一的参数来源就是 `DEFAULT_RETRIEVAL_CONFIG`。

### 1.2 v1 与 v2 是否确实调用生产检索策略

```
src/memory/memory-service.ts:173        selectRetrievalStrategy(config.algorithm).retrieve(...)
src/memory/memory-service.ts:197        selectRetrievalStrategy(config.algorithm).retrieve(...)
src/evaluation/retrieval-benchmark.ts:352  selectRetrievalStrategy(algorithm).retrieve(...)
```

评测与生产走同一个注册表、同一个 `RetrievalConfig` 类型、同一个 `RetrievalRequest` 结构。评测**没有**另写一份检索逻辑（这正是既有 M3 评测器的问题，Phase A 没有重复它）。

**判定：成立。**

### 1.3 评测案例是否被用于调参 —— Phase A 的核心缺陷

git 历史证据：

```
$ git log --oneline -S "diversityPenalty: 0.2"  -- src/memory/retrieval/retrieval-config.ts
7d35a1c feat(retrieval): versioned config, decision trace and dual-strategy registry
12e5093 feat(eval): offline benchmark that measures the production retrieval algorithms

$ git log --oneline -S "diversityPenalty: 0.05" -- src/memory/retrieval/retrieval-config.ts
12e5093 feat(eval): offline benchmark that measures the production retrieval algorithms
```

即：`0.2` 在 `7d35a1c` 引入，`0.05` 在 `12e5093` 出现——而 `12e5093` 正是新增基准并报告「MRR 0.9167 → 0.9583」的那次提交。

Phase A 的实际过程是：用 12 个案例跑基准 → 发现重复簇 MRR 下降 → 调 `diversityPenalty` → 用**同一批 12 个案例**重跑 → 报告新数字。

**判定：不成立。Phase A 报告中的 v2 指标是在被报告的同一批数据上调参得到的，属于乐观偏差，不能作为 Phase B 的对照基线。**

Phase A 文档确实写了「存在过拟合风险」，但仅止于免责声明，没有用独立数据验证。本阶段必须用开发/验证/留出三段切分重建基线。

### 1.4 固定时钟是否贯穿生产检索调用链 —— 已修复的阻断项

Phase A 声称「检索可重放」。实际：

```
src/app/companion-service.ts:748   const evaluationAt = this.now()
src/app/companion-service.ts:751   prepare(..., evaluationAt)     // 用于生成同意预览
src/app/companion-service.ts:762   prepare(..., evaluationAt)     // 用于实际派发
src/app/companion-service.ts:868   assembleContext(query, max)    // ← 没传 now
src/app/companion-service.ts:892   assembleContext(content, max)  // ← 没传 now
src/memory/memory-service.ts:178   const now = options.now ?? this.timestamp()
```

`prepare` 被调用两次，每次 `assembleContext` 都各自读一次 `clock()`。后果：

1. 同意预览与实际派发可能基于**两个不同时刻**的检索结果；
2. `sendChat` 里有 `if (hashProviderInput(verified.input) !== preview.payloadSha256) throw CONFLICT`；
3. 若两次检索的排序因毫秒差而不同，**整个回合会以 CONFLICT 失败**。

这不是理论问题，而是「同输入同配置应可重复」的直接反例，也与 Phase A 自己的结论矛盾。

**已修**：`prepare` 把 `evaluationAt` 传入两次检索（`{ now: evaluationAt }`）。
**回归测试**：`src/memory/retrieval/retrieval-integrity.test.ts` 用「每次读时钟前进 1 毫秒」的时钟跑完整 `sendChat`，断言两次 `retrieval.decision` 的 `evaluatedAt` 完全相同。
**验证测试有效**：临时回退修复后该用例失败（`expected 2 to be 1`），恢复后通过。

### 1.5 纠正链是否处理多修订与缺失历史 —— 已修复的阻断项

`listSupersededStatements` 的 SQL：

```sql
WHERE m.status = 'active' AND r.revision < m.revision
ORDER BY m.updated_at DESC, r.memory_id, r.revision
LIMIT ?
```

- **多修订**：`r.revision < m.revision` 覆盖 A→B→C 的全部历史修订，正确。
- **缺失历史**：若某条修订查不到「下一条修订」，`superseded_at` 为 NULL，JS 侧过滤掉，降级而非崩溃，正确。
- **撤回/删除**：`m.status = 'active'` 排除撤回；删除因 `ON DELETE CASCADE` 连修订一起消失，正确。
- **静默截断**：Phase A 用 `MAX_SUPERSEDED_STATEMENTS = 200`，按 `m.updated_at DESC` 取窗口。活跃记忆中若有超过 200 条被取代的修订，**更早的纠正会被静默丢弃**，此时「已纠正的旧事实」可能重新被检索到——这是安全性相关的静默弱化。

**已修**：上限提到 2000，并改为请求 `cap + 1` 以**可观测地**判断截断；`RetrievalDecision.correctionChain = { statements, truncated }` 记录在决策与事件日志中，弱化不再无声。
**回归测试**：`retrieval-integrity.test.ts` 用返回 2001 行的替身仓储断言 `truncated: true`，返回 3 行时断言 `truncated: false`。

### 1.6 删除/撤回/权限过滤是否发生在语义召回与融合之前

当前 v2 的实际顺序：

```
status !== active      → retracted
sensitivity > 上限     → sensitivity
lexical === 0          → irrelevant        ← 语义阶段必须移除这个前提
superseded             → superseded_statement
打分 → MMR → 预算
```

权限与删除**确实在打分之前**，这一点正确。

但 `lexical === 0 → irrelevant` 在 `superseded` **之前**。语义检索引入后，「词法 0 命中」不再等于「无关」，因此：

- 该过滤必须改为「词法 0 **且** 语义低于阈值」；
- 且 `superseded` 检查必须**移到任何打分之前**，否则一条被纠正的旧事实可能先拿到高语义分，再被后续步骤误放行。

**判定：需要阶段四重构，不是当前缺陷，但必须先记录约束。**

### 1.7 实际 HTTP 请求体是否遵循最终检索结果

`src/app/retrieval-request-context.integration.test.ts` 6 个用例断言 `messages[0].content`（system）与 `"memories":[]`，覆盖：偏好进入请求、纠正后旧文本消失、重启后一致、删除不回流、复活被拦、超敏感度不下发。全部通过（本轮 `npm test` 45 文件 / 314 用例）。

**判定：成立。** 验证的是真实派发的请求体，不是数据库行。

### 1.8 `npm run evaluate:retrieval` 是否可独立重复运行

连续执行两次，比较报告：

```
identical excluding generatedAt: true
inputSetHash stable: true
selectedIds stable: true
```

**判定：成立。** 报告可复现（`generatedAt` 是唯一变化字段，属预期）。

### 1.9 CI 是否执行该评测，以及缺门禁的真实原因

```
$ gh auth status
Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'      ← 无 workflow

$ gh api repos/ve766/morrow-ai-companion-v2/actions/permissions
{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}
```

结论：**仓库 Actions 本身是开启的，限制在凭据上**——推送包含 `.github/workflows/*` 的提交会被拒绝：

```
refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml`
without `workflow` scope
```

Phase A 因此撤回了那一行 CI 改动，并在文档中说明。**没有**通过删除步骤或降低断言绕过。

**判定：成立（如实记录）。** 所需权限与补齐步骤见阶段六报告。

---

## 2. 阻断项处理结果

| 阻断项 | 严重性 | 处理 | 状态 |
|---|---|---|---|
| 检索未使用回合固定时刻，预览与派发可能不同源 | 高（可导致回合 CONFLICT 失败；违反可重复性） | `prepare` 传入 `evaluationAt`；新增回归测试并验证其能抓住原缺陷 | **已修** |
| 纠正链窗口静默截断 200 条 | 中高（静默削弱纠正语义） | 上限 2000 + `correctionChain.truncated` 可观测 | **已修** |

两项修复均未改变默认算法、未改变评分公式，因此不影响 Phase A 已报告的对照数字（除决策日志多一个字段）。

---

## 3. 风险清单（进入阶段二的输入）

| 风险 | 影响 | 阶段二的应对 |
|---|---|---|
| **评测污染**：v2 参数在报告的同一批数据上调过 | Phase A 的「无退化」结论不可信 | 开发/验证/留出三段切分；留出集只在方案冻结后跑一次 |
| 12 个案例全部是英文为主、短句、单轮 | 无法反映「不同措辞」的真实分布 | 新增同义改写、间接表达、中英混合、词重叠但语义无关等场景 |
| `expectedRelevantIds` 是设计判断，无用户标注 | 指标的绝对值意义有限 | 在报告中明确标注；只看相对变化与逐案例行为 |
| 无语义能力 | 「vegetarian meals」无法召回「what should I eat」 | 阶段三用真实 embedding 实测，而非假定 |
| 检索候选窗口固定 1000 条 | 记忆量增长后召回上限受限 | 记录为已知边界，不在本阶段改动 |
| `lexical === 0 → irrelevant` 与语义阶段冲突 | 若直接叠加语义分，可能破坏既有过滤顺序 | 阶段四显式重构顺序：权限/删除 → 纠正链 → 候选生成 → 双信号 → 融合 → 去重/预算 |
| 语义模型引入后的分发体积与冷启动 | Windows 安装包显著增大 | 阶段三实测体积/延迟，作为选型维度 |

---

## 4. 本阶段不做什么

- 不修改既有 12 个案例的预期答案（保留为回归基准）。
- 不因为阶段一发现了污染就推翻 Phase A 的代码结构；算法实现本身没有问题，问题在**测量方法**。
- 不预先引入向量数据库或 embedding 依赖；先测再定。

---

## 5. 本阶段提交

见本文件所在提交。修改文件：

- `src/app/companion-service.ts`（检索固定到回合时刻）
- `src/memory/memory-service.ts`（纠正链窗口与截断标记）
- `src/memory/retrieval/retrieval-strategy.ts`、`retrieval-trace.ts`、`retrieval-v2.ts`、`memory-context-assembler.ts`（透传 `supersededTruncated` 与 `correctionChain`）
- `src/memory/retrieval/retrieval-integrity.test.ts`（新增 3 个回归用例）
- `src/evaluation/retrieval-benchmark.ts`、`src/memory/retrieval/retrieval.test.ts`（请求结构同步）

测试：`npm run typecheck` 通过；`npm test` 45 文件 / 314 用例通过（Phase A 基线 44 / 311）。
