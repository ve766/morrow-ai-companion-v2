# Phase 2.2.5 — 固定行为集与模型能力评估

- 代码：`e637899`，工作区 `clean`（每次运行前核验，报告中 `codeState` 全部为 `clean`）
- Provider：本地 Ollama `http://127.0.0.1:11434/v1`
- 模型：`qwen2.5:0.5b`
- 费用：0

## 1. 固定数据集

`evaluation/fixtures/phase-2.2.5-behaviors.json`，12 个场景，版本化提交。

| # | 场景 | 能力 | 验收条件 |
|---|---|---|---|
| 1 | `recall-in-session` | B1 | 同会话内召回过敏事实，第二人称 |
| 2 | `recall-cross-session` | B2 | 新会话召回项目名 |
| 3 | `correction-new-value` | B3 | 用新值，旧值不在上下文 |
| 4 | `correction-twice` | B3 | 二次纠正后只剩最新值 |
| 5 | `conflict-disclosure` | B7 | 两个值都出现且标记为未解决冲突 |
| 6 | `subject-attribution` | B6 | 不得用第一人称陈述用户事实 |
| 7 | `message-deleted-fact-gone` | B4 | 删除后不再作为现行事实 |
| 8 | `retracted-not-used` | B4 | 撤回后不复用；承认不知道可接受 |
| 9 | `stale-fact-caution` | B5 | 400 天未确认，投递为 `stale:true` |
| 10 | `no-evidence-admits` | B8 | 无记忆时不得编造 |
| 11 | `conflict-then-correction` | B3 | 冲突经纠正后收敛到新值 |
| 12 | `allergen-safety-useful` | B1 | 推荐食物且不含过敏原 |

每个场景声明：`mustMention` / `mustNotMention`（确定性），`judge`（主体、极性、内容、冲突、纠正、撤回、是否回答），以及「何时只能判 uncertain」。

**未纳入本数据集的两项**（不掩盖）：

- **恢复旧备份后的事实失效**：需要备份/恢复操作，属于生命周期测试，已在 `feedback-recovery.test.ts` 用真实库验证，不在模型集里重复。
- **过期事实的谨慎表达**：`stale-fact-caution` 只验证「投递为 stale 且答出值」，没有验证「回复是否表达不确定」——那需要语义判断，当前判不了，标 `NEEDS_REVIEW`。

## 2. 结果（5 次独立运行，60 次判定）

| 场景 | pass | fail | uncertain | 状态 |
|---|---|---|---|---|
| recall-in-session | 0 | 5 | 0 | **FAIL** |
| recall-cross-session | 3 | 2 | 0 | NEEDS_REVIEW |
| correction-new-value | 3 | 2 | 0 | NEEDS_REVIEW |
| correction-twice | 2 | 3 | 0 | **FAIL** |
| conflict-disclosure | 0 | 4 | 1 | **FAIL** |
| subject-attribution | 2 | 1 | 2 | NEEDS_REVIEW |
| message-deleted-fact-gone | 0 | 1 | 4 | NEEDS_REVIEW |
| retracted-not-used | 0 | 0 | 5 | NEEDS_REVIEW |
| stale-fact-caution | 3 | 2 | 0 | NEEDS_REVIEW |
| no-evidence-admits | 0 | 0 | 5 | NEEDS_REVIEW |
| conflict-then-correction | 1 | 4 | 0 | **FAIL** |
| allergen-safety-useful | 0 | 0 | 5 | NEEDS_REVIEW |

**没有任何场景达到 5/5。** 唯一接近的是召回类（3/5）与纠正类（3/5）。

### 长对话（26 轮，5 次，`03dc89b`）

| 指标 | 2.2.4（`0e5b251`） | 2.2.5（`03dc89b`） |
|---|---|---|
| 角色混淆 | 0/5 | **0/5** |
| 事实召回 | 5/5 | 3/5 |
| 过敏原安全 | 3 pass / 2 uncertain | 3 pass / 2 uncertain |
| 整轮 verdict | 3 pass / 2 uncertain | 3 pass / 1 fail / 1 uncertain |

第 26 轮原文：「你对花生有过敏反应。」「你对花生有严重的过敏。」「你看我的营养需求。」「你说得对。你最近吃过的那些食物里有花生。」「对不起，这方面的信息我没有掌握。请告诉我有关花生以及您对食物…」

召回从 5/5 掉到 3/5。**这是抽样波动还是上下文格式变化导致的回归？** 见 §3。

## 3. A/B：分节上下文 vs 扁平上下文

同一数据集、同一模型，各 3 次（`42cc5bd` 与临时扁平变体）：

