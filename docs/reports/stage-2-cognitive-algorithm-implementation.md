# Stage 2 认知算法真实接线与端到端缺口修复 — 实现报告

| 项 | 值 |
|---|---|
| 任务 | issue #17 评论 6516588833 |
| 分支 | `feat/stage-2-delivery-hardening`（PR #15） |
| 开工基线 HEAD | `55432fc2816feb223a1205b40592306d205d0bc8` |
| 实现提交 | `d856e25`（下文所有结果都在该提交、**工作区干净**时生成） |
| 环境 | Windows 10.0.26200（MINGW64）、Node v22.22.2 |
| 自审报告 | [`docs/audit/stage-2-cognitive-algorithm-implementation-audit.md`](../audit/stage-2-cognitive-algorithm-implementation-audit.md) |

---

## 1. 真实调用链（先核对，再动手）

```
src/cognition/intent-decision.ts        规则层：collectSignals → scoreIntentCandidates → decideIntent
        │                               决定 intent / alternatives / needsMemoryRetrieval / confidence(0-100)
        ▼
src/cognition/intent-confidence.ts      B1：assessIntentConfidence（五特征 z 分、margin、band、clarify 门控）
        │                               输入是**同一个**候选列表，不是另算一套
        ▼
src/cognition/cognitive-turn-analyzer.ts 把 assessment 变成 strategy（clarify / retrieve_memory / answer）
        │                               并写入 analysis（持久化）
        ▼
src/app/companion-service.ts            prepare() 组装上下文 → 序列化请求
        │                               system 消息里出现 `intent=…; response route=…; uncertainty=…`
        ▼
最终序列化 Provider payload
```

**消费端是真实存在的**：`companion-service.ts` 第 80 行把 `response route=${analysis.strategy}` 写进 system 消息，第 90 行为 `strategy === 'clarify'` 追加一条"只问一个澄清问题"的指令。因此策略变化在 payload 里可见、可断言。

---

## 2. B1：多信号置信度接入策略

### 2.1 公式与代码映射

```
z_i = w_s·s_i + w_e·e_i + w_m·m_i + w_k·k_i − w_a·a_i
Δ   = z₍₁₎ − z₍₂₎        （候选集合级，不作为单候选特征）
```

| 符号 | 含义 | 代码来源 | 真实数据 |
|---|---|---|---|
| `s` | 语义匹配度 | `scoreIntentCandidates().score / 100` | 规则层对同一候选的最强规则 + 佐证加分（0-100） |
| `e` | 表达明确度 | `explicitnessOf()` | 短语级标记（权重 ≥80）→1；仅事实谓词推断→0.55；中等→0.6；词面线索→0.35 |
| `m` | 信息完整度 | `completenessOf()` | 按目标标签判定：查询要有对象、计划要有动作+范围、纠正要带新值 |
| `k` | 上下文一致性 | `contextFitOf()` | **独立轮次恒为 1，与历史无关**；指代轮次才取值：共享内容 1 / 无关历史 0.2 / 无上文 0 |
| `a` | 歧义程度 | `ambiguityOf()` | 未解析指代 +0.6、自述困惑 +0.8、指示词 +0.3、否定 +0.15、反讽 +0.3、候选竞争 +0.2 |
| `Δ` | 候选区分度 | `assessIntentConfidence()` | 排序后前两名 z 差 |

权重（源码 `INTENT_CONFIDENCE_WEIGHTS`，非负、和为 1）：

```ts
{ semantic: 0.1, explicitness: 0.6, completeness: 0.1, context: 0.1, ambiguity: 0.1 }
```

阈值（源码 `INTENT_CONFIDENCE_BANDS` / `INTENT_MARGIN_FLOOR`）：`high 0.62`、`medium 0.45`、`clarify 0.42`、`marginFloor 0.08`。

### 2.2 权重怎么来的（不是拍脑袋）

