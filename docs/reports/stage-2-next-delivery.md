# Stage 2 下一轮交付（issue #17）

写作时间：2026-10-29 17:35 (+08:00)
分支：`feat/stage-2-delivery-hardening`（PR #15）
本文件对应提交 HEAD：见 PR #15 最新 HEAD（结果文件内记录了生成它的 exact SHA）

---

## 1. 本轮实际完成

### 1.1 A–L 评测运行器（从"只有定义"到"能真跑"）

新增 `evals/stage-2/runner/cli.ts` + `npm run eval:stage2`。运行器：

- 用真实 `CompanionService` + 真实 SQLite（临时库）驱动，经 `sendChat` 走完整轮次；
- 断言只读**序列化后的 Provider 请求**与数据库，不读模型自述；
- Provider 为**脚本化**（返回固定文本），结果文件里标注 `providerMode: "scripted"`，绝不当作真实模型证据；
- 逐场景输出 `PASS / FAIL / SKIPPED / BLOCKED / NOT_RUN`，`passRate` 分母只含 `PASS + FAIL`。

**可执行场景（3 个，全部真实执行）**

| 场景 | 断言 | 结果 |
|---|---|---|
| B 跨会话记忆 | 记忆 id 在同会话请求中投递；新会话仍投递 | PASS 2/2 |
| D 撤回 | 撤回前正对照可投递；撤回后 id 与文本均不出现 | PASS 3/3 |
| I 幂等 | 重复 requestId 只产生 1 条 assistant；返回同一消息；provider 只调 1 次 | PASS 3/3 |

**未执行场景（诚实标注）**：A / C / E / F / G / H / J = `NOT_RUN`（脚本未写），K / L = `BLOCKED`（无凭据 / 渲染沙箱）。

### 1.2 运行器自身的缺陷（记录，不隐藏）

首次运行时 B 与 D 全红，`delivered=0`。排查后确认**不是产品缺陷**，而是运行器的 ID 提取错误：
记忆块是嵌在 system 消息里的 JSON 字符串，引号是转义的（`\"id\":\"...\"`），原正则匹配不到。
修正为「先反转义、再在 `"memories":[` 窗口内匹配」后全部通过。

这意味着：D 的"撤回后不存在"断言在修好之前是**假通过**（因为提取恒为 0）——正对照存在的意义正在于此。

### 1.3 B2 渐进式个性化（本次实现，已进入真实链路）

- 迁移 22：`personalization_state`（有界值）+ `personalization_signals`（逐轮证据，主键 `(dimension, turn_id)`）。
- `src/personalization/personalization-service.ts`：`p' = clip(p + η·w·e, 0, 1)`，`η = 0.05`，单轮每维最多移动 0.05。
- 写入：`onTurnCompleted`（真实轮次完成）；读取：`buildSelfModelContextBlock` → 下一轮 system 提示词。
- 撤回：`forgetTurn` 删该轮信号并重算（回到 0.5，不是"略低于 0.5"）；消息删除由迁移 22 触发器清理。
- 端到端测试证明：第 1 轮写入后**第 1 轮 payload 不含该块**，第 2 轮 payload 含 `Bounded interaction preference state` 与 `exploration=`。

### 1.4 审查发现的 P1 修复（数据一致性）

| 编号 | 问题 | 修法 | 验证 |
|---|---|---|---|
| P1-A | 触发器只删 `personalization_signals`，`personalization_state` 残留旧值，仍会进提示词 | 改为**证据即真相**：`get()` 每次按剩余证据折叠重算，并回填缓存行；触发器删信号后旧值不可能存活 | 删除源消息后 `value=0.5`、`evidence_count=0`、缓存行同步修正 |
| P1-B | `apply()` 两次写入无事务，崩溃可留「有信号无状态」 | 插入 + 折叠 + 写缓存放进 `BEGIN IMMEDIATE`，异常 ROLLBACK；重放收敛（折叠而非自增） | 人工制造「有信号无状态」后再调 `apply`，结果与折叠一致 |
| P1-C | 算式夹紧但落库仍是原值，与 CHECK 冲突 | 归一化提前到服务边界，写库与计算使用同一组数字；NaN/Infinity/非法时间戳拒绝 | `weight=5` 落库为 `1`；非法输入零写入 |

