# Phase 2.2.10 — 最终记忆可靠性修复与端到端验收

## A. 基线

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 工作副本 | `E:/opencode/morrow-v1-fix-v0.1` |
| 起始分支 | `fix/phase-2.2.9-memory-reliability-hardening` @ `34cb660` |
| 本轮分支 | `fix/phase-2.2.10-memory-trust-hardening` |
| base | PR #7 分支（`fix/phase-2.2.9-memory-reliability-hardening`） |
| 起始工作区 | 干净，无未提交改动 |
| 迁移版本 | v22 → **v24**（v23 由上一轮引入） |

PR 依赖链（2026-10-28 实测）：

| PR | 状态 | head | base |
|---|---|---|---|
| #4 | OPEN（非 draft） | `25e8000` | `feat/phase-2-companion-core` |
| #6 | OPEN / Draft | `dca6486` | `feat/phase-2.2-memory-reliability` |
| #7 | OPEN / Draft | `34cb660` | `fix/memory-reliability-v0.1` |

**与任务书记录的差异**：任务书把 `dca6486` 记为「PR #7 HEAD」，实际它是 **PR #6 的 head**，也是 PR #7 的 base；PR #7 当前 head 是 `34cb660`。本轮以 `34cb660` 为基线，依赖关系不变（#7 → #6 → #4）。

## B. 缺陷清单

### P1-1（高）旧候选的 `correction_target_revision` 是迁移时的猜测

- 位置：`src/persistence/migrations.ts` v23、`src/app/companion-service.ts` `review()`
- 根因：v23 用 `SELECT m.revision` 把迁移时刻的目标版本写进旧候选。该数字从未被候选记录过。若候选创建时目标是 revision 1、等待期间变成 revision 2，迁移会把候选标成「针对 revision 2 创建」，接受时版本校验直接通过，等于把猜测当成历史。
- 修复前：旧候选迁移后获得「已核对版本」的外观，可覆盖更新的记忆。
- 修复后：
  - v24 对 v23 之前创建的候选 `correction_target_revision = NULL` 且 `correction_binding = 'unverified'`；
  - 接受路径先判 `binding`，`unverified` → `CONFLICT` + `correction_rejected:binding_unverified`，候选保持 pending，不写入、不降级为新增；
  - 领域层 `validateCorrectionTarget` 对 `expectedRevision === null` 返回 `revision_unproven`（纵深防御，避免任何调用方把「未知」当「匹配」）；
  - v23 之后创建的候选写入 `correction_binding = 'recorded'`，保持可校验。
- 回归测试：`tests/acceptance/schema-recovery.test.ts`（v22→v24 绑定失效、v23 后候选保留 recorded、二次启动稳定）、`src/app/memory-correction-hardening.integration.test.ts`（绑定不可验证时拒绝、新候选记录 revision）。

### P1-2（高）事实属性过粗，同族不同事实可互相覆盖

- 位置：`src/memory/memory-domain.ts` `classifyFactAttribute`、`src/memory/memory-formation-domain.ts` `validateCorrectionTarget`
- 根因：`identity` 同时覆盖姓名/生日/年龄，`project_code` 与项目名称共用一档。只比较宽泛类别时，「我叫小王」可以被「我今年 30 岁」覆盖。
- 修复前：`identity === identity` 即放行。
- 修复后：属性拆为 `name / birth_date / age / residence / employer / job_role / study_topic / preference / project_name / project_code / relationship / health_fact / goal`，比较精确到槽位；无法识别属性时退回共享证据（≥2 显著词），仍不满足则拒绝。
- 新增时间轴判定 `classifyTemporalReference`：历史↔当前的时间语义翻转（「我以前住在大阪」→「我现在住在京都」）拒绝为 `temporal_mismatch`，避免把历史事实改写为当前事实或反向抹掉历史。
- 新增非断言判定：假设、条件、引用、明确不确定（`如果/假设/要是/可能/不确定/听说/「」`）→ `not_an_assertion`。
- 新增纯否认判定：单值属性上只否定旧值而不给新值（「我不再住在大阪」）→ `negation_mismatch`，提示改用撤回；偏好类豁免，因为「我不喜欢摄影」本身就是一个取值。
- 回归测试：`src/memory/memory-formation-domain.test.ts`（任务书 9 行对照表 + 第三人称/引用/条件/假设/不确定/纯否认）、`memory-correction-hardening.integration.test.ts`（姓名记录被年龄语句改写时拒绝；同槽位改名成功且旧值进历史）。

### P1-3（中高）迁移回填的敏感度被当作真实历史

