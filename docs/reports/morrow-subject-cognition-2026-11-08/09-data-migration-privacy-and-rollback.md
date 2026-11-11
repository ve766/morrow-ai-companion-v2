# 09 · 迁移、隐私与回滚

- v54 前向迁移：`morrow_thoughts`、`morrow_self_states`；未删除/重置用户数据。
- thought 保存 question/hypothesis（截断 1000）；state 保存 proposition/evidence/rationale；不含 API key。
- 日志不含正文；事件只记 id/status/score/priority。
- 外部操作权限未增加；scheduler 只本地 DB。
- 回滚：代码回退需兼容 v54 表；旧版本遇到 future schema fail-closed，不能直接降级；保留 DB 备份。
- 缺口：thought 无 conversation 外键级联删除；无 state retract API；备份恢复未演练 v54。
