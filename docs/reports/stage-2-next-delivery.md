# Stage 2 交付状态（issue #17）

分支：`feat/stage-2-delivery-hardening`（PR #15，保持 Open，不合并、不发版）
本文件是阶段二状态的**唯一口径**。历史版本里的"只有 3 个场景可执行 / A–L 未实现"等段落已删除，不再保留互相矛盾的两套说法。

## 0. SHA 口径（先看这个）

| 名称 | SHA | 含义 |
|---|---|---|
| 结果生成代码 SHA | `5635a9c6e0023d8bc059f6c4322dd65dc5b9101b` | 下面所有评测 JSON 里的 `headSha`。结果是在**工作区干净**时、于这个提交上生成的 |
| 当前 PR HEAD | 见 PR #15 最新提交 | 通常比结果 SHA 新一个"结果提交"，因为结果文件本身要提交 |

两者不同是正常的：结果必须绑定生成它的代码，而不是绑定"记录结果的提交"。旧 SHA 的结果文件一律保留，不覆盖、不冒充当前提交。

## 1. 状态总览

| 能力 | 状态 | 证据 |
|---|---|---|
| 评测运行器 A–L（12 个可执行场景） | **PASS 12/12**，45 条断言，NOT_RUN 0 | `evals/stage-2/results/2026-10-30T02-48-36-5635a9c.json` |
| B1 多信号意图置信度 | **已实现**，未接管 `strategy` | `intent-confidence.test.ts`（5 条） |
| B2 渐进式个性化 | **PASS（已接线）** | `personalization-service.test.ts`（11 条，含 P1-A/B/C） |
| B3 上下文块效用 `U(c)` | **已实现并用于排序**，`P/X/D` 恒 0 | `context-utility.test.ts`（5 条） |
| B4 轮次状态机 | **已接线 6 个点**，3 个中间态未接 | `turn-state-machine.test.ts`（6 条） |
| B5 反思→下一轮 payload | **PASS** | 场景 B5（5 条断言） |
| 主题同一性匹配 | **PASS（开发集 26 对）** | `topic-identity.test.ts`（12 条）+ 开发集报告 |
| 记忆证据失效（P0-A） | **PASS** | `interest-invalidation.test.ts`（9 条）+ payload 级 2 条 |
| 反转改变兴趣状态（P0-B） | **PASS** | 同上 |
| 真实 Provider S1–S6 | **PASS WITH LIMITATIONS**（26/26 客观断言；S4 缺第二模型） | `evaluation/reports/phase24-real-model-78ff892.json` |
| 消融 | **部分**：1 条臂可执行（B2），2 条 NOT_RUN | `evals/stage-2/ablation/` |
| 场景 K（真实凭据） | **BLOCKED** | 本环境无凭据 |
| 场景 L（桌面渲染） | **BLOCKED** | Chromium 沙箱无法启动，最小复现已证明是环境问题 |
| CI | **BLOCKED（账号计费）** | run 40993696285 注解见 §8 |

## 2. 评测运行器

`evals/stage-2/runner/cli.ts` + `npm run eval:stage2`。运行器用真实 `CompanionService`、真实 `ReflectionService`/`InterestService`/`SelfModelService`、真实 SQLite、真实事件日志驱动，断言只读**序列化后的 Provider 请求**与数据库。Provider 是脚本化的（`providerMode: "scripted"`），因此这些结果证明接线与载荷内容，**不证明模型质量**。

