# Morrow V2 审计交付报告

> 审计基准：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 分支：`feat/stage-3-long-term-companion`｜PR #19（OPEN，未合并）
> 本轮性质：**只读审计 + 治理基准候选**。未实现新功能、未改业务代码、未改 schema、未合并 PR、未发 Release。

---

## 1. 交付摘要

| 项 | 结果 |
|---|---|
| 审计覆盖 | 16 个领域目录、33 个迁移、55 张表、16 个触发器、66 个 IPC 通道、46 份文档、9 个评测运行器、CI、安装配置、提交历史 |
| 门槛 | `tsc` 0 / `vitest` **84 文件 756 用例** / `build` 0 / 5 套评测全部退出码 0 |
| P0 | **7 项** |
| P1 | 12 项 |
| P2 | 9 项 |
| 能力分布 | M0=2、M1=1、M2=4、M3=6、M4=11、M5=1（n=1）、**M6=0** |
| 需求处置 | KEEP 21 / MERGE 7 / REWRITE 9 / DEFER 6 / DROP 3（合计 46） |
| 新增文档 | 10 份，路径见证据索引 §6 |
| **结论** | **NO-GO（Stage 3 完成）**；**GO（冻结基准候选）** |

---

## 2. 最重要的三个发现

### 2.1 三项能力在生产结构性不可达，但被记为已完成

`origin='morrow'` 的唯一生产者 `observeMorrow()`（`interest-service.ts:309-318`）只有评测在调用；反思路径不传 `origin`，所以落库永远是 `user`。

连锁后果：**Morrow 自身兴趣**（C6）、**兴趣三分**（只有 `user` 可达）、**受约束自主探索**（门禁只接受 `morrow|shared`，恒返回「无候选」）——三项在生产环境永远不会发生。

而交付文档把它们记为「已实现」。这是本轮最大的「声称 vs 事实」差距。

### 2.2 长期目标在生产无法写入

`SelfModelLoopServices.goals` 的类型是 `Pick<CompanionGoalService,'activeForContext'>`（`companion-service.ts:638`），类型层面就排除了 `create`。`goals:create` IPC 指向的是**任务型** `GoalService`。

结果：`companion_goals` 永远为空，提示词里的目标块永远不出现。L10 之所以 PASS，是评测直接调服务。

### 2.3 评测层会为上述缺口出具 PASS

- `memoryBlockEmpty` 在标记缺失时返回 `true` → 删掉整个记忆块，「无记忆不编造」仍然通过。
- L11「重启后人格漂移连续」实测 detail 是 `{"warmth":0,"directness":0,"humor":0}` —— 两侧都是 0，因为它的三句话是裸命令句，成长门禁 abstain。**0 == 0 通过了。**
- 消融的因果关系是**循环的**：每个模块只被「测它自己的那个场景」观测，翻转开关只改那一个场景。

至少 16 条断言属于这一类。

---

## 3. 完成定义自检（对照治理重置 §8）

| 要求 | 状态 | 证据 |
|---|---|---|
| 四张真实系统地图齐全，每个关键节点有源码证据 | **完成** | 3 份架构/血缘文档 + 1 份矩阵；每节带 `文件:行号` |
| 全部核心能力完成 M0–M6 分级，未把模块存在误报为掌握 | **完成** | 25 项能力逐项分级，含「出厂默认有效级别」 |
| PR #19、分支、SHA、CI、测试与历史变更基线可追溯 | **完成** | 证据索引 §1；CI 状态已查明为 `steps=0` |
| Issue #20 正文及所有评论逐条处置 | **完成** | 46 条，KEEP/MERGE/REWRITE/DEFER/DROP |
| 基准候选版可直接指导下一轮，不需再从历史评论拼接任务 | **完成** | 基准 §4 的 L0–L6，每层有进入/退出/回退/禁止 |
| 所有固定交付文件已提交 GitHub，路径准确 | **完成**（见 §7） | 10 份，路径与任务书一致 |
| 未擅自实现新功能、改业务行为、合并 PR、发 Release | **完成** | 本轮唯一改动是新增 10 份文档 |
| 明确给出 GO / NO-GO | **完成** | §6 |

---

## 4. 未完成项（明确挂起，不计入交付）

