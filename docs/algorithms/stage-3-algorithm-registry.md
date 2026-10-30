# Stage 3 算法登记表

只登记**已实现并有源码入口**的算法。每条给出公式、变量、范围、参数来源、更新规则、缺失/冲突/撤回策略、复杂度、源码入口与测试。

---

## G1 人格有界漂移（Personality growth）

**源码**：`src/personalization/personality-growth.ts`
**迁移**：29 `bounded-personality-growth`
**测试**：`src/personalization/personality-growth.test.ts`（16 条）

### 公式

对维度 `d ∈ {warmth, directness, humor}`：

```
offset_d = clamp( Σ_i  s_i · w_i · STEP · decay(age_i) ,  −MAX_OFFSET, +MAX_OFFSET )     if N_d ≥ MIN_EVIDENCE
         = 0                                                                              otherwise

decay(age) = 0.5 ^ (age_days / HALF_LIFE_DAYS)

effective_d = clamp( baseline_d + offset_d , 0, 100 )
```

### 变量与参数

| 符号 | 含义 | 值 | 来源 |
|---|---|---|---|
| `s_i` | 第 i 条证据的方向，夹紧 | `[-1, 1]` | `deriveGrowthSignals` |
| `w_i` | 证据可靠度，夹紧 | `[0, 1]`，取 `analysis.confidenceScore/100 × 0.5` | 分析器自身置信度的一半 |
| `STEP` | 单条证据最大贡献 | `1.0` 点 | 常量 `GROWTH_STEP` |
| `MAX_OFFSET` | 漂移硬上限 | `±8` 点（0–100 量表） | 常量 `GROWTH_MAX_OFFSET`，同时是 DB CHECK |
| `MIN_EVIDENCE` | 允许移动所需独立回合数 | `3` | 常量 `GROWTH_MIN_EVIDENCE` |
| `HALF_LIFE_DAYS` | 证据半衰期 | `45` 天 | 常量 `GROWTH_HALF_LIFE_DAYS` |
| 忽略阈值 | 超过 4 个半衰期的证据不参与折叠 | `180` 天 | `GROWTH_MAX_AGE_HALVES` |

### 更新规则

1. 每回合每个维度**至多一条**证据，主键 `(dimension, turn_id)`，重放幂等。
2. 折叠是**全量重算**，不是增量；删除消息由触发器删证据，下一次读取自动回落。
3. 证据不足门槛时：证据入库，事件记为 `withheld`，`offset = 0`。
4. `rollback(dimension)`：删除该维度全部证据 → `offset = 0`，事件记 `rolled_back`，**基线从未被触碰**。

### 证据派生映射（窄映射，已知局限）

| 触发信号 | 维度 | `s` |
|---|---|---|
| `signals.correction` 或 `signals.changedMind` | directness | `+0.6` |
| 否则 `signals.explicitConstraint` | directness | `+0.3` |
| `signals.explicitMemoryRequest` 或 `explicitMemorySaveRequest` | warmth | `+0.4` |
| `personalization.exploration > 0.55` 且有证据 | humor | `+0.3` |
| 其余（含单独 `negation`） | — | 无 |

**局限**：这是规则推导的工程启发式，不是心理测量。它只能表达"用户多次纠正 → 更直接"这类窄关系。

### 缺失 / 冲突 / 撤回

- 缺失：无证据 → `offset = 0`，prompt 不出现该行。
- 冲突：正负证据自然抵消（折叠是带符号求和）。
- 撤回：`forgetTurn` / 触发器 / `rollback` 三条路径都能让偏移回落。

### 复杂度

`O(k)`，`k` = 该维度证据行数；每次 `apply` 一次折叠。索引 `(dimension, created_at)` 隐含在主键 + turn 索引上。

---

## X1 受约束自主话题（Constrained exploration）

**源码**：`src/self-model/exploration-policy.ts`
**迁移**：29 `exploration_events`
**测试**：`src/self-model/exploration-policy.test.ts`（11 条）

### 判定

```
allowed = eligible ∧ ¬unsuitable_turn ∧ raised_24h < MAX_PER_DAY ∧ (now − last_raised) ≥ COOLDOWN ∧ fresh_topic

eligible(i)     = status='active' ∧ evidence ≥ MIN_EVIDENCE ∧ strength ≥ MIN_STRENGTH ∧ confidence ≥ MIN_CONFIDENCE
unsuitable_turn = correction ∨ uncertainty='high' ∨ intent='correction'
```

### 参数

| 参数 | 值 | 说明 |
|---|---|---|
| `MIN_EVIDENCE` | 3 | 独立观察次数 |
| `MIN_STRENGTH` | 0.6 | 兴趣强度 |
| `MIN_CONFIDENCE` | 60 | 兴趣置信度 |
| `COOLDOWN_HOURS` | 6 | 距上次发起的冷却 |
| `MAX_PER_DAY` | 2 | 滚动 24 小时上限 |

