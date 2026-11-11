# 03 · 注意力、thought 与假设

触发来源（生产）：

- assistant 不确定/没有记录/不能确定 → `assistant_uncertainty`；
- correction intent / conflict → `user_correction`；
- prediction error（fact guard rewrite 或显式传入）→ `prediction_error`（新增，单测）。

优先级：

`P = 0.30U + 0.25N + 0.20R + 0.15Rel + 0.10I - 0.20Risk`

U 不确定性、N 新颖、R 重复/跨情境、Rel 相关、I 重要；Risk=0（无外部动作）。结果 clamp [0,1]；真实 thought 0.646–0.663。

缺口：

- reflection finding/interest change/relationship event 尚未直接生成 thought；
- scheduler 只 review 到期 thought，不从历史经历主动生成新假设；
- 状态机字段有限（open/reviewed/candidate/promoted/dormant/closed）。