| 场景 | 断言 | 断言内容 |
|---|---|---|
| B 跨会话记忆 | 2 | 同会话投递；新会话仍投递 |
| D 撤回 | 3 | 撤回前正对照；撤回后 id 与文本都不出现 |
| I 幂等 | 3 | 重复 requestId 只产生 1 条 assistant、返回同一消息、provider 只调 1 次 |
| B4 轮次生命周期 | 3 | 成功轮次 `committed`；失败轮次 `failed`；失败不落 assistant |
| B5 反思进入下一轮 | 5 | 反思执行、长期层有该主题、证据 3 条跨 2 会话、payload 含注意力块、块内点名目标 id |
| A 指代依赖 | 4 | 无上文→`unresolved`；自足问句→`none`；代词追问→`prior_turn`；两种情况可区分 |
| C 纠正链 | 4 | 纠正前正对照；rev2/prev1/`corrected` 成链；下一轮只带新值 |
| E 人格稳定 | 4 | 4 轮情绪/反馈后版本与数值不变；未写修订；载荷文案逐轮一致 |
| F 状态影响 | 5 | `applied=true`；`after` 等于已提交状态；单轮变化 ≤ 上限；值在范围内；载荷含不可覆盖声明 |
| G 晋升门槛 | 4 | 单会话 3 次不晋升；第二会话晋升；无关主题仍候选；不串主题 |
| H 反思限流 | 4 | 额度用尽即拒；被拒不留运行记录；1 小时后窗口重开 |
| J 载荷哈希 | 4 | 批准哈希 == 实发载荷哈希（重算）；重放不重发；撤回后哈希变；撤回值不在新载荷 |

K（真实 Provider 凭据）与 L（桌面渲染）仍 `BLOCKED`，不计入通过。

## 3. B5 与主题匹配

**根因**：`interests.observe` 原先只用「共享词 ≥ 2」判同一主题。中文短轮次词集不同，同一主题被拆成多条 candidate，各自够不到「≥2 会话 且 ≥3 证据」，`active` 恒为 0。

**匹配器**（`src/self-model/topic-identity.ts`，确定性、无网络、无 embedding）：

```
score = 0.30·Jbigram + 0.10·Junigram + 0.45·Containment(preferred) + 0.15·[sharedPreferred≥2] + runBonus
runBonus: Han ≥4 字 / latin ≥3 词 → +0.30；Han =3 字 / latin =2 词 → +0.20
阈值: same ≥ 0.45；ambiguous ≥ 0.35（歧义带内不合并）
```

三道硬约束保证"不误合并"优先于"多合并"：上位词 → `different`；同槽替换 → `ambiguous` 永不合并；极性冲突 → 记反证。

最长共享串只在**内容字符**上计算（剔除虚词/代词/程度副词/时间框架），实词（`学/练/做`）不剔——它们在 `天文学/数学` 这类名词里，剔了会丢真匹配。这条是场景 G 抓到框架碰撞误合并后补的。

**开发集（26 对，`npm run eval:topic-identity`，结果 `headSha=5635a9c`）**：

```
precision 1.000   recall 0.889   FP 0   FN 1
混淆矩阵：same->same 8  same->different 1  different->same 0  different->different 17
ambiguous 4（其中 2 对同槽替换、1 对句式框架碰撞，均正确未合并）
gate: falsePositive must be 0 (actual 0); recall misses are reported, not gated (actual 1)
```

唯一漏判 `p03`（`我在学手冲咖啡` / `最近一直在练手冲`，仅共享 2 字中心词）记为**召回损失**，不是误合并。样本包含：跨会话表达变化、上位词、同词异义、否定/反转、不同对象、短中文句、英文句、标点空白、重复句、相似不同主题、句式框架碰撞。指标是开发集结果，不声称已校准。

**门禁语义**：脚本只以 FP 为门禁——误合并会把错误兴趣永久写进长期层，召回缺口只让晋升延后。脚本每次打印上面那行 gate，报告 JSON 带 `headSha` 与 `generatedAt`。

## 4. P0-A：记忆证据随记忆失效

**问题**：反思把已保存记忆作为兴趣证据（`evidenceKind='memory'`），但迁移 24 只有 `messages` / `conversations` 的清理触发器。记忆被 retract / delete / correct 后，证据仍在，兴趣可以继续 `active` 并进入下一轮载荷。

**修法**（迁移 25）：

