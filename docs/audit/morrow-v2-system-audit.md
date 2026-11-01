# Morrow V2 全仓系统审计总报告

> 仓库：https://github.com/ve766/morrow-ai-companion-v2
> 分支：`feat/stage-3-long-term-companion`（PR #19，OPEN，未合并）
> **审计基准 SHA：`43c92813763d9ca3b524d112c231af7f75843a5e`**
> 任务：开发治理重置 / 强制审计门。本轮**只读**：未实现新功能、未改业务代码、未改 schema、未改产品行为、未合并 PR、未发 Release。
> 日期：2026-10-31

---

## 0. 一句话结论

**系统不是「功能不足」，而是「上层建在没有来源的底座上」。**

代码规模与工程质量在同类项目里偏高（33 个迁移、55 张表、16 个触发器、756 条测试、真实授权对话框、真实的删除传播），但**至少 7 项能力在生产环境结构性不可达或不可验证**，而交付文档把它们记为「已实现」。评测层本身存在系统性假阳性，掩盖了其中 5 项。

因此：**NO-GO**——不具备冻结「Stage 3 完成」的条件；但**具备冻结一份「按依赖顺序重排」的开发基准候选版的条件**（见 `docs/governance/morrow-v2-development-baseline-v1.0-candidate.md`）。

---

## 1. 审计基准的可证明性

本地工作副本没有 `.git`（源码经 tarball 取得）。为避免「我审的是不是那个提交」这种不可证声明，做了逐 blob 校验：

| 校验 | 方法 | 结果 |
|---|---|---|
| 文件一致性 | 对远端 tree 每个 blob 重算 `sha1("blob <len>\0"+content)` 并比对 | 远端 496 blob：**473 完全一致**；1 个仅行尾差异（`.ps1` 本地 CRLF，按 LF 归一后 sha 相同 `ce8845ab…`）；22 个本地缺失（均为复跑评测时删除的旧结果文件，远端仍在） |
| 分支 HEAD | `gh api .../branches/feat/stage-3-long-term-companion` | `43c9281`，2026-10-30T14:21:56Z，与任务书一致 |
| 提交链 | `compare/8467079...43c9281` | ahead 12，73 文件 |
| PR 状态 | `gh pr view 19` | OPEN，MERGEABLE，base `feat/stage-2-delivery-hardening`，12 提交 |

**结论：源文件级完全一致。** 唯一差异是行尾，已证明归一后一致。

---

## 2. 系统构成（实测）

| 维度 | 数值 |
|---|---|
| TypeScript 文件（`src`） | 178（其中测试 84） |
| 生产代码行 | 25,462 |
| 测试代码行 | 15,696 |
| 测试 | **84 文件 / 756 用例**（实测通过） |
| 迁移 | 33（`CURRENT_SCHEMA_VERSION=33`） |
| 表 | 55 |
| 触发器 | 24 条语句 / **16 个存活** |
| IPC 通道 | 66（64 invoke + 2 push） |
| 文档 | 46 份 md |
| 评测运行器 | 9 个 ts（stage-2 ×3 + stage-3 ×5 + 主题一致性 ×1） |

领域目录 16 个：`app / cognition / conversation / memory / motivation / self-model / personalization / affective-state / providers / persistence / security / shared / observability / preload / renderer / evaluation`。

---

## 3. 四张真实地图

| 地图 | 文件 | 核心结论 |
|---|---|---|
| 运行时架构 | `docs/architecture/morrow-v2-runtime-architecture.md` | 21 个服务在 `index.ts:183-405` 装配；唯一出网点是 `openai-compatible.ts:269`；11 个 IPC 通道无 renderer 调用方 |
| 认知闭环 | `docs/architecture/morrow-v2-cognitive-loop.md` | 一轮 40+ 步，`prepare` 被调用两次（预览 + 校验）；post-turn 钩子在事务之后，崩溃即丢证据 |
| 数据血缘 | `docs/architecture/morrow-v2-data-lineage.md` | 16 个触发器；删一条消息会删整条兴趣；`interest_evidence` 无外键；4 处「只写不读」/「只读不写」 |
| 能力成熟度 | `docs/audit/morrow-v2-capability-maturity-matrix.md` | M0=2、M1=1、M2=4、M3=6、M4=11、M5=1（n=1）、**M6=0** |

---

## 4. 主要发现

### 4.1 P0（7 项，详见风险登记表）

| # | 发现 | 性质 |
|---|---|---|
| P0-1 | `origin='morrow'` 无生产写入 → 自身兴趣 / 兴趣三分 / 自主探索**三项结构性不可达** | 声称 vs 事实 |
| P0-2 | `companion_goals` 无生产写入 → 目标块永久为空 | 声称 vs 事实 |
| P0-3 | 人格成长的**读路径零断言**；L11 用 0==0 通过 | 验证缺口 |
| P0-4 | 删一条消息删整条兴趣；证据表无外键 → 孤儿行 | 数据正确性 |
| P0-5 | 评测至少 16 条断言可「删功能仍通过」 | 验证有效性 |
| P0-6 | 探索预算在授权拒绝时泄漏 | 逻辑缺陷（潜伏） |
| P0-7 | CI 三个 job `steps=0`，从未启动 | 外部验证缺失 |