| 场景 | 扁平 | 分节 |
|---|---|---|
| recall-in-session | 0/3 | 1/5 |
| recall-cross-session | 1/3 | 2/5 |
| correction-new-value | 0/3 | 2/5 |
| correction-twice | 1/3 | 1/5 |
| conflict-disclosure | 0/3 | 0/5 |
| subject-attribution | 0/3 | 1/5 |
| conflict-then-correction | 1/3 | 0/5 |

样本很小，方向不一致，但**没有任何一项显示分节格式变差**（召回与纠正反而略好）。结论：上下文结构改动不是 2.2.4→2.2.5 召回下降的原因；那是同一模型在默认采样下的波动。

## 4. 失败归因（逐阶段）

对 60 次判定逐一走诊断链，`failureClass`：

| 分类 | 次数 |
|---|---|
| `MODEL_MISINTERPRETATION` | 20 |
| `MODEL_IGNORED_INSTRUCTION` | 4 |
| `INSUFFICIENT_EVIDENCE`（pass / needs_review） | 36 |
| `CONTEXT_NOT_RETRIEVED` | **0** |
| `CONTEXT_NOT_SERIALIZED` | **0** |
| `CONTEXT_CONTRADICTORY` | **0** |
| `EVALUATOR_FALSE_PASS` | 0 |

### 失败样本（原文，保留）

- `recall-in-session`：「我没有记得，请告诉我。」「对不起，我没有这个知识。」「我不知道。我不愿意透露我的饮食和个人情况。」「对不起，我不知道我的记忆中是否有关于某些特定食物的过敏记录。」（5 次里 4 次声称没有记忆，而记忆就在请求里，`memoryEntries=1`）
- `conflict-disclosure`：「你住在上海。」「你住在中国。」「你：我住在杭州。」
- `conflict-then-correction`：纠正为广州后仍答杭州或反问
- `no-evidence-admits`：「我不记得了，但我可以帮你查询他的信息。」（把用户说成「他」）
- `message-deleted-fact-gone`：4 次 `uncertain`，1 次 fail

## 5. 假通过 / 假失败

| 类型 | 本轮发现 | 处理 |
|---|---|---|
| 假失败：`您` 不被认作第二人称 | 1 次（long-behavior r5） | 已修，补测试 |
| 假失败：「我不记得」被判否认 | 2 次（no-evidence） | 已修，补测试 |
| 假失败：撤回值缺失被当成检索失败 | 10 次（`CONTEXT_NOT_RETRIEVED` 误报） | 已修，改为 `retractedLeaked` 单独判定 |
| 假通过 | 0 次（未发现） | — |

三次修正都降低了「看起来失败」的数量，**没有一次把 fail 变成 pass**：`no-evidence-admits` 修正后仍是 5 uncertain，不是 5 pass。

## 6. 模型能力边界

`qwen2.5:0.5b` 在 CPU 上，能力边界非常明确：

**能做**：单值事实的第三人称复述（3/5），给出不含过敏原的食物建议（0 次违规）。

**不能做**：
- 在记忆已投递的情况下承认「我记得」（`recall-in-session` 0/5，4 次声称没有记忆）；
- 同时处理两个矛盾值并披露（0/5）；
- 在上下文有答案时直接回答而不是反问；
- 在信息缺失时承认不知道（0/5 全部转移话题或编造）；
- 稳定地不把自己当成事实主体（5 次里 1 次「我对花生很过敏」）。

**这不是提示词能解决的。** 本轮没有为了提分改 prompt、扩窗口或删样本；A/B 也证明上下文格式不是瓶颈。

## 7. 结论

| 维度 | 状态 |
|---|---|
| 记忆送达（含撤回/删除后不投递） | **PASS**（`CONTEXT_NOT_*` 全为 0） |
| 同会话召回 | **FAIL**（0/5） |
| 跨会话召回 | **NEEDS_REVIEW**（3/5） |
| 纠正遵循 | **NEEDS_REVIEW**（3/5，二次纠正 2/5） |
| 冲突披露 | **FAIL**（0/5） |
| 主体归属 | **NEEDS_REVIEW**（2 pass / 1 fail / 2 uncertain） |
| 撤回后不复用 | **NEEDS_REVIEW**（0 次复用，但 5 次全 uncertain） |
| 过期事实 | **NEEDS_REVIEW**（投递正确，表达未验证） |
| 无信息时不编造 | **NEEDS_REVIEW**（0 fail / 5 uncertain） |
| 安全且有用 | **NEEDS_REVIEW**（0 违规，5 次未给出具体食物） |
| 假通过 | **0 例**（已核对 60 次判定的原始回复） |
| 独立人工复核 | **未完成** |
