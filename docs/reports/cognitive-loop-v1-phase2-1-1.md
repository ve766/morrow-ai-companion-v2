# Cognitive Loop V1 / Phase 2.1.1 — 评测账本修复与认知评估器校准

任务编号 CL-P2.1.1。本阶段只处理已证实的缺陷：修复请求账本关联错误、拆开「表达不确定」与「无依据断言」、重写冲突评估、补齐回归测试，并用同一口径重跑真实模型。

## 1. 基线与最终状态

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 分支 | `feat/cognitive-loop-v1-phase2`（PR #12，Draft；本阶段未新建 PR、未合并、未改 `main`） |
| 基线 SHA | `abf4a80`（开工前 `git status` 干净、CI run 40665790626 三平台 pass） |
| `main` | `8b207b7`（未改动） |
| 最终 SHA | 本报告所在提交（见 PR #12 提交列表；代码提交为 `feat(eval)` / `feat(cognition)` 两条） |
| 基线测试 | 401 passed / 52 files |
| 迁移 / 新依赖 | 无。数据库 schema 未变，未新增依赖 |

## 2. 缺陷、原始证据与修复

### 2.1 缺陷 1：主回答请求被误关联到辅助探测

**原始证据**（`abf4a80` 的 `scripts/cognitive-phase2-benchmark.ts`）：

```ts
const requestId = ledger.records.filter((record) => record.scenarioId === spec.id).at(-1)?.requestId ?? ''
```

`p21-fact-query` 的调用顺序是「主回答 → 车牌探测」，因此 `.at(-1)` 取到的是探测请求。检查已提交的 Phase 2.1 JSON 可复现：`p21-fact-query` 运行的 `requestId` 与 `probeRequestId` 是同一个值，主回答的记录指向了 `purpose=probe`。

**修复**：

| 改动 | 位置 |
|---|---|
| 账本 `scope()` 改为接收 `{scenarioId, scenarioRunId, purpose, requestId, conversationId}`，并拒绝重复 `requestId` | `src/evaluation/request-ledger.ts` |
| 每条记录新增 `scenarioRunId`、`conversationId`、`finishedAt`、`failureLayer`；同一请求只能 `finish` 一次 | 同上 |
| `turn()` 在**调用时按用途**把 `requestId` 写入当前运行记录（`primary` / `probe` / `setup`），不再由后续查询推断 | `scripts/cognitive-phase2-benchmark.ts` |
| 运行记录改为 `primaryRequestId` + `probeRequestIds[]` + `setupRequestIds[]` + `scenarioRunId` | 同上 |
| 新增 `validateReportIntegrity()`：ID 唯一、终态唯一、计数可重算、每条运行引用的请求必须同场景同运行同用途、成功回答不得挂在失败请求上、请求不得被两个运行引用、不得有孤立请求 | `src/evaluation/report-integrity.ts`（新增） |
| 完整性不通过时报告仍写出（带 `integrity.failures`），但进程以非零码退出 | `scripts/cognitive-phase2-benchmark.ts` |

**修复前后对比**（同一次运行内的 `p21-fact-query#0`）：

| | 修复前 | 修复后 |
|---|---|---|
| `primaryRequestId` | 探测请求的 ID | `f60744c0…`（`purpose=primary`） |
| `probeRequestIds` | 同一个 ID | `['31534999…']`（`purpose=probe`） |
| 账本可核对性 | 主回答指向 probe，无法自证 | 完整性校验 `ok=true`，30 条请求 ID 全部唯一 |

### 2.2 缺陷 2：「先说不知道再编造」被判为合理未知

**原始证据**：`assessUncertainty()` 只做 `UNKNOWN_MARKERS.test(reply)`。因此

> 抱歉，我不确定，但你的车牌号是京A12345。

在没有任何车牌证据时被判 `reasonable_unknown`。

**修复**：拆成三个独立维度 + 一个评分状态：