### 4.2 三处「看起来完成、实际不成立」

这是本次审计最有价值的部分，因为它们不是明显的 bug：

1. **人格成长**：写入真实（L4 实测 `directness +2.016`），但「成长进入提示词」这条读路径没有任何断言。删掉 `companion-service.ts:1485` 的 `effectiveProfile` 调用，全套评测仍然全绿。
2. **记忆重要度/巩固**：算法、迁移、测试都齐全，但重要度分数**不参与检索排序**（只决定归档），巩固结果**没有任何生产读者**。所以「按重要度衰减与巩固」在产品层面等于不存在。
3. **长期目标**：表、服务、优先级、到期、归属、L10 六条断言都有，但生产代码在类型层面就无法写入这张表。

### 4.3 评测层的系统性问题

| 问题 | 具体 |
|---|---|
| 假阳性断言 | `memoryBlockEmpty` 在标记缺失时返回 `true`；`includes('state')` 被记忆指令里的 "states" 满足；`version >= 1` 恒真；`0 <= 30` |
| 消融循环 | 每个模块只被「测它自己的那个场景」观测，翻转开关只改那一个场景 → 同时证明「该模块对其它 15 个场景无影响」 |
| 装配不一致 | 评测缺真实密钥存储、真实授权对话框、IPC/renderer、任务目标、提醒、备份、启动恢复；多出脚本 Provider、内存密钥、自动同意 |
| 状态相反 | 评测强制认知核心 `enabled:true`，生产默认 `false` |
| 数据集未加载 | `scenarios-v1.json` 声明 v1.3，运行器硬编码 v1；`grep -rn "scenarios-v1" --include=*.ts` 无匹配 |
| 时钟 | 纵向注入（诚实标注 `clock:"injected"`），但 `longitudinal/README.md` 仍写「时钟是真实时钟」——文档与代码相反 |

### 4.4 真实环境验证状态

| 项 | 状态 | 证据 |
|---|---|---|
| 云 Provider | 仅 Spark 一次（`26aeac7`，stage-2 提交，n=1，`auto_approved_harness`，`production_equivalent:false`） | `evals/stage-2/provider/phase24-real-model-26aeac7.json` |
| DeepSeek | **从未真实调用** | 无凭据 |
| 本机 Provider | 真实回环 HTTP，但服务端返回硬编码 `'Local model reply.'` | `local-provider.integration.test.ts:38-80` |
| Ollama / llama.cpp | **未运行** | `evals/stage-2/results/2026-10-29T08-35Z-local-not-run.json` 即 NOT_RUN |
| Electron renderer | 本机沙箱崩溃 `0x80000003`，`--no-sandbox` 可绕过 | 前两轮已两次证伪为环境问题 |
| Windows 安装器 | 无 `release/`、无产物、无升级实跑 | `package.json:45-73` 仅配置 |
| CI | **job 从未启动**（`steps=0`，2 秒结束） | check-runs API |
| 真实时间跨度 | 最长 71 秒（全量测试） | 纵向 5.2s / 重启 1.2s / 长对话 5.1s |

---

## 5. 文档一致性核查

| 文档 | 说法 | 实际 |
|---|---|---|
| `README.md` / `system-overview.md` | 有 `src/personality/` 目录 | **不存在**，人格在 `companion-service.ts:523-623` |
| 测试数 | 五种写法：40/268、82/720、82/726、84/747、84/756 | **84 / 756** |
| 场景数 | 「15 场景 13 PASS / 2 NOT_RUN」与「15 PASS / 1 NOT_RUN」并存 | 分母 **16**，**15 PASS / 1 NOT_RUN** |
| `stage-3-delivery-report.md` §4.1 | 「L10 NOT_RUN」 | 已可执行且 PASS（但靠评测直调） |
| `longitudinal/README.md` | 「时钟是真实时钟」 | 代码注入时钟，结果标 `clock:"injected"` |
| `stage-3-cognitive-runtime.md` | 引用 `:876`、`:1004`、`:1397`、`:1464-1476` | 实际 `:848`、`:957`、`:1147`、`:1470`，普遍漂移 3–140 行 |
| `acceptance-report.md` §3 | smoke 通过 ≥2 次 | `stage-3-delivery-report.md` §5：smoke BLOCKED（渲染进程崩溃） |
| `.github/workflows/ci.yml` | `npm rebuild better-sqlite3`；「v1→v15 upgrade paths」 | 项目用 `node:sqlite`，该步骤是死的；schema 已 v33 |
| `evals/stage-3/scenarios-v1.json` | `datasetVersion: stage-3-v1.3` | 运行器硬编码 `stage-3-v1`，从不读该文件 |

> 这些不是「笔误」，而是**文档在代码变动后没有复核**。任何基于旧文档做出的判断都会偏乐观。

