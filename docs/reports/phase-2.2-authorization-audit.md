# Phase 2.2 — 兴趣标签敏感度与授权（任务 4）

- 相关提交：`7e2b35c`
- 迁移：v15 → **v16**（`interest-sensitivity`）
- 断言对象：最终序列化请求体（`cognitive-loop.integration.test.ts`）

## 1. 问题

Phase 2.1 修掉了「逐字用户语句绕过 `includeSensitive`」的 P0，但留下了兴趣标签通道：

| 通道 | 修复前是否受 `includeSensitive` 约束 |
|---|---|
| 记忆 JSON | 是（`sensitivity` + `maximumSensitivity`） |
| 逐字用户语句 | 是（Phase 2.1 修复） |
| 兴趣标签 | **否**——`interests` 表没有敏感度列 |

兴趣标签是单个主题词 + 强度 + 置信度 + 证据次数，保真度低于整句，但它仍然能暴露「用户在谈医疗 / 债务 / 关系」这类事实。一个关掉敏感记忆开关的用户，仍然会在每一次请求里看到这些标签。

## 2. 方案

### 2.1 数据库

迁移 v16：

```sql
ALTER TABLE interests ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal'
  CHECK (sensitivity IN ('normal', 'personal', 'sensitive'));
UPDATE interests SET sensitivity = 'sensitive' WHERE <标记匹配 label 或 terms_json>;
```

- **默认值**：`normal`。旧行不会被一刀切标成敏感，也不会被一刀切标成普通——它们按自己已有的证据（label + terms_json）回填。
- **回填依据**：v15 行唯一还带着的语义证据就是标签和词项集合，不用它就没有别的依据。
- **为什么迁移里内联标记表**：迁移必须保持发布当天的行为，即使运行时分类器以后被改进，也不能改变历史迁移的结果。

### 2.2 运行时分类

`classifyInterestSensitivity(label, terms)`：

- 命中任一敏感标记 → `sensitive`；否则 `normal`。
- 没有 `personal` 中间档：目前没有任何诚实依据能把「个人」与「普通」分开，硬造一档只会制造虚假精度。

### 2.3 只能升级，不能静默降级

新兴趣在 `observe()` 时分类；已存在的兴趣若曾命中敏感标记，后续中性轮次**不会**把它降回 `normal`。降级需要用户显式操作，不能由一次措辞变化推断出来。

### 2.4 授权在装配处生效

- `InterestService.activeForContext(limit, maximumSensitivity)` 按同一套 `normal < personal < sensitive` 上限过滤。
- `buildSelfModelContextBlock` 传入本轮真实的 `max`（未授权时是 `personal`）。
- 默认参数是 `sensitive`，保证既有调用方行为不变；聊天路径永远显式传值。

## 3. 证据

| 检查 | 结果 |
|---|---|
| v15 库升级到 v16，两行都不丢 | `migrations.test.ts`：`抑郁` → `sensitive`，`天文` → `normal` |
| 重复执行迁移不报错 | 同一用例第二次 `applyMigrations` 仍返回 16 |
| 敏感话题被分类 | `self-model.test.ts`：`抑郁症让我很难受` → `sensitive` |
| 普通话题不被误伤 | `天文学最近很有意思` → `normal`，且 `activeForContext(5,'personal')` 仍返回它 |
| 不静默降级 | 中性后续轮次后仍为 `sensitive` |
| 重启后一致 | 关闭并重开数据库后仍 `sensitive`，`personal` 上限下仍为空 |
| **最终请求体** | `cognitive-loop.integration.test.ts`：未授权请求含「天文」但**不含**「抑郁」；授权后才出现 |

请求体用例同时断言「普通兴趣仍在」，证明关闭的是定向通道，不是把整个长期层删掉。

### 2.5 询问不等于属性

`onTurnCompleted` 过去对每条用户消息都调用 `interests.observe`。因此「抑郁症一般怎么治疗？」会生成一个主题标签——即使那是搜索，不是用户的属性。

现在的规则：

- 疑问句（结尾 `？`/`?`，或以 吗/呢/什么/怎么/为什么/哪/谁/多少/如何/是否/能不能/可不可以/请问 开头）**不能新建**兴趣，`observe` 返回 `null`。
- 疑问句**可以**给用户已陈述过的主题增加证据，避免把「天文学里你最喜欢什么？」当成与既有主题无关。
- 判定在服务层完成，`source: 'question' | 'statement'` 显式传入，而不是靠提示词。

代价（有意）：只用疑问句表达的偏好（「我对天文学很感兴趣，有推荐吗？」）不会被记为兴趣。漏记可以恢复，凭空生成敏感属性不可恢复。

测试：`self-model.test.ts`（疑问句返回 `null`；疑问句强化已有主题）、`cognitive-loop.integration.test.ts`（「抑郁症一般怎么治疗？」不产生兴趣行，随后陈述句才产生敏感兴趣）。

## 4. 未覆盖 / 残余风险

1. **分类器是标记表**，不是理解。换一种说法（「情绪很低落」）不会命中，会落到 `normal`。这是保守方向上的失败，但仍是失败。
2. **`self_model_entries` 仍没有敏感度列**。逐字语句通道整体受 `includeSensitive` 门禁（Phase 2.1），但它与主记忆没有外键：撤回一条记忆不会自动撤回对应的自我条目。本阶段没有改这个语义，也没有偷偷加迁移。
3. **备份恢复**：敏感度是普通列，随数据库备份/恢复一起走；现有备份测试覆盖库完整性、撤回与删除日志重放，但**没有**针对 interests 的专项恢复断言。
4. 兴趣标签本身仍以 label 形式进入 prompt；分类用的是 label + terms。若 label 恰好中性而 terms 敏感，标签文本泄漏有限，但分类仍会拦住它。

## 5. 回滚

`git revert 7e2b35c`。注意：回滚代码不会自动回滚已升级到 v16 的数据库；v16 多出的列对旧代码是可见但未使用的，`applyMigrations` 会因版本高于已知而拒绝打开——需要恢复备份。这是有意的 fail-closed 行为，不是缺陷。
