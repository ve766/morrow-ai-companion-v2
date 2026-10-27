# Phase 2.2.2 — 反馈候选的身份与证据

- 迁移：v17 → v18（`feedback-identity-and-evidence-lifecycle`）
- 实现：`src/self-model/feedback-candidate-service.ts`

## 1. 身份模型

| 概念 | 定义 | 存储 |
|---|---|---|
| 候选身份 | 一条需要评估的行为偏好 | `(evidence_hash, kind)` 唯一 |
| 证据身份 | 一次具体来源观察 | `(candidate_id, conversation_id, evidence_hash)` 主键 |
| 证据重复 | 同一来源重复导入 | 主键冲突 → `INSERT OR IGNORE`，不计数 |
| 候选相似 | 不同表述支持同一候选 | **不自动合并**；字符串相似不足以合并语义 |

同一句话换个 `kind`（tone → boundary）现在得到两条候选，而不是复用旧行。

## 2. 敏感度与来源

- 每条证据保存自己的 `source`、`sensitivity`、`status`、`created_at`。
- 候选级敏感度 = 证据的最大值；**只升不降**。
- 候选级来源：只要有一条 `user_explicit` 证据，就升为 `user_explicit`；证据行本身的来源不被覆盖。
- 不因为新证据是 `user_explicit` 就删除或改写旧的 `model_inferred` 证据。

## 3. 并发与幂等

- 候选插入依赖 `(hash, kind)` 唯一索引；并发插入由数据库裁决，失败方回读已有行。
- 证据插入依赖主键；同一会话同一句重复导入是 no-op。
- 没有「先查询再插入」的窗口作为唯一保护。

## 4. 测试

| 场景 | 断言 |
|---|---|
| 同一消息重复导入 | 仍一条证据，`distinctConversations = 1` |
| 同一会话重复表达 | 不升级为 supported |
| 不同会话相同反馈 | `supported`，distinct = 2 |
| 同一句话不同 kind | 两条独立候选 |
| 同一句话 user_explicit + model_inferred | 候选来源升级，证据来源各自保留 |
| 更高敏感度的新证据 | 候选升为 `sensitive`，后续低敏感证据不能降级 |
| 相互矛盾的新证据 | **未做语义冲突检测**；不同 kind 分开，同 kind 归并，见 §5 |
| 并发导入同一证据 | 数据库唯一索引兜底 |

## 5. 局限（如实）

1. **没有语义冲突检测**。「请简短」和「请详细」如果字面不同，会形成两条候选；如果同字面但意图相反，无法识别。本轮不声称已解决语义矛盾。
2. 候选相似合并需要人工或后续规则，当前不做自动合并。
3. `confidence` 只记录，不参与候选级聚合。
