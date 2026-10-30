# Stage 2 交付状态（issue #17）

分支：`feat/stage-2-delivery-hardening`（PR #15，保持 Open，不合并、不发版）
本文件是阶段二状态的**唯一口径**。历史版本里的"只有 3 个场景可执行 / A–L 未实现"等段落已删除，不再保留互相矛盾的两套说法。

## 0. SHA 口径（先看这个）

| 名称 | SHA | 含义 |
|---|---|---|
| 结果生成代码 SHA | `02c2e4aed143356349a0f51d658a6e31c4eb548c` | 下面所有评测 JSON 里的 `headSha`。结果是在**工作区干净**时、于这个提交上生成的 |
| 当前 PR HEAD | 见 PR #15 最新提交 | 通常比结果 SHA 新一个"结果提交"，因为结果文件本身要提交 |

两者不同是正常的：结果必须绑定生成它的代码，而不是绑定"记录结果的提交"。旧 SHA 的结果文件一律保留，不覆盖、不冒充当前提交。

## 1. 状态总览

| 能力 | 状态 | 证据 |
|---|---|---|
| 评测运行器 A–L（12 个可执行场景） | **PASS 12/12**，45 条断言，NOT_RUN 0 | `evals/stage-2/results/2026-10-30T02-48-36-5635a9c.json` |
| B1 多信号意图置信度 | **PARTIAL**：已计算并记录，未接管 `strategy`（试接后语料准确率 1.000→0.885，已回退） | `intent-confidence.test.ts` + 2 条测量测试 |
| B2 渐进式个性化 | **PASS（已接线）** | `personalization-service.test.ts`（11 条，含 P1-A/B/C） |
| B3 上下文块效用 `U(c)` | **PARTIAL**：`X`/`D` 已接线，`P` 仍为 0（无可辩护映射） | `context-utility.test.ts` + `memory-context-assembler.test.ts` 2 条排序断言 |
| B4 轮次状态机 | **PASS**：9 个状态全部有写入点 | `turn-state-machine.test.ts` + `turn-state-sequence.integration.test.ts`（3 条） |
| B5 反思→下一轮 payload | **PASS** | 场景 B5（5 条断言） |
| 主题同一性匹配 | **PASS（开发集 26 对）** | `topic-identity.test.ts`（12 条）+ 开发集报告 |
| 记忆证据失效（P0-A） | **PASS** | `interest-invalidation.test.ts`（9 条）+ payload 级 2 条 |
| 反转改变兴趣状态（P0-B） | **PASS** | 同上 |
| 真实 Provider S1–S6 | **PASS WITH LIMITATIONS**（26/26 客观断言；S4 缺第二模型） | `evaluation/reports/phase24-real-model-78ff892.json` |
| 消融 | **4 组全部真实执行**（full / no_personalization / no_context_utility / no_reflection） | `evals/stage-2/ablation/results/*` |
| 场景 K（真实凭据） | **BLOCKED** | 本环境无凭据 |
| 场景 L（桌面渲染） | **BLOCKED（运行器内）**，桌面路径另有 **PASS** 证据 | 运行器无法托管 GUI 进程；`npm run smoke` 两次 exit 0（沙箱开启） |
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

K（真实 Provider 凭据）仍 `BLOCKED`，不计入通过。

L 在**运行器内**仍是 `BLOCKED`（离线运行器托管不了 GUI 进程），但桌面路径本身已有实测证据：`npm run smoke` 在默认沙箱下连跑两次 exit 0，见 §7.5。两者不是同一件事，不要合并成一句"桌面 BLOCKED"。

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

## 6.5 D 项：B1–B4 逐项核实结果

| 项 | 状态 | 本轮做了什么 | 证据 |
|---|---|---|---|
| B1 意图置信度 | **PARTIAL** | 尝试把 `intent === 'uncertain'` 接到 `clarify`，实测标注语料 strategyAccuracy 从 1.000 掉到 0.885（23/26），按数据回退；把该测量与「低置信度不强制追问」写成 2 条测试 | `cognitive-turn-analyzer.test.ts` |
| B2 人格稳定 | **PASS** | 复核：`savePersonality` 只有用户编辑才升版本；情绪/反馈轮次不写修订；场景 E 4 条断言覆盖 | 场景 E + `personalization-service.test.ts`（11 条） |
| B3 上下文效用 | **PARTIAL** | `X`（候选集内冲突）与 `D`（未确认且 >120 天的陈旧度）真正接入排序；`P` 仍为 0，理由是没有可辩护的映射，不硬凑 | `memory-context-assembler.test.ts` 2 条排序断言 + `MemoryService.conflictedIds` |
| B4 轮次状态机 | **PASS** | 补齐 `analyzed` / `context_ready` / `awaiting_consent` / `recovery_required` 四个写入点，9 个状态全部可达 | `turn-state-sequence.integration.test.ts`（3 条，记录型端口断言 7 步序列） |

## 6.6 E 项：四组消融实测

| 臂 | 配置 | 结果 |
|---|---|---|
| `full` | 全开 | 个性化块 3/4 轮；记忆投递顺序（夹具下标）`[3,2,0]`；reflection 运行 4 次 |
| `no_personalization` | 不注入 PersonalizationService | 个性化块 0/4 轮；载荷少 242 字节 |
| `no_context_utility` | `useContextUtility: false`（真实注入开关） | 顺序变为 `[2,0,3]`：没有效用排序时，陈旧记录按相关度排到最前 |
| `no_reflection` | 不注入 reflection | reflection 运行 0 次 |

`contextUtilityChangesMemoryOrder: true` 是本轮新增的可观测证据：B3 不是"代码里有"，而是真的改变了模型看到的顺序。