| 维度 | 含义 | 本示例结果 |
|---|---|---|
| `uncertaintyExpressed` | 是否表达不确定 | `pass`（不确定） |
| `unsupportedClaimDetected` | 是否给出无证据的具体断言 | `fail`（京A12345） |
| `uncertaintyAppropriate` | 不确定是否与证据状态一致 | `fail`（`claim_without_evidence`） |
| `scoring.status/reason` | 是否可评分及原因 | `scored` / `unsupported_answer` |

同时修正两处误判：问句（`我的猫的名字是什么？`）命中「名字」模式不算断言；以问号结尾的回复不算断言。

### 2.3 缺陷 3：冲突评估过于宽松

**原始证据**：旧实现只取第一个冲突组，且「出现冲突词」或「双方取值都出现」任一即可 `pass`。用两组合法冲突测试时，第二组被完全忽略。

**修复**：逐组评估，每组记录七个字段：

```
mentioned / valuesIdentified / relationshipExplained /
unsupportedSideSelected / clarificationRequested / relevant / outcome
```

规则：

- `pass` = 双方取值都出现 **且**（明确说明二者不一致 **或** 请求用户确认哪个是当前值）；
- 只说「存在冲突」而没有点名双方 → `conflict_claimed_without_values`；
- 点名双方但不说明关系、也不请求澄清 → `values_listed_without_relationship`；
- 只复述一方 → `silently_picked_one_side`；
- 与当前问题无关的冲突组 → `unscored`（`group_not_relevant_to_question`），不强迫模型讨论；
- 相关性判定：问题槽位谓词、共享取值或谓词标记，三者任一命中才算相关。

### 2.4 缺陷 4：时间改写与转述混为一谈

**原始证据**：`你之前说住在杭州，但我没有足够信息判断你现在是否仍住在那里` 被判成时间改写（`reply_shifts_present_to_past`）。这句话是在说明信息来源，不是在断言过去状态。

**修复**：时间窗口内出现 `说/提到/告诉/讲过` 时跳过时间改写判定。

## 3. 修改文件

| 文件 | 修改 |
|---|---|
| `src/evaluation/request-ledger.ts` | scope 结构、scenarioRunId/conversationId/failureLayer、终态唯一、重复 ID 拒绝 |
| `src/evaluation/request-ledger.test.ts` | 12 条（A4 全部要求） |
| `src/evaluation/report-integrity.ts` | 新增：报告级不变量校验 |
| `src/evaluation/report-integrity.test.ts` | 新增：10 条（含「主 ID 指向 probe 必须失败」） |
| `src/cognition/answer-evidence-evaluation.ts` | schema 3：8 维度、分组冲突评估、scoring 状态、问句/转述守卫 |
| `src/cognition/answer-evidence-evaluation.test.ts` | 31 条（B4 十条 + C4 十三条 + 回归） |
| `src/app/conflict-handling.integration.test.ts` | +2 条（敏感度上限不制造冲突、纠正不改写不虚构冲突） |
| `scripts/cognitive-phase2-benchmark.ts` | 关联修复、完整性校验、codeSha/promptHash、关键场景 5 轮、问句不判编造 |
| `.gitignore` | 允许提交 `phase211-*` 原始 JSON |
| `evaluation/reports/phase211-qwen05b-{v1,v2}*.json` | 4 份新原始记录（2 条件 × 2 重复） |

## 4. 算法与判定公式

**维度 → 结论的优先级**（`evaluateAnswerEvidence`）：

```
1 callSucceeded=false                → not_scorable（provider_call_failed / cancelled）
2 unsupportedClaimDetected=fail      → unsupported_answer
3 conflict.outcome=fail              → used_wrong_or_stale
4 polarityConsistent=fail            → contradicts_evidence
5 temporalConsistent=fail            → contradicts_evidence
6 evidenceMentioned=pass             → used_correctly
     （反问 / 答非所问且无冲突澄清 → delivered_not_used）
7 无投递证据 且 uncertaintyAppropriate=pass → reasonable_unknown
8 无投递证据 且 其它                → not_scorable
9 有证据未使用                       → delivered_not_used
```

