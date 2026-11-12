# Stage 3 能力成熟度矩阵（C1 专项切片）

> 权威全表在 `docs/reports/stage-3-acceptance-matrix.md` §1。本文件只记录 **C1（语境/意图理解）** 这一行在 2026-10-31 的证据与定级，避免与全表分叉：定级以本文件为准并已回填全表。

等级定义（沿用既有口径）：

| 级别 | 含义 |
|---|---|
| M0 | 不存在 |
| M1 | 只有声明或类型 |
| M2 | 有实现但无生产读者 |
| M3 | 有生产读者，但证据链不完整 |
| M4 | 主链闭环，有正反例断言 |
| M5 | 有真实环境（真实模型/真实时间）证据 |
| M6 | 长期稳定 + 独立评估 |

---

## C1 语境/意图理解

| 项 | 本轮前 | 本轮后 | 依据 |
|---|---|---|---|
| 定级 | M4（默认关） | **M4+** | 见下方逐条断言 |

### 支持定级的事实（每条对应一个可执行断言）

| # | 事实 | 断言位置 |
|---|---|---|
| 1 | speech act 与 intent 是两个对象，不再共用一个标签 | `src/cognition/intent-reading.test.ts`「B. speech act and intent are separate」 |
| 2 | 引用/假设/玩笑不授权执行，且结构上无法被下游改写 | `isSpeechActReading` 拒绝 `attributedTo ≠ user && binds`；`isIntentReading` 拒绝 `mayExecute` 与 quotation 并存 |
| 3 | 同一句在不同上下文产生不同决策 | `C1-A1`、`C1-A2`、`C1-A3`（22 条场景中 3 条族） |
| 4 | 同源证据不再重复计权 | `intent-decision.ts` 按 `(label, source)` 折叠；`scoreIntentCandidates` 用 distinct sources |
| 5 | 纠正/撤回使旧读法失效 | `intent_readings.superseded_by_message_id`；`C1-D3`、`C1-D5` |
| 6 | 读法进入最终 payload | `tests/c1-mainchain.test.ts`「serializes the speech act and the response mode」 |
| 7 | 删除来源消息后读法消失 | FK cascade；`tests/c1-mainchain.test.ts`「removes the reading with the message」 |
| 8 | 重启后语义一致 | `tests/c1-mainchain.test.ts`「survives a restart」 |
| 9 | 变异测试真的会失败 | `C1-F1`…`C1-F4`（移除上下文 / 加否定 / 改主体 / 注入篡改读法） |

### 不支持更高定级的缺口

| 缺口 | 为什么挡住 M5 |
|---|---|
| 真实模型语义表现 | 本轮无可用凭据，`provider` 字段为 `scripted (not a model)`；真实对话的意图判断没有证据 |
| 独立人工评价 | `manualReview.status = PENDING`，不用同一套规则给自己打分 |
| 校准 | 没有标注集与校准集，`scoreKind` 恒为 `heuristic_score` |
| 语用覆盖 | 反讽只有显式标记；多意图上限 2；槽位仅四类 |
| 真实时间跨度 | 所有场景都在单进程内连续完成 |

**结论：C1 确定性机制已验证（M4+），真实模型语境理解能力 NOT_RUN。** 不得以本文件宣称 C1 完成。
