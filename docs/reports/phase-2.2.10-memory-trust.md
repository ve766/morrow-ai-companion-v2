# Phase 2.2.10 — 最终记忆可靠性修复与端到端验收

## A. 基线

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 工作副本 | `E:/opencode/morrow-v1-fix-v0.1` |
| 起始分支 | `fix/phase-2.2.9-memory-reliability-hardening` @ `34cb660` |
| 本轮分支 | `fix/phase-2.2.10-memory-trust-hardening` |
| 本轮 head | `2bce65b`（代码 + 界面提示）；报告提交见 PR #8 |
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

本轮共修复 6 个缺陷：P1-1/2/3 为首次交付内容（SHA `48697e2` 之前），P1-4/5/6 为本轮按最新审查补充。每条都先写复现测试、确认失败，再改实现。

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

### P1-4（高）未知事实属性仍用共享关键词放行

- 位置：`src/memory/memory-formation-domain.ts` `sharesFactAttribute` / `canTargetCorrection` / `validateCorrectionTarget`
- 根因：属性识别失败时（`classifyFactAttribute` 返回 `null`），三个函数都退回到「共享 ≥2 个显著词」。而词面重叠恰恰是最容易被误导的信号：「我养了一只叫咪咪的猫」与「我养了一只叫花花的猫」几乎逐字相同，描述的却是不同的值。
- 修复前：属性未知的两句话只要词面重叠就被视为同一事实，可以互相更正。
- 修复后：任一侧属性未知即返回 `false` / `attribute_mismatch`，detail 为 `The fact attribute cannot be reliably established; manual review is required.`。属性相同也只是必要条件，主体、时间、否认、revision、敏感度校验全部保留。
- 回归测试：`memory-formation-domain.test.ts` 新增 5 条（词面重叠不绑定、已知同槽仍绑定、已知异槽仍拒绝、未知属性接受时拒绝、已知同槽正常更正）。反例先经真实分类器验证为 `null`，未凭猜测构造。

### P1-5（高）无目标的更正候选被静默创建为新记忆

- 位置：`src/app/companion-service.ts` `review()`、`src/renderer/src/companion-ui.ts`
- 根因：`review()` 只在 `correction_target_id !== null` 时校验；为 `null` 时直接走 `create()`。于是 `candidate_kind='correction'` 但从未绑定目标的候选（属性无法识别、或目标被删除后外键置空）会被保存成一条全新记忆——既不是更正，也没有经过目标校验。
- 修复前：接受这类候选会新增记忆并标记 `accepted`。
- 修复后：`correction` 且无目标 → `CONFLICT` + `correction_rejected:target_missing`，候选保持 pending，不写入任何记忆；界面禁用保存并说明「没有对应的原记忆」。拒绝/撤回仍然可用。
- 回归测试：`memory-correction-hardening.integration.test.ts` 新增 3 条（无目标候选被拒且不写入、目标删除后外键置空仍被拒、无目标候选仍可拒绝）。既有「旧候选四种目标状态」用例同步区分 `target_missing`（删除）与 `binding_unverified`（其余）。

### P1-6（中）迁移时间戳无法解析时被当作「迁移之后」

- 位置：`src/persistence/migrations.ts` v24
- 根因：v24 用 `created_at < applied_at` 判断记录是否早于 v23。空串与无法解析的字符串在文本比较中可能「大于」时间戳，于是被当成迁移后写入、保留 `recorded`。
- 修复后：先校验时间戳形状（`GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'`），形状不符即视为不可证明，标 `unverified` / `inferred_backfill`。等于迁移时刻或更晚的合法时间戳仍视为记录值（迁移本身从不写入候选，因此该边界只会出现在迁移之后）。
- 回归测试：`schema-recovery.test.ts` 新增 1 条，覆盖早于、等于、未来、空串、乱码五种时间戳。

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

命令均在本轮分支执行。三个 SHA 必须分开读：

