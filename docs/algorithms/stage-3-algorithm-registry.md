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

### 证据派生映射（唯一当前版本，Issue #20 重写）

只有**显式风格陈述**产生证据，且正负成对：

| 维度 | 极性 | `strength` | 规则名 | 模式（节选） |
|---|---|---|---|---|
| directness | + | 0.8 | `explicit_direct_request` | 直接说/别绕/说重点/开门见山 |
| directness | − | 0.8 | `explicit_soft_request` | 委婉/别这么直接/温和一点 |
| warmth | + | 0.7 | `explicit_warmth_request` | 温柔/多关心我/体贴一点 |
| warmth | − | 0.7 | `explicit_warmth_reduction` | 别煽情/别肉麻/保持距离 |
| humor | + | 0.7 | `explicit_humor_request` | 幽默/开个玩笑/轻松点 |
| humor | − | 0.7 | `explicit_humor_reduction` | 严肃(一)点/别(老)开玩笑/正经(一)点 |

聚合规则（同一回合、同一维度）：

```
net_d = clip( Σ polarity·strength , −1, +1 )
weight = confidenceScore / 100
```

- **相反证据先聚合再计算**，不再用 first-match/`seen` 吞掉后来的反向证据；完全抵消则该回合不产生证据。
- **门禁**：`intent='uncertain'`、`confidenceScore < 50`、或 `uncertainty='high' 且 confidence < 65` → abstain。
- **非断言语气**（如果/假如/扮演/假装/打个比方）与**引述**（`stripQuotedAndReportedText`）→ abstain。

**已废弃（deprecated）**：`correction → directness`、`explicitMemoryRequest → warmth`、`personalization.exploration → humor`。它们描述内容或工作流，不是稳定风格；迁移策略是直接删除，不保留并行规则。

**局限**：规则窄，换一种说法就不触发；`weight` 用的是分析器自身未校准的置信度。

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

### 预算（S3-04，唯一当前语义）

每日上限不再是"先读后写"，而是**事务内预留**：

```
BEGIN IMMEDIATE
  existing = SELECT state FROM exploration_budget WHERE scope=? AND day=? AND turn_id=?
  if existing: COMMIT; return existing            -- 幂等
  used = COUNT(state IN ('reserved','consumed'))  -- 预留也占名额
  state = used >= MAX_PER_DAY ? 'denied' : 'reserved'
  INSERT exploration_budget(...)
COMMIT
```

- `permit` 时预留；`actually_raised` → `consumed`；`not_raised`/`provider_failed`/`user_rejected` → `released`。
- `(scope, day, turn_id)` 是幂等键；`day` 来自注入时钟的 UTC 日期。
- 同时存在两个限制：**日预算**（预留表）与**滚动 24 小时窗口**（`recent()`，用于冷却与骚扰控制），二者独立生效，均需通过。

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

## M1 记忆重要度、衰减与合并（Issue §2A）

**源码**：`src/memory/memory-importance.ts`
**迁移**：31 `memory-importance-and-consolidation`
**测试**：`src/memory/memory-importance.test.ts`（11 条）

```
I(m) = clip( .30·S + .25·U + .15·R + .10·G + .10·C + .10·T , 0, 1 )
R    = 1 − e^(−n/3)            n = 独立提及次数（revision − 1）
T    = 0.5^(age_days / 90)
```

| 符号 | 含义 | 取值 | 来源 |
|---|---|---|---|
| `S` | 来源可靠度 | 1.0 用户明确 / 0.7 已接受建议 / 0.5 回合推导 | `source_category` |
| `U` | 显式重要性标记 | 0/1 | 记忆正文 |
| `R` | 重复提及 | `[0,1)` | `revision` |
| `G` | 与目标关联 | 0/1 | 记忆正文 |
| `C` | 曾被纠正 | 0/1 | `memory_revisions.change_type='corrected'` |
| `T` | 时效 | `[0,1]`，半衰期 90 天 | `updated_at` |

参数版本 `memory.importance.v1` 写入 `memory_importance.version`。

规则：
1. 每次创建/纠正/撤回/恢复后**重算**，不增量累加。
2. 归档条件：`I < 0.35` **且** `updated_at` 早于 180 天 **且** 未受保护。
3. 受保护：`U=1` 或 `C=1` 或 `G=1`，时间不可归档。
4. 归档只写 `archived_at`，不改 `status`；检索侧过滤 `archived_at IS NULL`；`restore()` 可恢复。
5. 合并按 `(predicate, value)` 分组，只存 `member_ids_json`，不复制正文。

**局限**：权重是手工设定的透明基线，未做标注校准；归档只在启动期执行；合并只覆盖 `fact-slot` 可解析的文本。

---

## D1 陪伴目标（Issue §2D）

**源码**：`src/motivation/companion-goal.ts`
**迁移**：32 `companion-goals`
**测试**：`src/motivation/companion-goal.test.ts`（10 条）

现有 `GoalService` 只接受固定 intent/successCriterion/constraints 常量并绑定审批与工具执行，属 Agent 侧，**不进入陪伴主链**；陪伴目标单独建模。

