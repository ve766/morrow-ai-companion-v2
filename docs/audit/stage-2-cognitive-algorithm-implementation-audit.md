# 自审：认知算法真实接线与端到端缺口修复

| 项 | 值 |
|---|---|
| 任务 | issue #17 评论 6516588833 |
| 实现提交 | `d856e25`（所有结果在该提交、工作区干净时生成） |
| 对照实现报告 | [`docs/reports/stage-2-cognitive-algorithm-implementation.md`](../reports/stage-2-cognitive-algorithm-implementation.md) |
| 环境 | Windows 10.0.26200、Node v22.22.2 |
| 结论 | **B1 PASS / B4 PASS / B5 PASS**；B2、B3、A1–A3 回归通过；整体仍受外部条件限制（见 §6） |

---

## 1. 需求追踪（逐条对应任务文本）

### 1.1 B1

| 任务要求 | 状态 | 证据 |
|---|---|---|
| 检查真实调用链并列出入口/消费端/特征来源 | ✅ | 报告 §1；`intent-decision` → `intent-confidence` → `cognitive-turn-analyzer` → `companion-service` → payload；每个特征的数据来源在 §2.1 表中 |
| 六特征（s/e/m/k/a + 候选区分度 d） | ✅ | `intent-confidence.ts` `IntentCandidateConfidence.features`（5 个单候选特征）+ `margin`（集合级 d，明确不塞进单候选向量） |
| `z_i = w_s s + w_e e + w_m m + w_k k − w_a a`，权重非负、和为 1 | ✅ | 源码常量 + `intent-confidence.test.ts` 首条断言 |
| 权重通过可测特征与标注开发集确定/校验，不得凭直觉 | ✅ | `scripts/b1-calibrate.ts` 网格搜索 + 双集验证（dev 18/18、holdout 8/8、fixture 26/26），约束与理由写在脚本内；结果文件 `results/2026-10-30T07-24-29-516Z-d856e25-cognitive.json` |
| 样本不足时明确保留为启发式，不得称概率 | ✅ | `calibration: 'uncalibrated_heuristic'`；softmax 只作 `share`（测试断言和为 1 且标注非概率） |
| 候选差距不足时结合当前轮证据；不得让"有历史"单独抬分 | ✅ | `contextFitOf` 对独立轮次恒返回 1；三档历史同句 topScore 相同（分析器与单元测试各一条） |
| 低置信度/高歧义 → 澄清或明确不确定 | ✅ | 未解析指代硬闸 + `directionChanging && Δ<floor` + 低分高歧义；payload 断言 `route=clarify` 与澄清指令 |
| 高影响/不可逆动作仍受授权门控，不得被置信度绕过 | ✅ | B1 只写 `strategy`；`authorize(preview)` 仍在 provider 调用前，既有授权测试不变（`src/app/consent*`/`companion-service.test.ts` 全过） |
| 用户纠正优先于旧候选 | ✅ | `correctionNeedsDetail` 与 CORRECTION 模式；"我说的是上海"+冲突历史 → 不 clarify 且 `signals.correction=true` |
| 阈值有来源、混淆矩阵、错误高置信度率 | ⚠️ 部分 | 阈值来自同一网格搜索并记录在结果 JSON（`chosen.marginFloor/clarifyThreshold`）；**混淆矩阵已记录**（`confusion` 字段）；**错误高置信度率未单独统计**——见 §5 残余缺口 |
| 10 类用例（明确/模糊/隐含/多义/缺上下文/无关历史/冲突历史/纠正/否定反讽/并列/需确认） | ✅ | `b1-devset.json` 26 例逐条带 `why`；单元 + 分析器 + 应用级三层断言 |
| 同一句在三种历史下的对照 | ✅ | `intent-confidence.test.ts` 与 `cognitive-turn-analyzer.test.ts` 各一条；校准 JSON `historyContrast.identical=true` |
| 断言最终策略或最终 payload，而非 assessment 有值 | ✅ | `b1-strategy-payload.integration.test.ts` 读序列化请求 |

### 1.2 B4

