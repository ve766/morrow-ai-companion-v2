# Phase 2.2.8 — A2 记忆形成与更新闭环

日期：2026-10-28  
分支：`fix/memory-reliability-v0.1`  
数据库：v22

## 1. 实现范围

本轮没有把“自动提取”实现成“全部聊天自动成为记忆”。完成一轮对话后只生成**待审核候选**，用户接受后才进入长期记忆。

实现采用本地确定性规则，不调用模型、不发起网络请求。真实的模型辅助 proposal 仍保留为单独的用户显式入口。

## 2. 候选数据模型（v22）

`memory_suggestions` 重建并新增：

- `candidate_kind`: `fact / preference / goal / project / correction`；
- `subject`: 固定 `user`，拒绝把 Morrow 自述写成用户事实；
- `evidence_type`: 用户明确陈述、用户明确更正、模型 proposal；
- `confidence`；
- `claim_key`：用于跨消息/跨会话去重；
- `conflict_with_json`：潜在冲突的现有记忆 ID；
- `correction_target_id`：自然语言更正的目标记忆；
- `status`: 新增 `withdrawn`；
- 原有 `source_message_id`、`sensitivity`、修订接受字段继续保留。

迁移从 v21 保留全部旧候选；旧行按 `fact / model_proposal / confidence 70 / subject user` 回填。

## 3. 候选形成

文件：`src/memory/memory-formation-domain.ts`

| 输入类别 | 行为 |
|---|---|
| 稳定事实（居住、身份） | `fact`，personal |
| 明确偏好 | `preference`，personal |
| 长期目标/学习 | `goal`，personal |
| 持续项目 | `project`，personal |
| 健康/财务/政治/宗教/性等 | `sensitive` |
| 寒暄、临时状态、问题、第三人称、对 Morrow 说话 | 不形成候选 |
| “现在住在大阪，不再住杭州” | `correction`，保留被替代值提示 |

自然语言更正不会直接写记忆；它只生成候选，并记录目标记忆和冲突 ID。

## 4. 审查与写入

`MemorySuggestionService.review()`：

- `accept`：用户可修改正文和敏感度；
  - 有有效更正目标时调用现有 `MemoryService.correct()`，保留修订链；
  - 目标已消失时创建新记忆，不改写无关记录；
  - 冲突仍保留为活动冲突，不静默删旧值；
- `reject`：候选不进入记忆；
- `withdraw`：候选状态为 `withdrawn`，不进入记忆或后续上下文。

审查、记忆写入和候选状态更新处于同一数据库事务。

## 5. 非阻塞与失败隔离

- 候选形成在 chat 完成后通过 microtask 调度；
- 不使用网络或模型；
- 任何候选形成异常都只记录 warning，不影响已验证的回复；
- 来源消息被删除时，候选随外键级联删除；已接受记忆仍走现有消息删除撤回路径。

## 6. 敏感度修复

`parseSuggestions()` 不再把所有模型候选硬编码为 `sensitive`，改用相同的本地分类器：

- 健康、财务、政治、宗教、性、身份凭证 → `sensitive`；
- 居住、项目、工作、偏好、目标 → `personal`；
- 低风险普通自述 → `normal`。

现有测试中“Prefers printed books…”的期望从 `sensitive` 更新为 `personal`，因为旧值正是被修复的统一硬编码，不是为通过而降低保护。接受时仍可手动提高为 `sensitive`；健康与财务测试仍要求 `sensitive`，访问控制测试验证 personal ceiling 看不到敏感记忆。

## 7. 自动测试

新增：

- `src/memory/memory-formation-domain.test.ts`（6）
- `src/app/memory-formation.integration.test.ts`（9）

覆盖：

- 普通陈述产生候选但不写记忆；
- 寒暄、第三人称、临时状态不产生；
- 重复陈述跨会话去重；
- 自然语言搬家生成更正候选，旧记录在确认前不变；
- 冲突候选保留 pending 和冲突 ID；
- 拒绝、撤回不进入记忆/上下文；
- 健康记忆保持 sensitive 且受访问上限约束；
- 形成失败不影响回复；
- 接受后撤回不再进入上下文；
- 来源消息、目标记忆和修订历史可追溯；
- 敏感度分类与跨属性更正识别单元测试。

结果：

- 新增 15 条测试全部通过；
- A2 + 候选/迁移相关回归 **45 条通过**；
- v11/v17/v18/v20 → v22 数据保留测试通过；
- `tsc --noEmit` 通过。

## 8. 未完成与限制

- 规则提取不是自然语言语义理解；当前只识别有限的明确句式，不能宣称高召回。
- 没有真实模型提取质量数据；stub/规则不能替代模型评估。
- 没有真实用户人工复核。
- 冲突处理和候选界面已支持，但候选只在本会话记忆建议区展示，没有跨会话收件箱。
- 删除一条已接受更正候选的来源消息会按现有安全策略撤回目标记忆；这是保守行为，尚需产品确认是否符合历史修订预期。
- 尚未重跑真实模型；A4 执行。