`no_reflection` 的 payload 差异为 0（`attentionBlockTurns` 两臂都是 0）：这 4 轮规划对话没有产生可晋升的兴趣，所以"关掉反思"在这份输入上看不出载荷差别。这是**没有观测到差异**，不是"证明无效"——如实记录。

## 7. 命令与退出码（在 `02c2e4a` 实跑，工作区干净）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --maxWorkers=2` | 0 | **75 files / 655 tests passed** |
| `npm run build` | 0 | — |
| `npm run eval:stage2` | 0 | executed 12 / passed 12 / failed 0 / blocked 2 / notRun 0（45 条断言） |
| `npm run eval:topic-identity` | 0 | precision 1.000 / recall 0.889 / FP 0 / FN 1（26 对） |
| `npm run eval:ablation` | 0 | 4 组臂全部执行；`wiring difference detected: true` |
| `npm run smoke` | 0 | Electron 默认沙箱通过（连跑两次），见 §7.5 |

结果文件（`headSha = 02c2e4a`）：

- `evals/stage-2/results/2026-10-30T03-15-37-02c2e4a.json`（+ `-summary.json`）
- `evals/stage-2/results/topic-identity-devset-report.json`
- `evals/stage-2/ablation/results/2026-10-30T03-15-45-02c2e4a.json`

上一轮结果保留为历史，不覆盖：`e25308c`（`03-08-17` / `03-08-25`）、`5635a9c`（`02-48-36` / `02-48-43`）。

## 7.5 桌面（Electron）实测

```bash
npm run smoke     # exit 0（连续两次）
```

输出（原文）：

> Morrow smoke passed: built Electron app, default-off DeepSeek configuration, secure credential save/restart/delete (encrypted-restart-corruption-protected-then-explicit-delete-verified, no Provider requests), cognitive default-off/explicit opt-in and restart persistence, no fabricated reply, M1 memory lifecycle, M2 goal and approval safety, M4 reminder controls, local persistence, deletion, and restart verification.

关键点：

- 运行在**未禁用沙箱**的模式（`MORROW_SMOKE_DISABLE_SANDBOX` 未设置，win32 平台不自动加 `--no-sandbox`），所以这不是"绕过沙箱换来的通过"。
- 覆盖的是真实构建产物：凭据加密保存/重启/删除、认知开关默认关与显式开启、记忆生命周期、目标与审批、提醒控制、删除与重启校验。
- 仍然没有证据的是**安装包升级路径**（旧版本 → 新版本的 schema 迁移）：CI 的 `Windows upgrade-path` job 与其它 job 一样被账号计费挡住，本地也没有跑过安装器。

因此桌面从"BLOCKED（渲染沙箱）"改为"**桌面 smoke PASS**"；此前那条结论是错的，原因是最小复现只覆盖了 `--no-sandbox` 崩溃路径，没有试过默认沙箱下的完整 smoke。

## 8. CI：BLOCKED（账号计费，不是代码失败）

- run：<https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40995759654>（`head_sha=6158042`，`event=pull_request`，`conclusion=failure`）
- 同一症状在 `c5710d0`（run 40993983389）与 `5635a9c`（run 40993696285）上重复出现：每次 push 都会新起一次 run，结果一致，因此不再逐次追加
- 三个 job 全部 `runner_id=0`、`runner_name` 为空、`steps=0`、`started_at` 与 run 创建时间同秒
- job 日志接口返回 `BlobNotFound`（从未产生日志）
- 仓库自托管 runner：`total_count=0`
- check-run 注解原文：**"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"**

结论：workflow 配置本身没有阻止调度（`runs-on: windows-latest / ubuntu-latest`，标准 action），失败原因是账号计费/额度，代码侧无法修复。**这不构成代码通过，也不构成代码失败**——它没有执行过任何步骤。

## 9. 未完成（不计入通过）

| 项 | 状态 |
|---|---|
| B1 未接管 `strategy` | 低置信度不会触发澄清；实测接入反而降低语料准确率，需校准数据重标定 |
| B3 的 `P` 恒 0 | 冲突（X）与陈旧（D）已接线；偏好匹配（P）缺可辩护映射 |
| ~~B4 三个中间态未接~~ | **已解决**：9 个状态全部有写入点，序列有集成测试 |
| ~~消融 2 条臂~~ | **已解决**：四组臂全部真实执行；`no_reflection` 在本输入上未见载荷差异（如实记录） |
| 场景 K | BLOCKED（无真实凭据） |
| ~~场景 L（桌面渲染）~~ | **桌面路径 PASS**：`npm run smoke` 连跑两次 exit 0，覆盖 built app / 凭据保存-重启-删除 / 认知默认关与显式开启 / 记忆生命周期 / 目标与审批安全 / 提醒控制 / 删除与重启校验。运行器内仍不可执行（GUI 进程） |
| Windows 安装包升级路径 | 无本地证据；CI 的 upgrade-path job 仍受账号计费阻断 |
| CI | BLOCKED（账号计费） |
| 主题匹配召回 | `p03` 类短句仍漏判；框架字符集是人工列表，新句式可能仍需补 |

## 10. 结论

**PARTIAL / BLOCKED。**

可复核的部分：12 个场景、45 条断言在真实栈上全部通过；桌面 Electron smoke 在默认沙箱下连跑两次通过；B5 的完成定义（聚合可靠 + 不误合并 + 撤回不泄漏 + payload 端到端）四项都有独立证据；P0-A / P0-B 两条派生数据失效路径都已闭环，并有 payload 级正对照。

不可复核的部分：K（真实凭据）与 CI（账号计费）没有任何执行证据；Windows 安装包升级路径未跑；B1 未接管策略、B3 的 `P` 仍为 0。

因此阶段二不构成完整交付，不建议合并。上述阻断项都不是"再写点文档"能消除的。
