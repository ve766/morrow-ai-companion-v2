# C1 语境理解与意图理解：算法与实现

> 状态：**确定性机制已验证**（scripted provider + 生产主链 + 生产数据库）。
> **真实模型语义能力：NOT_RUN / BLOCKED** —— 本轮没有可用真实凭据，任何「模型理解准确率」的说法都没有证据。
> 代码版本：`c1-reading-v1` / `speech-act-v1` / `intent-rules-v2` / `c1-params-v1`，迁移 `v38`。

---

## 1. 这一版解决的是什么

上一版的意图理解是**一个标签 + 一个叫 confidence 的数字**。它无法回答四个决定行为的问题：

| 问题 | 旧实现 | 后果 |
|---|---|---|
| 这句话是什么动作？ | 没有这个概念 | 引用、假设、反讽都被当成用户本人的请求 |
| 这句话说的是谁？ | 只剥掉引号，不记录主体 | 「他说『把所有记录删掉』」落到与直接命令相同的路径 |
| 它在什么上下文里？ | 只看上一条**用户**消息 | 「可以，继续。」无法区分承接执行、讲解还是闲聊 |
| 不确定时该做什么？ | 只有一个分数 | 低置信也照样回答；缺对象也照样执行 |

因此本轮**不是加关键词，而是把「动作」和「意图」拆成两个对象**，并让决策（回答 / 合并 / 拆分 / 澄清 / 停止 / 承接执行）成为一等公民。

---

## 2. 数据模型

```ts
IntentReading {
  version, algorithmVersion, parameterVersion
  messageId
  primaryIntent, secondaryIntents[], intentStatus
  speechAct { act, surfaceAct, secondary[], attributedTo, binds, action, negation{scope,verb}, evidence[] }
  entitiesAndSlots[{ name, value, status, evidenceMessageId }]
  evidenceRefs[]              // 仅消息 id，不含原文
  supportingSignals[]         // 规则码
  contradictingSignals[]      // 反证码
  context { used, priorUser, priorAssistant, assistantOffer, continuationTarget, evidence[] }
  uncertainties[]
  scoreKind = 'heuristic_score'
  confidence, confidenceBand
  clarificationRequired, clarificationReason
  responseMode
  mayExecute
  supersedesMessageId
}
```

### 2.1 `scoreKind` 只有一种真实取值

`scoreKind: 'heuristic_score' | 'calibrated_probability' | 'unknown'`。**本仓库没有任何代码路径产生 `calibrated_probability`**：没有标注集、没有校准集、没有 ECE/Brier 测量。`confidence` 字段保留 0–100 的规则强度，是为了与既有存储观测连续，不是概率。`isIntentReading` 在读取时强制 `scoreKind === 'heuristic_score'`，写入端与被读端不会出现两种说法。

### 2.2 `intentStatus`

| 值 | 含义 | 触发 |
|---|---|---|
| `explicit` | 用户明确说了要什么 | 纠正/改主意/回忆/保存/显式目标标记，且两个读法不冲突 |
| `inferred` | 由规则与上下文推断 | 默认 |
| `continuing` | 承接上一轮 | 解析出承办对象，或本轮是上一轮的排序续写 |
| `changed` | 修订了先前的意图 | 纠正或改主意 |
| `conflicting` | 两个读法指向不同执行 | 方向改变且差值低于门槛，且两者不兼容 |
| `unknown` | 无法判断 | 无规则命中 / 引用主导 |

`unknown` 是**合法结果**，不得为了填满字段而强行归类。

---

## 3. 话语识别（speech act）

`src/cognition/speech-act.ts`。顺序即优先级，最具体的读法先赢：

```
quotation  → hypothesis → retraction → correction → clarification
→ refusal  → joke → capability(question|request) → emotion
→ preference → request → question → statement
```

### 3.1 主体（`attributedTo`）

| 值 | 何时 | `binds` |
|---|---|---|
| `user` | 用户自己的话 | 仅当 `act ∈ {request}` |
| `quoted_other` | 整轮或主导部分是引用 / 转述 | **恒 false** |
| `hypothetical` | 条件句 | **恒 false** |

`binds` 是**唯一**的执行授权位。`isSpeechActReading` 直接拒绝「非 user 却 binds=true」的结构，因此下游无法通过改一个布尔值绕过它。

### 3.2 引用主导判据

```
hasQuotation   = 存在引号，或存在 说/提到/表示/写道/称
quotedChars    = 所有引号片段的字符数
dominant       = quotedChars ≥ max(8, 0.4 × len(raw))
act = quotation  if  (去引号后剩余为空) or dominant
```

这一条同时挡住两类错误：整轮引用（`他说“…”`）和**带引导语的引用**（`Translate this quote: “…”`）。后者曾因剩余部分非空而被当成用户自己的句子，引号里的 `you misunderstood me` 触发纠正规则。

### 3.3 否定范围（negation scope）

