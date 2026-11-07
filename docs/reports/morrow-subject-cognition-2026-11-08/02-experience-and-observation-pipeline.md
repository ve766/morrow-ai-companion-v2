# 02 · Experience / Observation 管线

当前真实输入：

- 对话 turn（user/assistant）、analysis intent、identity guard。
- assistant uncertainty/prediction error → thought。
- memory/interest/feeling/reflection 服务存在，但 **没有统一 Experience 事件协议**。

缺口：

- 没有稳定 `experienceId` 协议、主体归属 user/morrow/shared/external 的统一表。
- 用户明确偏好仍只记录在既有 personalization/memory，不会写成 Morrow preference（负向约束已保持）。
- 助手文本只作为候选触发，不作为事实证据；inner thought 由 assistant uncertainty 触发，不是把文本当事实。
- 重复消息/同源证据在 thought evidence 中按 turn/message 去重、按 conversation 计算独立度。

状态：`PARTIAL`。
