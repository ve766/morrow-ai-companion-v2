# Stage 4-A 记忆操作规划器

## 1. 输出类型（判别联合）

```
none      { reason }
create    { messageId, facts[{predicate,value,valueNormalized,polarity,displayText}], confidence, decisionReason }
correct   { messageId, target{memoryId,factId,predicate,previousValue,revision}, newValue, displayText, confidence, decisionReason }
clarify   { messageId, reason, candidates[{value,memoryId}] }
rejected  { messageId, reason }
failed    { messageId, stage, errorCode }
```

执行结果 `MemoryOperationOutcome` 额外带 `status`：`committed_and_verified | clarify | rejected | failed | not_applied`，以及 `predicate / previousValue / currentValue / memoryId / revision / factId / sourceMessageId / replayed`。

## 2. 判定规则（确定性，无模型输出参与）

```
if !ledgerAvailable                → failed(LEDGER_UNAVAILABLE)
if !SAVE_MARKER && !UPDATE_MARKER  → none(no_explicit_marker)
candidates = extractFactSlots(text) 中 polarity=positive 的事实（保守：疑问/假设/转述/模态不出）
if candidates 非空:
    c = candidates[0]
    active = ledger.active(c.predicate)
    同一值已存在               → none(already_current)（或 create 重放，若来源=本轮）
    active 为空 或 文本含“我还有/另一只” → create
    active 多于 1              → clarify(multiple_active_values)
    否则                        → correct(target=active[0])
if 仅 UPDATE_MARKER:
    代词 它(现在)?…叫 V
       pets==1 → correct（物种继承自目标记忆文本）
       pets>1  → clarify(pronoun_with_multiple_candidates)
       pets==0 → clarify(pronoun_without_referent)
    否则 → none(update_marker_without_target_or_value)
```

置信度是规则常量（create 90 / 直接纠正 85 / 代词纠正 75），仅用于解释与排序，不参与数据库判定。

## 3. 显示文本（可再抽取性）

每类谓词有固定模板，保证「写入的记忆文本」再抽取得到同一事实：

| predicate | 模板 |
|---|---|
| residence | 我住在{value}。 |
| employer | 我在{value}工作。 |
| name | 我的名字叫{value}。 |
| age | 我{value}岁。 |
| project_code | 我的项目代号是{value}。 |
| health | 我对{value}过敏。 |
| preference | 我喜欢{value}。 |
| study | 我在学习{value}。 |
| goal | 我的目标是{value}。 |
| object_location | 我的证件放在{value}。 |
| pet_name | 我的{猫\|狗}叫{value}。（物种取自本轮或目标记忆；均无则「我的宠物叫{value}。」） |

## 4. 纠正事务与验证

```
BEGIN IMMEDIATE
  correct(): 旧 revision superseded（valid_to=now）+ 新 revision active（provenance=本轮 message）
COMMIT
复读验证：current(predicate) 恰含新值且来源=本轮；history 中旧值 status=superseded
```

验证失败 → `status=failed`（errorCode=VERIFICATION_FAILED），并写 `memory.operation.failed(stage=verification)`；回复不得声称保存。

## 5. 单值谓词与冲突

- 单值谓词（residence/name/age/employer/job_role/project_code/pet_name）在同一谓词出现多个 active 值时，planner 返回 clarify，不挑选；
- 「我还有一只猫叫X」被识别为**新增**（another 标记），不是纠正；
- 跨记忆的冲突不静默覆盖（读取层标 conflict）。

## 6. 失败行为一览

| 情形 | 结果 |
|---|---|
| ledger 不可用 | failed(LEDGER_UNAVAILABLE)，回复不得声称保存 |
| 抽取为空 + 有保存标记 | none(save_marker_without_extractable_fact)，回复可询问补全 |
| 代词无指代 / 多候选 | clarify，不写入 |
| 事务或验证失败 | failed，事件留痕，回复不得声称保存 |
| 同一轮重放 | committed_and_verified + replayed=true，不重复写入 |