### 1.5 B4 持久化轮次状态机（本次实现）

- 迁移 23 `turn_states`：每轮一行，记录"停在哪一步"，而不是只有终态。
- 转换表在 `turn-state-machine.ts`，非法转换抛错且**不覆盖**已存状态；重复进入同一状态是 no-op。
- 已接线 6 个点：`received → context_ready → requesting → response_received → committed`，失败分支写 `failed`/`cancelled` + 错误码。
- 尚缺 `analyzed` / `awaiting_consent` / `recovery_required` 的写入点（转换表已定义）。

### 1.6 B3 上下文块效用（本次实现）

- `U(c) = wr·R + wf·F + wq·Q + wp·P − wx·X − wd·D`，权重见算法登记 §8。
- 替换了 `memory-context-assembler.ts` 里原来的 `rankScore`（`score + conf/50 + 2·2^(−Δt/30)`），排序现在走文档公式。
- 每个分量归一化后再加权；非有限值按 0；返回 `reason` 码便于审计。
- **未接线**：`P`（个性化偏好）恒为 0，`X`/`D` 也为 0（冲突与过期在别的层处理）。这三项在注册表中明确标注，不计完成。

### 1.7 B1 多信号意图置信度（本次实现，未改变行为）

- `s = α·r + β·c + γ·e + δ·h`，权重 0.45/0.25/0.15/0.15；缺失信号按可用分量**重新归一化**，不用 0/1 填充。
- 全缺失时 `confidence=0` 且 `needsClarification=true`——"没测到"不能读成"确定错了"。
- 标注 `calibration: 'uncalibrated_rule_evidence'`，不是概率。
- **行为未改变**：尝试把 `ambiguous` 一律改成 clarify 后，`cognitive-evaluation` 的离线基线断言失败，因此回退。阈值需用标注数据重标定后再接管 strategy，已记为未接线项。

### 1.8 B5 根因修复：兴趣主题碎片化（本次实现）

**根因（已在真实数据链上确认，不再从阈值入手）**：`interests.observe` 只用「共享词 ≥ 2」判同一主题。中文短轮次的词集不同，同一主题被拆成多条 candidate，各自累积证据都够不到「≥2 会话 且 ≥3 证据」，`active` 恒为 0。

**修复**：新增确定性主题同一性匹配器 `src/self-model/topic-identity.ts`。

```
score = 0.30·Jbigram + 0.10·Junigram + 0.45·Containment(preferred) + 0.15·[sharedPreferred≥2] + runBonus
runBonus: Han ≥4 字 / latin ≥3 词 → +0.30；Han =3 字 / latin =2 词 → +0.20
阈值: same ≥ 0.45；ambiguous ≥ 0.35（歧义带内不合并）
```

三道硬约束保证「不误合并」优先于「多合并」：

| 约束 | 触发 | 结果 |
|---|---|---|
| 上位词 | 较短一侧内容单元 ≤1 且较长 ≥2（`咖啡` / `咖啡拉花`） | `different` |
| 同槽替换 | 单元集对称差 ≤2 且 Jaccard∈[0.5,1)（`我喜欢猫` / `我喜欢狗`） | `ambiguous`，永不合并 |
| 极性冲突 | 一侧否定（`我喜欢` / `我不喜欢`） | 记**反证**，不计支持 |

**开发集指标**（23 对人工标注，`npm run eval:topic-identity`）：

```
precision 1.000   recall 0.875
same->same 7   same->different 1
diff->same 0   diff->different 15
ambiguous 3（其中 2 对为同槽替换，正确未合并）
```

唯一漏判 `p03`（`我在学手冲咖啡` / `最近一直在练手冲`，仅共享 2 字中心词）已如实记录为召回损失，**不是**误合并。小样本结果标注为开发集结果，不声称已普遍校准。

门禁语义（此处曾写错，已改正）：脚本**只以 FP 为门禁**——误合并会把错误兴趣永久写进长期层，召回缺口只让晋升延后。因此 `p03` 存在时退出码仍是 0，脚本每次打印 `gate: falsePositive must be 0 (actual 0); recall misses are reported, not gated (actual 1)`。之前报告里把该命令写成「0 / 全绿」而未说明这条语义，容易被读成指标全部达标；现在语义与数字一起给出。报告 JSON 同时带 `headSha` 与 `generatedAt`。

