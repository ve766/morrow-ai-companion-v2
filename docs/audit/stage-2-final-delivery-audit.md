# Stage 2 最终交付审计

| 项 | 值 |
|---|---|
| 审计时间（UTC） | 2026-10-30T06:10:43Z 起（验证批次见 §6） |
| 执行者 | 交付 Agent（WorkBuddy），受 issue #17 评论 6516147709 指派 |
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 分支 | `feat/stage-2-delivery-hardening` |
| 被审 HEAD | `42a51e075af8a8ce9628c87490c37df8c92b7580` |
| PR | [#15](https://github.com/ve766/morrow-ai-companion-v2/pull/15)（OPEN，未合并） |
| 环境 | Windows 10.0.26200（MINGW64）、Node v22.22.2 |
| 结论 | **PARTIAL** |

本审计只核实事实、修正文档口径、标注未关闭项。不合并、不改 main、不发版、不新增功能、不删除历史结果。

---

## 1. 审计范围与方法

1. 从远端拉取分支，记录 `git status --short`（干净）、`git rev-parse HEAD`、`git branch --show-current`、PR #15 HEAD，确认三者一致。
2. 逐份打开 7 份交付/审计/算法文档，对每条关键结论追到原始证据（源码、测试、结果 JSON、CI run），不复制旧结论。
3. 对「文档声称」与「证据实际内容」做交叉核对，发现冲突即修正，并记录在本文件 §3。
4. 在**干净工作区**（`dirty_at_start=0`）上重跑全部命令，逐条记录命令、起止 UTC、退出码、HEAD、Node/OS、结果文件路径（§6）。
5. 枚举评测结果 JSON 里**实际存在的场景 ID 与断言数**，不沿用"12 个场景"这种整体措辞。

---

## 2. 逐项状态

状态口径：PASS = 有可复核证据且行为符合断言；PARTIAL = 部分接通或证据不完整；BLOCKED = 外部条件导致无法执行；NOT_RUN = 从未执行。

### 2.1 评测运行器（离线，脚本化 Provider）

| 项 | 状态 | 证据 |
|---|---|---|
| 12 个可执行场景 A/B/C/D/E/F/G/H/I/J/B4/B5 | **PASS** | `evals/stage-2/results/2026-10-30T06-12-40-42a51e0.json`（`headSha=42a51e0`）：`executed 12 / passed 12 / failed 0 / blocked 2 / notRun 0`，45 条断言 |
| K（真实 Provider 场景） | **BLOCKED（设计如此）** | 运行器固定脚本化 Provider（`providerMode: "scripted"`），无法承载真实模型；真实覆盖见 2.5 |
| L（桌面渲染场景） | **BLOCKED（运行器内）** | 离线运行器托管不了 GUI 进程；桌面覆盖见 2.6 |

**"12/12" 的确切含义**：12 个**可执行**场景全部通过；K、L 两个场景各 0 条断言、状态 `BLOCKED`，**未计入通过**。场景数不等于算法模块数——B1 至今未接线（§2.2）。

### 2.2 B1–B5

| 项 | 状态 | 证据与边界 |
|---|---|---|
| B1 意图置信度 | **PARTIAL / PENDING PRODUCT DECISION** | 已计算并随分析返回（`intent-confidence.ts`、`cognitive-turn-analyzer.ts`），**未影响任何决策**。三次接线尝试（clarify、检索收窄、排除探索后再收窄）全部实测回退：`uncertain→clarify` 使标注语料 strategyAccuracy 1.000→0.885（23/26）；收窄检索会误伤首轮清晰问句（同一句 `我住在哪里？` 首轮 0.780 / 有上文 0.947，差值全来自 `history` 分量）。测量钉在 `cognitive-turn-analyzer.test.ts` |
| B2 人格稳定 | **PASS** | `personalization-service.ts` + 迁移 22；场景 E 4/4（4 轮情绪/反馈后版本与数值不变、无静默修订、载荷文案逐轮一致）；`personalization-service.test.ts` 13 条 |
| B3 上下文效用 `U(c)` | **PASS（P/X/D 全部接线）** | `context-utility.ts` → `memory-context-assembler.rankScore`。P：`personalizationFit`（记忆文本命中 depth/pace/exploration 关键词 → 该维度距 0.5 的距离）；X：`MemoryService.conflictedIds`（候选集内措辞重叠）；D：未确认且 > `STALE_UNCONFIRMED_DAYS=120` 的线性陈旧度。证据：`memory-context-assembler.test.ts` 7 条（含 3 条排序断言）、`personalization-service.test.ts` 中 `personalizationFit` 2 条 |
| B4 轮次状态机 | **PASS（9 个状态均有写入点）** | `companion-service.ts` `recordTurnState`：`received` / `analyzed` / `context_ready` / `awaiting_consent` / `requesting` / `response_received` / `committed` / `failed` / `cancelled` / `recovery_required`。`turn-state-sequence.integration.test.ts` 3 条：成功轮次 7 步序列、失败轮次止于 `failed`、`recovery_required` 两条合法入边 |
| B5 反思→下一轮 payload | **PASS** | 场景 B5 5/5；`topic-identity.ts` 匹配器；`topic-identity.test.ts` 12 条；开发集 26 对 P 1.000 / R 0.889（§2.4） |

**B3 的 `P` 说明**：它是窄映射——只有明确提到交互维度的记忆才拿分，未提到的恒为 0。这不是"完全偏好匹配"，是"记忆是否在讲某个已被个性化的维度"。**不能**据此宣称模型理解用户偏好。

### 2.3 记忆证据与反转（P0-A / P0-B）

| 项 | 状态 | 证据 |
|---|---|---|
| 记忆 retract/delete/correct → 兴趣证据失效 | **PASS** | 迁移 25（`evidence_revision` + 3 个触发器）；`interest-invalidation.test.ts` 9 条（retract / hard delete / correct 且 confirm 不误删 / 重启 / 备份快照）；`migrations.test.ts` v24→v25 升级 |
| payload 级无泄漏 | **PASS** | `interest-payload-invalidation.integration.test.ts` 2 条：撤回前正对照含该兴趣 id，撤回后不含；反转后不含、重新喜欢后又出现 |
| 反转改变兴趣状态 | **PASS** | `interest-service.ts` `evaluate`/`derivedStatus`；`effectiveSupport = max(0, support − 末次支持后的 counter)`；4 条反转用例 |

### 2.4 主题同一性开发集

**PASS（小样本）**：26 对人工标注，`headSha=42a51e0`，`evals/stage-2/results/topic-identity-devset-report.json`。

```
precision 1.000  recall 0.889  FP 0  FN 1  ambiguous 4
混淆矩阵：same->same 8  same->different 1  different->same 0  different->different 17
```

唯一漏判 `p03`（`我在学手冲咖啡` / `最近一直在练手冲`）是召回损失，不是误合并。**26 对是小规模开发集，不得据此宣称已校准或可泛化。**

### 2.5 真实 Provider（S1–S6）

**PASS WITH LIMITATIONS**。原始报告：`evals/stage-2/provider/phase24-real-model-26aeac7.json`（模型 `spark-x2.6`，生成于 `codeSha=26aeac7`，1 次/场景）。

| 场景 | 状态 | 断言 |
|---|---|---|
| S1 跨轮偏好 | PASS | 2/2 |
| S2 撤回 | PASS | 3/3 |
| S3 无证据 | PASS | 2/2 |
| S4 模型切换 | **SKIPPED** | 只有单一模型 id，无法演示切换 |
| S5 状态影响 | PASS | 3/3 |
| S6 失败重试 | PASS | 3/3 |

合计 13/13 客观断言、errors 0。**不是 6/6**：S4 为 SKIPPED。**不是成功率**：每场景 1 次。

### 2.6 桌面（Electron）

**PASS**。`npm run smoke` 在**默认沙箱**（未设 `MORROW_SMOKE_DISABLE_SANDBOX`）下通过，记录在 `evals/stage-2/results/verify-42a51e0-061042.txt`。覆盖 built app、凭据加密保存/重启/删除、认知默认关与显式开启、记忆生命周期、目标与审批、提醒控制、删除与重启校验。

### 2.7 Windows：schema 升级 vs 安装器升级

| 项 | 状态 | 说明 |
|---|---|---|
| schema/migration 测试 | **PASS** | win32 上 `npx vitest run src/persistence` 57/57（即 CI `windows-install-path` job 的同款命令）；含 v1→v25 升级路径与 v24→v25 |
| **安装器升级**（旧安装包 → 新安装包） | **BLOCKED / NOT VERIFIED** | 从未在本机安装过安装器，也没有旧版→新版的覆盖升级验证。schema 测试**不能**替代它 |

### 2.8 消融

**PASS（4/4 执行）**：`evals/stage-2/ablation/results/2026-10-30T06-12-49-42a51e0.json`。

| 臂 | 观察 |
|---|---|
| `full` | 个性化块 3/4 轮；记忆顺序（夹具下标）`[3,2,0]`；反思运行 4 次 |
| `no_personalization` | 个性化块 0/4 轮；载荷少 242 字节 |
| `no_context_utility` | 记忆顺序 `[2,0,3]`（陈旧记录按相关度排到最前） |
| `no_reflection` | 反思运行 0 次；**注意力块两臂均为 0** |

**`no_reflection` 的能力边界**：该臂证明了"关掉反思后反思不再运行"，但在这 4 轮输入上**没有产生任何 payload 差异**（`attentionBlockTurnsFull=0`、`attentionBlockTurnsOff=0`，`contextUtilityPayloadBytesDelta` 全 0）。因此它**不能**证明"反思提升回复质量"，也不能证明"反思对下一轮无影响"——只证明在这份输入上没有可观测差异。

### 2.9 CI

**BLOCKED**。

- 最新 run：[41010305777](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/41010305777)，`head_sha=67f2a37`，`conclusion=failure`
- 三个 job 全部 `runner_id=0`、`steps=0`、`conclusion=failure`
- check-run 注解原文：**"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"**
- 自托管 runner：`total_count=0`

**不计通过，也不计失败**：没有任何步骤执行过。workflow 配置本身不阻止调度（`runs-on: windows-latest / ubuntu-latest`，标准 action）。

---

## 3. 口径冲突与修复记录

| # | 冲突 | 核实结果 | 处理 |
|---|---|---|---|
| 1 | "A–L 12/12、45 assertions、NOT_RUN 0" vs "K/L 可能 BLOCKED" | 两者都对但措辞误导：结果 JSON 为 `executed 12 / passed 12 / blocked 2`，K、L 各 0 断言且 `BLOCKED` | 所有文档改为"12 个**可执行**场景全部 PASS；K、L BLOCKED 未计入"，并新增 §2.1 的场景清单 |
| 2 | "Windows 57/57" vs "安装器升级未验证" | 57/57 是 `npx vitest run src/persistence`（schema 测试） | 文档拆成两行：schema PASS、安装器 BLOCKED / NOT VERIFIED（§2.7） |
| 3 | `evaluation/reports/phase24-real-model-26aeac7.json` 访问 404 | **报告从未提交**：`.gitignore:18 evaluation/reports/*` 把脚本输出目录整体忽略，文件一直只在本地 | 逐字节复制到 `evals/stage-2/provider/phase24-real-model-26aeac7.json`（SHA-256 校验一致）+ README；文档引用全部改指向新路径。生成脚本输出路径未改，后续运行需手动复制 |
| 3b | 同一类问题第二次出现：验证日志 `verify-…-061042.log` 也被 404 | `.gitignore:5 *.log` 忽略所有日志文件 | 日志改名为 `.txt`（不受忽略），文档引用同步；验证脚本改为写 `.txt`。**教训：引用任何证据文件前先用远端 API 确认存在，不能只看本地 `ls`** |
| 4 | PR HEAD / 评测 JSON `headSha` / 消融 JSON `headSha` 三者不同 | 结果在 `42a51e0` 生成（干净树），PR HEAD 随后多一个"提交结果"的提交 | 文档新增 SHA 口径表，逐份说明"结果生成 SHA"与"当前 HEAD"的区别；旧 SHA 结果保留不覆盖 |

另修正两处此前审计已发现但我自己写错的事实：

- **桌面"渲染沙箱不可用"是错的**：当初只测了 `--no-sandbox` 崩溃路径。默认沙箱下 `npm run smoke` 通过。
- **"网关要 HMAC 签名"是错的**：是我把密钥当位置参数传给 node，实际发出 `Bearer undefined`，才看到 401 `apikey not found`。正确传参后 200。

---

## 4. 剩余风险

| 编号 | 风险 | 影响 | 现有缓解 |
|---|---|---|---|
| R1 | B1 未接线：低置信度不会触发澄清或降级 | 模糊轮次直接按最可能标签执行 | 已量化（三次尝试 + 分布测量），待产品决策 |
| R2 | B3 的 `P` 是窄映射（关键词 → 维度距离） | 未提到维度词的偏好类记忆不获加成 | 恒 0 行为有测试；文档明示边界 |
| R3 | 主题匹配的框架字符集是人工封闭列表 | 新句式框架可能被当成共享内容（精度风险） | 场景 G + 3 对框架样本盯住 |
| R4 | 开发集只有 26 对 | 指标不具统计意义 | 标注为"小规模开发集" |
| R5 | 真实 Provider 每场景 1 次 | 只能证明行为发生，不能估成功率 | 报告明示；脚本支持 `MORROW_REAL_RUNS` |
| R6 | 消融 `no_reflection` 无可观测 payload 差异 | 不能据此断言反思的收益 | 报告如实写"未见差异" |
| R7 | CI 无执行证据 | 合并后无法确认 CI 会绿 | 本地跑同一批命令作为替代证据，并标注差异 |
| R8 | 安装器升级未验证 | 升级用户可能遇到迁移问题 | 进程内 v1→v25 已测，安装器层未覆盖 |
| R9 | 旧库行的 `evidence_revision` 为 NULL | 任何一次措辞修订会清掉它 | 升级不降级既有兴趣；新证据全部带修订号 |

---

## 5. 未关闭事项（不得由本任务自行裁决）

| # | 事项 | 状态 | 解除条件 |
|---|---|---|---|
| 1 | B1 意图置信度 | **PARTIAL / PENDING PRODUCT DECISION** | ①提供标注数据（哪怕几十条"该不该追问"）以重定分量并重标定；或 ②产品负责人明确批准将 B1 移出阶段二范围。**本任务不删除该范围，也不宣称完成** |
| 2 | CI | **BLOCKED** | 账号账单/额度恢复。恢复后需重跑并附 steps/logs |
| 3 | Windows 安装器升级 | **BLOCKED / NOT VERIFIED** | 需要授权在干净机器上执行：安装旧版 → 覆盖安装新版 → 启动 → 数据保留验证 |
| 4 | Provider S4 | **SKIPPED** | 需第二个模型 id（`MORROW_SPARK_MODEL_2`）才能演示跨模型切换 |
| 5 | 消融 `no_reflection` | **PASS（执行）但无 payload 差异** | 需构造能产生可晋升兴趣的输入，才能观察反思对载荷的影响 |

---

## 6. 验证批次（干净工作树，`dirty_at_start=0`）

日志：`evals/stage-2/results/verify-42a51e0-061042.txt`（含每条命令的起止 UTC 与退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --maxWorkers=2` | 0 | 75 files / 659 tests passed |
| `npm run build` | 0 | — |
| `npm run eval:stage2` | 0 | 12 executed / 12 passed / blocked 2 / notRun 0 → `results/2026-10-30T06-12-40-42a51e0.json` |
| `npm run eval:topic-identity` | 0 | P 1.000 / R 0.889（26 对）→ `results/topic-identity-devset-report.json` |
| `npm run eval:ablation` | 0 | 4 臂 → `ablation/results/2026-10-30T06-12-49-42a51e0.json` |
| `npm run smoke` | 0 | Electron 默认沙箱通过 |

真实 Provider 单独运行（需凭据，未在本批次内）：`evals/stage-2/provider/phase24-real-model-26aeac7.json`，生成于 `codeSha=26aeac7`。

---

## 7. 结论

**PARTIAL。**

理由：阶段二的核心行为（记忆证据失效、反转状态、B5 payload 闭环、B2/B3/B4 接线、12 个可执行场景、四组消融、真实 Provider、桌面）都有可复核证据；但 **B1 未接线且需产品决策**，且 **CI 与安装器升级无执行证据**。

**是否建议合并 PR #15：不建议。**

不是因为代码有已知缺陷，而是因为：①B1 是阶段二范围内的算法项，尚未完成，需产品负责人裁决；②CI 从未真正执行，合并后无法确认流水线健康；③安装器升级路径未验证。三项都不是本任务能单方面关闭的。

关闭路径：产品决策（B1）+ 账单恢复（CI）+ 一次授权安装器升级验证。
