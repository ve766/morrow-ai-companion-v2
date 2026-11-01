# Stage 3 最终缺口收口审计

- 生成时间：2026-11-01T03:15Z
- 基线：`docs/reports/stage-3-followup-gap-closure.md`（2026-10-30，基准 HEAD `69cb18f`）
- 工作树：`E:\Hasee\Documents\morrow-stage3`，**无 `.git`** → 本轮无法用 `git diff` 证明"哪一条被改过"，只能给"当前磁盘状态 + 代码位置 + 实测结果"
- 口径：PASS / PARTIAL / BLOCKED / NOT_RUN。**非 PASS 不计入通过率**

---

## 一、上一轮列出的缺口，逐条对账

| 编号 | 上轮状态 | 本轮状态 | 依据（可核验） |
|---|---|---|---|
| **S3-01** Morrow 兴趣未接真实反思生产链 | OPEN（P0） | **PASS** | `src/self-model/reflection-service.ts:678` 调用 `interests.observeMorrow({conversationId, findingId, ...})`，:669 另写 `observeMorrowEvidence`；来源拆成 `origin ∈ {user, morrow}` 分别折叠（登记表 C.1/C.2）。不再是"只验证直调" |
| **S3-02** 探索消融无行为因果 | PASS | **PASS**（未回退） | `evals/stage-3/runner/harness.ts` L5 仍要求存在 `permitted`；本轮未重跑该夹具 |
| **S3-03** 人格证据门禁与同轮冲突 | PASS | **PASS**（未回退） | `personality-growth.ts` `deriveGrowthSignals` 的净证据聚合 + 三重 abstain 仍在；`growth.v2` |
| **S3-04** 每日预算并发超额 | PASS | **PASS**（未回退） | `exploration-policy.ts` 事务内 `reserve/consume/release`；迁移 33 |
| **S3-05** 登记表新旧规则冲突 | PASS | **REOPENED → 本轮修复** | 见 §二。上轮"删除追加段"的结论不成立：追加段仍在，且与附录 C.7 直接冲突 |

S3-01 的关闭是实质性的：Morrow 侧兴趣第一次有了**非测试代码**的生产入口，且证据按 `conversation_id` 分组、`UNIQUE(evidence_ref)` 保证重试幂等。这正是上轮把它列为 P0 的原因——兴趣归因错，等于让用户提过的话题冒充"她自己想聊的"。

## 二、S3-05 为什么重新打开

上轮结论是"删除追加段，规则内联到唯一章节；旧规则标 deprecated"。当前文件里同时存在三层：

1. 正文 `## G1`（第 7 行起）：公式写 `effective_d = clamp(baseline_d + offset_d, 0, 100)`。
2. `## 2026-10-31 纠偏：算法变更（以本节为准）`（第 228 行起）："上文的 G1 描述已被下列版本取代"。
3. `## 附录 C`（第 306 行起）：C.7 又把 `personality-growth.ts` 的 `deriveGrowthSignals` 登记为**真实运行的算法**。

于是同一份文件里：

- §G1 说存在 `effective_d = baseline + offset` 的合成；
- §G2 说"身份自身的演化（G1 原意）**当前无生产者**"；
- §C.7 说 G1 的证据派生**有生产者、有测试、在跑**。

三者不能同时为真。实测（`src/app/companion-service.ts`）：

```
1073–1082  每完成轮 deriveGrowthSignals → growth.apply        ← 有生产者
 996–1013  effectiveProfile 只加 interaction.offsets()        ← 没有 growth 读取方
 281      describeGrowth() 定义于此，全仓无生产调用点          ← 没有消费者
```

因此真相是第三层与第二层各对一半：**G1 有生产者，缺消费者**；`effective_d = baseline + growth_offset` **未实现**。本轮按这个结论改写了登记表（见 §五），不是再追加一段说明。

## 三、原任务 A–F 现状

| 项 | 上轮 | 本轮 | 说明 |
|---|---|---|---|
| A 记忆重要度/衰减/合并 | PARTIAL | **PARTIAL** | M1 完整；**冲突分类仍缺**（全树 grep `conflictKind` / `conflict_type` / `ConflictClass` 无命中） |
| B 内在状态 appraisal/调节 | NOT_RUN | **NOT_RUN** | 沿用既有 `cognitive-feeling-engine`；无 appraisal 重构，无 affect 消融 |
| C 反思候选与质量评测 | PARTIAL | **PARTIAL** | 候选可追溯、限频去重可用；**质量指标仍缺**（`reflection-service.ts` 内无 quality/repetition/retractionRate/evidenceSupport 相关实现） |
| D 长期目标闭环 | PASS | **PASS** | `CompanionGoalService`（迁移 32）；期限边界解析 `三月之前 → 2027-02-28T15:59:59Z` 在真实运行中通过 |
| E 真实自主探索闭环 | PARTIAL | **PARTIAL** | 状态机 + 原子预算 + 词面/形态双检；**语义级提及检测未实现**（`exploration-policy.ts` 仍是 term 包含判定） |
| F 语音闭环 | NOT_RUN | **NOT_RUN** | 无 ASR/TTS adapter，无 UI 状态机 |

