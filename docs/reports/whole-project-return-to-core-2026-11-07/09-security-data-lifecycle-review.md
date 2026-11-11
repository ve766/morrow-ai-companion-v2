# 09 · 安全与数据生命周期复核

## 1. Provider 授权

- 本基线（`e1d8513`）仍按每条消息弹窗；没有 24h consent grant 代码。
- PR #64 的 `provider_consent_grants` 表已随 v53 进入 acceptance DB，但本基线不读取它；这是 schema-only 兼容，不代表授权复用已启用。
- PR #64 的敏感 scope 风险：`maximumSensitivity='sensitive'` 也会生成 24h grant，而 UI/隐私文案承诺“敏感仅本次”；若合并 PR #64，必须先把 sensitive 从自动复用中排除，并要求每次确认。**本任务未合并 PR #64。**
- scope fingerprint 不含 API key/正文/payload；删除 profile/清除凭据应撤销 provider grants（PR #64 实现，本基线未启用）。

## 2. 身份与隐私

- `identityContract` 只使用 provider id/displayName/model，不含 endpoint 或 key。
- 历史/记忆仍标记 untrusted evidence；身份契约置顶，但不能保证 Provider 100% 服从。
- 未新增日志中的消息正文/密钥；`identity-behavior-evaluation.json` 保存的是用户测试问题与模型回复，未含凭据。

## 3. 迁移与用户数据

- acceptance DB 已迁移到 v53；权威基线代码只有 v52，会导致 fail-closed 启动失败。
- 本轮仅移植 v53 schema（`self_model_states`、`provider_consent_grants`）到新分支，保留现有数据；未重置/删除用户数据。
- v53 表在新基线中未被业务代码使用；无敏感数据写入。
- 未导入 V1；未运行卸载安装器；未修改 main/release。

## 4. 删除/撤回/恢复

- 既有 memory/turn trace/备份删除边界未改动。
- v53 表无触发器删除语义时，PR #64 代码未启用，故无新增生产数据生命周期。
- 若后续合并 PR #64，需要补充 self-model state 的撤回/删除/备份恢复审计。

## 5. 结论

本任务没有扩大授权、没有绕过 consent、没有把 key/正文写入 fingerprint 或日志。敏感 consent 复用仍是 PR #64 的未解决风险，不能以 schema 存在当作安全 PASS。