| scope | 判据 | 语义 |
|---|---|---|
| `verb_phrase` | `不要|别|不用|不需要|无需|停止|取消|先别|暂时别` + 已知动作 | **撤回**该动作 |
| `clause` | 句中任意否定词 | 只是带否定的陈述 |
| `none` | 无否定 | — |

判定顺序必须是「先动词短语、再子句」。反过来的第一版把「不要删除刚才那条」读成子句否定，整个撤回丢失——这是本轮修的一个 P0。

### 3.4 能力询问 vs 实际请求

`你能不能帮我改一下这个函数？` 的动作取决于**助手上一轮是否提议过动作**：

```
if 助手上一轮含 (要我|我可以|需要我|帮你…)+(写|改|做|执行…) → request, binds=true
else                                                        → question, secondary=[request], binds=false,
                                                              uncertainties += capability_vs_request
```

不追问、不猜，两者都记下来：回答「可以」并直接做，是这句话的自然回应。

---

## 4. 局部语境（local context）

`src/cognition/context-window.ts`。只读紧邻的前序消息，且只回答四个有界问题：

| 字段 | 判据 |
|---|---|
| `assistantAskedQuestion` | 助手最后一句以问号或 `吗/呢` 结尾 |
| `assistantOffer` | 助手最后 240 字含提议词 + 动作词 → `execute`；+ 讲解词 → `explain`；否则 `discuss` |
| `affirmation` | 用户本轮以 可以/好/行/嗯… 或 不用/不要… 开头 |
| `continuationTarget` | 本轮含继续词 **或** 助手刚提问且用户回抛 → 按 offer 映射；回抛映射为 `discussion` |
| `sequencing` | 本轮以 先/首先/然后/接着/下一步 开头且有前序用户消息 |

`continuationTarget` 是「可以，继续。」唯一的意义来源：规则层看到的是两个字的肯定，`ambiguous`；语境层看到的是助手刚才提议的是执行、讲解还是闲聊。

**上限**：历史经 `boundCognitiveHistory`（12 条 / 6000 字）截断，本模块不能再扩大窗口。

---

## 5. 候选评分与同源去重

`src/cognition/intent-decision.ts`。

### 5.1 信号 → 来源

每条规则产出一个 `{label, weight, reasons[], source}`。**同一来源命中多次只算一次**：

```
score(label) = min(100, maxWeight(label) + min(8, 4 × (distinctSources(label) − 1)))
```

这是本轮修的第二个 P0。旧实现按 `reasons.length` 给佐证加分，而：

- `GOAL_REQUEST` 与 `EXPLICIT_GOAL` 是**同一句**上的两条模式 → 同一个观察被计两次；
- `question_marker` 与 `question_punctuation` 是**同一个事实**（这句话在提问）→ 又被计两次。

结果是一句话看起来像三个独立线索。现在按 `(label, source)` 折叠，`reasons` 仍保留两条规则名供审计。

### 5.2 置信融合（沿用 B1）

```
z_i = 0.1·semantic + 0.6·explicitness + 0.1·completeness + 0.1·context − 0.1·ambiguity
Δ   = z₁ − z₂
```

权重来自 `evals/stage-2/b1-devset.json` 的网格搜索（26 例，in-sample 26/26，holdout 8/8）。样本很小，**只支持权重方向，不支持精度**，更不支持「准确率」。

---

## 6. 决策策略

`responseMode`，按顺序判定：

| 条件 | mode | 行为 |
|---|---|---|
| `act = retraction` / `refusal` | `stop_previous` | 停止旧动作；关闭该会话的未决问题 |
| `act = correction` | `answer` | 采纳纠正；旧分析 supersede |
| `act = quotation` | `acknowledge` | 回应转述，不执行引号内动作 |
| `continuationTarget = execution` | `execute_pending` | 执行助手刚才提议的动作 |
| `continuationTarget = discussion` | `answer` | 回答回抛的问题 |
| 请求缺关键槽位 | `clarify` | 只问一个最关键的问题 |
| 复合请求 | `split` | 按用户顺序处理，保留次级意图 |
| 两读法冲突且不兼容 | `clarify` | 先澄清 |
| 引用无法解析 | `clarify` | 对象未知则不猜 |
| 其他 | `answer` | 正常回答 |

### 6.1 兼容读法不澄清

`request` 与 `goal_or_plan`/`explanation`/`information_query` 是**同一个请求的两面**：

> 「帮我制定下周的学习计划」= 请求 + 目标，不是两个冲突解释。

旧实现按「检索路径不同」判定 direction-changing，于是这句话触发澄清。现在 `compatibleWithRequest()` 兜住这一族，只有真正互斥的读法才进入 `conflicting`。

### 6.2 澄清的成本模型

