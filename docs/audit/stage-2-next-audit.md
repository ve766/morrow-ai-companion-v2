# Stage 2 自审（issue #17 最终轮）

审计时间：2026-10-29 19:45 (+08:00)
分支：`feat/stage-2-delivery-hardening`（PR #15）
本文件写作时 HEAD：见 PR 最新 HEAD（评测/消融结果各自记录了生成时的 SHA）

---

## 1. 需求 → 源码 → 证据追踪

| 需求 | 源码入口 | 真实调用链 | 证据 | 状态 |
|---|---|---|---|---|
| B1 多信号置信度 | `cognition/intent-confidence.ts` | `analyzeCognitiveTurnDetailed` 决策时计算 | `intent-confidence.test.ts`（5） | **已实现，未接管 strategy** |
| B2 个性化 | `personalization/personalization-service.ts`、迁移 22 | `onTurnCompleted` 写 → `buildSelfModelContextBlock` 读 → 下一轮 payload | `personalization-service.test.ts`（11）+ 消融 | **已接线** |
| B3 `U(c)` | `cognition/context-utility.ts` | `memory-context-assembler.rankScore` | `context-utility.test.ts`（5）+ 记忆 60 | **已接线（P/X/D 恒 0）** |
| B4 状态机 | `cognition/turn-state-machine.ts`、迁移 23 | `send()` 6 个点 | `turn-state-machine.test.ts`（6）+ 评测场景 B4 | **已接线（3 态未接）** |
| B5 反思闭环 | `self-model/reflection-service.ts` | 轮次完成触发 | — | **未完成**：缺"反思→下一轮 payload"证据 |
| A1 隐私 | `self-model/self-fact-statement.ts`、迁移 20 | `onTurnCompleted` | 4 条测试 | 已修 |
| A2 删除边界 | 迁移 19/21/22/23 触发器 | 删除消息/会话 | 边界测试 4 + 个性化 2 | 已修 |
| A3 旧 schema | `turn-context.ts` `normalizeTurnContext` | 仓储 get/list | turn-context 11 | 已修 |

## 2. 本轮消融（真实执行）

`npm run eval:ablation` → `evals/stage-2/ablation/results/<utc>-<sha>.json`

```
full:               personalization block in 2/3 payloads, bytes=1393,1427,1496
no_personalization: block in 0/3 payloads,                bytes=1393,1185,1254
wiring difference: true
```

结论：B2 确实改变**序列化后的 Provider payload**（第 2 轮 +242 字节），不是只存在于代码里。
诚实边界：只测了"块是否进入 payload"，未测它对回复质量的影响；单会话三轮，只能证明接线差异，不能给比率。

`no_context_utility` / `no_reflection` 两条臂 **NOT_RUN**：B3 没有可注入开关，B5 需要反思发现跨越确认边界——用桩伪造那个前提等于自证。

## 3. 残余风险（按严重度）

| # | 风险 | 影响 | 处理 |
|---|---|---|---|
| R1 | B1 未接管 strategy | 低置信度不会真的触发澄清 | 需标注数据重标定阈值；已记录 |
| R2 | B3 的 P/X/D 恒为 0 | 排序未考虑个性化/冲突/过期 | 冲突与过期在别的层已过滤，但未进排序 |
| R3 | B4 三态未接 | `analyzed`/`awaiting_consent`/`recovery_required` 无写入点 | 生命周期仍能区分终态与中断 |
| R4 | B5 无 payload 级证据 | 反思闭环未证明 | 未完成项，不计通过 |
| R5 | 脚本化 provider | 不覆盖模型质量 | 真实模型 BLOCKED |
| R6 | CI runner 未分配 | 无 CI 证据 | BLOCKED |

## 4. 是否满足合并门槛

**不满足。** 理由：

1. 任务书要求的 B5 端到端与 A–L 全场景未完成；
2. 真实 Provider、Electron/Windows、CI 三项均无有效证据；
3. 消融只覆盖 1 个模块（B2），不足以支撑"各模块贡献"的结论。

可以合并的前置条件：B5 证据、A–L 至少 A/C/E/F/G/H/J 落地、至少一次带 steps 的 CI run、凭据或桌面二者之一取得真实证据。

本文件不改变任何状态：**PARTIAL / BLOCKED**。
