# Phase 2.3 — 反馈候选（最小可信增量）

- 实现：`src/self-model/feedback-candidate-service.ts`
- 迁移：v16 → **v17**（`persona-feedback-candidates`）
- 原则：**本轮不实现自动应用。**

## 1. 数据模型

| 表 | 作用 |
|---|---|
| `persona_feedback_candidates` | 一条候选：类型、来源、证据摘要、置信度、敏感度、状态 |
| `persona_feedback_evidence` | 每次观察的 `(candidate, conversation, message, hash)`，用于区分独立证据 |

- 候选只存 ≤500 字摘要 + 会话/消息引用，不复制完整对话。
- `evidence_hash` 唯一：同一句话不会分叉成两条候选。
- 证据表主键 `(candidate_id, conversation_id, evidence_hash)`：同一会话重复说同一句只算一次。

## 2. 状态与门槛

`pending → supported → applied`，旁路 `rejected` / `withdrawn`。

- 同一句话在 **2 个独立会话**出现 → `supported`。
- 同一会话重复 10 次仍是 `pending`、`distinctConversations = 1`。
- 阈值 2 是**最低可解释门槛**，不是真实性证明；更高置信度仍需人工判断。

## 3. 不会自动生效

- 没有任何回合钩子、定时任务或后台进程调用 `apply`。
- `apply` 必须由调用方提供回调，由回调真正保存人格并返回新版本；服务只记录。
- `sensitive` 候选在 `includeSensitive: false` 时抛 `FORBIDDEN`。
- `rejected` / `withdrawn` / `applied` 不能再 `apply`（`CONFLICT`）。

## 4. 数据治理

- 删除会话时，`CompanionService.deleteConversation` 先调用 `withdrawForConversation`，再删除；候选不会指向已删除的会话。
- 撤回/拒绝都写入 `decision_reason`，可审计。
- 回滚：人格版本由既有 `personality_revisions` 保存，`restore(version)` 可回到旧版本。

## 5. 测试（13 例）

| # | 断言 |
|---|---|
| 1 | 记录候选后人格版本不变 |
| 2 | 单次表扬不造成漂移 |
| 3 | 未批准候选永远不会 applied |
| 4 | 同一句重复导入不重复计数 |
| 5 | 同一会话重复仍 pending |
| 6 | 第二个独立会话 → supported |
| 7 | 明确行为请求可形成候选 |
| 8 | 敏感候选未授权 apply → FORBIDDEN |
| 9 | `withdrawForConversation` 撤回 |
| 10 | 真实删除路径撤回候选 |
| 11 | rejected 不能再 apply |
| 12 | apply 记录版本，rollback 可回退 |
| 13 | withdraw 记录原因 |

## 6. 局限

1. 本轮没有「自动从对话中识别反馈」的生产入口；候选由调用方显式 `record`。避免把模型猜测直接变成人格输入。
2. 候选与人格之间没有外键；`applied_personality_version` 是审计字段，不是约束。
3. 没有候选的 UI；只有服务与测试。
4. 来源消息被**撤回**（而非会话删除）时的联动未实现；目前只有会话删除路径。