| 字段 | 含义 |
|---|---|
| `owner ∈ {user, shared, morrow}` | 三类归属，永不合并 |
| `priority 1..5` | 1 最优先，列表升序 |
| `due_at` | 到期即 `expired`，不删除 |
| `status ∈ {active, paused, completed, cancelled, expired}` | `expired` 由时间产生，`cancelled` 只能由人产生 |
| `companion_goal_progress(note/step/blocker/decision)` | 追加式，级联删除 |

规则：`activeForContext()` 先 `expireOverdue()` 再取 active；完成/取消/过期下一轮退出 payload；`resume()` 拒绝恢复 cancelled；prompt 三行措辞区分归属。

---

## F1 兴趣归属

`interests.origin ∈ {user, morrow, shared}`（迁移 30），默认 `user`。Morrow 来源证据 `evidence_kind='reflection'`，引用反思 finding id；用户证据落在 `morrow` 话题上 → `shared`，反向不成立；探索资格只认 `morrow/shared`。

---

## 未实现（不计入登记表）

- Morrow 兴趣的**反思生产链**（S3-01）：`observeMorrow()` 已存在，但反思仍把候选写成用户兴趣。
- 记忆**冲突分类**（事实冲突/偏好变化/时间变化/情境差异）只保留原冲突标记，未分类。
- 内在状态 **appraisal** 重构（§2B）。
- 反思**质量指标**（§2C）。
- 语音 ASR/TTS 闭环（§2F）。
- 人格漂移的 UI 呈现与用户确认流程（服务层已有 `rollback`，界面未接）。


---

## 2026-10-31 纠偏：算法变更（以本节为准）

> 与上文冲突时，本节优先。上文的 G1「人格成长」与 X1「预算」描述已被下列版本取代。

### I1 兴趣证据折叠（替代「计数」）

```
net(i) = Σ_g polarity_g × reliability_g × 2^(−age_g/14)
```

- `reliability_g` = 该观测的主题匹配分（新主题直接观测记 1.0）；
- `age` 半衰期 **14 天**（`INTEREST_EVIDENCE_HALF_LIFE_DAYS`）；
- 晋升仍用**整数计数**：`support − recentCounters ≥ 3` 且独立会话 ≥ 2；
- 强度用 `net`，置信度用计数——两者分离，不再混成一个数；
- 参数版本：`interest.evidence.v2`。

**证据独立性**：一个观测 = 一条来源（message / memory / reflection finding），`UNIQUE(evidence_ref)` 保证重试与重复反思只记一次；独立性按 `conversation_id` 分组。

### I2 归属升级

```
origin' = morrow 且 origin=user  → shared
origin' = user   且 origin=morrow → shared
否则保持不变
```

`shared` 的定义是「双方各有独立证据」，与先后顺序无关；任一侧都不得吞掉另一侧。

### M2 记忆重要度（修正）

```
I(m) = clip(.30·S + .25·U + .15·R + .10·G + .10·C + .10·T, 0, 1)
R = 1 − e^(−n/3)          n = evidence_type='restatement' 的独立分组数
T = 2^(−age/H_type)       H ∈ {365 边界/身份, 180 目标或用户明确, 90 其它}
```

- **`revision` 不再参与 R**：编辑不等于提及；
- `n` 来自 `memory_evidence` 账本，无行时为 0；
- 排序：`rank = base + 0.20·I`（加法，只影响近分；准入在排序之前）；
- 参数版本：`memory.importance.v2`。

### X2 探索状态与预算（修正）

```
状态: permitted → selected_for_prompt → actually_raised | not_raised | uncertain
                                      ↘ provider_failed | user_rejected
预算键: (scope, turn_id) + reservation_day
```

- `uncertain` 独立存在，不消耗预算，也不再被报成 `not_raised`；
- consume/release 只按 `turn_id` 查找，跨 UTC 日不再丢预约。

### G2 交互适配（替代 G1 的语义）

```
offset_d = clamp(Σ polarity·strength·2^(−age/45), −8, +8)   仅当 N_d ≥ 3
effective_d = clamp(identity_d + offset_d, 0, 100)
```

- 写入 `user_interaction_profile`，**不写** `personality_profiles`；
- 只影响 warmth/directness/humor 三个表达数值，`disagreementStyle`/`systemRules`/`version` 恒为身份基线；
- 参数版本：`interaction-profile.v1`；
- **身份自身的演化（G1 原意）当前无生产者，标记为未实现。**

### R1 Morrow 问题候选

```
label 在 ≥2 个独立会话的 knowledge_gap 中出现
  ∧ label 长度 ≥ 2
  ∧ label 不匹配问题残留词（哪里/到哪/来着/…）
  → morrow_interest_candidate → observeMorrow(kind=reflection)
```

- 缺口来源：事实守卫把无依据个人断言改写（`guard.verdict='rewrite'`）；
- 已知局限：只覆盖「守卫改写」这一种缺口，不是通用问题生成器。
