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

effective_d = clamp( baseline_d + offset_d , 0, 100 )     ← 目标公式，当前未实现
```

### 接入口（这一维最容易读错的地方）

`offset_d` 每轮都在算、在存、可回滚，但**没有任何读取方把它送进 prompt**：

| 环节 | 代码位置 | 状态 |
|---|---|---|
| 产生证据 | `companion-service.ts:1073–1082`（`deriveGrowthSignals` → `growth.apply`） | 每完成轮写入 |
| 折叠成 offset | `personality-growth.ts` 全量重算 + `personality_growth_state` | 已实现 |
| 写进 prompt | `companion-service.ts:996–1013` `effectiveProfile` | **不读 growth**，只加 `interaction.offsets()` |
| 描述文本 | `personality-growth.ts:281` `describeGrowth()` | 导出但**无生产调用点** |

结论：`effective_d = baseline_d + offset_d` 是设计目标，不是现状。prompt 里实际出现的是"基线 + 交互偏移"（见 G2）。两条路径上，**身份基线本身只由用户编辑改变**——这一点成立。

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

> 本节记录 2026-10-31 的一轮修正，**不是第二套真相**：被修正的条目已在原章节就地改写，这里只保留"改了什么、为什么改"。
>
> - **G1 未被取代**。它仍是证据台账（`personality_growth_*`），只是**没有消费者**：`effective_d` 未实现，见 G1「接入口」。
> - **X1 的预算语义被 X2 取代**（事务内预留，不再读-判-写）。
> - **G2 不是 G1 的替代品**，它是另一条路径（`user_interaction_profile`），也是当前唯一真正影响 prompt 数值的那条。


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
- **G2 与 G1 是两条独立路径**：G2 有生产者也有消费者（进 prompt），G1 有生产者但无消费者（台账只写不读）。上一版此处写「G1 当前无生产者」是错的——`deriveGrowthSignals` 每轮都在写证据（`companion-service.ts:1073`）。未实现的是 **G1 的 `effective_d` 合成**，不是它的证据链。

### R1 Morrow 问题候选

```
label 在 ≥2 个独立会话的 knowledge_gap 中出现
  ∧ label 长度 ≥ 2
  ∧ label 不匹配问题残留词（哪里/到哪/来着/…）
  → morrow_interest_candidate → observeMorrow(kind=reflection)
```

- 缺口来源：事实守卫把无依据个人断言改写（`guard.verdict='rewrite'`）；
- 已知局限：只覆盖「守卫改写」这一种缺口，不是通用问题生成器。

---

## 附录 C：最终纠偏新增/修改、且真实运行的算法（2026-10-31）

只登记**有生产输入**的算法。没有生产者的一律不登记。

### C.1 兴趣证据的按来源 fold（P0-1）

- 源码：`src/self-model/interest-service.ts` → `SqliteInterestRepository.fold`、`InterestService.evaluate`
- 输入：`interest_evidence` 行，含 `evidence_origin ∈ {user, morrow}`、`match_score`、`created_at`、`conversation_id`

```
decay_i    = 2^(-age_i / 14)
weight_i   = clip(match_score_i,0,1) · decay_i
net_o      = Σ_{origin=o} ±weight_i          (support +, counter −)
groups_o   = |{ conversation_id : origin=o, polarity=support }|
support_o  = |{ i : origin=o, polarity=support }|
effective  = max(0, support_owner − recentCounters)
```

- 参数：半衰期 14 天（`INTEREST_EVIDENCE_HALF_LIFE_DAYS`）；晋升门槛 `groups ≥ 2 ∧ effective ≥ 3`（`INTEREST_PROMOTION_MIN_*`）
- 边界：`owner = shared` 时用 morrow 侧计数，且要求 user 侧 > 0；`support = 0` 时聚合被删除
- 为什么按来源拆：探索门把 `shared` 当作 Morrow 可提起的话题，用总量晋升等于让用户提及给她凑门槛

### C.2 知识缺口 → 独立证据的聚合（P0-1）

- 源码：`src/self-model/reflection-service.ts` → `pickMorrowGapCandidate`、`KnowledgeGapService`
- 输入：`knowledge_gap_evidence(label, conversation_id, event_id, occurred_at)`

```
for label in labels(batch):
    if len(label) < 2 or 形如疑问词: skip
    events ← gap_evidence(label)  where retracted_at is null
    if |distinct conversation_id| ≥ 2: 选中，evidence = 全部 events（上限 8）