`scripts/b1-calibrate.ts` 在**两套标注集**上网格搜索：

- 本任务新建的开发集：`evals/stage-2/b1-devset.json`（26 例，覆盖明确/模糊/隐含/多义/缺上下文/无关历史/冲突历史/纠正/否定反讽/候选并列/需确认动作）
- 既有 fixture 语料：`evaluation/fixtures/cognitive-turn-v1.json`（26 例）

搜索空间与**原则性约束**（不是调参旋钮）：

- 步长 0.1、和为 1；每个特征的权重 ≥0.05（丢弃特征等于坏模型）
- `completeness ≤ 0.2`：它是文本形状代理（长度、有无动词/范围词），不允许主导
- `context ≤ 0.3`：上下文一致性只应调制，不应成为全部
- `semantic + explicitness ≥ 0.5`：描述"这轮在说什么"的特征必须占多数
- 平手时取 `semantic + explicitness` 更高者（同样准确率下更依赖证据）

结果：

```
dev 18/18   holdout 8/8   all 26/26   fixture 26/26
```

holdout 是按每 3 例取 1 例、**未参与选择**的切分。两套共 52 例都判对——但这仍是小样本，**不构成校准**，对外只称 `uncalibrated_heuristic`。

### 2.3 决策规则（真的接在策略上）

```ts
const strategy =
  hasUnresolvedReference || correctionNeedsDetail || assessment.needsClarification
    ? 'clarify'
    : decision.needsMemoryRetrieval ? 'retrieve_memory' : 'answer'
```

`assessment.needsClarification` 的三种来源：

1. **未解析指代硬闸**（`unresolvedReference`）：没有任何上文且本轮含指示词/指代 —— 这是**前置条件**，不是 0.06 的扣分。首版把它当惩罚，被 0.6 的完整性权重淹掉，"那个怎么办？" 照样被回答。
2. **方向改变 + 边际过窄**：`directionChanging && Δ < marginFloor`。`directionChanging` 用**有效检索需求**比较（`retrievalNeedOf`），不是静态表——否则"How does photosynthesis work?"这种一般问句会因为 `information_query` 在表里标着"检索"而被误判成方向冲突。
3. **低分 + 高歧义 + 方向改变**：`z₁ < clarify 且 a₁ ≥ 0.5`。

保护规则：

- 显式纠正优先于任何历史推断（`correctionNeedsDetail`）；"不对"（无新值）追问，"我说的是上海"（有新值）不追问。
- 高影响动作仍走既有授权门控——B1 只决定"要不要问"，不能绕过 `authorize()`。
- 检索**路由**保持由规则层决定：指代可能指向只存在记忆里的事实（"那我之前说的茶呢？"），按分数改路由会静默丢掉召回。

### 2.4 B1 证据

| 类型 | 位置 | 断言 |
|---|---|---|
| 单元 | `src/cognition/intent-confidence.test.ts`（10 条） | 权重归一且非零；同句三档历史同分；指代仅在有共享内容时得分；歧义降分；按 z 排序；share 和为 1 且标 `uncalibrated_heuristic`；无候选不追问；未解析指代必追问；两读数同路由不追问 |
| 分析器 | `src/cognition/cognitive-turn-analyzer.test.ts`（6 条 B1 组） | 三档历史同分且同策略；未解析指代 → clarify；有相关上文 → 不 clarify；"嗯。"无候选不追问；纠正压过上下文；清晰请求跨历史同策略 |
| 应用级 | `src/app/b1-strategy-payload.integration.test.ts`（3 条） | payload 含 `response route=clarify` 与澄清指令；同一句有上下文后不再出现；清晰个人问题在无关历史下仍 `retrieve_memory` |
| 校准 | `evals/stage-2/results/2026-10-30T07-24-29-516Z-d856e25-cognitive.json` | dev 18/18、holdout 8/8、fixture 26/26、historyContrast.identical=true |

### 2.5 实现过程中修掉的真实缺陷（都不是"为了让测试过"）

