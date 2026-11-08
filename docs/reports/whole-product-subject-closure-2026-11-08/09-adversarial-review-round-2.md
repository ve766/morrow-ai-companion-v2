# 第二轮对抗性审查

第一轮代码完成后，按“全新 checkout/干净 DB/真实用户路径”自查。以下只列独立发现与本轮动作。

## 已发现并修复

1. **用户探索所有权泄漏**
   - 复现：`analysis.intent='exploration'`、无 `exploration_request` 事件时，curiosity 仍可能 `sourceKind=morrow_self_appraisal`、`traitEligible=true`。
   - 修复：`userRequestedExploration` 判定；sourceKind→shared_interaction，traitEligible=false，reasonCode 记录。
   - 回归：`appraisal-engine.test.ts`。

2. **晋升回合自我反证**
   - 复现：trait 在第 7 个正向回合刚 active，counter 逻辑在同一回合立即写 counter，导致 status 回落。
   - 修复：`activeBefore` 在正向 observation 前快照；只有本轮开始前已 active 才写 counter。
   - 回归：`personality-affect.integration.test.ts`。

3. **Reward 半状态**
   - 复现：reward 先写，affect event 因无 message FK 失败被 catch；reward 留在 DB。
   - 修复：reward + progress affect 同一 transaction；失败回滚 reward，只记录无正文 failure event。
   - 回归：`intrinsic-reward.test.ts` 使用真实 conversation/message FK。

4. **Sensitive 对话框默认按钮过宽**
   - 复现：sensitive 对话框 `defaultId=1`（允许）；按 Enter 可能误批准。
   - 修复：sensitive 默认 `取消`（0）；chat 可记住时默认“仅本次”（1）。

5. **trait 删除后陈旧 revision**
   - 复现：消息删除级联 observation，`current` 仍返回旧 active。
   - 修复：`current` 比较 observation 数并立即 recompute；`active` 走 current。
   - 回归：`morrow-trait-service.test.ts`。

6. **UI 假按钮风险**
   - 检查：静态控件均有 handler/IPC；新增 affect/consent 面板加入 `docs/ui/control-contract.json` 与 `tests/ui-control-contract.test.ts`（selector、contracts、preload、ipc handler）。
   - 真实 chat：`scripts/chat-ui-smoke.mjs` 通过真实 built Electron + loopback SSE，验证输入→发送→流式→持久化。

## 仍未修复/未自动验证

- **Reflection finding → self-state**：仍只路由，不写回/削弱 self-state；本轮不声称 PASS。
- **原生 consent 三按钮自动化**：CDP 无法点 OS 对话框；`chat-ui` 用 acceptance-only 自动同意。产品对话框按钮本身为 `PENDING_HUMAN`。
- **真实 cloud Provider A–K**：NOT_RUN。
- **内存检索 100/500/1000/5000**：NOT_RUN；没有 Dense/PPR。
- **NSIS installer**：网络 504 阻塞；旧 stub 不冒充。
- **Mood 独立层**：仍是 3D feeling 投影，不是独立 mood 表。
- **暂停情绪**：没有持久化 pause 开关。

## 结论

本轮不是“零缺陷”；上述已修项有明确测试/命令，未修项在 `10-acceptance-matrix.json` 中标记 PARTIAL/NOT_RUN/BLOCKED/PENDING_HUMAN。
