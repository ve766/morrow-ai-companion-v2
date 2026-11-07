# 05 · Morrow-owned Interest 与人格

- Morrow-owned state：actor=morrow，来源是自身不确定/预测误差/纠错，不是用户偏好。
- 当 active 且 priority≥0.6，domain 标为 `interest`；否则 `question`。
- 该 state 进入下一轮 context（query 相关性过滤）。
- 用户 interest 与 Morrow interest 仍分开：inner service 不读取/复制用户 interest 作为 Morrow 的。
- 人格长期变化：**NOT_IMPLEMENTED**；现有 personality/growth 主要是用户适配，不能冒充由内向外形成。
- 固定温柔/活泼/幽默标签：未添加。
- 自主表达：**NOT_RUN**；没有主动提起未解问题的生产测试。