- 位置：`src/persistence/migrations.ts` v23/v24、`src/persistence/memory-repository.ts`、`src/memory/memory-timeline.ts`
- 根因：v23 把记忆「当前」敏感度复制进所有旧修订。该值可用于保守过滤，但不能证明当时记录的级别。
- 修复前：`memory_revisions.sensitivity` 无来源标记，审计界面无法区分记录值与推测值。
- 修复后：新增 `sensitivity_source`（`recorded` / `inferred_backfill`）；v23 之前创建的修订标记为 `inferred_backfill`，之后由代码写入的修订为 `recorded`；`MemoryRevisionRecord`、时间线条目、`memory.history` IPC 均携带来源。过滤仍用记忆当前敏感度，推测值**只用于安全过滤，不作为历史证据**，因此不存在「因推测不完整而降低保护」。
- 回归测试：`schema-recovery.test.ts`（v22→v24 回填来源、v23 后为 recorded、备份/恢复后来源一致）、`memory-timeline.test.ts`（推测值保持标注）、`memory-correction-hardening.integration.test.ts`（更正路径两次修订均为 recorded）。

### 复核 2.2.9 已有修复（未破坏）

| 链路 | 证据 |
|---|---|
| 审核时重新验证目标 | `memory-correction-hardening` 8 条原有用例全部保留并通过 |
| 目标修改/撤回/删除时拒绝 | `target_changed` / `target_inactive` / `target_missing` 用例 |
| 普通陈述不误触发更正 | 8 行分类矩阵（`memory-formation-domain.test.ts`） |
| 敏感度在新增/更正/修订中一致 | 上调保留、显式降级拒绝、未选择时按上限升级 |
| 中文检索不靠字符重叠 | `memory-context-assembler.test.ts` 23 条，含弱二元组反例 |
| continuity 不复活撤回/无关记忆 | `never revives a retracted or still-sensitive record` |
| 冲突在请求中显式标记 | `unresolvedConflicts` 双值用例 + payload 审计 |
| 无相关记忆允许空结果 | `does not inject unrelated recency-only memories` |
| 重复提交/事务失败/并发 | 二次接受只产生一次修订；`rolls back state changes when revision insertion fails` |

未删除、未跳过、未弱化任何 2.2.9 用例。唯一改动的旧断言是 `memory-formation.integration.test.ts` 中「现在住=更正」的期望，那正是 P1-B 缺陷本身，已在 2.2.9 报告中记录。

## C. 数据迁移

**v24 `correction-binding-and-sensitivity-provenance`**

```sql
ALTER TABLE memory_suggestions ADD COLUMN correction_binding TEXT NOT NULL DEFAULT 'recorded'
  CHECK (correction_binding IN ('recorded','unverified'));
UPDATE memory_suggestions
  SET correction_binding='unverified', correction_target_revision=NULL
  WHERE correction_target_id IS NOT NULL
    AND created_at < COALESCE((SELECT applied_at FROM schema_migrations WHERE version=23), '9999');
ALTER TABLE memory_revisions ADD COLUMN sensitivity_source TEXT NOT NULL DEFAULT 'recorded'
  CHECK (sensitivity_source IN ('recorded','inferred_backfill'));
UPDATE memory_revisions SET sensitivity_source='inferred_backfill'
  WHERE created_at < COALESCE((SELECT applied_at FROM schema_migrations WHERE version=23), '9999');
```

- 只增列 + 定向 UPDATE，不重建表、不删数据、不改记忆正文。
- 历史不确定数据：旧候选**失去自动接受权**（需重新提出更正），旧修订敏感度**标为推测**。二者都不再被当作已核实事实。
- 重复启动：`schema_migrations` 记录使 v24 只执行一次，二次打开不改绑定（测试覆盖）。
- 备份/恢复：`keeps sensitivity provenance across a backup and restore` 证明来源标记随备份往返。
- 回滚：无破坏性变更，回退代码即可；旧版本打开 v24 会按既有 fail-closed 行为拒绝，不会静默降级。

## D. 测试结果

命令均在本轮分支执行，代码 SHA `a68b52b`（干净工作区）。

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 通过 |
| 全量单测/集成 | `vitest run` | **674 / 674**，65 文件 |
| 迁移/恢复验收 | `vitest run tests/acceptance/schema-recovery.test.ts` | 13 / 13 |
| 构建 | `electron-vite build` | 通过（main / preload / renderer） |
| 离线评估 | `npm run evaluate` | 通过，precision 1.0 / recall 1.0，0 泄漏 |
| 认知评估 | `npm run evaluate:cognition` | 三套数据集 gate 全过 |
| 陪伴核心 | `npm run evaluate:companion` | 31 / 31 |
| 上下文记忆 | `npm run evaluate:context` | **23 / 23**，94 条断言 |

失败与重试：首次全量运行 3 条失败，原因是新增能力项后 v1/v2 数据集未覆盖（不是实现缺陷），补齐 `b11-sensitive-ceiling` 用例后全绿；无跳过、无降低断言。CI 结果见 PR #8。

新增/修改测试统计：+40（领域 32 条中新增 12 条对照 + 6 条边界）、集成 +4、迁移 +2、备份 +1、时间线 +1、评测数据集 +1 用例（v1/v2 各一条）。

