# 06 · 内部认知工作区

- 表：`morrow_thoughts` / `morrow_self_states`（v54）。
- 触发：不确定、纠错、预测误差；普通寒暄/用户偏好不创建 Morrow thought。
- 状态：open/reviewed/candidate/promoted/dormant/closed；thought priority 0–1。
- 本地调度：`app/index.ts` 每 5 分钟 `reviewDue(now,3)`；before-quit clear；无网络/云 Provider/工具。
- 持久化：SQLite；重启恢复；真实 state/thought 重启后仍在。
- 下一轮读取：`contextBlock(query)` 按 token 重叠过滤，避免无关 state 污染。
- 反证：`addCounterEvidence` 更新 counter refs 并 review；单测 active→weakened。
- 预算：每次 review 最多 3，thought priority/uncertainty/独立度限制。

未完成：scheduler 不从历史经历生成新假设；没有每日预算计数器/队列积压指标持久化；无自主表达投递。