## 四、评测项现状

| 项 | 状态 | 备注 |
|---|---|---|
| L5 | PASS（客观） | 模型层行为仍 BLOCKED |
| L6 | PASS（客观）/ BLOCKED（行为） | 真实模型评分未运行 |
| L10 / L11 | PASS | 未回退 |
| 长对话 | PASS（真实模型，32 轮/3 会话） | 但含 1–2 条失败断言，见 `stage-3-real-provider-evidence.md` |
| 纵向 | PASS（注入时钟） | 不宣称真实多日 |
| **C1 机制套件** | **PASS（新增）** | 22 场景 / 88 断言，`suite: mechanism` |
| **C1 语义套件** | **BLOCKED（新增）** | `BLOCKED_NO_SECRET`；6 场景，无凭据 |
| CI 双平台 | BLOCKED | 账号计费问题，run `41178081914` 未启动 |
| Electron renderer | **PASS（本轮变更）** | 冒烟 exit 0，未传 `--no-sandbox`；此前记录的 `0x80000003` 未复现 |
| 置信度校准 | NOT_RUN | 离线评估自陈 `calibration.measured = false` |

## 五、本轮实际改动（只列能指认的）

| # | 改动 | 文件 | 性质 |
|---|---|---|---|
| 1 | C1 中文短答匹配修正 | `evals/stage-3/intent-understanding/run.ts`、`src/cognition/*` | 代码 |
| 2 | 继承话题与指代绑定加固 | `src/cognition/intent-reading.ts` | 代码 |
| 3 | `provider-retry` 并行偶发失败 | 相关套件与实现 | 代码；本轮以**串行** 894 测试复核，未单独重跑并行模式 |
| 4 | C1 端到端主链断言扩充 | `evals/stage-3/intent-understanding/run.ts` | 代码（22 场景 88 断言） |
| 5 | 机制/语义拆成两套 | `run.ts` / `semantic.ts` / `package.json` / README / 契约 | 代码 + 文档 |
| 6 | 凭据审计 | `docs/audit/stage-3-provider-credential-audit.md` | 文档 |
| 7 | `assertNoSecret` 左边界缺陷 | `evals/stage-3/shared/real-provider.ts` | 代码（安全） |
| 8 | 登记表三处自相矛盾 | `docs/algorithms/stage-3-algorithm-registry.md` | 文档 |
| 9 | C1-A3 空断言 | `evals/stage-3/intent-understanding/run.ts` | 代码（评测真实性） |

第 9 条值得单独记：原断言只检查 `status === 'stated'`，能被 `个函数`/`张图` 通过；上一版"修复"只清了值，没清断言，存档里 `函数`/`图` 照样绿。现在要求"值出现在本轮原话 + 不是量词开头 + `topic.evidenceMessageId` 等于引入轮 id"。**22/22 在修之前也是绿的**——这是本轮唯一一处"green 曾经无意义"的地方。

## 六、仍未通过（合并前必须知道）

1. **C1 语义证据 BLOCKED**：无 `MORROW_TEST_API_KEY`。机制套件的 22/22 **不能**替代。
2. **人工复核 PENDING**：唯一真实长跑的 `manualReview.status = "PENDING"`，没人逐条读过回复是否自然。
3. **G1 无消费者**：人格生长台账每轮写入、可回滚、有审计，但**不进 prompt**；同理，三次真实长跑里交互偏移恒为 0，端到端效果无证据。
4. **CI BLOCKED**：不是代码问题，是账号计费；恢复后需重跑双平台。
5. **§2A / §2C / §2F**：冲突分类、反思质量指标、语音闭环，均未动。
6. **语义级探索检测**：改写式"提起"会漏判。
7. **无 commit**：本树所有结论都无法被第三方按 SHA 复现。这是当前最大的可审计性缺陷，且不是靠补文档能解决的。

## 七、结论

本轮把 C1 从"有评测"推进到"评测本身可证伪"：拆开机制与语义、修掉一条假绿断言、修掉一处会误报的凭据扫描、并把登记表里三层互相打架的说法收敛成一条。

但按完成定义，只要 C1 语义证据 BLOCKED、人工复核 PENDING、§2B/§2C/§2F 未实现，整体只能是 **PARTIAL**。

**不得建议合并 PR #19。** 这个结论不因本机验证链全绿而改变。
