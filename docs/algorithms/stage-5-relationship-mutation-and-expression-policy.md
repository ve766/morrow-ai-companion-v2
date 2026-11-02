# Stage 5 关系证据、目标撤回与表达策略算法

本文对应修复后的实现（`d986403`），公式与阈值均在生产代码中，不只是文档。

## 1. 关系证据聚合

```
score(x, t) = clip( Σ_g  w_g · s_g · exp(−ln2 · ageDays_g / halfLife_g), 0, 1 )
```

| 符号 | 含义 | 实现 |
|---|---|---|
| `g` | 一个独立来源组 = 一条源消息 | `relationship_thread_evidence(thread_id, source_message_id)` 唯一；同一消息重放不增权 |
| `w_g` | 来源权重 | 显式陈述 1.0；模糊暗示不抽取（权重 0，不入库） |
| `s_g` | 方向 × 强度 | `polarity='support'` → +1；`counter` 预留 −1（当前抽取器不产生反证行） |
| `halfLife_g` | 半衰期 | `address_preference` 180 天；`shared_topic/shared_plan/rhythm_preference` 90 天 |
| `ageDays_g` | 证据创建至今 | 注入时钟（测试可推进） |
| `clip` | 边界 | `[0,1]` |

状态判定：

```
active     ⟺ score ≥ 0.5  AND  distinctMessages ≥ MIN_GROUPS[kind]
candidate  ⟺ score ≥ 0    AND  distinctMessages <  MIN_GROUPS[kind]   （或 score < 0.5）
expired    ⟺ 距 lastSeen > 180 天
retracted / superseded：终态，recompute() 直接返回
```

`MIN_GROUPS`：`address_preference=1`（一次明确陈述即可）、`shared_plan=1`、
`rhythm_preference=1`、`shared_topic=2`（约定话题需要两次独立确认）。

`strength` 是有界启发式，不是概率；提示与 UI 都不允许把它作为置信承诺展示。

## 2. 目标撤回（P0-A）

计划器先做全局意图判定，再按称谓、约定、新内容分派。核心约束：

1. **全局撤回必须显式**：句子同时包含集合与动作（“把这些约定和偏好都撤回”“撤回所有约定”），
   才返回 `retract_all`；返回时记录 `relationship.retract_all`（payload 含
   `explicitGlobalIntent: true`、撤回条数）与 `relationship.mutated`。
2. **约定撤回必须唯一可定位**：候选集合 = 该用户 live 的 `shared_topic ∪ shared_plan`；
   - 1 条 → `retract(threadId)`
   - 0 条 → `clarify: no_agreement_to_retract`
   - ≥2 条 → `clarify: ambiguous_agreement_target`
3. **零写入澄清**：`clarify` 只写 `relationship.clarify` 事件（reason code），不改线程。
4. **幂等**：同一消息重放时目标已不是 live，撤回分支为 no-op；事件使用确定性 id
   （`relationship-mutated:<messageId>`、`relationship-retract-all:<messageId>`）。

## 3. 称呼纠正（P1-C）

正则（按顺序）：

| 名称 | 形态 |
|---|---|
| `ADDRESS_AMBIGUOUS` | “还是叫我之前/原来/以前那个名字”——无法解析值 → clarify |
| `ADDRESS_REJECT` | “我不喜欢这个称呼”“不要这样称呼我”——无新值 → 停用唯一当前值 |
| `ADDRESS_NEGATED` | “别再/不要/不用（再）叫我X”——拒绝的具体旧值 |
| `ADDRESS_NEW` | “（以后/请/就）叫我X”——新值 |

判定顺序与关键修复：

```
negated = ADDRESS_NEGATED.exec(text)
if negated:
    rest = text.slice(negated.index + negated[0].length)   // 只在否定短语之后找新值
    replacement = ADDRESS_NEW.exec(rest)
    if replacement and replacement.value != negated.value:
        old = live address with value == negated.value
        return old ? replace(old, replacement.value)
                   : support(replacement.value, replaces=true)
    // 只否定，没有新值
    current = live address (值匹配 negated.value，或唯一当前称呼)
    return current.length == 1 ? retract(current[0])
                               : clarify(...)
fresh = ADDRESS_NEW.exec(text)
if fresh: return support(fresh.value, replaces=true)
```

`replace` 写入：

- 旧线程 `status='superseded'`；
- 新线程 `supersedes_thread_id = old.id`；
- 旧值的 `source_message_id` / 证据保留，历史问题仍可审计来源；
- 旧值不再进入 `activeThreads()`。

## 4. 重放安全（P1-D）

判定不使用“请求次数”，而使用时间与已存状态：