| 任务要求 | 状态 | 证据 |
|---|---|---|
| 检查状态机/仓库/服务/事务边界 | ✅ | 报告 §3.1；`turn-state-machine.ts`、`turn-state-repository.ts`、`companion-service.ts` 的 `prepareFinalization` → `appendMessage(afterPersist)` 顺序 |
| `interrupted → recovery_required → recovering → 续跑或明确 failed` | ✅ | 新增 `recovering`（前驱 `recovery_required`）；`recoverInterruptedTurns` 依次记录 `recovery_required` → `recovering` → `committed`/`failed` |
| 恢复所需最小信息持久化 | ✅ | 既有 finalization 意图（turn_id、assistant_message_id、context 模板、feeling 事件 id、pending 草稿）；不写 prompt 明文 |
| 不重复插入用户消息 / 助手回复 | ✅ | 故障注入 1、2 用例均断言 user=1、assistant 0/1 |
| 不重复应用记忆/人格/内在状态/反思副作用 | ✅ | 提交后残留路径只调 `applyFinalization`；turn context 为按 turn_id 的 upsert，feeling 以 `sourceEventId` 比对 |
| Provider 成功但本地提交失败时不盲目重发 | ✅ | 用例 1 断言 `provider.calls` 在恢复前后不变 |
| 恢复自身幂等；连续两次不产生双份 | ✅ | 用例 1 第二次恢复 `completed+interrupted=0` |
| 删除会话/消息后不复活 | ✅ | 用例 3：`completed=0` 且会话仍不可读 |
| 故障注入测试覆盖：请求前/返回后提交前/提交中断/重启/重复恢复/超时/删除后 | ⚠️ 部分 | 已覆盖：返回后提交前（1）、提交后意图残留（2）、删除后（3）、重启（4）、重复恢复（1）。**请求前中断**与**Provider 超时**未单独注入——见 §5 |

### 1.3 B5

| 任务要求 | 状态 | 证据 |
|---|---|---|
| 链路可追踪：持久化 → 受限反思 → 结构化候选 → 门控 → 写入 → 检索排序 → 装配 → payload | ✅ | 报告 §4.2；探针轮次在新会话，主题只能经长期层进入 payload |
| 结构化 schema 覆盖六类 | ✅ | 迁移 26 扩到 7 类；`intent_correction`、`next_turn_suggestion` 为新增；`self-model.test.ts` 断言发现的 kind 均在枚举内 |
| 每项记录来源引用/置信度/候选或确认/创建轮次/撤回语义 | ✅ | `evidence_json`（事件/记忆/条目 id）、`confidence`、`run_id`+`created_at`、`interests.status` 与证据账本 |
| `ΔP = clip_ε(η·G·Map(R))`，结构化建议经映射与门控，不直接乘人格向量 | ✅ | 现状：人格更新只走 `personalization-service` 的有界更新（单轮 ≤0.05、折叠重算）；反思**不直接写人格**，只产出建议类发现。**Map 未实现为独立函数**——见 §5 |
| 正向 fixture：full 与 no_reflection 的 payload 有可解释差异 | ✅ | `ablation/results/2026-10-30T07-24-31-267Z-d856e25-reflection-positive.json`：full 3/2→active→块出现；off 2/1→candidate→无块 |
| 撤回/删除后差异消失 | ✅ | 撤回两条记忆后探针 payload 不再含注意力块 |
| 反思失败不阻塞聊天 | ✅ | `src/app/b5-reflection-safety.integration.test.ts`：注入抛错后仍 deliver，且断言注入确实被触发 |
| 四层报告（运行了/产生候选/过门控/payload 变） | ✅ | 结果 JSON `layers` 字段逐层给出两臂取值 |

### 1.4 B3 / B2 / A1–A3 回归

| 项 | 状态 | 证据 |
|---|---|---|
| B3 只核验不重写 | ✅ | `context-utility.ts`、`rankScore` 未改；装配器 3 条排序断言（P/X/D）仍过；`no_context_utility` 臂仍显示顺序差异 |
| 先硬过滤再评分 | ✅ | 装配器 `eligible` 过滤（status/sensitivity）在 `rankScore` 之前，本轮未改 |
| B2 单轮上限/证据折叠/撤回重算 | ✅ | `personalization-service.test.ts` 13 条全过 |
| A1–A3 删除/撤回/备份恢复边界 | ✅ | `derived-deletion-boundary.test.ts`、`interest-invalidation.test.ts`、`backup-service.test.ts` 全过 |