| 变化 | 规则 |
|---|---|
| 新增 `interest_evidence.evidence_revision` | 记录被观察的记忆修订号；旧行为 NULL，视为旧修订 |
| `AFTER DELETE ON memories` | 删除该记忆的全部证据（与记忆删除同一事务） |
| `AFTER UPDATE OF status`，`NEW.status <> 'active'` | 撤回即失效：删除该记忆的证据 |
| `AFTER UPDATE OF revision` 且 `NEW.revision > OLD.revision` **且 `NEW.current_text <> OLD.current_text`** | 只删旧修订的证据；新修订的证据保留 |

文本比较是必要的：`confirm` 也会升 revision 但措辞不变，若只看 revision，一次确认就会误删有效证据（首版实现即如此，被测试抓到）。

**重折叠**：证据行由触发器在记忆语句的同一事务内删除；兴趣缓存（`evidence_count` / `conversation_count` / 状态 / 强度 / 置信度）由读取路径按剩余证据重折叠并写回——`list()` 与 `activeForContext()` 都经过 `reconcile`，payload 组装必然走这条路径。证据清零则整行删除。

**测试**（`src/self-model/interest-invalidation.test.ts`，真 SQLite 含迁移）：

1. retract → 证据消失、`active→candidate`、剩余证据仍在（不误删）；
2. hard delete → 证据清零、兴趣删除；
3. correct → 旧修订证据失效；`confirm` 不失效；新修订重新观察有效；
4. 重启后仍为 candidate、证据账本不含该记忆；
5. 备份导出 → 打开快照：不含被撤回证据、状态仍为 candidate；
6. `migrations.test.ts`：v24 → v25 升级保留旧证据（`evidence_revision=NULL`），升级后撤回可清。

**payload 级**（`src/app/interest-payload-invalidation.integration.test.ts`）：撤回前正对照（payload 含该兴趣 id）→ 撤回后 payload 不含该 id，也不再出现该标签的兴趣条目。

## 5. P0-B：反转改变兴趣状态

**问题**：反转被写成 `polarity='counter'`，`fold()` 也统计了 counter，但 `reconcile()` 只用 support/conversations，`derivedStatus()` 完全不读 counter。所以"我不喜欢了"只留下一条记录，`active` 不变，旧兴趣继续进 payload。

**语义（确定规则）**：

- **反转立即暂停**：最新一条证据是 counter 时，`active → candidate`（保留行与历史，不删除）。理由是反转陈述的是"现在"，而证据是"过去"。
- **只扣"最后一次支持之后的" counter**：`effectiveSupport = max(0, support − recentCounters)`。这样 `喜欢 → 不喜欢 → 又喜欢` 能恢复，旧 counter 不会永久压制新证据；反过来新 counter 也不会被旧 support 永久压过。
- **驱动量**：`effectiveSupport` 决定状态、强度、置信度；`evidence_count` 仍存 raw support（"依据 N 次"是发生过的事实）。两个数都写进 `interest.observed` / `interest.recomputed` 事件，算术可复核。
- **用户设定的 `dropped` / `archived`** 不被证据覆盖。
- **删除 counter 来源**（消息或记忆）后按剩余证据重算，可自动回到 `active`。

**测试**：`interest-invalidation.test.ts` 四条——反转立即暂停（含"反转前确实 active"正对照）、重新喜欢恢复、删除 counter 来源后重算回 active、重放同一 counter 不重复计数；`interest-payload-invalidation.integration.test.ts` 一条端到端——反转后 payload 不含该兴趣 id，重新喜欢后又出现。

## 6. 本轮顺带修掉的缺陷

