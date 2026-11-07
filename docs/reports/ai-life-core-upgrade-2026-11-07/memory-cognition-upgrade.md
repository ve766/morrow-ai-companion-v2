# 记忆、反思与探索升级审计

## 1. 记忆检索

现状（保留）：

- `src/memory/memory-context-assembler.ts` 已有 4 通道 RRF：
  - fact-index（属性命中）
  - lexical（关键词/短语）
  - fact-slot（同谓词、不同措辞）
  - value（用户当前陈述直接点名旧值）
- RRF：`RRF(m) = Σ 1/(60 + rank_channel(m))`，再按 context utility/importance 重排。
- 冲突事实并列呈现，不自动覆盖；retracted/superseded/archived 不参与。

本轮结论：

- **混合检索已存在**；“semantic-only”/神经 embedding 通道和 lexical vs semantic vs hybrid 三臂消融未实现，标记 `NOT_IMPLEMENTED`，未伪造 metrics。
- 记忆到自我模型的引用：新 self-model state 的 `evidenceRefs` 可引用 message/memory；本轮运行时提取只写 message ref；`retrieved_memory` 来源路径已定义但未接自动管线，标记 `PARTIAL`。

## 2. 反思

现状（保留）：

- `ReflectionService` 产出 `memory_gap / open_question / bias_hint / interest_candidate / consistency_note / intent_correction / next_turn_suggestion / morrow_interest_candidate`。
- `ReflectionFindingRouter.promptBlock` 只注入最多 2 条未过期 hint，且标记注入记录。
- 反思有 budget/去重/失败降级；不自动执行动作。

本轮结论：

- findings → self-model revision 的自动写回未实现（`NOT_IMPLEMENTED`）；现有 hint 注入路径保留并通过既有测试。
- 未修改反思触发预算，避免无证据扩张 token。

## 3. 探索候选

现状（保留）：

- `ExplorationService` 基于 interest/自身缺口选择候选，状态 `candidate/selected_for_prompt/permitted/settled`。
- 目标、授权、执行分离；不新增 Agent/工具。

本轮结论：

- 统一 `Priority = Interest × InformationGain × Relevance × Feasibility × UncertaintyNeed − RiskPenalty` 的新候选评分未实现；现有 interest-based 探索保留，标记 `PARTIAL`。
- 未扩大本地目标权限；未启用提醒。

## 4. 明确未完成

- neural semantic embedding 与 ablation；
- reflection → self-model 自动修订；
- 统一探索候选评分；
- 长对话退化/真实 Provider 多轮认知指标的完整评测矩阵。

这些不能以文档代替实现；在最终报告标记 `NOT_IMPLEMENTED` / `PARTIAL`。