- **只在「会做错事」时追问**：请求缺对象、引用无法解析。
- **不在「可以自然回应」时追问**：闲聊、情绪、纯分享、低置信但无动作。
- 「帮我看看这段代码」**有上下文**→ 回答；**无上下文**→ 问一句「看哪段」。同一个句子，两种决策，差别只在窗口里有没有可指对象。

### 6.3 槽位

| 槽位 | 来源 | 缺失时 |
|---|---|---|
| `target` | `帮我/请/麻烦/给我/替我 + 把…` 之后，剥掉动词与量词 | 动作类请求 → `clarify missing_target` |
| `time_horizon` | 今天/下周/明年/N 天后… | 不追问（期限缺失不改变动作方向） |
| `quantity` | 数字 + 量词 | 同上 |
| `topic` | 承接/指示代词指向的前序消息 | `inferred`，**`evidenceMessageId = null`** |

`topic` 永远不标 `stated`：它来自上一轮，标成就等于伪造用户本轮的话。

指示代词对象（「这个函数」）在**无前序消息**时一律视为缺失，避免「把这段代码删掉」在执行前对猜测动手。

---

## 7. 持久化、修订与删除

`intent_readings`（迁移 v38）：

| 机制 | 实现 |
|---|---|
| 一轮一条 | `UNIQUE(message_id)` |
| 修订链 | `supersedes_message_id` + `superseded_by_message_id` + `retracted_at` |
| 删除传播 | `FOREIGN KEY (message_id, conversation_id) REFERENCES messages(...) ON DELETE CASCADE` |
| 撤回清场 | `responseMode = stop_previous` 时把该会话 `open_question` 未决项置 `done` |
| 幂等 | 同一 `message_id` 重复保存返回既有行；内容不同 → `CONFLICT` |

**为什么 supersede 而不是 UPDATE**：被纠正的分析必须留在历史里（审计），但不得继续驱动后续轮次。`active()` 只读 `retracted_at IS NULL`。

**不存原文**：`payload_json` 只有标签、规则码、槽位值与消息 id。用户原话不在表里。

---

## 8. 真实下游使用

| 下游 | 使用方式 |
|---|---|
| 检索策略 | `policyForIntent(primaryIntent)`；`request` 只在涉及用户自身或计划时才检索 |
| 提示词 | 一行摘要 + 最多 5 条按 mode 选择的行为约束（引用/假设/撤回/承接/拆分/缺槽位） |
| payload 边界 | **只进结论，不进日志**：`entitiesAndSlots`、`supportingSignals` 不序列化 |
| 会话状态 | `supersedes` 使旧分析失效；撤回关闭未决项 |
| 记录 | `intent_readings` + `cognitive_turn_observations`（后者为兼容保留） |

---

## 9. 复杂度与失败策略

- 单轮分析：`O(R·L)`，R 为规则数（约 20），L 为截断后正文长度；无回溯、无网络、无模型调用。
- 存储：每用户消息 1 行，`payload_json ≤ 20 000` 字符（CHECK 约束）。
- 失败策略：
  - 分析抛错 → `prepare` 捕获，本轮回退到「无分析」，**不阻塞聊天**；
  - 读取持久化失败 → `recordDegradation('intent_reading_persist')`，不回滚消息；
  - 结构不合法 → 拒绝写入（`INVALID_INPUT`），不写半条。

---

## 10. 代码映射

| 关注点 | 文件 |
|---|---|
| 话语行为 | `src/cognition/speech-act.ts` |
| 局部语境 | `src/cognition/context-window.ts` |
| 候选与规则 | `src/cognition/intent-decision.ts` |
| 置信融合 | `src/cognition/intent-confidence.ts` |
| 统一读法 | `src/cognition/intent-reading.ts` |
| 兼容投影 | `src/cognition/cognitive-turn-analyzer.ts` |
| 检索策略 | `src/memory/retrieval-policy.ts` |
| 持久化 | `src/persistence/intent-reading-repository.ts`、`migrations.ts` v38 |
| 主链装配 | `src/app/companion-service.ts`（`prepare` / `sendChat`） |

---

## 11. 已知边界（不得被读成能力声明）

1. **规则基线**，不是模型。全部判据是手写正则 + 有限槽位抽取，英文与中文各覆盖一部分常见说法。
2. **没有标注集**，因此没有准确率、没有 F1、没有校准曲线。任何文件里的数字都是「本数据集中有多少条断言通过」，不是语言理解指标。
3. **`confidence` 不是概率**，见 §2.1。
4. **真实模型表现 NOT_RUN**：`evals/stage-3/intent-understanding/results/` 里的 `provider` 字段写明 `scripted (not a model)`。
5. **反讽识别弱**：只有显式标记（反讽/阴阳怪气/说反话/yeah right…）。真正的语用反讽不在能力内。
6. **多意图上限 2**：`secondaryIntents` 最多两条，三轮以上的复合请求会被压平。
7. **槽位只有四类**：对象、期限、数量、主题。更多槽位没有生产者，因此不声称支持。