| 用途 | SHA | 说明 |
|---|---|---|
| 代码（本轮修复） | `48697e2` | 严格属性校验 + 无目标拒绝 + v24 时间戳形状 |
| 测试 | `48697e2` | 新增测试与实现同一提交 |
| 界面提示补充 | `2bce65b` | 仅渲染层文案，payload 不变 |
| 真实模型运行 | `2bce65b` | `codeState=clean`，5 轮 × 11 场景 |
| 报告（本文件） | 见 PR #8 最后一个 docs 提交 | 不改代码 |
| 上一轮基线 | `a68b52b` | 2.2.10 首次交付 |

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 通过 |
| 全量单测/集成 | `vitest run` | **684 / 684**，65 文件 |
| 迁移/恢复验收 | `vitest run tests/acceptance/schema-recovery.test.ts` | 14 / 14 |
| 构建 | `electron-vite build` | 通过（main / preload / renderer） |
| 离线评估 | `npm run evaluate` | 通过，precision 1.0 / recall 1.0，0 泄漏 |
| 认知评估 | `npm run evaluate:cognition` | 三套数据集 gate 全过 |
| 陪伴核心 | `npm run evaluate:companion` | 31 / 31 |
| 上下文记忆 | `npm run evaluate:context` | **23 / 23**，94 条断言 |

**674 / 675 / 684 的差异说明**

| 数字 | 来源 |
|---|---|
| 674 | 上一版报告写作时的全量结果，早于「旧候选四种目标状态」用例 |
| 675 | 提交 `b119131` 补上该用例后的结果（+1） |
| 684 | 本轮新增 9 条：领域 5（未知属性）、集成 3（无目标更正）、迁移 1（时间戳边界） |

三次数字变化都对应可指认的测试文件与提交，没有删除或跳过任何用例。

**失败与重试**：本轮先写测试并确认失败（领域 3 条、集成 2 条、迁移 1 条），再改实现；实现后全部通过。全量运行没有出现失败或跳过。上一轮曾因新增能力项导致 v1/v2 数据集覆盖不足而失败 3 条，已补齐用例，不是本轮问题。

## E. 真实模型实验

- 模型：`qwen2.5:0.5b`（本地 Ollama，`http://127.0.0.1:11434/v1`，`modelInCatalog=true`）
- 数据：`evaluation/fixtures/memory-pipeline-a4b-v1.json`（A4 十场景原样 + `a4-sensitive-boundary`）
- 重复：5 轮 × 11 场景 = **55 个场景-运行单元**，代码 SHA `2bce65b`，`codeState=clean`
- 原始结果：`evaluation/reports/a4b-final-run{1..5}.*.json`（上一版 `a4b-clean-run*` 保留，对应 SHA `a68b52b`）

| 场景 | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 同会话过敏 | F | F | P | F | F |
| 跨会话代号 | U | F | F | F | F |
| 更正大阪 | F | P | P | F | F |
| 旧城市不当当前 | F | F | P | U | U |
| 冲突披露 | U | F | U | F | U |
| 撤回不使用 | U | U | U | U | U |
| 无记忆不编造 | P | U | P | U | U |
| 无关问题 | U | U | U | U | U |
| 主体归属 | F | F | P | F | F |
| 长对话更正 | F | F | F | P | F |
| 敏感度边界 | U | U | P | U | U |

P=pass, F=fail, U=uncertain。合计 **9 pass / 23 fail / 23 uncertain**。

| 指标 | 本轮（11 场景×5，`2bce65b`） | 上一轮（10 场景×5，`a68b52b`） |
|---|---|---|
| Payload 投递率（需要记忆的场景） | **100%**（`notDelivered=0`，5/5 轮） | 100% |
| 模型正确使用率 | 9/55 = 16% | 10/50 = 20% |
| 更正遵循率 | **2/5** | 3/5 |
| 冲突披露率 | **0/5** | 0/5 |
| 长对话更正 | 1/5 | 0/5 |
| 历史事实误用 | 旧值 0 次被当作当前；当前值答对 1/5 | 3/5 |
| 撤回事实泄漏率 | **0/5** | 0/5 |
| 敏感记忆越权投递 | **0/5** | 未覆盖 |
| Uncertain 比例 | 23/55 = 42% | 20/50 = 40% |

