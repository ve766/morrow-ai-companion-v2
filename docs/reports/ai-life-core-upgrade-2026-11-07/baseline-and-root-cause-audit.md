# Issue #63 基线审计与根因

- 仓库：`E:/Hasee/Documents/morrow v2/zcode/stage3-audit/repo`
- 开工 HEAD：`e1d85137b64f4e6d65750a11eb27757135c1f32b`（PR #62 分支）
- 本任务分支：`feat/ai-life-core-upgrade-20261107`
- 本轮暂停 UI：未修改 CSS、布局、主题、导航或响应式。
- 最终 commit：以 PR/Issue #63 评论为准

## 1. 真实调用链审计

`输入 → preprocess → memory retrieval → cognitive analysis → self-model/personality context → provider consent → provider → persistence → post-turn outbox → reflection/exploration → next turn`

| 层 | 实际实现 | 审计结论 |
|---|---|---|
| 意图/认知 | `cognition/cognitive-turn-analyzer`, `intent-decision`, `turn-context` | 已接入；当前 turn 的 intent/策略进入 payload |
| 记忆检索 | `memory/memory-context-assembler` 4 通道 RRF：fact-index、lexical、fact-slot、value | 已有混合检索；没有神经 embedding；“semantic-only”通道不存在 |
| 自我模型 | `self-model/self-model-service` + `self_model_entries` | 只有 kind/statement/confidence/status；没有 type/stance/scope/证据列表/revision rationale |
| 偏好/价值 | `personalization` + `personality_growth` + `interaction-profile` | 有界数值信号，但不是带证据/来源的自我模型状态 |
| 反思 | `reflection-service` + `findingRouter.promptBlock` | 有运行/去重/提示注入；修正主要写 findings/pending，不是自我模型 revision |
| 探索 | `exploration-policy` + `explorationLine` + `exploration` 表 | 已有候选/选择/结算；候选来源是 interest，未扩展为统一认知缺口候选 |
| 上下文 | `buildSelfModelContextBlock` | 已注入 interests/facts/personalization/growth/hints/goals；新状态尚未接入（本轮补） |
| 授权 | `requestProviderConsent` + payload hash | 每次消息都弹窗：授权绑定 exact payload，不能复用 |

## 2. 根因

1. **自我模型是投影，不是认知状态**：`self_model_entries` 缺少证据、来源、适用范围、修订号和替代链；`activeStatementsForContext` 只取 fact/correction，偏好/价值/边界/能力没有结构化状态。
2. **授权粒度过细**：scope 只存在于 payload hash 里；没有 provider/endpoint/model/sensitivity 级别的持久 grant，导致每条普通消息重复询问。
3. **记忆语义能力有限**：已有 fact/slot 通道能处理部分改写，但没有独立语义通道，也没有 lexical/semantic/hybrid 消融结果。
4. **反思与自我模型之间缺少写回**：反思 findings 能进入 prompt hints，但不会生成带证据的 self-model revision。

## 3. 本轮选择

在 24h 内交付可运行纵向切片：

- 新增 append-only 结构化自我模型状态（schema v53），真实写入并在下一轮上下文使用；
- 新增持久 consent scope grant，同 provider/endpoint/model/sensitivity/action 复用，scope 变化/撤销/过期重新确认；
- 审计并复用现有 memory RRF、reflection、exploration；对尚未实现的 neural semantic/ablation 明确标记 `NOT_IMPLEMENTED`，不以文档冒充完成。

## 4. 未完成/明确不做

- Neural embedding / semantic-only 检索与三臂消融：`NOT_IMPLEMENTED`（现有 4 通道 RRF 保留）。
- 反思 findings 到 self-model revision 的自动写回：`NOT_IMPLEMENTED`（本轮仅保留既有 hint 注入）。
- 探索候选扩展到统一认知缺口：`PARTIAL`（现有 interest-based 探索链路保留）。
- UI：本轮明确不做。