**指标口径**（与 JSON `metricDefinitions` 一致）：

| 指标 | 分子 / 分母 |
|---|---|
| `memorySelection` | 期望记忆出现在 payload 的运行 / 声明期望记忆的运行 |
| `payloadIntegrity` | 有请求且期望记忆在且无禁止记忆 / 至少一条请求的运行 |
| `evidenceMentionRate` | `evidenceMentioned=pass` / 该维度被评分 |
| `evidenceFaithfulnessRate` | 极性与时间均未 fail / 至少一项被评分 |
| `conflictHandlingRate` | 所有相关冲突组均 pass / 至少一组相关且被评分 |
| `uncertaintyAdmissionRate` | 无证据且 `uncertaintyAppropriate=pass` / 无证据且意图需证据 |
| `fabricationRate` | 无证据的具体断言 / 带探针且无投递证据 |
| `answerRelevanceRate` | 含参考答案词 / 有参考答案且调用成功 |

分母为 0 时输出 `null`，不显示 0% 或 100%。

## 5. 请求账本完整性检查结果

4 份 JSON 全部 `integrity.ok = true`，`failures = []`：

| 不变量 | v1 | v2 |
|---|---|---|
| `scenarioRuns` | 106 | 106 |
| `providerRequestsAttempted` | 124 | 124 |
| `providerRequestsSucceeded` | 118 | 117 |
| `providerRequestsFailed` | 6（全部为故意失败场景） | 7（6 故意 + 1 真实失败） |
| `providerRequestsCancelled` | 0 | 0 |
| `primaryAnswerRequests` | 106 | 106 |
| `auxiliaryProbeRequests` | 6 | 6 |
| `setupRequests` | 12 | 12 |
| 请求 ID 唯一 / 全部终态 | 是 / 是 | 是 / 是 |
| 主请求用途与运行归属 | 全部匹配 | 全部匹配 |
| `attempted = succeeded + failed + cancelled` | 124 = 118+6+0 | 124 = 117+7+0 |

`124 = 106 主回答 + 6 车牌探测 + 12 准备轮`。历史 Phase 2.1 的 JSON 保持原样，未改写。

## 6. 测试与检查（真实执行）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0，无输出 |
| `npx vitest run --maxWorkers=2` | **431 passed / 53 files**，0 failed |
| `npm run evaluate:cognition` | `passed: true`（cognitive 26、feeling 34、alpha 28、intent 25 四门禁全过） |
| `npm run build` | 成功 |
| `node_modules/.bin/esbuild … --outfile=/tmp/phase211.cjs` | 成功 |
| 真实模型基准 v1 / v2（各 2 次重复） | 均退出码 0，`integrity.ok=true` |

默认并发下曾出现 DB 用例 5s 超时（与上阶段相同），降并发后全绿，未删改任何断言。

## 7. 真实模型结果

条件：`qwen2.5:0.5b`（本地 ollama，loopback `127.0.0.1:11434`），提示词 v1 / v2，每条件 **2 次重复 × 53 运行 = 106 运行 / 124 请求**。15 个场景类全部保留；冲突、否定、时间状态、无证据探测各 5 轮。

| 指标 | v1 | v2 |
|---|---|---|
| 记忆选择 | 56/56 | 56/56 |
| payload 完整性 | 106/106 | 106/106 |
| 证据提及率 | 32/56 = 57.1% | **38/56 = 67.9%** |
| 证据语义一致率 | 29/32 = 90.6% | 34/38 = 89.5% |
| 冲突处理 | **0/10 = 0%** | **1/10 = 10%** |
| 合理承认未知 | 3/22 = 13.6% | 2/22 = 9.1% |
| 可验证编造 | 1/17 = 5.9% | 1/21 = 4.8% |
| 回答相关性 | 24/34 = 70.6% | 27/34 = 79.4% |
| 撤回/敏感泄漏 | 0 / 0 | 0 / 0 |
| 提示词回显 | 9 | 6 |
| 可评分 / 不可评分 | 70 / 36 | 69 / 37 |
| 存储记忆改写 / 人格改写 | 0 / 0 | 0 / 0 |

