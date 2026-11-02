# Distress 语境作用域与证据独立性

对应实现：`src/affective-state/expression-policy.ts`（`expression-policy.v2`，
Issue #31 F3）。参数是固定规则权重，不是统计概率，也不向用户展示。

## 1. 处理流水线

```
原文
 → 规范化（trim）
 → 分句：按 。！？!?；;，, 换行 切分
 → 逐句判定语境：引用 / 否定 / 转述 / 假设 / 中性
 → E：仅中性分句中的当前用户第一人称情绪陈述
 → C：仅中性分句中的独立躯体/行为线索（不再计入程度词/标点）
 → T：有界前序互动张力（feeling state）
 → D = 0.55E + 0.25C + 0.20T
 → distress = E ≥ 0.85 OR (D ≥ 0.65 AND C ≥ 0.40)
 → ExpressionPolicy
```

`DistressEvidence` 暴露 `explicit/contextual/tension/score/distress/context/rationale`，
供测试与审计；不包含原始文本。

## 2. 分句与语境判定

| 阶段 | 规则 | 例子 |
|---|---|---|
| 分句 | `。！？!?；;，,` 与换行 | “我不是真的难过，只是有点累” → 两句 |
| 引用 | 分句含引号 `“”"「」『』‘’` | 你说“我现在很烦” |
| 否定 | 情绪词**之前**、同一分句内出现 `不是/并不/没有/没/不/别/从不/才不` | 我不是说我现在很烦；我不难过 |
| 转述 | 你/他/她/朋友/同事/家人/别人/有人/听说/据说/医生说/咨询师/主管/老板 + 说/告诉/提到/表示/觉得/认为/问；或“我刚才/之前/上次说” | 你刚才说我现在很烦；我朋友说我最近很焦虑 |
| 假设 | 如果/要是/假如/万一/倘若/若 | 如果我很烦，我就先暂停一下 |
| 中性 | 以上都不成立 | 我现在很烦 |

判定顺序：引号 → 否定（前缀） → 转述 → 假设。否定作用域只覆盖当前分句的情绪词，
不会吞掉后续分句（“我不是难过，但我现在很累”中第二句仍可成为 E）。

## 3. E — 显式情绪陈述

E 只来自**中性分句**：

| 形态 | 例子 | E |
|---|---|---|
| 第一人称 + 可选时间/程度 + 情绪词 | 我现在很烦、我今天很累 | 1 |
| 时间框架 + 程度 + 情绪词 | 今天真的很难受 | 1 |
| 事件/人 + 让/把 + 我 + 情绪词 | 这件事让我很难过 | 1 |
| 极端句式 | 我撑不住了、我受不了了 | 1 |
| 轻度限定（仅 mild 模式） | 我有点累、我有些焦虑 | 0.6 |

- `烦` 后接 `麻/请/琐/杂` 不算情绪（麻烦、烦请、烦琐、烦杂）。
- 轻度模式不进入 strong 模式；`我有点累` 只能是 0.6，需要独立 C/T 才能达到阈值。
- 被引用、转述、否定、假设的短语即使包含完整情绪句式，也不计入 E；只会记录边界原因。

## 4. C — 独立上下文佐证

C 只来自**中性分句**的躯体/行为线索：

```
睡不着 | 失眠 | 没力气 | 不想动 | 吃不下 | 没胃口 | 心慌 | 喘不过气 | 头疼
```

- 1 个不同线索 → C=0.4
- ≥2 个不同线索 → C=0.8
- 程度副词、重复同一情绪词、感叹号/重复标点**不计入 C**：它们是 E 的一部分，
  不能伪装成第二个独立证据来源。
- 不引入未经证实的“前序回合情绪”通道；T 是唯一的前序状态证据。

## 5. T — 前序互动张力

`FeelingState.values.tension`（0–1，有界、衰减）。T 只占 20%，单独最多贡献 0.2，
无法触发 distress；它不能替代 E 或 C，也不会把当前句的情绪词再次计入。

## 6. 公式与阈值

```
D = 0.55·E + 0.25·C + 0.20·T
distress = (E ≥ 0.85) OR (D ≥ 0.65 AND C ≥ 0.40)
```

| 参数 | 值 | 依据 |
|---|---|---|
| `DISTRESS_THRESHOLD` | 0.65 | 强显式（E=1,C=0,T=0）D=0.55，靠 E≥0.85 触发；轻度 E=0.6 需要 C=0.8 且 T≈1 才能达到 0.73 |
| `DISTRESS_CONTEXT_MIN` | 0.40 | 至少一个独立躯体线索；纯工具词/程度词为 0 |
| `DISTRESS_EXPLICIT_HIGH` | 0.85 | 明确第一人称情绪陈述直接触发，不依赖 C/T |
| 权重 0.55/0.25/0.20 | — | E 是主证据，C 是独立佐证，T 只是状态；三者来源不同 |

`我有点累，睡不着，也没力气`（E=0.6、C=0.8、T=1）→ D=0.73 → distress，是组合规则
的校准点；`我有点累`（E=0.6、C=0、T=0）→ D=0.33 → 不触发。

## 7. 边界原因码

`DistressEvidence.rationale` 可区分：

| 原因码 | 含义 |
|---|---|
| `explicit_emotion_statement` | 当前用户明确情绪陈述 |
| `contextual_corroboration` | 轻度陈述 + 独立 C/T 达标 |
| `mild_without_independent_context` | 有轻度陈述但无独立佐证 |
| `negated_emotion` | 情绪被同一分句否定 |
| `quoted_emotion` | 引号内引用 |
| `reported_emotion` | 转述他人/过去的话 |
| `hypothetical_emotion` | 条件/假设句 |
| `unresolved_tension_only` | 只有前序张力 |
| `no_distress_evidence` | 无证据 |

`context` 字段记录 `neutral/negated/quoted/reported/hypothetical`，供测试断言；
不写入 prompt，不包含原文。

## 8. 表达策略

优先级不变：

1. `wantsDirectAnswer` → `answer_directly` / `brief` / `questionBudget=1`，
   不先安慰，不用 distress 策略阻断任务。
2. 不确定性 ≥ 0.55 → `clarifyMode='prefer'`；若 evidence.distress 则
   `acknowledge_first`，rationale 兼容 v1 词汇 `uncertain_and_user_tension`。
3. evidence.distress → `acknowledge_first`，rationale `user_tension_unresolved`。
4. 其余 → `none`；有张力但无 distress 时 rationale `unresolved_tension_only`。

策略只改变表达；事实、权限、记忆真值、人格基线不变。

## 9. 失败降级

- 无文本/文本为空 → E=0、C=0，仅 T；不触发。
- 语境无法判定（例如无法确定引用归属）→ 按边界/无证据处理，宁可不触发。
- 轻度陈述无独立佐证 → 不触发。
- 直接请求 → 永远优先，不因语境判定被阻断。
- 内部 trace 只记录原因码与分数，不记录原文、密钥或个人内容。