## E. 真实模型实验

- 模型：`qwen2.5:0.5b`（本地 Ollama，`http://127.0.0.1:11434/v1`，`modelInCatalog=true`）
- 数据：`evaluation/fixtures/memory-pipeline-a4b-v1.json`（A4 十场景原样 + 新增 `a4-sensitive-boundary`）
- 重复：5 轮 × 11 场景 = **55 个场景-运行单元**，代码 SHA `a68b52b`，`codeState=clean`
- 原始结果：`evaluation/reports/a4b-clean-run{1..5}.*.json`

| 场景 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 同会话过敏 | U | P | F | F | F |
| 跨会话代号 | P | F | F | F | F |
| 更正大阪 | P | P | P | F | F |
| 旧城市不当当前 | F | F | P | P | P |
| 冲突披露 | F | U | F | F | U |
| 撤回不使用 | U | U | U | U | U |
| 无记忆不编造 | U | U | U | U | U |
| 无关问题 | U | U | U | U | U |
| 主体归属 | P | F | F | F | F |
| 长对话更正 | F | F | F | F | F |
| 敏感度边界 | U | U | U | U | U |

P=pass, F=fail, U=uncertain。合计 **9 pass / 23 fail / 23 uncertain**。

| 指标 | 本轮（11 场景×5） | 上一轮 A4（10 场景×5） |
|---|---|---|
| Payload 投递率（需要记忆的场景） | **100%**（`notDelivered=0`，5/5 轮） | 100% |
| 模型正确使用率 | 9/55 = 16% | 10/50 = 20% |
| 更正遵循率 | **3/5** | 3/5 |
| 冲突披露率 | **0/5** | 0/5 |
| 长对话更正 | 0/5 | 0/5 |
| 历史事实误用（旧值当当前） | 3/5 正确，0 次泄漏旧值 | 3/5 |
| 撤回事实泄漏率 | **0/5** | 0/5 |
| 敏感记忆越权投递 | **0/5** | 未覆盖 |
| Uncertain 比例 | 23/55 = 42% | 20/50 = 40% |

解读（必须一起读）：

- **投递层全部正确**：5 轮 `notDelivered=0`，冲突场景两条值都进入 `unresolvedConflicts`，敏感场景 0 次进入请求，撤回场景 0 次进入请求。
- **失败几乎全部归因 MODEL**：5 轮 `deliveredButNotUsed` 为 2/4/4/3/4，`ruleNotSatisfied=0`（无一条是装配或规则问题）。典型输出：被问「我住哪」答「你住在北京」、被问冲突时只挑一边、长对话里把已知值丢掉。
- 0.5B 模型不具备稳定使用上下文的能力，本轮**不能**据此声称认知可靠性达标；这属于模型能力限制，不是检索或 payload 缺陷。
- 与上一轮相比，10 个共有场景从 10 pass 变为 9 pass，差异在噪声范围内（同一模型同一数据的逐轮波动为 ±3），不作为能力提升或退化的证据。

## F. 剩余风险

1. **模型能力**：0.5B 本地模型在更正遵循、冲突披露、长对话保持上均不可靠；需要更强且已授权的模型才能评估产品级表现，本轮未做。
2. **属性分类仍是规则**：`employer` 与 `job_role`、`preference` 与 `interest` 靠顺序匹配；`interest` 被并入 `preference`（拆开会产生误拒且不增加安全）。无法识别的句子退回共享词证据，可能放过语义相近但槽位不同的更正。
3. **纯否认检测是启发式**：只对单值属性生效，判定依据是「去掉否定词后是目标文本的子串」。复杂句式（「我不是说我不在大阪」）可能漏判或误判，方向偏向拒绝，不会静默覆盖。
4. **旧候选需要重新表达**：迁移后 `unverified` 候选只能拒绝或撤回，用户要重新说一次更正。这是安全取舍，不是缺陷，但会造成一次交互成本。
5. **敏感度推测值**：`inferred_backfill` 只是保守过滤值，不能用于回答「当时是什么级别」；报告与界面必须始终标注来源。
6. **无人工复核**：评测器一致率仍无人工抽样数据；本轮所有结论均为自动测试与自动判定结论。
7. **评测数据集新增用例**：v1/v2 各加一条 `b11-sensitive-ceiling`（+40 行，无删改），历史报告文件未改动。

## G. 结论

**PASS_WITH_LIMITATIONS**

- 工程验收项均有证据：三个 P1 缺陷已复现、修复并被回归测试锁定；迁移、重复启动、备份恢复、事务回滚均验证；全量 674 条测试与四个离线评估通过。
- 非阻塞限制已明确记录：真实模型（0.5B）能力不足，冲突披露 0/5、长对话更正 0/5，payload 正确但模型不用；属性分类与否认检测仍是确定性启发式；无人工复核。
- 未做：合并、发布、改 `main`、付费云调用、引入研究算法包、大规模重构。
