# Stage 5 Distress 证据校准（E/C/T/D）

对应实现：`src/affective-state/expression-policy.ts`（`expression-policy.v2`）。
参数是固定、可解释的规则权重，不是统计概率，也不向用户展示。

## 1. 公式

```
E = explicit_emotion_statement_score ∈ [0, 1]
C = contextual_corroboration        ∈ [0, 1]
T = unresolved_interaction_tension  ∈ [0, 1]   （bounded feeling state）

D = 0.55·E + 0.25·C + 0.20·T

distress = (E >= 0.85) OR (D >= 0.65 AND C >= 0.40)
```

- `E >= 0.85`：明确、高置信的情绪陈述。
- 组合规则：E 较弱时，需要上下文佐证（C）且总分足够。
- T 只占 20%：单独张力最高只能贡献 0.2，无法触发 distress。
- 直接请求（`wantsDirectAnswer`）在策略层最高优先级，覆盖 distress 表达。

## 2. E — 显式情绪陈述

只匹配完整句式，不做单字子串匹配：

| 形态 | 示例 | E |
|---|---|---|
| 第一人称 + 可选时间/程度 + 情绪词 | “我现在很烦”“我今天很累”“我有点烦” | 1（“有点”为 0.6） |
| 时间框架 + 程度 + 情绪词（无“我”） | “今天真的很难受” | 1 |
| 事件/人 + 让/把 + 我 + 程度 + 情绪词 | “这事让我很烦” | 1 |
| 极端句式 | “我撑不住了”“我受不了了” | 1 |
| 轻度限定 | “我有点累” | 0.6（需上下文佐证） |

排除规则：

- `烦` 后接 `麻/请/琐/杂` 不算情绪（“麻烦”“烦请”“烦琐”“烦杂”）。
- “我不喜欢这个方案”不含情绪词，E=0。
- “你刚才没有回答我的问题”是互动陈述，不是情绪陈述，E=0。

## 3. C — 上下文佐证

C 是**独立线索类别**的计数，不是同一个词重复出现：

| 类别 | 例子 |
|---|---|
| 显式情绪句式 | 上表 E>0 |
| 躯体/行为线索 | 睡不着、失眠、没力气、不想动、吃不下、心慌、喘不过气、头疼 |
| 强调标点/重复 | `！`、`!`、`啊啊`、`呜呜`、烦死、累死 |
| 程度词 + 显式情绪 | 很/太/真的/特别/实在/非常/快/有点 |

- 1 类（且 E>0）→ C=0.4
- ≥2 类 → C=0.8
- 无显式情绪 → C=0（避免仅凭“麻烦/不喜欢”产生上下文困扰）

## 4. T — 未解决互动张力

来自既有 `FeelingState.values.tension`（0–1），有界、衰减、跨会话；不是情绪识别。
普通 disagreement/否定不会自动抬高 T；T 单独不触发 distress。

## 5. 对照用例

`src/affective-state/distress-evidence.test.ts` 逐例断言 E/C/T/D 与策略：

| 输入 | E | C | T | D | distress | evidence rationale | policy |
|---|---|---|---|---|---|---|---|
| 我现在很烦 | 1 | 0.8 | 0 | 0.75 | yes | explicit_emotion_statement | acknowledge_first |
| 今天真的很难受 | 1 | 0.8 | 0 | 0.75 | yes | explicit_emotion_statement | acknowledge_first |
| 我撑不住了 | 1 | 0.4 | 0 | 0.65 | yes | explicit_emotion_statement | acknowledge_first |
| 这事让我很烦 | 1 | 0.8 | 0 | 0.75 | yes | explicit_emotion_statement | acknowledge_first |
| 我今天很累 | 1 | 0.8 | 0 | 0.75 | yes | explicit_emotion_statement | acknowledge_first |
| 我有点烦 | 0.6 | 0.8 | 0 | 0.53 | no | contextual_corroboration* | none |
| 麻烦你帮我检查一下代码 | 0 | 0 | 0 | 0 | no | no_distress_evidence | none |
| 这个操作很麻烦 | 0 | 0 | 0 | 0 | no | no_distress_evidence | none |
| 我不喜欢这个方案 | 0 | 0 | 0 | 0 | no | no_distress_evidence | none |
| 麻烦把日志发我 | 0 | 0 | 0 | 0 | no | no_distress_evidence | none |
| 你刚才没有回答我的问题 | 0 | 0 | 0 | 0 | no | no_distress_evidence | none |
| 你刚才没有回答我的问题（T=0.2） | 0 | 0 | 0.2 | 0.04 | no | unresolved_tension_only | none |
| 我现在很烦，别安慰我，直接给修复方法 | — | — | — | — | yes | — | answer_directly（直接请求优先） |

\* `我有点烦` 的 evidence rationale 是 `contextual_corroboration` 只有当 distress=true；
实际 distress=false，rationale 为 `unresolved_tension_only`（T>0）或
`no_distress_evidence`（T=0）。该行用于说明“轻度陈述不足以触发”。

## 6. 阈值依据

| 参数 | 值 | 依据 |
|---|---|---|
| `DISTRESS_THRESHOLD` θ | 0.65 | 显式强陈述（E=1,C=0.4,T=0）恰好达到；只有 E 弱/无 E 时达不到 |
| `DISTRESS_CONTEXT_MIN` | 0.40 | 单一显式线索即可作为最小佐证；纯工具词为 0 |
| `DISTRESS_EXPLICIT_HIGH` | 0.85 | 明确句式直接触发，不依赖 C/T |
| 权重 0.55/0.25/0.20 | — | 显式陈述是主证据；上下文次之；互动张力只是状态，不能主导 |
| 情绪词排除 `烦(麻|请|琐|杂)` | — | 修复 F3 的确定性误判 |

校准方法：固定对照集（正例 4、负例 4、边界 2）逐项断言；没有把它包装成统计概率。
若后续增加语言变体，必须新增对照用例并记录误判率，不得直接调阈值“试到过”。

## 7. 失败降级

- 没有用户原文（`text` 缺失）→ E=0、C=0；仅 T 存在 → 不触发 distress。
- 上下文/情绪证据不足 → 返回 `no_distress_evidence` 或 `unresolved_tension_only`，
  策略为 `none`；宁可不安慰，也不虚构语义分数。
- 不确定性高且 distress 成立 → `clarifyMode='prefer'` + `acknowledge_first`，
  `questionBudget=2`。
- 直接请求 → `answer_directly`、`brief`、`questionBudget=1`，不先共情。
- 策略只改变表达；事实、权限、记忆真值、人格基线不变。

## 8. 兼容性

- 表达策略 rationale 保留 v1 词汇：`user_tension_unresolved`（distress）、
  `uncertain_and_user_tension`（不确定 + distress）、`explicit_direct_request`、
  `no_special_condition`；新增 `unresolved_tension_only` 供“有张力但无困扰”使用。
- 结构化证据的真实原因在 `DistressEvidence.rationale`，仅用于测试/审计，不进入 prompt。