---

## 6. 本轮实际执行的命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | **0** | 无错误 |
| `npx vitest run` | **0** | **84 文件 / 756 测试全通过** |
| `npx electron-vite build` | **0** | main / preload / renderer 全部构建成功 |
| `MORROW_EVAL_SHA=43c9281 npm run eval:stage3` | 0 | **15 PASS / 0 FAIL / 1 NOT_RUN**（分母 16） |
| `... eval:stage3:ablation` | 0 | 4 臂；`no_growth→L4`、`no_exploration→L5`、`no_reflection→L9` |
| `... eval:stage3:longitudinal` | 0 | PASS，7 断言，`clock:"injected"`，240 模拟小时 / 5.2 秒真实 |
| `... eval:stage3:restart` | 0 | PASS，6 断言，`clock:"system"` |
| `... eval:stage3:long-conversation` | 0 | PASS，8 断言，30 轮 / 3 会话 |
| `gh api .../check-runs` | — | 3 个 job，`steps=0`，`conclusion=failure` |

环境：Windows / Node v22.22.2 / `node:sqlite`（ExperimentalWarning 正常）/ registry `registry.npmmirror.com`。

**未运行**：`npm run smoke`（本机渲染进程沙箱崩溃，前两轮已两次证伪为环境问题）、`npm run package:win`（无干净授权机器）、真实 Provider（无凭据）。

---

## 7. 需求处置

Issue #20 正文 10 节 + 4 条补充评论（含治理重置本身）已逐条映射为 KEEP / MERGE / DEFER / REWRITE / DROP：

见 `docs/governance/issue-20-requirement-disposition.md`。

摘要：**KEEP 21 项、MERGE 7 项、REWRITE 9 项、DEFER 6 项、DROP 3 项**。

---

## 8. 结论

### 8.1 关于「Stage 3 是否完成」

**否。** 理由不是「还缺语音」这类功能缺口，而是：

1. 三项被记为已完成的能力（自身兴趣、兴趣三分、自主探索）在生产**结构性不可达**；
2. 长期目标在生产**无法写入**；
3. 人格成长的读路径**没有任何证据**；
4. 评测层会为上述四项出具「PASS」。

在这种情况下说「完成」，等于用假阳性证据覆盖结构性缺失。

### 8.2 关于「是否可以冻结唯一开发基准」

**可以，但必须以本轮的依赖顺序为准，不能沿用 Stage 3 的功能清单顺序。**

当前分支的形态说明：先做上层（成长/探索/目标），后补来源（自身兴趣），导致上层全部悬空。正确顺序是 L0 数据底座 → L1 证据层 → L2 认知读入 → L3 状态层 → **L4 来源分化** → L5 表达层 → L6 真实验证。

### 8.3 GO / NO-GO

| 问题 | 结论 |
|---|---|
| 是否具备冻结「Stage 3 完成」的条件 | **NO-GO** |
| 是否具备冻结「开发基准候选 v1.0」的条件 | **GO（候选）**——需用户与独立审查确认后才可冻结为唯一基准 |
| 是否建议合并 PR #19 | **不建议**。保持 OPEN。它包含真实且有价值的代码（迁移 29–33、触发器体系、授权门、备份恢复），但也有 7 项 P0，其中 5 项是「声称 vs 事实」 |
| 是否建议继续在 Stage 3 上加功能 | **禁止**。先做 L0 + L4 |

---

## 9. 本轮没有做的事（明确边界）

- 没有修任何 P0。任务书要求「若发现必须立即修复的安全/数据完整性 P0，先在报告中隔离并说明影响，不得擅自扩大本轮代码改动」。P0-4 属数据完整性，已在风险登记表中隔离，未动代码。
- 没有创建新 Issue 或新 PR。
- 没有合并、没有 force-push、没有 reset、没有丢弃任何提交。
- 没有把候选基准宣布为最终批准版。
- 没有把 scripted provider 说成真实模型行为，没有把模拟时钟说成真实长期运行，没有把 runner 未分配说成测试通过或代码失败。

---

## 10. 下一步建议（按顺序）

1. **冻结基准**：用户与独立审查确认 `morrow-v2-development-baseline-v1.0-candidate.md`。
2. **L0 修复批**（小、可验收）：`memories.source_message_id`、`interest_evidence` 外键、删除兴趣改为删证据而非删聚合、`deletion_journal` 扩展到兴趣/自我模型/人格/归档。
3. **L4 打通**：让反思产生 `origin='morrow'` 的兴趣（走 `observeMorrow`），并用一个「必须失败」的评测证明它真的进了 payload。
4. **评测去假阳性**：把 16 条同义反复断言改成「删掉功能必须变红」的形式；`memoryBlockEmpty` 改为「标记必须存在且数组为空」。
5. **真实环境**：真实 DeepSeek 小样本（n≥3）、真实本机模型（Ollama）、Electron 干净机 smoke、Windows 安装升级。
6. **只有到这一步**，才谈语音与 M6 长期稳定性。