解读（必须一起读）：

- **投递层全部正确**：5 轮 `notDelivered=0`；冲突场景两条值都进入 `unresolvedConflicts`；敏感场景 0 次进入请求；撤回场景 0 次进入请求；无任何 `mustNotMention` 失败。
- **失败全部归因 MODEL**：5 轮 `deliveredButNotUsed` 为 3/6/2/4/6，`ruleNotSatisfied=0`。典型输出：被问「我住哪」答「你住在北京」、冲突时只挑一边、长对话里丢掉已给的值。
- **本轮改动不影响该矩阵**：P1-4/P1-5/P1-6 只作用于「属性未知的更正」与「无目标候选」，这 11 个场景不触发这些路径；两轮数字差异（更正 3→2、长对话 0→1、旧城市 3→1）在 0.5B 的逐轮波动范围内，不作为能力变化证据。
- 0.5B 模型不具备稳定使用上下文的能力，**不能**据此声称认知可靠性达标；这是模型能力限制，不是检索或 payload 缺陷。

## F. 剩余风险

1. **模型能力**：0.5B 本地模型在更正遵循、冲突披露、长对话保持上均不可靠；需要更强且已授权的模型才能评估产品级表现，本轮未做。
2. **属性分类仍是规则**：`employer` 与 `job_role`、`preference` 与 `interest` 靠顺序匹配；`interest` 被并入 `preference`（拆开会产生误拒且不增加安全）。**无法识别的句子不再有任何自动更正路径**：它们既不能被绑定为目标，也不能被接受为更正，只能新增一条记忆或手工编辑。这是刻意的安全取舍，代价是覆盖率。
3. **更正候选可能「不可保存」**：属性无法识别时仍会形成 `correction` 候选（保留用户原话作为证据），但它永远无法被接受。界面会说明原因并禁用保存；若用户只想记录新事实，需要新增记忆。这是 P1-5 修复的直接后果。
4. **纯否认检测是启发式**：只对单值属性生效，判定依据是「去掉否定词后是目标文本的子串」。复杂句式（「我不是说我不在大阪」）可能漏判或误判，方向偏向拒绝，不会静默覆盖。
5. **旧候选需要重新表达**：迁移后 `unverified` 候选只能拒绝或撤回，用户要重新说一次更正。这是安全取舍，不是缺陷，但会造成一次交互成本。
6. **敏感度推测值**：`inferred_backfill` 只是保守过滤值，不能用于回答「当时是什么级别」；报告与界面必须始终标注来源。
7. **无人工复核**：评测器一致率仍无人工抽样数据；本轮所有结论均为自动测试与自动判定结论。
8. **评测数据集新增用例**：v1/v2 各加一条 `b11-sensitive-ceiling`（+40 行，无删改），历史报告文件未改动。

## G. 结论

**PASS_WITH_LIMITATIONS**

- 工程验收项均有证据：六个 P1 缺陷（含本轮 P1-4/5/6）已复现、修复并被回归测试锁定；迁移、重复启动、备份恢复、事务回滚、时间戳边界均验证；全量 684 条测试与四个离线评估通过。
- 建议在独立审查通过后关闭记忆可靠性专项，冻结基线；本轮不扩大范围。
- 非阻塞限制已明确记录：真实模型（0.5B）能力不足，冲突披露 0/5，payload 正确但模型不用；属性分类与否认检测仍是确定性启发式；未知属性的事实不再支持自动更正；无人工复核。
- 未做：合并、发布、改 `main`、付费云调用、引入研究算法包、大规模重构。
