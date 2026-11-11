# 最终产品算法索引（公式 · 参数 · 入口 · 失败语义）

全部公式在生产主链有真实调用；参数为固定启发式，不是概率，也不向用户展示。

## 1. 记忆检索（`src/memory/memory-context-assembler.ts`）

```
通道：fact-index / lexical / slot / normalized-value
RRF(d) = Σ_ch 1/(60 + rank_ch(d))，归一化 = 值 / (通道数/(60+1))   # A1 修复
排序 = contextUtility(RRF, freshness, quality, conflict)
```

- 先按权限/状态过滤（active、未归档、敏感上限）；superseded 只进“历史”标注，不当当前值。
- 冲突 → `conflicts` 结构 + 提示要求澄清；无证据 → 明确“未检索到”，不编造。
- 度量：Stage 3 final-closure 8 个同义用例 recall@2=1.0、MRR=0.948、误注入=0。

## 2. 记忆操作（`src/memory/memory-operation-planner.ts` / `memory-service.ts`）

```
plan ∈ none | create | correct | clarify | rejected | failed
execute(create)  = 事务{ 写记录+revision+账本 → 逐项复读验证 }
  验证不符 → 回滚（rolled_back）；仅索引降级 → recovery_required
```

- 只有 `committed_and_verified` 允许模型说“已记住”；其余状态明确禁止。
- 纠正验证绑定 `sourceMemoryId = target.memoryId`（A2 修复）。

## 3. 关系连续性（`src/relationship/relationship-threads.ts`）

```
score = clip(Σ_g w_g·s_g·exp(−ln2·ageDays_g/halfLife_g), 0, 1)
halfLife：称呼 180 天 / 其余 90 天；active 需 score≥0.5 且独立消息≥MIN_GROUPS
mutation ∈ support|replace|retract|retract_kind|retract_all|clarify（目标不明→零写入）
```

- 来源删除 → v46 触发器删证据 + tombstone（无 value/来源指针）。
- 晚到旧任务：`lastSeenAt > at` 的新决定胜出，旧值 superseded。

## 4. Outbox / 效果账本（`src/app/effect-ledger.ts`、`cognitive-outbox.ts`）

```
claim: 条件 UPDATE → running, lease=T+60s, lease_generation=+1
complete/fail: WHERE claim_owner=me AND lease_generation=mine AND state='running'
drain: claim → project → complete（失败→lostLease，不标 done）
退避：min(2^attempt×5s, 15min)；5 次后 terminal_failed
```

- 真实 OS 进程验证：单 owner、单次成功、租约接管、删除并发、旧任务不覆盖。

## 5. 人格成长 / 沟通适配（`src/personalization/*`）

```
G1 成长：门槛 3 独立回合；步长 1；上限 ±8；半衰 45 天；180 天截断
G2 适配：同 fold 公式，读时重算（A4 修复）→ 半衰与删除即时生效
prompt：人格数值=基线+G1；G2 单独一行“仅表达层”
```

## 6. Distress / 表达策略（`src/affective-state/expression-policy.ts`）

```
分句 → 引用/否定/转述/假设作用域 → E（仅中性分句第一人称）
C = 独立躯体/行为线索（≥2→0.8，1→0.4）；T = 有界前序张力
D = 0.55E + 0.25C + 0.20T
distress = E≥0.85 OR (D≥0.65 AND C≥0.40)
优先级：answer_directly > clarify(prefer) > acknowledge_first > default
```

## 7. 探索门（`src/self-model/exploration-policy.ts`）

```
候选：Morrow/shared 且 active、证据≥3、强度≥阈值、置信≥阈值
抑制：纠正 / 直接请求 / 高不确定；预算 2/日；冷却 6h；会话内去重
```

## 8. 兴趣形成（`src/self-model/interest-service.ts`）

晋升需 ≥3 独立证据且跨 ≥2 会话；来源删除/撤回触发降级或删除（触发器 + 读时对账）。

## 9. 失败与回滚语义（通用）

- 一切派生投影幂等、可重放；账本记录 applied/terminal_failed。
- 用户可见状态只用 `committed_and_verified / clarify / failed / recovery_required / rolled_back`。
- 删除即隐私：来源消失 → 内容清空（tombstone），恢复路径不复活。