| 项 | 状态 | 原因 |
|---|---|---|
| 任何 P0 的代码修复 | **未做** | 任务书禁止本轮改业务代码；P0-4 属数据完整性，已在风险登记表隔离并说明影响 |
| 真实 DeepSeek 调用 | **BLOCKED** | 无凭据 |
| 真实本机模型（Ollama 等） | **BLOCKED** | 环境未部署 |
| Electron renderer 启动 | **BLOCKED** | 本机沙箱崩溃 `0x80000003`，`--no-sandbox` 可绕过；前两轮已两次证伪为环境问题 |
| Windows 安装 / 升级 | **BLOCKED** | 无干净授权机器；无 `release/` 产物 |
| CI 执行 | **BLOCKED** | 三个 job `steps=0`，2 秒结束，平台侧未分配 |
| 真实时间跨度（M6） | **NOT_RUN** | 审计轮无法产生；现有最长真实运行 71 秒 |
| 语音 | **NOT_RUN** | 无实现（M0） |

---

## 5. 本轮踩到并记录的坑

1. **「任务已更新」可能在评论里，不在正文。** 本轮再次验证：治理重置写在第 4 条评论（2026-10-31 01:50），正文未变。只 diff body 会漏。
2. **CI 红灯不等于代码失败。** 三个 job 的 `steps` 长度为 0，2 秒结束——是平台侧未分配 runner。既不能写「CI 通过」，也不能写「测试失败」，只能写 BLOCKED。
3. **无 `.git` 时，「我审的是哪个提交」必须可计算。** 用 git blob sha 逐文件比对，473/496 一致，1 个行尾差异，22 个本地缺失（可解释）。
4. **假阳性断言往往长得像正常断言。** `version >= 1`、`0 <= 30`、`includes('state')`——单看每一条都不刺眼，合起来让整套评测失去判别力。
5. **消融的因果可能是循环的。** 如果每个模块只被「测它自己的场景」观测，那么「关掉它只改那一个场景」既证明它有用，也证明它对别处无用。这两件事必须分开表述。

---

## 6. GO / NO-GO

| 问题 | 结论 | 理由 |
|---|---|---|
| 是否具备冻结「Stage 3 完成」的条件 | **NO-GO** | 3 项能力生产不可达、1 项无法写入、1 项读路径零证据，而评测为它们出具 PASS |
| 是否具备冻结「开发基准候选 v1.0」的条件 | **GO（候选）** | 四张地图齐全、能力已分级、需求已处置、依赖顺序已明确；需用户与独立审查确认后才可冻结 |
| 是否建议合并 PR #19 | **不建议** | 含真实有价值的代码（迁移 29–33、触发器体系、授权门、备份恢复），但有 7 项 P0，其中 5 项是「声称 vs 事实」 |
| 是否建议继续在 Stage 3 上加功能 | **禁止** | 先做 L0 + L4 |

---

## 7. 交付文件

全部位于审计分支，路径与任务书 §6 一致：

| # | 文件 |
|---|---|
| 1 | `docs/audit/morrow-v2-system-audit.md` |
| 2 | `docs/architecture/morrow-v2-runtime-architecture.md` |
| 3 | `docs/architecture/morrow-v2-cognitive-loop.md` |
| 4 | `docs/architecture/morrow-v2-data-lineage.md` |
| 5 | `docs/audit/morrow-v2-capability-maturity-matrix.md` |
| 6 | `docs/audit/morrow-v2-risk-dependency-register.md` |
| 7 | `docs/governance/morrow-v2-development-baseline-v1.0-candidate.md` |
| 8 | `docs/governance/issue-20-requirement-disposition.md` |
| 9 | `docs/reports/morrow-v2-audit-evidence-index.md` |
| 10 | `docs/reports/morrow-v2-audit-delivery-report.md`（本文件） |

---

## 8. 下一步建议（按顺序）

1. **确认基准**：用户 + 独立审查确认 `morrow-v2-development-baseline-v1.0-candidate.md`；未确认前不冻结。
2. **L0 第一批**（最小、可独立验收、风险最低）：迁移 34（`memories.source_message_id`、`interest_evidence` 外键、`UNIQUE` 收窄、`deletion_journal` 扩展）+ 触发器修正（删消息删证据而非删聚合）+ 4 类反向测试。
3. **L1**：证据契约 + 时间衰减 + 提交后崩溃的证据补偿。
4. **L4**：反思 → `observeMorrow()`，并配一个「关掉反思，Morrow 兴趣必须消失」的消融。
5. **评测去假阳性**：16 条同义反复断言改为「删功能必须变红」。
6. **L6**：真实 DeepSeek（n≥3）、真实本机模型、干净机 smoke、Windows 安装升级、≥7 天真实运行。
7. 只有到这一步，才谈语音与 M6。

---

*本报告不宣布任何能力已完成。它只声明：在当前代码事实上，哪些说法成立、哪些不成立、以及正确的下一步是什么。*
