# 人格成长运行时 v2（G1/G2 双账本，D-1 修复后）

状态截至 commit：见 `git log -1 --format=%H`（本文件随修复提交入库）。取代 `stage-3-algorithm-registry.md` 中 G1 的旧描述（旧文"生产者存在、每轮运行"与执行事实不符，已由独立审计 D-1 指认并在此订正）。

## 1. 两条账本，一个信号源

每轮对话由 outbox 的 `growth` 投影器（`src/app/companion-service.ts`，`buildCognitiveProjectors`）把 `deriveGrowthSignals()` 的输出写入**两条互不隶属的账本**：

| | G1 `PersonalityGrowthService` | G2 `UserInteractionProfileService` |
|---|---|---|
| 表 | `personality_growth_signals` / `_state` / `_events` | `user_interaction_signals` / `_profile` |
| 语义 | Morrow 自身的证据形成倾向（呈现维度漂移） | 对**该用户**的沟通适配 |
| 消费者 | `effectiveProfile`（prompt 人格三数值 = baseline + G1 fold）+ context block 解释行 | context block 的 "Interaction style adapted…" 行（仅表述） |
| 幂等 | PK `(dimension, turn_id)`，`ON CONFLICT DO NOTHING` | 同 |

两者共享同一折叠数学，禁止互相写入；prompt 中分别以 "Morrow's personality … evidence-formed drift" 与 "Interaction style adapted to what this user asked for" 标注，不合并成一个含糊数值。

## 2. 折叠公式（沿用既有 foldGrowth，D-1 未改参数）

```
对每条证据 i（维度 d，回合 t）:
  age_i  = max(0, now − created_at_i)（天）
  丢弃   age_i > 45 × 4（四个半衰期后的证据只留档不参与）
  w_i    = clamp(signal_i, −1, 1) × clamp(weight_i, 0, 1) × GROWTH_STEP(=1) × 0.5^(age_i/45)
total_d = Σ w_i（同一 (dimension, turn) 只算一次；同回合重复转述被上游 deriveGrowthSignals 合并）
offset_d = counted ≥ 3 ? clamp(round(total_d), −8, +8) : 0
P_effective = clamp(P_baseline + offset_d, 0, 100)     ← prepare() 每轮实时折叠
```

- 变量：`signal` ∈ [−1,1]（规则极性×强度）；`weight` = max(0.6, 分析置信度/100)；`GROWTH_MIN_EVIDENCE=3` 个**独立回合**（按 turn_id 计，同回合重试/重复 prepare 被 PK 吸收）；`GROWTH_MAX_OFFSET=8`；半衰 45 天。
- 正负证据同式参与（相反指令同回合净额聚合）；`applied=false` 时证据留档并在台账事件中记为 withheld。
- baseline（`personality_profiles`）只有用户编辑可写；`rollback(dimension)` 删除该维度全部证据行并折叠回 0；`forgetTurn(turnId)` 供删除级联——消息删除 trigger（v29）删信号行，读时 fold 即重算，无需失效缓存。

## 3. 运行时数据流

```
用户消息 → deriveGrowthSignals(analysis, content, personalization)
  → outbox('growth') 投影器（assistant 消息事务后 drain，幂等）
      ├─ growth.apply()    → personality_growth_signals（G1）
      └─ interaction.apply() → user_interaction_signals（G2）
prepare()（下一轮）
  ├─ effectiveProfile = applyGrowth(baseline, growth.list())   → prompt 头部三数值
  ├─ describeGrowth(growth.list())                              → context block 解释行
  └─ interaction.describe()                                     → context block 适配行
消息删除 → trigger 删 signals → 下次 fold 自动重算
用户回滚 → IPC personalityGrowthRollback → rollback() → 偏移归 0
```

## 4. 消费证据（本仓库）

- 生产链集成：`src/app/stage3-remediation.integration.test.ts`（outbox 写入、prompt 数值来自 G1、3 轮门槛、删除重算、回滚、跨重启连续）。
- 真实链路阈值/衰减/上限：`src/personalization/personality-growth.test.ts`、纵向评测（注入时钟，fresh=3 / aged=1.5）。
- 真实运行佐证：spark-x2.6 三次 32 轮会话 `interactionOffsets={0,0,0}` 是 G2 证据门槛（≥3 条显式风格句）未达标的诚实结果，不是 G1 缺席。
