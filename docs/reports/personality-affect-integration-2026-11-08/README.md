# Morrow 人格与多维情绪一体化（Issue #72）

- Issue：https://github.com/ve766/morrow-ai-companion-v2/issues/72
- 分支：`feat/personality-affect-integration-20261108`（stacked on PR #70）
- 基线：`fix/chat-consent-latency-20261108` @ `b9988861e49f87ab235847792ac32e21c74e3ca0`
- 状态：**PARTIAL**

## 本轮真实落地的内容

1. 多维情绪模型：18 个可注册情绪族、可共存实例、逐族半衰期、来源归属（Morrow / user-context / shared-interaction / system-evidence）、证据引用、regulation 状态。
2. 确定性 appraisal：G/C/N/A/S/R/L/E 八分量，权重版本化；`P_e` 与 `I_e = clip(sigmoid(P_e)·Q_e·D_e)` 只用于候选强度缩放，不宣称概率。
3. 单一情绪事件日志 + 投影：`emotion_events` / `emotion_states` / `emotion_revisions`，按 turn 幂等，可重建；消息/会话删除级联或重建。
4. 生产接线：`ChatService.prepare` 生成 affect preview → system prompt（当前回合表达）→ `ChatService.send` 在 assistant 消息事务内持久化；下一轮按 query 相关性读取；探索 gate 使用主题相关的 affect bias；inner cognition 使用 affect conflict/prediction-error 作为巩固触发。
5. Morrow-owned trait：独立会话、跨情境、24h 窗口、反证惩罚、迟滞、冷却；只有 `morrow_self_appraisal` / `system_evidence` 能写入；user adaptation 仍只在 `personality-growth`，两者不混表。
6. 内在奖励契约：只接受可验证目标进展/预测误差下降/证据质量/探索发现/目标完成；用户赞美、留存、依赖、模型自夸被拒绝。
7. v55 migration、真实 SQLite 集成测试、行为边界测试 A–K（部分）、性能微基准。

## 如何复现

```bash
cd <repo>
npm run typecheck
npm test
npm run build
npm run eval:affect
```

报告中的 `machine-results.json` 记录实际命令、退出码、测试数量、migration 版本和性能结果。`benchmark-raw.json` 是 `npm run eval:affect` 的原始输出。

## 明确限制

- 没有新 UI；情绪/人格状态仍通过既有聊天与设置路径体验，没有可视化面板或“清除情绪”按钮（`clearCognitiveHistory` 已清理新账本）。
- 没有真实云 Provider 的新一轮同条件行为实验；本地 loopback HTTP provider 用于生产调用链，不是 mock 函数。
- sadness/loneliness 只在真实 Morrow-owned loss 接口与单测中成立；生产只有 knowledge gap → concern 路径。
- anger/fear 有 appraisal 边界和单测，但没有稳定的生产触发场景。
- 没有训练、没有强化学习、没有后台网络、没有工具执行。
- 不宣称主观意识、心理诊断或“真实感受”；所有值都是规则驱动的工程状态。
