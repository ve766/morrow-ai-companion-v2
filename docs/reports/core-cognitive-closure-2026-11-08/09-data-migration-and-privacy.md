# 09 · 数据迁移与隐私

## Migration

- v54 `inner-cognition-workspace`：`morrow_thoughts`、`morrow_self_states` + indexes。
- 前向追加；schema 53 已存在（PR #66 兼容）。
- 无数据重置/删除；未导入 V1；未修改 main/release。
- 真实 acceptance DB 从 53 → 54 后正常启动；thought/state 跨重启保留。

## 数据内容

- thought 保存 question/hypothesis（可能含用户测试文本，截断 1000 字符）；本地 SQLite。
- state 保存 proposition/evidenceRefs/rationale/algorithmVersion；不含 API key。
- 未将 thought/state 写日志正文；事件只记 id/status/score。
- 上下文只注入 actor=morrow 的 state；用户偏好不自动变 Morrow 偏好。

## 授权

- 本任务未修改 consent grant 代码；PR #64 未合并。
- 现有每消息 consent 继续；sensitive 24h 复用风险仍属于 PR #64，未启用。
- 内部 scheduler 不调用 Provider，不需云端授权。

## 风险/未完成

- 无 state retract/rollback API；只有 revision/supersede。
- 无 counter-evidence 生产入口。
- thought 文本包含用户问题片段，删除会话时没有触发器级联清理（表无 conversation_id 外键）；backlog：按 source ref 清理/脱敏。
- 未执行备份/恢复对 v54 表的完整演练。
