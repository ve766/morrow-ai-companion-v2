# Stage 2 最终算法登记

| 项 | 值 |
|---|---|
| 结果生成 SHA | `a8e382de96840e72effa9c8d7901971bee6e6e89` |
| 状态口径 | PASS / PARTIAL / BLOCKED / NOT_RUN（与交付报告一致） |
| 完整历史登记 | [`stage-2-algorithm-registry.md`](stage-2-algorithm-registry.md)（逐轮细节，保留） |

本文件是阶段二**最终**算法登记：只写当前生效的公式、参数、门控与调用链。任何与旧登记冲突处，以本文件为准。

---

## 1. B1 意图置信度

**状态**：PASS（**未校准**：`calibration: 'uncalibrated_heuristic'`）

### 1.1 公式

```
z_i = w_s·s_i + w_e·e_i + w_m·m_i + w_k·k_i − w_a·a_i
Δ   = z₍₁₎ − z₍₂₎                    （集合级，不进单候选向量）
share_i = exp(z_i/T) / Σ_j exp(z_j/T)  （仅作展示，不是概率）
```

### 1.2 变量

| 变量 | 取值 | 含义 | 计算位置 |
|---|---|---|---|
| `s_i` | [0,1] | 候选语义/规则匹配强度 | `scoreIntentCandidates().score / 100` |
| `e_i` | [0,1] | 表达明确度 | `explicitnessOf`：短语标记(≥80)→1；仅事实谓词→0.55；≥62→0.6；否则 0.35 |
| `m_i` | [0,1] | 信息完整度 | `completenessOf`：按标签判对象/动作+范围/新值 |
| `k_i` | [0,1] | 上下文**内容**一致度 | `contextFitOf`：非指代轮次恒 1；指代轮次 共享内容 1 / 无关 0.2 / 无上文 0 |
| `a_i` | [0,1] | 歧义程度 | `ambiguityOf`：未解析指代 .6、自述困惑 .8、指示词 .3、否定 .15、反讽 .3、候选竞争 .2（累加后 clamp） |
| `Δ` | [0,1] | 候选区分度 | 排序后前两名 z 差 |
| `T` | 0.12 | share 的温度 | `INTENT_SHARE_TEMPERATURE` |

### 1.3 参数与来源

| 参数 | 值 | 来源 |
|---|---|---|
| `w_s` | 0.10 | 双集网格搜索（见下） |
| `w_e` | 0.60 | 同上 |
| `w_m` | 0.10 | 同上 |
| `w_k` | 0.10 | 同上 |
| `w_a` | 0.10 | 同上 |
| `high` | 0.62 | 同一搜索的阈值网格 |
| `medium` | 0.45 | 同上 |
| `clarify` | 0.42 | 同上 |
| `marginFloor` | 0.08 | 同上 |

搜索：`scripts/b1-calibrate.ts`，开发集 26 例（`evals/stage-2/b1-devset.json`）+ 既有 fixture 26 例；权重步长 0.1、和为 1；约束：每项 ≥0.05、`completeness ≤0.2`、`context ≤0.3`、`semantic+explicitness ≥0.5`；平手取证据权重更高者。

结果：dev 18/18、holdout 8/8、fixture 26/26；合并评估 26/26（`…-b1.json`），高置信度错误 0。

### 1.4 决策规则（按顺序）

```
1. 显式纠正（有纠正标记）
   ├─ 无新值（wordCount ≤ 2）→ clarify
   └─ 有新值 → 按纠正后的理解继续
2. 未解析指代（无上文且含指代/指示词）→ clarify          ← 硬闸，不是扣分
3. 需授权动作 → 既有 authorize() 门控（置信度不能绕过）
4. 无候选 → answer（与"低置信度候选"区分）
5. z₁ < clarify 或 Δ < marginFloor
   ├─ 方向会变（前两名有效检索需求不同）→ clarify
   └─ 否则 → 安全不确定表达（当前实现：answer + uncertainty）
6. 否则 → 按首候选路由（retrieve_memory / answer）
```

**方向变化判定**用 `retrievalNeedOf`（有效检索需求），不是静态 `RETRIEVAL` 表。

### 1.5 调用链

`intent-decision.scoreIntentCandidates → intent-confidence.assessIntentConfidence → cognitive-turn-analyzer.strategy → companion-service（system 消息 + 澄清指令）→ Provider payload`

### 1.6 边界与复杂度

- 复杂度 O(k·n)：k 候选数（≤5），n 文本长度。
- 无候选时 `needsClarification=false`（没有竞争解读就没有方向可错）。
- 指代硬闸优先于一切打分：`那个怎么办？` 即使 z 很高也追问。
- **不是概率**：52 例小样本，不构成校准；对外只称 score/band。

### 1.7 测试

`intent-confidence.test.ts`（11）、`cognitive-turn-analyzer.test.ts`（6 条 B1 组）、`src/app/b1-strategy-payload.integration.test.ts`（3）。

---

## 2. B4 轮次生命周期与恢复

**状态**：PASS

### 2.1 状态与合法边