### 选择规则

在通过门槛的候选里取 `strength` 最大者；并列时取 `lastSeenAt` 更近者；再并列按 `id` 字典序 —— 固定输入下结果确定。

### 幂等与记录

- `recent(excludeTurnId)` 排除当前回合，因此同一回合的"预览"与"校验"两次决策结果一致（否则 payload 哈希会不一致并触发 `CONFLICT`）。
- 决策结果写 `exploration_events`：`raised` 计入频次，`declined` 只作审计。

### 边界

- 只能在同一回合的 system prompt 里出现一行许可；**没有回合外通道**。
- 不产生"经历"，不虚构事实。

---

## 复用（未修改）的既有算法

| 算法 | 源码 | 本次是否改动 |
|---|---|---|
| 意图判定与置信度 | `src/cognition/intent-decision.ts`、`intent-confidence.ts` | 否 |
| 上下文效用 `U(c)` | `src/cognition/context-utility.ts` | 否 |
| 检索策略与状态加宽 | `src/memory/retrieval-policy.ts`、`cognition/retrieval-attention.ts` | 否 |
| 内在状态事件与衰减 | `src/affective-state/cognitive-feeling-engine.ts` | 否 |
| 交互偏好 `p' = clip(p + η·w·e)` | `src/personalization/personalization-service.ts` | 否（G1 沿用同一形状） |
| 兴趣证据折叠与晋升 | `src/self-model/interest-service.ts` | 否 |
| 反思限频与去重 | `src/self-model/reflection-service.ts` | 否 |

## 未实现（不计入登记表）

- 记忆巩固（consolidation）与按重要度的衰减/归档策略。
- 人格漂移的 UI 呈现与用户确认流程（服务层已有 `rollback`，界面未接）。
- 长对话早期约束的行为层评分规则。


---

## G1′ 人格证据派生（Issue #20 重写）

### 证据规则表（只有显式风格指令）

| 维度 | 方向 | `s` | `w` | 规则名 | 模式（节选） |
|---|---|---|---|---|---|
| directness | + | 0.8 | 0.8 | `explicit_direct_request` | 直接说/别绕/说重点/开门见山 |
| directness | − | 0.8 | 0.8 | `explicit_soft_request` | 委婉/别这么直接/温和一点 |
| warmth | + | 0.7 | 0.7 | `explicit_warmth_request` | 温柔/多关心我/体贴一点 |
| warmth | − | 0.7 | 0.7 | `explicit_warmth_reduction` | 别煽情/别肉麻/保持距离 |
| humor | + | 0.7 | 0.7 | `explicit_humor_request` | 幽默/开个玩笑/轻松点 |
| humor | − | 0.7 | 0.7 | `explicit_humor_reduction` | 严肃点/别开玩笑/正经点 |

约束：
- 匹配前先 `stripQuotedAndReportedText(content)` —— 别人说的话不是用户的偏好；
- 同一轮同一维度至多一条证据（`seen` 集合）；
- 证据写 `source` 列；折叠公式、±8 上限、3 轮门槛、45 天半衰期、回滚语义均未变。

**已废弃的旧映射**：`correction → directness`、`explicitMemoryRequest → warmth`、`personalization.exploration → humor`。理由：它们描述的是内容或工作流，不是稳定风格。

## X1′ 探索生命周期（Issue #20 重写）

```
状态: permitted → selected_for_prompt → actually_raised | not_raised
                                      ↘ provider_failed
                                      ↘ user_rejected
唯一索引: (turn_id, state)
```

- 资格：`origin ∈ {morrow, shared}` ∧ `status=active` ∧ `evidence ≥ 3` ∧ `strength ≥ 0.6` ∧ `confidence ≥ 60`；
- 许可（`permitted`）不计入频次；只有 `actually_raised` 计入 24 小时上限；
- `detectRaised(reply, label)`：回复包含标签词 → `raised`；回复过短或无词面重合 → `not_raised`；标签无可分词 → `uncertain`（按 `not_raised` 记）；
- `recent(excludeTurnId)` 排除当前回合，保证预览与校验一致。

**已知局限**：词面匹配会漏掉改写式提出，因此 `not_raised` 不等于"模型没说"，只等于"没有词面证据"。

## F1 兴趣归属

`interests.origin ∈ {user, morrow, shared}`，默认 `user`。Morrow 的来源证据 `evidence_kind='reflection'`，引用反思 finding id，不引用用户消息。用户证据落在 `morrow` 话题上 → `shared`；反向不成立。
