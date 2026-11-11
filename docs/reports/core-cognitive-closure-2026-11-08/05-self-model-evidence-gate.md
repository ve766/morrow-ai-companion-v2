# 05 · Self-model evidence gate

## 数据

`morrow_self_states`（v54）：

`actor, domain, proposition, stance, evidence_json, counter_evidence_json, independent_contexts, score, status, revision, supersedes, rationale, algorithm_version`

- actor=`morrow` 才进入 Morrow 上下文；用户陈述不会被写成 Morrow 偏好。
- 状态只能由 `InnerCognitionService.reviewThought` 产生。
- 旧行 `superseded`，新行 `revision+1`；不覆盖历史。

## 评分（本实现称 score，不称 probability）

```text
q = min(1, 0.45 + 0.15*independentContexts + 0.10*evidenceRefs)
score = 100 * (0.45*q + 0.20*min(1, independent/2) + 0.20*uncertainty + 0.15*recency - 0.20*counterEvidence)
```

- independent = distinct conversationId 数；同一会话重复/同一 turn 不会增加。
- `uncertainty` 来自触发的不确定回答；`recency` 固定 0.8（本轮无时间衰减实现）。
- counterEvidence > 0 → `conflict_pending`；independent ≥2 且 score≥55 → `active`；否则 `candidate`。
- 阈值 55 是启发式，未校准；因此叫 score。

## 状态机

`candidate → active`（第二独立会话） / `candidate → conflict_pending`（反证） / `active → superseded`（新 revision） / 无显式 retract API（backlog）。

## 真实结果

- thought `8ec2fea2-4884-4e2e-8c39-597fab09ba24` → candidate
- second independent conversation → state `293a5774...` superseded by `b07b848d...` active score 91 revision 2
- next turn payload contains `Morrow-owned unresolved thoughts`（真实 consent dialog 文本检查）

## 缺口

- 反证写入没有生产入口（仅 schema/测试预留）。
- 没有独立来源质量 q_i/LR 校准；不能称为概率。
- 没有 retract/rollback API；只能 append revision。
- 反思 finding 未自动生成 thought。
