# 安全、隐私、迁移与回滚

## Consent

- 首次 chat（非 sensitive）：原生对话框 `取消 / 仅本次 / 记住 30 天`。
- 记住 scope：`action + providerId + endpoint + model + maximumSensitivity`；不含正文/payload/key。
- sensitive：`取消 / 允许本次发送`；`ConsentGrantService.grant()` 对 sensitive 返回 null，永远不会长期复用。
- 每次发送仍校验 payload hash；批准后复用 prepared snapshot；config/conversation 变化 → CONFLICT。
- 设置页可列出有效 grant 并撤销；撤销写 `revoked_at`，下一次发送重新确认。
- 未自动化：原生 OS 对话框按钮点击（CDP 无法控制）→ `PENDING_HUMAN`。

## 密钥

- API key 只在 Windows SafeStorage / secure store；IPC 返回体不含密钥；renderer 输入框保存后清空。
- `product-path` 验证两个 profile 的 ciphertext digest 不同、删除一个不影响另一个、endpoint 变更清旧密钥。
- 本任务没有把 key 写入代码、日志、报告、Issue、PR 或命令行参数。

## Trace / 日志

- 新增日志只记录 action/sensitivity/remember、scope 前缀、revision/status 等结构化字段；不记录消息正文、prompt、payload、key。
- `affect.progress_commit_failed` 只记录 `reason: atomic_reward_affect_commit`，不含正文。

## 删除/清除

- `deleteConversation`：删除 conversation → emotion events FK cascade，projection 无条件 rebuild；trait observations 删除并 recomputeAll；reward 不按 conversation 删除（它是 Morrow progress 账本），但 `clearAffect` 会清。
- `clearCognitiveHistory`：feelings + affect emotion events/states/revisions/regulations + traits + rewards。
- `current()` 对 observation 数量与 revision 不一致立即 recompute，覆盖单条消息删除后的 trait 陈旧。
- 未覆盖：单条消息删除后 emotion projection 的 UI 路径；依赖 DB dirty/FK rebuild。

## Migration / rollback

- 当前 v55；本任务没有新增 migration，复用 emotion/trait/reward 表。
- v54→v55 前向迁移由既有备份/回滚框架处理；不删除/重置用户数据。
- 功能回退：不注入 `selfModelLoop.affect` 走原路径；consent grant 可撤销；clear 删除派生账本。
- 旧代码不能打开 future schema（fail-closed）；回退需 v54 备份，不直接降级当前 DB。

## 剩余风险

- 原生 consent 对话框无法自动化，E2E 只证明“自动同意变量”下的 chat；产品默认按钮行为需要人工点一次。
- 真实 cloud Provider 的 quota/auth/timeout 分支没有在本环境实跑；现有 provider error 映射保留。
- 本任务没有做 1000/5000 记忆隐私/删除压力测试。

## 第二轮补充

- 新 v56 migration：`morrow_mood_state`（单行、JSON、revision、paused、last_advanced_at）。这是前向迁移，不改 v54/v55 数据。
- `MORROW_ACCEPTANCE_AUTO_CONSENT` 现在只在 `!app.isPackaged` 时生效；打包后的生产应用即使继承该环境变量也不会绕过 consent。敏感仍每次确认。
- mood pause/resume 是本地状态，不联网；clear 清理 mood 行。
- 仍未做原生 consent 对话框自动化点击（PENDING_HUMAN）；单消息删除的 emotion UI 路径仍未真实点击。
