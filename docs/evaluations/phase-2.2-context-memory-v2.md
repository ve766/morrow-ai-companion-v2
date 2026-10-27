# Phase 2.2 — 语境评测集 v2 与评测器有效性（任务 5）

- 数据集：`evaluation/fixtures/context-memory-v2.json`
- 报告：`evaluation/reports/context-memory-v2-report.json`
- 相关提交：`d4960be`、`36a0629`

## 1. 数据集结构

`context-memory-v2` 保留 v1 的全部 22 个用例（因此 21 项能力仍然全覆盖），再追加 8 个：

| 新用例 | 能力 | 断言 |
|---|---|---|
| `v2-elliptical-context` | A2 | 省略轮 + 前文 → `match=context` |
| `v2-conflict-group` | B7 | 两条同主题 → `memoryEntries=2`，请求含 `conflictGroup` |
| `v2-stale-classes` | B5 | 120 天：volatile `stale=true`，stable `stale=false`，请求含 `volatility` |
| `v2-lexical-precision` | B8 | `an` 不命中 `analyst`，`memoryTopicCount=0` |
| `v2-retracted-context` | B4 | 撤回后 `memoryEntries=0`，哨兵不出现 |
| `v2-correction-current` | B3 | 纠正后含「杭州」、不含「上海」 |
| `v2-no-evidence` | B8 | 无记忆 → `"memories":[]` |
| `v2-unrelated-not-promoted` | B9 | 无关记录在两轮都不是 `topic` |

每个用例都有 `claims`（它被允许得出什么结论）与 `expect`（至少一条可执行断言）。没有断言的 turn 在解析期就被拒绝。

## 2. 离线结果

| 指标 | v1 | v2 |
|---|---|---|
| 用例 | 22 | **30** |
| 断言 | 90 | **110** |
| 通过 | 22/22 | **30/30** |
| 确定性 hash | `693b0a19…` | `b9cc7f03…` |
| 重放稳定 | 是 | 是 |
| 网络调用 | 0 | 0 |

`evidenceClass = offline_deterministic_stub`，`measures = context_delivery`，`modelUnderstanding = not_assessed`。这组数字只能说明「该送的东西送对了」。

## 3. 评测器有效性

### 3.1 四态判定

`pass / fail / uncertain / needs_review`，规则能证明什么就判什么：

| 规则 | 通过的含义 | 判定 |
|---|---|---|
| `mustMention` | 字符串确实出现 | `pass`（附「提到不等于使用」） |
| 只有 `mustNotMention` | 字符串没出现 | `uncertain`（不回答也满足） |
| `clarifying_question` | 有问号 | `uncertain`（任何问句都满足） |
| 无规则 | 无从判定 | `needs_review` |
| 回声 ≥ 40 字符 | 回复是请求的复读 | `pass` 降为 `uncertain` |

### 3.2 已知假通过 / 假失败被固定下来

`verdict.test.ts` 新增两条**不是**「判定正确」的测试，而是把 Phase 2.1 的盲点钉住：

| 案例 | 当前判定 | 断言 |
|---|---|---|
| a4：第三人称复述「用户提到豆豆，是不是生病了呢？」 | `pass` | caveat 必须含 `not a use` |
| a6：无问号的声明式澄清「请告诉我预订的具体需求和时间。」 | `fail` | caveat 必须含 `may be the rule rather than the model` |

它们的作用是：以后有人想把这个盲点「改好」，必须先看到这两条测试，而不是悄悄把盲点变成无条件通过。

### 3.3 自动与人工分离

复核文件独立于报告（`evaluation/reviews/<runId>.review.json`），`review:summary` 只读不写。**本阶段没有做真实人工复核**；复核文件的 `reviewer.kind` 仍应是 `agent`，不得表述为「人工质量复核已完成」。

## 4. 真实模型结果

数据集 30 例，本轮只跑 5 例（其余未选）：

命令：

```
MORROW_CONTEXT_REAL_DATASET=context-memory-v2.json \
MORROW_CONTEXT_REAL_CASES=v2-elliptical-context,v2-conflict-group,v2-stale-classes,v2-correction-current,v2-retracted-context \
MORROW_CONTEXT_REAL_OUTPUT=context-memory-v2-real-report.json \
npm run verify:context:real
```

| 项 | 值 |
|---|---|
| runId | `20261027T062902Z-e0151c` |
| 代码 | `36a0629`，clean tree |
| 模型 | `qwen2.5:0.5b` @ `http://127.0.0.1:11434/v1` |
| 采样 | 客户端不发采样参数，Provider 默认 |
| 选中 / 已判定 | 5 / 3 |
| pass / fail / uncertain / needs_review | 0 / 3 / 0 / 2 |
| `notDelivered` | **0** |
| `deliveredButNotUsed` | 3 |

逐例：

| 用例 | 判定 | 归因 | 回复 |
|---|---|---|---|
| `v2-elliptical-context` | fail | delivered_but_not_used | 「再后天什么时候要去出差？」 |
| `v2-conflict-group` | fail | delivered_but_not_used | 「你住在中国，我住在美国……」 |
| `v2-correction-current` | fail | delivered_but_not_used | 「我住在北京。」 |
| `v2-stale-classes` | needs_review | — | 无机械规则 |
| `v2-retracted-context` | needs_review | — | 只有缺席型规则 |

前一轮（规则尚未加上）的 runId `20261027T062820Z-5b5f8f` 也保留：5/5 全部 `needs_review`。两份记录都没有被覆盖。

## 5. 这组数字不能说明什么

- 不能说明 Morrow 具备冲突披露、过期承认或纠正遵循能力。三项可判定用例全部 fail。
- 不能说明 `qwen2.5:0.5b` 代表其他模型；它只是一个可复现的本地基线。
- 不能说明 30 个离线用例「模型都能过」；离线只测投递。

## 6. 残余风险

1. 数据集 30 例仍偏小；v2 新增 8 例是定向补齐，不是统计抽样。
2. 没有真实人工复核；a4/a6 的盲点仍然存在。
3. 「长对话早期约束」仍只有字符预算断言，没有 20–30 轮的行为观察（P2）。
4. 真实运行只覆盖 5/30 例，其余未验证。