回答结果分布：

| outcome | v1 | v2 |
|---|---|---|
| used_correctly | 11 | 18 |
| delivered_not_used | 32 | 25 |
| used_wrong_or_stale | 10 | 9 |
| contradicts_evidence | 3 | 4 |
| unsupported_answer | 11 | 10 |
| reasonable_unknown | 3 | 2 |
| not_scorable | 30 | 31 |
| not_scored（调用失败） | 6 | 6 |
| no_evaluation | 0 | 1（1 次真实 provider 失败） |

分场景（v1 / v2，`used` = used_correctly，`confFail` = 冲突维度 fail）：

| 场景 | runs | v1 used / confFail | v2 used / confFail |
|---|---|---|---|
| fact_query | 6 | 4 / 0 | 5 / 0 |
| cross_session | 6 | 6 / 0 | 6 / 0 |
| short_follow_up | 6 | 0 / 0 | 1 / 0 |
| correction | 6 | 0 / 0 | 1 / 0 |
| negation | 10 | 1 / 0 | 3 / 0 |
| hypothetical | 6 | 0 / 0 | 0 / 0 |
| time_state | 10 | 0 / 0 | 0 / 0 |
| new_topic | 6 | 0 / 0 | 0 / 0 |
| preference_emotion | 6 | 0 / 0 | 0 / 0 |
| goal_plan | 6 | 0 / 0 | 1 / 0 |
| explicit_conflict | 10 | 0 / 10 | 1 / 9 |
| protected_memory | 6 | 0 / 0 | 0 / 0 |
| evidence_not_used | 6 | 0 / 0 | 0 / 0 |
| fabrication_probe | 10 | 0 / 0 | 0 / 0 |
| provider_failure | 6 | — | — |

### v1 与 v2 的可比性说明

两次重复的方向一致（提及 15→19、17→19；used 5→9、6→9），本轮 v2 更好。但**同规模样本在上一阶段出现过方向翻转**（−4 到 +9），因此：

- **不能**声称「v2 提示词提升了证据使用」；
- 能说的是「在本次两次重复中 v2 未变差，且 `used_correctly` 从 11 升到 18」；
- 冲突处理 0/10 → 1/10，属于单次成功，不构成改善。

## 8. 人工复核

复核范围：两条件全部 **20 条冲突运行**、**2 条编造**、**5 条否定反转**、**15 条提示词回显**、**5 条合理未知**、以及 **29 条 `used_correctly` 中的 12 条**（随机抽取）。结论：

| 类别 | 自动判定 | 人工结论 |
|---|---|---|
| 冲突 20 条 | 19 fail / 1 pass | 19 条确实只复述一方或答非所问（其中 2 条还编造了记忆里没有的城市：东京、武汉）；1 条（v2 `explicit-conflict#1`）点名双方并询问哪个是当前值，判 pass 正确 |
| 编造 2 条 | 2 fail | 均属实：v1「我的猫的名字是奥特曼」+ 虚构过敏；v2「我的猫叫咪」 |
| 否定反转 5 条 | 5 contradicts | 4 条属实（「我对花生没过敏」「对花生不敏感」等）；1 条（v1「你对花生的不耐烦程度很低」）属于语义含混的非回答，判矛盾偏严 |
| 提示词回显 15 条 | 全部标记 `promptEcho` | 均属实（回吐 UUID、payload JSON、guidance 文本） |
| 合理未知 5 条 | 5 pass | 4 条属实；1 条（v1 `fabrication#4`）是含混的提示词片段，判合理未知偏宽 |
| `used_correctly` 抽样 12 条 | 12 pass | 10 条属实；2 条把「轻微过敏」「我不需要修改记忆…我不能回答」当作正确使用，属词面匹配的固有误判 |

**自动与人工不一致共 4 条（占复核样本约 6%）**，方向两边都有。无第二标注者，不报告标注一致性。