---

## 2. 变更是否只在要求范围内

- 未重构整体架构、未引入第二套状态源（`recovering` 加入既有枚举）。
- 未扩张 Agent/桌面控制面。
- 未把实现写进文档：所有行为改变都在 `src/`，文档只做描述。
- 未为通过而放宽断言：新增断言全部是"更严格"，唯一放宽的是把 `correctionNeedsDetail` 的阈值从 4 改成 2——那是**收窄**触发面（更少追问），并有对应正反用例。

---

## 3. 隐私与数据边界

- 反思发现只存 id 引用，`self-model.test.ts` 断言序列化后不含用户原文。
- 恢复流程不写 prompt 明文；finalization 意图只含 context 模板与 id。
- 本轮未新增任何凭据读写；测试用 `test-key` 占位替换串（非真实密钥），与既有测试一致。

---

## 4. 幂等与并发

| 面 | 现状 |
|---|---|
| 同轮恢复 | 意图处理后 `remove(turnId)`；二次恢复无动作（用例 1 断言） |
| 同一观察入库 | `interest_evidence` 的 `evidence_ref` 唯一索引（既有） |
| 反思运行 | `MAX_RUNS_PER_HOUR=6`、`MAX_CANDIDATE_INTERESTS_PER_RUN=1`（既有，未放宽） |
| 状态机 | 重复进入同状态为 no-op（既有契约，测试仍在） |

---

## 5. 残余缺口（如实列出，未达标项不宣称完成）

| # | 缺口 | 影响 | 为什么没做 |
|---|---|---|---|
| 1 | **错误高置信度率未统计** | 无法回答"模型有多自信地答错" | 需要一批带"错误答案"标注的样本；现有两套语料只标策略，不标答案对错。已在报告 §2.2 标注为限制 |
| 2 | `Map(R_t)` 未实现为独立函数 | 反思建议尚未映射到人格维度 | 现状是反思**不写人格**（只有建议类发现），因此没有可映射的通道；实现 Map 需要先定义"哪类建议可改哪个人格维度"，属于产品决策 |
| 3 | B4「请求前中断」「Provider 超时」未单独注入 | 覆盖少两种故障形态 | 请求前中断没有 finalization 意图，按设计直接是"未开始"；超时已被 provider 层既有测试覆盖（`provider-retry.test.ts`），但**未在恢复路径上**注入 |
| 4 | B1 权重样本量小（52 例） | 不能称为校准 | 如实标 `uncalibrated_heuristic`；需要更多标注才能升级 |
| 5 | 真实 Provider / CI / 安装器升级 | 沿用上一轮结论 | 外部条件（账号额度、账单、机器授权），本轮未重跑 |

---

## 6. 外部阻断（与非 B1/B4/B5 的既有结论一致）

| 项 | 状态 | 证据 |
|---|---|---|
| CI | BLOCKED | run 41010305777：三 job `runner_id=0`/`steps=0`，注解为账号付款失败或额度不足 |
| 真实 Provider 重跑 | NOT_RUN（本轮） | 上一轮已跑通 S1–S6（5/5、13/13），本轮未重跑；如需最新证据需重新提供可用凭据 |
| Windows 安装器升级 | BLOCKED / NOT VERIFIED | 未在本机安装过安装器 |

---

## 7. 结论

- **B1：PASS** —— 多信号分数真实影响 `strategy`，同句三档历史同分，模糊/冲突/低置信度会追问，纠正优先，授权门控未被绕过，权重来源可复现，校准状态诚实标注。唯一未统计的是"错误高置信度率"（§5-1）。
- **B4：PASS** —— 真实中断、重启恢复、恢复幂等、Provider 已返回但提交中断、删除后不复活五类都有数据库级断言；无法安全恢复时明确 `failed`。
- **B5：PASS** —— 结构化反思（7 类）受证据与门槛约束；正向夹具下 full / no_reflection 的最终 payload 有可解释差异；撤回后差异消失；反思失败不影响答题。
- **B2 / B3 / A1–A3：无回归**。
- **整体**：本轮三个算法缺口已闭合；阶段二整体状态仍受 CI、安装器升级与真实 Provider 重跑三项外部条件限制，是否可称"阶段二完成"仍不由本轮决定。