```
允许替代/降级目标 ⟺ target.lastSeenAt <= mutation.at
upsert(kind, value):
    在全状态（active/candidate/superseded/retracted/expired）中按 (kind,value) 查找
    存在且 live → 复用 id
    存在且 lastSeenAt >= at → 视为旧消息重放，复用 id（不复活）
    存在且 lastSeenAt <  at → 用户严格更新地重新确认，置 candidate 后由 recompute 定状态
    不存在 → 新建
```

这样：

- 旧消息重放不会取代较新的决定；
- 同一消息重复投影不会产生第二个同值线程；
- 撤回后的重新确认只可能来自时间更晚的显式陈述。

## 5. 表达策略

```
Policy = f(explicitIntent, uncertainty, unresolvedTension, boundedState, userBoundary)
```

优先级（高→低）：

1. 安全、事实、权限边界（不进入策略计算，始终覆盖）；
2. 用户明确指令（直接回答、不要安慰、不要追问）→ `adviceMode='answer_directly'`,
   `brevity='brief'`, `questionBudget=1`, `rationale='explicit_direct_request'`；
3. 必要澄清（`uncertainty ≥ 0.55`）→ `clarifyMode='prefer'`，`questionBudget=2`；
4. 当前互动状态（未解决张力 / 明确困扰）→ `adviceMode='acknowledge_first'`；
5. 默认表达 → `adviceMode='none'`, `questionBudget=2`。

### 5.1 信号修正（P1-F）

```
distress = 明确困扰词命中(text)
        或 state.values.tension ≥ 0.05
```

明确困扰词（有界列表，可扩展）：`很累/特别累/好累/难受/难过/烦/崩溃/撑不住/
不想(做|干|活)/没力气/焦虑/睡不着/压力(很|太)?大`。

普通否定（`signals.negation === true`）**不再**等于 distress；“我不喜欢这个方案”不会触发
`acknowledge_first`。直接请求仍最高优先级：“别安慰我，直接说下一步怎么做” →
`answer_directly`。

策略只改变表达方式：

- 不修改事实账本、记忆状态、权限、人格基线；
- 不向用户暴露 confidence、revision、memory id、strength 或状态数值；
- 不声称人类主观体验，但也不把这一点写成状态报告（见下）。

### 5.2 提示层映射

| 策略输出 | 注入文本 |
|---|---|
| `answer_directly` | “answer it directly …”；`brief` 控制篇幅 |
| `acknowledge_first` | 先回应用户的感受/张力，再决定是否给建议；不输出清单式建议 |
| `clarifyMode='prefer'` | 允许 1–2 个澄清问题，先确认再回答 |
| `questionBudget` | “Optional follow-up questions allowed: N” |

固定原则（与顺序相关的两条）：

1. 问候：短、自然、回问候 + 至多一个开放问题；点名禁止“运行正常/一切照常运转/没什么新鲜事”
   与“随时可以帮你/有什么需要随时说”等状态报告和客服式收尾。
2. 使用记忆：在一个从句里自然使用（示例“按我记得的，你喜欢咖啡”）；不叙述检索过程、
   不解释记忆边界，除非不确定性实际影响答案。

## 6. 删除与恢复对算法的影响

- 证据删除后 `recompute()` 只对剩余证据求和；无证据线程 `candidate/strength=0`。
- `reconcile()` 删除 `source_message_id NOT IN (SELECT id FROM messages)` 的证据后重算。
- `retracted` / `superseded` 不受 `recompute()` 影响；恢复或重放都不能把它们变回 active。
- 备份恢复的 deletion journal replay 通过删除会话/消息触发同一证据清理路径。

## 7. 参数依据

| 参数 | 值 | 依据 |
|---|---|---|
| `RELATIONSHIP_ACTIVE_THRESHOLD` | 0.5 | 一次显式陈述（1.0）即时衰减下仍 active；两条相隔一个半衰期的证据合计约 0.5 |
| `RELATIONSHIP_TTL_DAYS` | 180 | 与称呼半衰期一致；更久的约定不再当作“当前约定” |
| 半衰期 180/90 | 天 | 称呼是较稳定偏好；话题/节奏更易过时 |
| `MIN_GROUPS.shared_topic` | 2 | 单次“下次聊X”可能是客套；两次独立确认才作为约定注入 |
| `CLARIFY_UNCERTAINTY_THRESHOLD` | 0.55 | 与 `uncertainty='medium'` 的映射一致 |
| `ACKNOWLEDGE_TENSION_THRESHOLD` | 0.05 | 有未解决张力即先回应；状态本身有界（0–1） |
| outbox 最大尝试 | 5（`EFFECT_MAX_ATTEMPTS`/`OUTBOX_MAX_ATTEMPTS`） | 有限重试，永久失败可见而非热循环 |
| 索引退避 | `min(2^attempt×5s, 15min)` | 既有 D2 机制；避免瞬时故障放大 |
