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
| B5 反思闭环 | `self-model/reflection-service.ts` → `interest-service.ts` → `topic-identity.ts` | 轮次完成触发；证据账本折叠 | 评测场景 B5（5 断言）+ `topic-identity.test.ts` + `interest-evidence.test.ts` | **PASS**（payload 含目标兴趣 id） |
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
| R4 | ~~B5 无 payload 级证据~~ | **已解决**：场景 B5 通过，payload 含目标兴趣 id | 见 §2 与算法登记 §11 |
| R7 | 主题匹配召回缺口 | 短句仅共享 2 字中心词时判为不同（开发集 `p03`） | 只造成晋升延后，不会误合并；已记入算法登记 |
| R9 | ~~框架碰撞误合并~~ | **已解决**：场景 G 发现 `我最近在学咖啡拉花` / `我最近在学吉他` 被判同一主题；共享串改为只算内容字符后该对降为 `ambiguous` | 开发集补 3 对框架样本（26 对，v2）；框架字符集是封闭列表，写错只会缩短共享串，不会凭空造出匹配 |
| R10 | ~~成功轮次上下文补丁被丢弃~~ | **已解决**：upsert 条件由 `status <> 'succeeded'` 改为"禁止降级"，`feeling.applied` / `after` 现在反映真实提交 | 场景 F 与 `turn-context-fidelity` 双重断言 |
| R11 | ~~事务嵌套导致读状态静默失败~~ | **已解决**：`transaction()` 嵌套改用 `SAVEPOINT` | `persistence.test.ts` 两条回归（内层可见外层未提交写入；内层失败只回滚内层） |
| R12 | 框架字符集为人工列表 | 中文虚词封闭集无法覆盖所有句式框架 | 漏掉的框架只会让共享串变长、抬高分数，属于精度风险；已用场景 G 与开发集框架样本盯住，后续按新样本补 |
| R13 | 场景 E/F 的触发依赖固定措辞 | 情感事件由本地规则触发，换一种说法可能不产生事件 | 场景断言的是"事件产生后记录是否诚实"，不是"规则召回率"；措辞召回属另一层 |
| R8 | 迁移前历史证据无消息归属 | 旧聚合计数回填为 `legacy` 证据行，无法按消息撤回 | 升级不会降级既有兴趣；新证据全部可归属、可撤回 |
| R5 | 脚本化 provider | 不覆盖模型质量 | 真实模型 BLOCKED |
| R16 | ~~Electron 渲染沙箱不可用~~ | **结论已更正**：`npm run smoke` 在默认沙箱下连跑两次通过；此前只测了 `--no-sandbox` 崩溃路径，把它当成了沙箱不可用 | 安装包升级路径仍未验证 |
| R6 | CI runner 未分配 | 根因已定位：check-run 注解为「recent account payments have failed or your spending limit needs to be increased」；`runner_id=0`、`steps=0`、日志 `BlobNotFound`、自托管 runner 0 | 代码侧无法修复；CI 不计通过也不计失败（未执行任何步骤） |
| R14 | 框架字符集是人工封闭列表 | 新句式框架可能仍被当成共享内容 | 只会抬高分数（精度风险），已用场景 G 与 3 对框架样本盯住 |
| R15 | 记忆证据按修订号失效 | 旧库行的 `evidence_revision` 为 NULL，任何一次措辞修订都会清掉它 | 升级不降级既有兴趣（证据仍在，直到修订发生）；新证据全部带修订号 |

## 4. 是否满足合并门槛

**不满足。** 理由：

1. 任务书要求的 B5 端到端与 A–L 全场景未完成；
2. 真实 Provider、Electron/Windows、CI 三项均无有效证据；
3. 消融只覆盖 1 个模块（B2），不足以支撑"各模块贡献"的结论。

可以合并的前置条件：B5 证据、A–L 至少 A/C/E/F/G/H/J 落地、至少一次带 steps 的 CI run、凭据或桌面二者之一取得真实证据。

本文件不改变任何状态：**PARTIAL / BLOCKED**。