**同时修掉的两个真实缺陷**：

1. **证据账本**（迁移 24）：`interests.evidence_count` 原来是只写计数器——重放同一轮会虚增，删消息不会减少，导致已撤回的观察仍在喂养 `active`。现在 `interest_evidence` 是唯一真相，`(interest_id, evidence_ref)` 主键 + `evidence_ref` 唯一索引，聚合值降为缓存，读取时按证据折叠重算；证据清零则整条删除，不达标则 `active → candidate`。
2. **反思的证据引用**：原来所有记忆共用占位 id `0000…`，幂等键一上，第二条记忆会被当成重放丢弃。改为 `evidenceKind='memory'` + 记忆 id。

**标签质量**：`deriveInterestLabel` 从「第一个内容 bigram」改为「最长连续内容短语」，`我最近在学咖啡拉花` 由 `最近` 变为 `学咖啡拉花`；顺带消除了两个不同主题撞 `interests_label_uq` 唯一索引导致的整轮认知更新中断。

## 2. 命令与退出码（实跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --maxWorkers=2` | 0 | **71 files / 629 tests passed** |
| `npm run build` | 0 | — |
| `npm run eval:stage2` | 0 | executed 5 / passed 5 / failed 0 / blocked 2 / notRun 7 |
| `npm run eval:topic-identity` | 0 | precision 1.000 / recall 0.875 / FP 0 / FN 1（门禁只看 FP，见下） |
| `npm run eval:ablation` | 0 | full 2/3 轮含个性化块 vs no_personalization 0/3 |

结果文件（`headSha = b497879`，与生成时代码提交一致）：
- `evals/stage-2/results/2026-10-29T16-47-15-b497879.json`（+ `-summary.json`）
- `evals/stage-2/results/topic-identity-devset-report.json`（内含 `headSha=b497879`）
- `evals/stage-2/ablation/results/2026-10-29T16-47-26-b497879.json`

修复过程结果全部保留，不覆盖也不冒充当前提交：
`16-02-23`（B5 FAIL 2/3，碎片化证据）、`16-12-19`（B5 FAIL 4/5，证据链已通但 payload 未带 id）、
`16-29-22`（B5 PASS，但开发集报告尚未带 headSha）、`16-45-15`（工作区有未提交改动时生成，SHA 不可作数）。

## 3. 未完成（阻止交付）

| 项 | 状态 |
|---|---|
| B1 多信号置信度 | **已实现**，未接管 `strategy`（改默认会移动离线基线，已回退） |
| B2 渐进式个性化 | **已实现并接线**（含 P1-A/B/C） |
| B3 上下文块效用 `U(c)` | **已实现并用于记忆排序**（`P/X/D` 恒 0） |
| B4 轮次状态机 | **已实现并接线（6 个点）**，3 个中间态待接 |
| ~~B5 反思→下一轮 payload~~ | **PASS**（场景 B5 5/5：反射执行、证据 3 条跨 2 会话、payload 含注意力块且带目标 id） |
| 消融脚本 | 1 条臂可执行（B2），`no_context_utility` / `no_reflection` NOT_RUN |
| 场景 A/C/E/F/G/H/J | NOT_RUN |
| 真实 Provider S1–S6 | **PASS WITH LIMITATIONS**（26/26 客观断言；S4 缺第二模型） |
| Electron / Windows | BLOCKED（最小复现证明是环境渲染沙箱，非产品缺陷） |
| CI | BLOCKED（`runner_id=0`，重跑 attempt 2 仍无 runner） |

## 4. 结论

**PARTIAL / BLOCKED。**

本轮把 B5 从 FAIL 推进到 PASS，并且是 payload 级证据：目标兴趣的证据账本有 3 条支持、跨 2 个会话，下一轮序列化请求里出现带该兴趣 id 的注意力块。B1–B4 均已实现并接线（各自带未接线项，已在注册表标注）。

仍阻止交付的是：场景 A/C/E/F/G/H/J 未执行、桌面与 CI 无有效证据。因此不构成阶段二交付，不建议合并。