| 缺陷 | 现象 | 修法 |
|---|---|---|
| 短问句被当指代 | "我住在哪里？" + 任意历史 → `continuation` | 短问句回退加 `!INFORMATION` 条件 |
| 无候选被当追问 | "嗯。"、"谢谢" → clarify | 无候选分支 `needsClarification: false`（没有竞争解读就没有方向可错） |
| 排序与评分不一致 | 出现负 margin（第二名的 z 高于第一名） | 先算 z 再排序 |
| 纠正详情阈值 | "我说的是上海" 被当成"没有详情" | `wordCount ≤ 2`；并补 `我说的是/我不是说` 模式 |
| 回忆请求不检索 | "我之前说的茶呢？" → answer | `retrievalNeedOf` 里显式召回请求直接命中 |
| 个人指代过宽 | "how do I cook rice" 被当个人查询 | 收窄为 `do i like/prefer/have/…` 这类问既有事实的句式 |

---

## 3. B4：真实中断 → 恢复闭环

### 3.1 生命周期

```
received → analyzed → context_ready → awaiting_consent → requesting → response_received → committed
任意可恢复阶段 → recovery_required → recovering → committed（意图已落库、消息已提交）
                                              └→ failed（消息未提交，安全失败）
```

新增 `recovering` 状态（`turn-state-machine.ts`，前驱 `recovery_required`；后继 `committed`/`failed`/`cancelled`），使轨迹能区分"已知损坏"与"正在修复"。

`recoverInterruptedTurns()` 现在按顺序记录 `recovery_required` → `recovering` → 终态，并只在**消息已存在**时应用意图（幂等：turn context 是按 turn_id 的 upsert，feeling 事件与已提交状态比对）。

### 3.2 故障注入测试（`src/app/b4-recovery.integration.test.ts`，4 条）

| 场景 | 注入方式 | 断言 |
|---|---|---|
| 提交前中断 | `ConversationService.appendMessage` 对 assistant 抛错一次 | 用户消息 1 条、assistant 0 条；恢复后 `interrupted=1`；**provider 调用次数不变**；turn context 为 `failed`；二次恢复 `completed+interrupted=0` |
| 提交后意图残留 | 最终化仓库 `remove()` 空转一次 | 恢复 `completed=1`；assistant 仍 1 条、user 1 条；provider 只被调用 1 次 |
| 删除会话后恢复 | 中断后 `deleteConversation` | `completed=0`，会话仍不可读——不复活 |
| 重启后恢复 | 关闭并重开 SQLite | 恢复 `interrupted=1`，消息计数不变 |

---

## 4. B5：反思对下一轮产生可验证影响

### 4.1 之前为什么两臂无差异

旧夹具只有 4 轮对话、没有保存的记忆。反思的贡献是**从记忆补充兴趣证据**，而对话轮次本身就贡献消息证据——没有记忆就没有差别。这不是"反思无用"，是夹具没给它输入。

### 4.2 正向夹具（`scripts/reflection-positive.ts`）

```
2 条同主题记忆（同一会话的事件）  → 反思产出 1 条候选兴趣（每次运行最多 1 条）
2 条同主题对话（另一会话）        → 消息证据
────────────────────────────────
full 臂：3 条证据 / 2 个会话 → active → 下一轮 payload 出现注意力块
off  臂：2 条证据 / 1 个会话 → candidate → 无块
```

探针轮次发在**新会话**里，所以主题只能经长期层到达 payload，不可能来自会话历史。

结果（`evals/stage-2/ablation/results/2026-10-30T07-24-31-267Z-d856e25-reflection-positive.json`）：

| 层次 | full | no_reflection |
|---|---|---|
| 反思运行 | 5 次 | 0 次 |
| 产生候选 | 有 | 有（来自消息） |
| 通过门控（active） | **是** | 否（2/1，差一个会话） |
| 下一轮 payload 改变 | **是**（含注意力块） | 否 |

