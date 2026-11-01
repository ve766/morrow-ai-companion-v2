# Stage 5 关系证据聚合与状态表达策略

## 1. 关系线程的证据聚合（已进入生产代码）

```
score(thread, t) = clip( Σ_g  w_g · s_g · exp(−ln2 · ageDays_g / halfLife_g), 0, 1 )
```

| 变量 | 含义 | 取值 / 来源 |
|---|---|---|
| g | 一条独立用户消息（`relationship_thread_evidence.source_message_id`，主键去重） | 同一消息重放不新增 |
| w_g | 来源权重 | 1.0（只有显式陈述才被抽取，弱暗示不入账） |
| s_g | 方向×强度 | +1 支持；−1 反证（当前仅作为结构保留，抽取器不产出反证，撤回走状态而非负分） |
| ageDays_g | 证据年龄（天） | `now − created_at`，向过去截断为 0 |
| halfLife_g | 半衰期 | address_preference 180 天；shared_topic / shared_plan / rhythm_preference 90 天 |

状态判定（`recompute()`）：

```
active     ⟺ score ≥ 0.5 且 独立消息数 ≥ MIN_GROUPS[kind]
candidate  ⟺ 未达门槛（存储但不注入）
expired    ⟺ now − last_seen > 180 天
retracted  ⟺ 用户撤回（不因分数回升复活）
superseded ⟺ 同类别的更新值出现（仅 address/rhythm 这类替换型）
MIN_GROUPS: address_preference=1, shared_plan=1, shared_topic=2, rhythm_preference=1
```

- **反证**：抽取器只产出支持证据；用户否定走“撤回”与“替换”两条确定路径（`那个约定就算了` / `以后叫我X`），避免用未校准负分掩盖语义。
- **缺失字段**：`expires_at` 仅在过期时写入；`strength` 每次读时重算，不累加。
- **不是概率**：0–1 的强度是排序与门槛用的启发式。

## 2. 内在状态（沿用既有实现，未重构）

现有 `feeling.ts` 已有有界状态更新（事件驱动、半衰、单事件上限、跨会话持久化）。本阶段不重写公式，只把**状态**接到**表达策略**：

```
z_t = clip( λ(Δt)·z_{t−1} + (1−λ(Δt))·f(e_t, ctx_t), z_min, z_max )
λ(Δt) = exp(−ln2 · Δt / halfLife)，halfLife: valence 6h / activation 0.75h / tension 12h
z ∈ [−1, 1]（各维度），attention.explorationPriority ∈ [0, 1]
```

无证据时保持衰减值；更新失败记录降级事件（`memory_operation_failed` 之外的 `cognitive_prepare_feeling` 阶段），聊天继续，不把默认值伪装成成功更新。

## 3. 表达策略（新增，进入生产链）

```
ExpressionPolicy = {
  adviceMode:    'none' | 'acknowledge_first' | 'answer_directly'
  clarifyMode:   'as_needed' | 'prefer'
  questionBudget: 0 | 1 | 2
  brevity:       'normal' | 'brief'
  rationale:     稳定原因码（不向用户展示）
}
```

判定顺序（`deriveExpressionPolicy`，按优先级）：

| 条件 | 结果 | 理由 |
|---|---|---|
| 用户明确要求直接答案（“别解释/直接说/只要答案/怎么解决”） | answer_directly + brief，questionBudget 1 | 直接请求优先于温度 |
| 分析不确定性 ≥ 0.55（high→0.8，medium→0.55，low→0.25） | clarifyMode=prefer，budget 2；若有用户张力则 acknowledge_first | 不确定时澄清而非断言 |
| 未解决张力 ≥ 0.05 | acknowledge_first，budget 1 | 先回应再建议 |
| 其余 | none / as_needed / budget 2 | 默认 |

- 策略**不改变**事实、权限、记忆真值与人格 baseline；同一 payload 中证据块与策略块并列，测试比对同一事实在两种状态下事实不变（S9）。
- 阈值是规则常量，不是统计校准值。

## 4. 失败与降级

| 情形 | 行为 |
|---|---|
| 关系线程 observe/read 失败 | `recordDegradation('relationship_threads')`，本轮无连续性块，聊天继续 |
| 状态读取失败 | 沿用既有降级；策略退化为 `none/as_needed` |
| 策略块生成失败 | 不注入，记录降级；事实证据不受影响 |
| 线程过期/撤回/替换 | 从 `activeThreads()` 消失，不进入 payload |

## 5. 参数来源与可调性

- 半衰期、阈值、MIN_GROUPS 均为具名常量（`relationship-threads.ts`、`expression-policy.ts`），有注释说明取值理由；
- 调整任一常量必须同步对应测试（重复不加权、双消息晋升、过期、口头撤回、直接请求优先）。