| 缺陷 | 现象 | 修法 |
|---|---|---|
| 框架碰撞误合并 | `我最近在学咖啡拉花` / `我最近在学吉他` 共享 5 字框架被判同一主题，吉他证据算进拉花 | 共享串只算内容字符（场景 G 抓到） |
| 成功轮次上下文补丁被丢弃 | `cognitive_turn_contexts` upsert 条件 `status <> 'succeeded'` 把同一轮自己的最终化补丁挡掉，`feeling.applied` 恒 false | 改为"禁止降级"：`<> 'succeeded' OR excluded.status = 'succeeded'` |
| 事务不支持嵌套 | 最终化在写事务里读状态，`snapshot()` 再开事务抛错被吞，返回默认值 | `SqliteDatabase.transaction` 嵌套改用 `SAVEPOINT` |
| 标签取到框架词 | `我最近在学吉他` 的标签是 `最近` | 取原文最长内容字符连续段 + 裁前导虚词（只裁前导，裁尾会把 `天文学`→`天文`） |
| 反思证据共用占位 id | 所有记忆共用 `0000…`，幂等键一上第二条被当重放丢弃 | `evidenceKind='memory'` + 记忆 id |
| 证据账本曾是只写计数器 | 重放虚增、删消息不减 | 迁移 24：`interest_evidence` 为唯一真相，聚合降为缓存 |

## 7. 命令与退出码（在 `5635a9c` 实跑，工作区干净）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --maxWorkers=2` | 0 | **74 files / 648 tests passed** |
| `npm run build` | 0 | — |
| `npm run eval:stage2` | 0 | executed 12 / passed 12 / failed 0 / blocked 2 / notRun 0（45 条断言） |
| `npm run eval:topic-identity` | 0 | precision 1.000 / recall 0.889 / FP 0 / FN 1（26 对） |
| `npm run eval:ablation` | 0 | wiring difference true（1 条臂） |

结果文件（`headSha = 5635a9c`）：

- `evals/stage-2/results/2026-10-30T02-48-36-5635a9c.json`（+ `-summary.json`）
- `evals/stage-2/results/topic-identity-devset-report.json`
- `evals/stage-2/ablation/results/2026-10-30T02-48-43-5635a9c.json`

## 8. CI：BLOCKED（账号计费，不是代码失败）

- run：<https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40993696285>（`head_sha=5635a9c`，`event=pull_request`，`conclusion=failure`）
- 三个 job 全部 `runner_id=0`、`runner_name` 为空、`steps=0`、`started_at` 与 run 创建时间同秒
- job 日志接口返回 `BlobNotFound`（从未产生日志）
- 仓库自托管 runner：`total_count=0`
- check-run 注解原文：**"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"**

结论：workflow 配置本身没有阻止调度（`runs-on: windows-latest / ubuntu-latest`，标准 action），失败原因是账号计费/额度，代码侧无法修复。**这不构成代码通过，也不构成代码失败**——它没有执行过任何步骤。

## 9. 未完成（不计入通过）

| 项 | 状态 |
|---|---|
| B1 未接管 `strategy` | 低置信度不会触发澄清；需标注数据重标定 |
| B3 的 `P/X/D` 恒 0 | 排序未考虑个性化/冲突/过期 |
| B4 三个中间态未接 | `analyzed` / `awaiting_consent` / `recovery_required` 无写入点 |
| 消融 2 条臂 | `no_context_utility` / `no_reflection` NOT_RUN |
| 场景 K | BLOCKED（无真实凭据） |
| 场景 L | BLOCKED（渲染沙箱） |
| CI | BLOCKED（账号计费） |
| 主题匹配召回 | `p03` 类短句仍漏判；框架字符集是人工列表，新句式可能仍需补 |

## 10. 结论

**PARTIAL / BLOCKED。**

可复核的部分：12 个场景、45 条断言在真实栈上全部通过；B5 的完成定义（聚合可靠 + 不误合并 + 撤回不泄漏 + payload 端到端）四项都有独立证据；P0-A / P0-B 两条派生数据失效路径都已闭环，并有 payload 级正对照。

不可复核的部分：K（真实凭据）、L（桌面渲染）、CI（账号计费）三项没有任何执行证据；B1/B3/B4 各有明确的未接线项；消融只有 1 条臂。

因此阶段二不构成完整交付，不建议合并。上述阻断项都不是"再写点文档"能消除的。