| 状态 | 合法前驱 |
|---|---|
| `received` | ∅（初始） |
| `analyzed` | received |
| `context_ready` | analyzed, received |
| `awaiting_consent` | context_ready |
| `requesting` | awaiting_consent, context_ready |
| `response_received` | requesting |
| `committed` | response_received, **recovering** |
| `failed` | 所有非终态 + recovering |
| `cancelled` | awaiting_consent, requesting, context_ready, recovering |
| `recovery_required` | 所有非终态（received/analyzed/context_ready/awaiting_consent/requesting/response_received） |
| `recovering` | recovery_required |

终态：`committed` / `failed` / `cancelled`。终态**不能**进入 `recovery_required` 或 `recovering`——恢复不得复活已完成的轮次。重复进入同一状态是 no-op（幂等契约）。

### 2.2 持久化顺序与事务边界

```
prepareFinalization  → 独立事务：写 finalization intent
appendMessage(assistant) → 单事务：写消息 → applyFinalization → remove(intent)
```

提交与清理**同事务**：崩溃会让两者一起回滚；"消息已提交、意图未清理"只能由清理失败产生。

### 2.3 恢复规则

| 证据形态 | 处理 | Provider 重发 |
|---|---|---|
| 有意图 + 有 assistant 消息 | `recovery_required → recovering → committed`，只补记账 | 否 |
| 有意图 + 无消息 | `→ failed`（reason `INTERRUPTED`） | 否 |
| 无意图 + 非终态 + 有消息 | `→ committed`（`recovered_after_commit`） | 否 |
| 无意图 + 非终态 + 无消息 | `→ failed`（`INTERRUPTED_UNKNOWN_OUTCOME`） | 否 |
| 会话已删除 | `dropped`，不复活 | 否 |

幂等：意图处理完即 `remove`；状态结算到终态后不再进入 `listUnsettled`。

### 2.4 复杂度与边界

- 每次恢复 O(m + u)：m 意图数、u 未结算状态数，均上限 50。
- 无 provider idempotency key，因此**默认不自动重试**；只允许安全失败与用户显式重试。
- 未覆盖：OS 级断电、多进程并发恢复。

### 2.5 测试

`turn-state-machine.test.ts`（6）、`turn-state-sequence.integration.test.ts`（3）、`src/app/b4-recovery.integration.test.ts`（4）、`tests/b4-child-crash.test.ts`（5，含 3 个真实 SIGKILL 窗口）。

---

## 3. B5 反思映射与门控

**状态**：PASS

### 3.1 管线

```
ReflectionFinding → 证据校验 → allowlist 映射 → 门控 → 持久候选/证据 → 下一轮上下文 → 最终 payload
```

### 3.2 映射表（allowlist）

| kind | 效果 | 是否写状态 |
|---|---|---|
| `interest_candidate` | `interest_evidence`（需 memory 引用） | 是（证据账本，仍受晋升门槛） |
| `intent_correction` | `intent_correction_candidate` | 否（只审计） |
| `next_turn_suggestion` | `bounded_suggestion` | 否（只审计） |
| `bias_hint`（声明维度） | `pending_personality` | 写 `pending_personality_candidates`，**不改基线** |
| `bias_hint`（无维度） | `descriptive` | 否 |
| `memory_gap` / `open_question` / `consistency_note` | `descriptive` | 否 |
| 未知 kind | `rejected: unmapped_kind` | 否（写 `reflection.finding_rejected`） |

### 3.3 证据校验与去重

- 至少 1 个**存储型**证据引用（`dimension` 是结构声明，不算）；引用必须解析到现存、未撤回的记录（event / memory / self-model entry）。
- `dedupe_key = sha256(kind | NFKC+空白归一化后的 statement | 排序后的证据引用)`，唯一索引；落库成功才执行效果 → 重跑幂等。
- 证据失效（撤回/删除）后：证据账本触发器删除派生证据；后续运行不再从该来源产生候选。

### 3.4 人格门控

```
ΔP_t = clip_ε(η · G_t · Map(R_t))
```

当前实现：`Map` 只映射到 `pending_personality_candidate`（维度 ∈ {exploration, depth, pace}，方向 increase/decrease，置信度来自 finding，有效期 14 天，状态 pending）。`G_t` 由证据有效性 + 去重保证；**没有任何路径把 pending 应用到基线**，应用需要用户确认（不在本阶段范围）。

### 3.5 晋升门控（未放宽）

`conversationCount ≥ 2 且 evidenceCount ≥ 3` → `active`；否则 `candidate`。`evidenceCount` 为净支持（扣掉末次支持之后的 counter）。

### 3.6 测试

`reflection-mapping.test.ts`（7）、`self-model.test.ts`（+3 管线用例）、`b5-reflection-safety.integration.test.ts`（1）、`scripts/reflection-positive.ts`（正向消融）。

---

## 4. B2 / B3 摘要（未改动）

| 项 | 公式/规则 | 状态 |
|---|---|---|
| B2 个性化 | `p' = clip(p + η·w·e, 0, 1)`，η=0.05，单轮每维 ≤0.05；读取时按证据折叠重算 | PASS（未改） |
| B3 上下文效用 | `U = 0.40R + 0.25F + 0.20Q + 0.10P − 0.15X − 0.05D`；`P` 窄映射（记忆提到交互维度时取该维度距 0.5 的距离），`X` 冲突，`D` 未确认且 >120 天的陈旧度 | PASS（未改） |