撤回两条记忆后重发探针轮：注意力块消失（`afterRetractionHasAttentionBlock=false`）——与 P0-A 的证据失效规则一致。

### 4.3 结构化 schema（迁移 26）

`reflection_findings.kind` 从 5 类扩到 7 类，覆盖任务要求的六类语义：

| 要求 | kind |
|---|---|
| 观察/事实候选 | `memory_gap` |
| 意图理解修正 | **`intent_correction`**（新增） |
| 兴趣候选 | `interest_candidate` |
| 人格/偏好调整建议 | `bias_hint` |
| 未解决问题 | `open_question` + `consistency_note` |
| 下一轮行为建议 | **`next_turn_suggestion`**（新增） |

每条发现都带 `evidence`（事件/记忆/自我模型条目 id）、`confidence`、`run_id`、`created_at`；兴趣候选的"候选/已确认"由 `interests.status` 承担，撤回语义由证据账本承担。反思推测不会写成已确认事实。

---

## 5. 变更文件

**新增**

- `src/cognition/intent-confidence.test.ts`（重写）
- `src/app/b1-strategy-payload.integration.test.ts`
- `src/app/b4-recovery.integration.test.ts`
- `scripts/b1-calibrate.ts`
- `scripts/reflection-positive.ts`
- `evals/stage-2/b1-devset.json`

**修改**

- `src/cognition/intent-confidence.ts`（五特征模型 + 门控）
- `src/cognition/intent-decision.ts`（导出候选评分、`retrievalNeedOf`、`referenceDependenceOf`；修 6 处缺陷）
- `src/cognition/cognitive-turn-analyzer.ts`（策略消费 assessment；可注入覆盖）
- `src/cognition/turn-state-machine.ts`（新增 `recovering`）
- `src/app/companion-service.ts`（恢复顺序、`recovering` 记录）
- `src/self-model/reflection-service.ts`（两类新发现）
- `src/self-model/self-model-domain.ts`（kind 枚举）
- `src/persistence/migrations.ts`（迁移 26）
- `src/persistence/migrations.test.ts`、`src/self-model/self-model.test.ts`（新增断言）

---

## 6. 命令与结果（`d856e25`，工作区干净）

验证日志：`evals/stage-2/results/2026-10-30T07-24-53-d856e25-verification.txt`

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | — |
| `npx vitest run --maxWorkers=2` | 0 | **77 files / 676 tests** |
| `npm run build` | 0 | — |
| `npm run eval:stage2` | 0 | 12 executed / 12 passed / blocked 2 / notRun 0（45 断言）→ `results/2026-10-30T07-26-54-d856e25.json` |
| `npm run eval:topic-identity` | 0 | P 1.000 / R 0.889（26 对，未变） |
| `npm run eval:ablation` | 0 | 四臂 → `ablation/results/2026-10-30T07-27-02-d856e25.json` |
| `npm run smoke` | 0 | Electron 默认沙箱通过 |

专项结果：

- B1 校准：`results/2026-10-30T07-24-29-516Z-d856e25-cognitive.json`
- B5 正向消融：`ablation/results/2026-10-30T07-24-31-267Z-d856e25-reflection-positive.json`

---

## 7. 限制（不要读过头）

- **分数不是概率**。权重来自 52 例小样本；`calibration` 字段保持 `uncalibrated_heuristic`，softmax 只作为 `share` 展示。
- **B1 只决定"要不要问"**，不决定检索路由，也不绕过授权门控。
- **B4 覆盖的是本进程能重放的中断**：崩溃发生在意图写入之后、消息提交之前。更早的中断（尚未写意图）没有可恢复证据，按失败处理。
- **B5 的消融是 1 个夹具**：证明接线存在且门控是决定性的，不是效率估计。
- 真实 Provider、CI、安装器升级沿用上一轮结论（外部条件），本轮未重跑。