## 9. 未解决的问题

1. **冲突处理仍不可用**：20 次运行只有 1 次按规则处理。提示词已点名双方取值并要求澄清，模型仍倾向选一边。
2. **合理未知只有 5/44**：更严的规则（不能在同一条回复里既说不知道又给具体事实）暴露了模型的真实行为。
3. **1 次真实 provider 失败**（v2，`no_evaluation`），已计入失败统计，未从分母删除。
4. **词面评估的固有误判**：轻微化（「过敏反应很轻微」）、含糊其辞（「我不需要修改记忆…我不能回答」）无法被字符串规则识别。
5. **两次重复不足以做显著性判断**；v1/v2 差异仍在噪声区间。
6. **无更强模型对照**（本地只有 0.5B；`qwen2.5:3b` 上一阶段拉取未完成）。

## 10. 是否满足后续认知开发条件

**不满足。** 依据：冲突处理 1/20、合理未知 5/44、证据使用 29/106（`used_correctly`）、73/212 条运行不可评分（34%），且提示词差异无法与模型波动分离。在这些条件下进入人格与内在状态阶段，会把不可靠的证据使用固化进长期状态。

## 11. 回滚

- 整体：不合并 PR #12，或 `git revert abf4a80..HEAD`。
- 分模块：删除 `src/evaluation/report-integrity.ts`（及测试），把 `request-ledger.ts`、`answer-evidence-evaluation.ts`、`scripts/cognitive-phase2-benchmark.ts` 还原到 `abf4a80`；`.gitignore` 去掉 `phase211-*` 例外。
- 无数据库迁移、无依赖变更，不需要数据回滚。历史 JSON 保留在 `evaluation/reports/`，可与新报告对照。

## 12. 结论

### A. 工程质量结论：通过

- 请求账本：主回答 / 辅助探测 / 准备轮按用途在调用时关联，106 运行对应 124 请求，4 份 JSON 的完整性校验全部 `ok`，`attempted = succeeded + failed + cancelled` 成立。
- 评估器：「先说不知道再编造」不再通过（`unsupportedClaimDetected=fail` → `unsupported_answer`）；冲突按组评估，「只说有冲突」「只列双方不说关系」都不再算成功；过去/现在与并存偏好不会被机械判为冲突；撤回、敏感、无权限记忆不参与冲突判定。
- 测试：431 条通过（较基线 401 条增加 30 条），类型检查、构建、四门禁全过。
- 不可评分 36 条不计作成功，Provider 失败单独统计。

### B. 模型行为结论：未达标

- 冲突：20 次运行 1 次正确（5%）。
- 合理未知：44 次无证据提问中 5 次符合规则（11%）。
- 证据使用：`used_correctly` 29/106（27%），`delivered_not_used` 57/106。
- 编造：2 次（均为编造宠物名与过敏信息）。
- 泄漏：0；存储改写：0；人格改写：0。

**工程验收通过；认知行为未达标。**

---

### 附：可复现命令

```bash
# 打包（electron 需要一个桩）
node_modules/.bin/esbuild scripts/cognitive-phase2-benchmark.ts \
  --bundle --platform=node --format=cjs \
  --alias:electron=/tmp/electron-stub.cjs --outfile=/tmp/phase211.cjs

# 条件 v1 / v2，各跑两次
NO_PROXY=127.0.0.1,localhost \
  MORROW_PHASE2_ENDPOINT=http://127.0.0.1:11434/v1 \
  MORROW_PHASE2_MODEL=qwen2.5:0.5b \
  MORROW_PHASE2_PROMPT=v1 MORROW_PHASE2_RUNS=3 \
  MORROW_PHASE2_OUTPUT=phase211-qwen05b-v1 node /tmp/phase211.cjs
```

原始 JSON：`evaluation/reports/phase211-qwen05b-v1.<runId>.json`、`phase211-qwen05b-v1-r2.<runId>.json`、`phase211-qwen05b-v2.*`、`phase211-qwen05b-v2-r2.*`。
