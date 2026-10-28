# Phase 2.2.9 — 记忆可靠性专项加固报告

## 0. 结论先行

本轮修复了 5 个已证实的安全缺陷，并新增 28 条回归测试。**没有**宣称记忆系统已经可靠，也**没有**完成真实模型复测（本地模型服务未运行，见第 6 节）。

- 错误目标的更正现在会被拒绝，不再改写无关记忆，也不再静默降级为新增。
- 普通现在时陈述不再被当成更正去覆盖旧事实。
- 用户审核时选择的敏感度现在会写入更正路径与修订历史；客户端不能把它降到服务端判定之下。
- 单一取值事实（居住地、雇主、项目代号、身份）的冲突即使词面几乎不重合也会进入 `unresolvedConflicts`。
- 拒绝原因以稳定 detail 码穿过 IPC 到达界面，而不是一句泛化的「记录状态已变化」。

## 1. 基线与分支

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| PR #6 | OPEN / Draft，head `dca6486af4d14edd2002b78e263f957d8b791352`，base `feat/phase-2.2-memory-reliability` |
| PR #4 | 未修改 |
| `main` | 未修改 |
| 本轮分支 | `fix/phase-2.2.9-memory-reliability-hardening`，从 `dca6486` 创建 |
| 起始工作区 | 干净，无他人未提交改动 |
| 算法研究包 | `research/cognitive-update-pack-v0.1` 未被导入运行时，本轮未触碰 |

与任务书中记录的 HEAD 一致，无差异。

## 2. P1-A 更正目标与编辑后内容不匹配

### 修复前的真实行为

`MemorySuggestionService.review()`（`src/app/companion-service.ts`）只做了两件事：用 `memories.list().find(...)` 找到候选里存下的 `correction_target_id`，然后判断 `status === 'active'`。目标不存在或已撤回时，代码会**静默走 `memories.create()`**，把更正降级成一条新记忆；目标仍活跃时，则**无条件**调用 `memories.correct(target.id, 用户编辑后的正文)`。也就是说，把一条居住地更正候选改成「我喜欢独自研究」再确认，会把居住地记忆的正文改成偏好陈述。

### 修复后

新增领域校验 `validateCorrectionTarget()`（`src/memory/memory-formation-domain.ts`），在事务内、写库前按顺序判定：

1. 目标不存在 → `target_missing`；
2. 目标非 active → `target_inactive`；
3. 候选创建时记录的目标修订与当前修订不一致 → `target_changed`；
4. 编辑后正文与目标当前正文相同 → `content_unchanged`；
5. 编辑后正文不是第一人称用户陈述，或指向第三方 → `subject_mismatch`；
6. 事实属性不同 → `attribute_mismatch`；两侧属性都无法识别时，要求共享 ≥2 个显著词作为证据，否则同样拒绝。

事实属性由新增的 `classifyFactAttribute()`（`src/memory/memory-domain.ts`）给出：居住、雇主、项目代号、身份、健康、偏好、学习、目标。

同时，候选创建阶段就加了第一道闸：`canTargetCorrection()` 要求候选与目标属于同一事实属性（或共享证据），因此「我喜欢独自研究」从一开始就不会被绑定到居住地记忆上。

拒绝时抛出 `ApplicationError('CONFLICT', 'correction_rejected:<reason>')`，候选保持 `pending`，用户可以重新审核或拒绝。**不会**再降级为新增，**不会**改到别的记录。

## 3. P1-B 普通陈述被误判为更正

### 修复前的真实行为

`CORRECTION_HINT = /(?:不再|搬家|搬到|改成|改为|已经不住|已经不用|现在是|现在住|现在在)/u`。`现在在` / `现在是` / `现在住` 属于宽泛的现在时标记，导致「我现在在学习 Blender」「我现在在大阪工作」「我现在住在大阪」全部被判为 `correction`，并在有旧记忆时自动绑定目标。

### 修复后

改为显式意图清单 `CORRECTION_PATTERNS`，只承认四类证据：

- 明确否认：`不再住…`、`不住…了`；
- 迁移：`搬家`、`搬到`、`换到`、`调到`；
- 承认说错：`说错`、`记错`、`纠正`、`改成`；
- 过去与现在的对照：`以前…现在…`。

任务书表格的 8 种表达现在都有对照测试（`src/memory/memory-formation-domain.test.ts`）：

| 表达 | 结果 |
|---|---|
| 我现在在学习 Blender | `fact`，非更正，无目标 |
| 我现在在大阪工作 | `fact`，非更正，无目标 |
| 我现在住在大阪 | `fact`，非更正，无目标 |
| 我不住大阪了，现在搬到京都了 | `correction`，superseded=`大阪` |
| 刚才说错了，我住在京都，不是大阪 | `correction`，superseded=`大阪` |
| 我以前喜欢摄影，现在更喜欢绘画 | `correction`，superseded=`摄影` |
| 我曾经住在大阪 | 不形成候选（历史陈述不写成当前事实） |
| 我不喜欢大阪 | `preference`，非更正 |

