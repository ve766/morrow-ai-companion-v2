# Phase 2.1 — 评测器有效性与误判分析（任务 4）

对象：`evaluate:context`（离线，投递层）与 `verify:context:real`（真机，模型行为层）。

## 4.1 两组指标各自测量什么

| | 离线 `evaluate:context` | 真机 `verify:context:real` |
|---|---|---|
| Provider | 确定性桩 | 本地 `qwen2.5:0.5b` @ `127.0.0.1:11434/v1` |
| 报告字段 | `measures: context_delivery` / `modelUnderstanding: not_assessed` | `measures: model_behaviour` |
| 断言对象 | 序列化请求逐轮 | 模型原始回复 + 该轮请求 |
| 结果 | 22/22，90 条断言，hash `2a089d6c…`，replayStable | 见 §4.4 |
| 能否推得"模型会回忆" | **否** | 只能在同一模型内比较 |

两者不是同一件事的两个分数，是两件事。离线全绿说明"该送的东西送对了"，与"模型用不用"无关；真机的每次失败都带 `not_delivered` / `delivered_but_not_used` 归因，本轮所有运行 `not_delivered` 恒为 0。

## 4.2 判定规则的失效方向（本轮实测）

新增四态判定：`pass` / `fail` / `uncertain` / `needs_review`（`src/evaluation/verdict.ts`）。规则能证明什么，就判什么：

| 规则形态 | 通过的含义 | 判定 |
|---|---|---|
| 含 `mustMention`（正向要求） | 某字符串确实出现过 | `pass`，并附"提到不等于使用"的 caveat |
| 只有 `mustNotMention`（缺席） | 该字符串没出现 | `uncertain` —— 不回答也满足 |
| `clarifying_question`（问号） | 有问号 | `uncertain` —— 任何问句都满足 |
| 无规则 | 无从判定 | `needs_review` |
| 无回复 | 模型未被观察到 | `needs_review`（不是模型失败） |

本轮全量运行 `20261027T034222Z-d3839e` 的实测结果，自动与人工并列：

| 用例 | 自动 | 人工 | 谁错了 |
|---|---|---|---|
| a1 | fail | fail | — |
| a3 | fail | fail | — |
| **a4** | **pass** | **fail** | **自动假通过**：回复含"豆豆"，但以第三人称复述后反问用户，没答"是不是生病了" |
| a5 | uncertain | uncertain | — |
| **a6** | **fail** | **pass** | **自动假失败**：声明式澄清"请告诉我预订的具体需求和时间"没有问号 |
| b1 | fail | fail | — |
| b2 | fail | fail | — |
| b3 | pass | pass | — |
| b7 | fail | fail | — |
| b8 | uncertain | uncertain | — |
| b9 | uncertain | fail | — |
| c4 | fail | fail | — |

合计：自动 `2 pass / 7 fail / 3 uncertain`，人工 `2 pass / 8 fail / 2 uncertain`，**1 个假通过、1 个假失败、0 个未复核**。两个方向都被证实存在，这不是"规则偏严"或"规则偏松"能一句话概括的。

复核文件：`evaluation/reviews/20261027T034222Z-d3839e.review.json`；对照命令 `npm run review:summary 20261027T034222Z-d3839e`。

## 4.3 本轮修掉的具体误判

1. **复述请求被当成回答。** `20261027T033926Z-71bbb2` 的 `b3` 回复是"用户住在上海，但是近期搬到杭州了。"之后**整段复制 system prompt**（含 "User-controlled communication preferences"）。规则在复制块里找到"杭州"，判 pass。现在：回复与请求存在 ≥40 字符的逐字重合时，`pass` 降为 `uncertain`，理由写明"匹配到的内容可能来自请求本身"。
2. **否认事实却因复述地名通过。** `b2` 曾答"我是来自阿里云的大规模语言模型，不存在实际居住地址"并提到城市。已给该用例加 `mustNotMention: ["不存在实际居住地址"]`（仅此一条，来自实测输出，不做通用否定检测）。
3. **"没提"被当成"答对"。** `b8`（问天气）上一轮是 pass。现在缺席类规则一律 `uncertain`。
4. **问号被当成澄清。** `a5` 上一轮是 pass。现在 `clarifying_question` 通过也只是 `uncertain`。

## 4.4 真机结果（`8d96a5f` 干净树）

| 运行 | 用例集 | pass / fail / uncertain / needs_review | not_delivered |
|---|---|---|---|
| `T034149Z-35fd58` | 5 定向 | 0 / 3 / 0 / 2 | 0 |
| `T034200Z-76f626` | 5 定向 | 2 / 2 / 0 / 1 | 0 |
| `T034212Z-bfeb47` | 5 定向 | 1 / 3 / 0 / 1 | 0 |
| `T034222Z-d3839e` | 全部 12 | 2 / 7 / 3 / 0 | 0 |

定向三次的一致性：

| 用例 | 三次自动判定 | 说明 |
|---|---|---|
| `b7` 冲突 | fail / fail / fail | 稳定缺陷。其中一次答"抱歉，我不太知道"——不选边，但也没说明冲突 |
| `c4` 冲突+过期 | fail / fail / fail | 城市在变（杭州/上海/杭州），"确定"不变 |
| `b2` 跨会话 | fail / pass / pass | 命中两次，均为第三人称转述 |
| `b3` 纠正 | needs_review / pass / fail | 中间一次是 `PROVIDER_RESPONSE`（第二轮回包无法解析），不是模型失败 |
| `b5` 过期 | needs_review ×3 | 无机械规则，三次回复都被保留供人工读 |

## 4.5 仍然失效的地方（不修，写明理由）

1. **词表双向失真。** `a6` 是假失败、`a4` 是假通过，同一套规则。加子串只会换一种错，不会变对。
2. **40 字符重合是代理指标。** 一个正确回答若恰好引用 40 字符以上的用户原话会被误判为复述。当前数据里未出现，但这是有意的保守方向（宁可疑，不可假通过）。
3. **`b5` 无自动判定。** 正确行为是"意识到过期并说明"，任何子串规则都会被"照读记忆"满足，反而奖励错误答案。保留 `needs_review`，靠人工。
4. **人工复核由 agent 执行，不是人。** 复核文件的 `reviewer.kind` 是 `agent`，这一点写在文件里。它证明的是"机制可分离、结论可追溯"，**不**等于完成了人工质量复核。

## 4.6 可复现性

- 每次运行一个 `runId`（`<时间戳>Z-<内容摘要6位>`），文件名含 runId，写入用 `COPYFILE_EXCL`，同名即报错。
- 报告含 `reproduction: { runId, codeCommit, codeState, sampling }`；`sampling` 记录的是"客户端不发送采样参数，由 Provider 默认值决定"——这是同一请求三次给三种答案的直接原因，也是**不能**用单次通过宣称能力的原因。
- 复核文件独立于报告，`review:summary` 只读不写。