```

- 关键点：批次只决定「什么时候看」，台账决定「证据够不够」。两个批次里各一条缺口，仍然是两个独立会话
- 一个 finding 引用 N 条事件，effect 就写 N 条证据行；不是一条

### C.3 记忆重复提及 n 的生产者（P0-5）

- 源码：`src/memory/memory-evidence-policy.ts` → `readMemoryUtterance`；`MemoryService.observeUtterance`
- 判定顺序（先命中先返回 `none`）：角色扮演 → 假设 → 引用 → 疑问 → 否定 → 讨论 → 断言/确认
- 匹配：`normalizeAssertion`（NFKC、去标点空白、小写）后完全相等，或短串包含且长度差 ≤ 6
- 记入：`evidence_type ∈ {restatement, confirmation}`，`independence_group = conversation_id`
- 公式接入：`R = 1 − e^(−n/3)`，其中 `n = |distinct independence_group|`；`actor='morrow'` 直接返回 `model_text`，不写行
- 边界：`retraction` 写入后 `recompute` 把 `n` 置 0；模型复述、疑问、引用一律不增加

### C.4 目标期限解析（P1-6）

- 源码：`src/motivation/goal-time.ts` → `resolveDueAt`
- 输入：`now`（注入时钟）、固定偏移 480 分钟
- 顺序：显式 `YYYY年M月D日` → `YYYY年M月` → 明年[M]月 → 今年[M]月 → 下个月 → 本月/月底 → 下周 → 本周 → N 天后 → N 周后 → M月D日（今年或明年）
- 输出：`dueAt`（UTC ISO，当地 23:59:59）、`expression`（用户原话）、`unresolved`
- 边界：匹配不到但形如时间短语 → `unresolved = true`、`dueAt = null`，由候选保留原表达并要求澄清；绝不伪造日期
- 标题：`stripHorizon` 移除时间短语后再切标题，避免把期限写进目标名

### C.5 主动提出的判定（P1-7）

- 源码：`src/self-model/exploration-policy.ts` → `evaluateRaise`、`topicTerms`
- 输入：持久化回复 + 话题标签

```
terms ← 标签分词（含 CJK 3–4 字子串，上限 60）
if 回复过短或 terms 为空        → uncertain
if 回复不含任何 term            → not_raised
if 含 term 但无「提问/第一人称关注」形态 → uncertain
否则                            → raised
```

- 为什么这样：关键词命中只能证明"提到了"，不能证明"她主动提起"。形态检查是第二道门
- `uncertain` 不消耗预算、不计入 raise 次数、不满足 L5 的通过条件

### C.6 期限边界（P0-2，2026-10-31 修正）

- 源码：`src/motivation/goal-time.ts` → `resolveDueAt`
- 两段式：`period = f(表达)`，`dueAt = boundary(period, 边界词)`

```
before: period.start − 1s        # 之前 / 以前 / 前
end:    period.end               # 底前 / 之内 / 内 / 裸写
start:  period.start             # 开始时 / 之初
after:  period.start             # 以后 / 之后
```

- 参数：固定偏移 480 分钟；月末取 `new Date(Date.UTC(y, m, 0)).getUTCDate()`，闰年自动正确
- 边界词从匹配结束位置向后 8 字符内识别，最长优先（`底前` 先于 `前`）
- 输出 `boundary` 与 `expression`（含边界词），无法解析仍 `unresolved = true`

### C.7 风格证据的词法优先（P0-5，2026-10-31 修正）

- 源码：`src/personalization/personality-growth.ts` → `deriveGrowthSignals`
- 规则：显式风格短语命中后，`intent` 标签不再是否决项；权重 `w = max(0.6, confidence/100)`
- 仍弃权：引用/转述、假设、角色扮演、`uncertainty='high' ∧ confidence<25`
- 理由：意图分类器判断的是「这轮要做什么」，不是「这句话说了什么」；用前者否决后者会丢掉明确的请求

> **消费者：无。** 本条只覆盖"证据怎么来"，不覆盖"证据怎么用"——`describeGrowth()` 无生产调用点，`effectiveProfile` 不读 growth。三次真实 32 轮会话的 `interactionOffsets` 恒为 `{0,0,0}`。不要把本条读成"人格会随对话变化"。

> **订正（状态截至修复轮，见 docs/reports/stage-3-final-remediation-report.md）**：本文为历史记录，以下表述已被后续事实取代——live 断言计数应为 10 断言 9 PASS 1 FAIL；CI 已在 5fe62f54 及后续 HEAD 全绿（run 41270227620/41270251780 及修复轮 run）；G1 生产链已按 D-1 重写（见 docs/algorithms/personality-growth-runtime-v2.md）；Electron renderer 在 CI 双平台 PASS、特定本机环境 BLOCKED，两态并存。
> G1 接入口、未实现清单为修复前事实。