「我曾经住在大阪」被跳过是刻意的：链路里没有「历史事实」这种记忆类型，把它写成当前居住地正是本轮要防的失败。历史值只通过 `memory_revisions` 与上下文里的 `corrected` 段出现。

**行为变更**：`src/app/memory-formation.integration.test.ts` 中原先断言「我现在住在大阪」是更正并绑定目标的用例，改为断言它是 `fact`、`correctionTargetId` 为 `null`、`conflictWith` 含旧记录。这是收紧而非放松：旧断言正是缺陷本身。

## 4. P1-C 更正路径丢失用户选择的敏感度

### 修复前的真实行为

`MemoryService.correct()` 只接受 `(id, content, correlationId)`，`MemoryRepository.transition()` 的 UPDATE 不含 `sensitivity`。审核时算出的 `sensitivity` 只写回了 `memory_suggestions` 表，**没有写进 `memories`**。因此「接受一条更正并把敏感度调高」在数据库里等于没做，后续检索和请求仍按旧级别放行。

### 修复后

- `MemoryTransition` 的 `correct` 分支携带可选 `sensitivity`，由 `transitionMemory()` 统一校验并写入同一次状态转移；
- `MemoryRepository.transition()` 的 UPDATE 增加 `sensitivity`；
- `memory_revisions` 新增 `sensitivity` 列（迁移 v23），修订历史可审计；
- 审核路径计算下限 `floor = max(服务端分类, 目标记忆敏感度)`：
  - 显式选择低于下限 → `INVALID_INPUT` + `sensitivity_below_floor`；
  - 未显式选择 → 取 `max(候选敏感度, floor)`，即只能升不能降；
- 最终 payload 边界再次生效：审计测试证明被调高为 `sensitive` 的更正，在未提高上限的请求里**不出现**，提高上限后才出现。

## 5. P1-D / P1-E 检索、冲突与时效

检索精度在 A3 已改为「短语 / 内容词 / 事实族 / 明确安全关系」四类证据，本轮未推翻。本轮新增的是**冲突识别的事实族维度**：

修复前 `assignConflictGroups()` 只按共享 ≥2 个显著词分组。「我住在大阪」与「我现在住在京都」只共享 `住在` 一个二元组，因此**没有**被判为冲突，两条都以 `currentFacts` 发出，模型没有任何提示。

修复后：

- 同一**单一取值**属性（居住、雇主、项目代号、身份）且正文不同 → 直接判为 `unresolvedConflicts`，`resolved:false`，两条都不进 `currentFacts`；
- 已知**多值**属性（偏好、学习、目标、健康）内部不再按词面重叠分组，避免把「我喜欢手冲咖啡 / 我喜欢冷萃咖啡」制造成冲突；
- 两侧属性都无法识别的记录仍保留原来的词面 ≥2 规则，作为保守兜底。

`evaluation` 侧的 `evaluate:context` 22 个用例、90 条断言仍全部通过，`B7_conflict_both_visible` 未修改。

## 6. 真实模型复测：BLOCKED

本轮**没有**取得新的真实模型数据，原因明确：

```
curl http://127.0.0.1:11434/api/tags
→ upstream connect failed: 目标计算机积极拒绝 (os error 10061)
```

本地 Ollama 服务未运行，任务要求「不发起付费云调用」，因此没有可用模型。A4 的五次 clean 运行证据（`evaluation/reports/a4-clean-run{1..5}.*.json`，SHA `5de0563`）保持原样、未被改写，仍作为修复前基线：

- 冲突披露 0/5；长对话更正 0/5；主体归属 1/5；跨会话 2/5。

修复后 payload 的冲突表达更强（两条都进 `unresolvedConflicts`），但**这不构成模型会正确使用的证据**。复测命令已固定，环境恢复后可直接执行：

```bash
MORROW_EVALUATION_ROOT=<repo> MORROW_CONTEXT_REAL_DATASET=memory-pipeline-a4-v1.json \
MORROW_CONTEXT_REAL_OUTPUT=a4-2.2.9-run1.json \
MORROW_CONTEXT_REAL_ENDPOINT=http://127.0.0.1:11434/v1 MORROW_CONTEXT_REAL_MODEL=qwen2.5:0.5b \
node <bundled context-memory-real-cli>
```

## 7. 数据库迁移 v23

```sql
ALTER TABLE memory_suggestions ADD COLUMN correction_target_revision INTEGER
  CHECK (correction_target_revision IS NULL OR correction_target_revision > 0);
UPDATE memory_suggestions SET correction_target_revision = (SELECT revision FROM memories WHERE id = correction_target_id)
  WHERE correction_target_id IS NOT NULL;
ALTER TABLE memory_revisions ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'personal'
  CHECK (sensitivity IN ('normal','personal','sensitive'));
UPDATE memory_revisions SET sensitivity = COALESCE((SELECT sensitivity FROM memories WHERE id = memory_id), 'personal');
```

- 只增列，不重建表、不删数据；
- 旧候选按迁移时刻的目标修订固定，这是唯一可得的诚实近似（记为已知限制）；
- 修订历史敏感度按记忆当前值回填，只会**高报**不会**低报**；
- 回滚说明：本轮无破坏性变更，回滚只需回退代码；旧版本打开 v23 数据库会按「更新版本」拒绝（既有 fail-closed 行为），备份/恢复路径未变。

## 8. 测试与命令

全部命令在 `fix/phase-2.2.9-memory-reliability-hardening` 上执行。

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `electron-vite build` | 通过（main / preload / renderer） |
| `vitest run`（全量 65 文件） | **655 / 655 通过** |
| `npm run evaluate` | 通过，precision 1.0 / recall 1.0，0 泄漏 |
| `npm run evaluate:cognition` | 通过，三套数据集全部 gate passed |
| `npm run evaluate:companion` | 31 / 31 |
| `npm run evaluate:context` | 22 / 22，90 条断言 |

远端 CI（run `40619577931` @ `d3bd41e`）：`Typecheck, tests, build and smoke (ubuntu-latest)`、`(windows-latest)`、`Windows upgrade path (schema migrations under the real app)` 三个 job 全部 success。

关于首次全量运行的 3 个失败：`scenario G` 的 `PROVIDER_NETWORK` 是已知本地 HTTP 端口抖动（A4 轮已记录），另两个失败来自沙箱拦截了 `%TEMP%` 下的写入（`morrow-run-id-*/.git/config.lock`、`morrow-reminder-replay-*`）。解除沙箱拦截后同一提交全绿，未修改任何断言来换取绿色。

新增 / 修改的测试：

| 文件 | 内容 |
|---|---|
| `src/memory/memory-formation-domain.test.ts` | 6 → 20 条：P1-B 八行对照矩阵、历史陈述、目标绑定、P1-A 六类拒绝 |
| `src/app/memory-correction-hardening.integration.test.ts` | 新增 8 条：属性不匹配、目标撤回、目标改版、重复接受、敏感度上调、客户端降级、敏感目标降级、未选择时自动升级 |
| `src/app/memory-payload-audit.integration.test.ts` | 6 → 8 条：冲突双值进入 payload、审核敏感度在最终边界生效 |
| `src/memory/memory-context-assembler.test.ts` | 21 → 23 条：单值属性冲突正例、多值属性反例 |
| `src/app/ipc.test.ts` | 13 → 14 条：拒绝原因穿透 IPC |
| `tests/acceptance/schema-recovery.test.ts` | 10 → 11 条：v22 → v23 回填与数据完整 |

### 提交与 PR

| 内容 | 提交 |
|---|---|
| 代码 + 测试（21 文件，+909/−58） | `cdf61ad` |
| 本报告 | `d3bd41e` |
| Draft PR | #7，base `fix/memory-reliability-v0.1`，未合并 |

## 9. 端到端场景证据

`src/app/memory-payload-audit.integration.test.ts` 直接读取真实 `sendChat` 发出的 `requestPayload`：

| 场景 | 断言 |
|---|---|
| 无关问题 | system 不含杭州 / Blender / 独自研究 |
| 相关检索 | 只含杭州，不含 Blender，角色顺序 `system,user` |
| 跨会话 | 新会话 payload 只有 2 条消息，记忆来自持久层 |
| 更正后 | 只含新值，旧值不出现 |
| 撤回 + 超限敏感 | 两条都不出现 |
| 冲突 | `currentFacts` 缺失，`unresolvedConflicts[0].resolved=false`，两条值都在 |
| 审核敏感度 | 未提上限时不出现，提上限后出现 |

## 10. 未解决、残余风险与阻塞

**已证实修复**：P1-A、P1-B、P1-C 的行为缺陷，冲突分组的事实族缺口，拒绝原因不可见。

**只降低风险、未证明可靠**：

- 事实属性分类仍是确定性规则，未识别的句子退回共享词证据，可能放过语义相近但属性不同的更正；
- 中文检索没有 embedding，「语义相同、词面不同」的召回只靠事实族兜底，覆盖有限；
- 冲突识别不做「值级」比较，同一属性下的两条同义表述（如「住大阪」/「定居大阪」）会被判为冲突，属于可接受的误报方向，但会消耗预算；
- 历史事实被直接丢弃，不形成记忆；用户若要保留「曾经住过大阪」，目前只能手工输入。

**阻塞**：

- 真实模型复测：本地模型服务不可用（见第 6 节），无授权云模型，`BLOCKED`；
- 人工复核：未执行。评测器一致率、误判类型分布本轮**没有**人工抽样数据，不能声称评测器已被人工验证；
- 更强模型对照：仍 `BLOCKED`（无第二个已授权且安全配置的生成模型）。

## 11. 明确未做的事

- 未合并 PR #4 / #6，未改 `main`，未发布；
- 未调用付费云模型，未读取或提交任何凭据；
- 未重置或删除任何真实数据库，未重写历史评测报告；
- 未引入认知算法包到运行时；
- 未做大规模重构。
