# Morrow Evaluation Suite 蓝图（工作包 D）

- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 定位：**在现有 6 个 stage 评测资产之上设计统一的 Morrow Evaluation Suite（下称 MES）v2 蓝图**，不重复造轮子：现有 evals/ 已覆盖大量场景（365 文件），本蓝图的工作是统一 schema、补齐缺口、固化指标公式与分母、建立可比较性规则。
- 纪律：每类评测给少量高价值样例而非海量低质量场景；客观断言与主观评分严格分离；状态词汇沿用仓库既有 PASS/FAIL/SKIPPED/BLOCKED/NOT_RUN/PENDING_HUMAN/EVIDENCED_ELSEWHERE（`evals/stage-3/runner/cli.ts` unmeasured 块、`evals/final-product/run.ts`）。

---

## 1. 设计原则（从现有资产提炼）

1. **离线/在线分离**（现有核心设计，保留）：离线用 ScriptedProvider（`evals/stage-3/runner/harness.ts:55-70`），结果文件明标 `provider: 'scripted-offline (not a model)'` 并携带 unmeasured 清单；live 用 `MORROW_TEST_API_KEY` 单一入口、缺 key 写 `BLOCKED_NO_SECRET` 一等结果、写盘前 `assertNoSecret`（`evals/stage-3/shared/real-provider.ts:111-183`）。
2. **客观断言只测可机判信号**：序列化 payload 内容、SQLite 状态、operation block、事件审计、状态机序列。主观质量（自然度/温度/人格感）只进真人盲评，**模型不给自己打分**。
3. **评测必须能失败**（`tests/eval-assertions.test.ts` 已确立）：喂旧实现会误过的输入必须 FAIL。
4. **每个结果可溯源**：记录 MORROW_EVAL_SHA + workingTree dirty 标志 + 数据集版本（现有 real-provider.ts:134-161 已做，推广到全部 runner）。
5. **不可比就明说**：不同 Provider/不同模型/不同数据集版本的结果不放同一张对比表（见 §5 每指标的"不可比条件"）。

---

## 2. 现状盘点与缺口矩阵

| 评测域 | 现有资产 | 缺口（MES v2 要补） |
|---|---|---|
| 多轮/跨会话语境 | stage-3 L1-L16（16 场景）、long-conversation、restart | 显式主题切换/指代回指场景少（对应算法 A1-c）；跨会话语境恢复断言偏隐式 |
| 记忆 | M1-M10（10 场景）+ M3 合成检索 A/B（precision/recall/attribution/6 类泄漏门禁）+ correction-round | 同义改写查询集缺失；误召回率无独立指标（只测命中）；撤回泄漏有门禁但无专门场景集 |
| 人格稳定/跨 Provider | stage-3 longitudinal（假时钟）、topic-identity | 人格式稳定性无量化指标（Personality Drift 未定义）；跨 Provider 连续性无场景 |
| 情绪 | stage-5 12 场景（关系临场感） | 情绪连续性无量化（跨轮 valence 与用户输入极性的相关性）；表达标签一致性靠人工 |
| 兴趣/自我模型 | stage-2/3 interest 场景、morrow-attribution 测试 | 兴趣证据性（证据→晋升全链）场景少；自我模型未确认条目不进 prompt 的负向断言缺 |
| 目标确认/反思路由 | eval L10（detect→prompt）、goal-lifecycle 测试 | 候选确认 UI 闭环场景（Stage 4 交付后才能写）；反思路由 open_question 场景缺 |
| Consent/IPC/路径/密钥/隐私 | acceptance A-H（含泄漏扫描）、provider-policy 测试、M4 13 项 safetyLeakCounts 全 0 | IPC 通道级 fuzz 无；路径穿越只有单测（无场景级） |
| Provider 失败/取消/重试/崩溃 | provider-retry、turn-reliability、b4-child-crash（4 阶段 SIGKILL）、turn-state-sequence | 场景级（非单测级）恢复一致性缺 |
| 安装/升级/迁移/备份 | migrations.test（v1→v47）、smoke --verify-upgrade、backup-service 16 测试、CI windows-install-path | 场景级备份→删除→恢复→撤回边界链缺（AUD-04 对应）；NSIS 全流程人工 |
| 性能/延迟 | 无系统性 | Latency/Error Rate 指标完全缺 |

---

## 3. 统一场景 Schema（MES v2）

```jsonc
{
  "schema_version": "mes-v2.0",
  "case_id": "MES-MEM-003",           // 类别前缀 + 序号
  "category": "memory",               // §4 的十类之一
  "title": "同义改写召回：居住地",
  "dataset_version": "mes-ds-2026.11",// 数据集 semver，改动即升版本
  "provider_mode": "scripted",        // scripted | live-replay | live
  "preconditions": {                  // 前置状态：通过 API/fixture 构造，不依赖对话顺序
    "seed_conversations": [...],      // 固定 id 的种子对话与消息
    "seed_memories": [...],           // 显式插入的记忆（带 sensitivity/confidence）
    "seed_state": { "feeling": {...}, "personality": {...} },
    "clock": "2026-11-01T08:00:00Z"   // 假时钟注入（longitudinal 模式已有）
  },
  "turns": [                          // 对话序列：每轮含 user 输入与 scripted 响应
    { "user": "...", "scripted_reply": "...", "expect_events": [...] }
  ],
  "assertions": {                     // 客观断言（全部可机判）
    "sql": [{ "table": "...", "where": "...", "expect": "..." }],
    "payload": [{ "jsonpath": "...", "contains_any": [...] }],  // 发往 Provider 的请求
    "events": [{ "kind": "memory.retrieval_miss", "count_gte": 0 }],
    "payload_sha_leak_scan": ["sk-", "api_key", "用户身份证号样例"]
  },
  "subjective_dimensions": ["naturalness", "warmth"],  // 声明哪些维度留给真人盲评
  "failure_conditions": ["any assertion fails", "crash", "timeout>90s"],
  "repeat": { "runs": 3, "seed": 42 } // 确定性重放；live 模式 runs=1 且标注
}
```

规则：`preconditions` 必须可用 API/fixture 构造（现有 eval harness 已支持 seed）；`assertions.payload` 是一等公民——**断言发往 Provider 的真实序列化请求**（继承 `tests/c1-mainchain.test.ts` 的做法），这是防止"内置状态没进真实请求"的唯一硬证据。

---

## 4. 十大评测类别定义

每类给出：场景要素、前置状态、客观断言重点、主观维度、失败条件。样例统一放 §6。

1. **MES-CTX 多轮/跨会话语境**：前置=会话 A 若干轮 + 话题切换；断言=检索 query 扩宽内容、指代消解结果（payload 里被代入的实体）、跨会话新会话首轮召回上一会话记忆；主观=上下文衔接自然度。失败=query 带过时主题词（若实现 A1-c）。
2. **MES-MEM 记忆**：四组——正确召回（改写/直引）、误召回（相近主题不同事实）、冲突与纠正（新值覆盖旧值后 payload 只出当前值+冲突标记）、撤回与删除（撤回后任何轮的 payload 与 SQL 都不可见；删除后含索引级联）。断言重点是 payload 级而非 UI 级。
3. **MES-ID 人格式稳定与跨 Provider 连续性**：前置=固定人格基线+预置 growth 证据；断言=同一人格输入在 scripted 序列下 system prompt 人格段逐字节稳定；跨 Provider=同一对话历史切换 provider 配置后 payload 的人格/记忆/情绪块不变（对 Provider 无关性断言）；主观=人格感一致度盲评。Personality Drift 指标见 §5。
4. **MES-EMO 情绪连续性**：前置=注入情绪事件序列（含假时钟）；断言=state 表衰减数值（公式重算比对）、表达策略分支（distress→先承认）、检索宽度放宽边界（+2/上限 25）；主观=情绪表达自然度。
5. **MES-INT 兴趣与自我模型证据性**：断言=证据行→晋升阈值→状态转移全链（SQL 断言）、origin 隔离（morrow 证据不推用户兴趣）、未确认 inference 不进 prompt、counter 冻结晋升；主观=兴趣提及的时机适宜度。
6. **MES-CONF 目标确认与反思路由**：断言=goal candidate 生命周期（pending→accept/reject→终态、复活不可能）、路由表全 kind 覆盖（registry 完整性：每个 producer kind 恰一条 route）、未知 kind fail-closed 留审计、hint 一次性消费；主观=反思建议呈现措辞。
7. **MES-SEC Consent/IPC/路径/密钥/隐私**：断言=无 consent 不出网（3 处 dispatch 全检）、敏感记忆默认不出 payload、哈希不匹配拒绝、IPC 越权/子帧拒绝、路径注入拒绝、journal/payload 密钥形状扫描（复用 assertNoSecret）；主观=consent 对话框可读性（人工）。
8. **MES-RES Provider 失败/取消/重试/崩溃**：断言=重试序列与 Retry-After 遵守、已出字流不重放、取消后无半截消息（SQL 无 assistant 行）、SIGKILL 四阶段恢复（复用 b4 矩阵）、中断 turn 标 INTERRUPTED 不重发；主观=错误提示文案质量。
9. **MES-OPS Windows 安装/升级/迁移/备份**：断言=vN→v47 迁移数据保留（构造旧库）、备份 manifest 校验、恢复后删除边界重放正确（含 AUD-04 回归：恢复后再转移成功）、卸载保留数据；执行载体=CI windows-install-path + smoke --verify-upgrade + 打包验收脚本（建议纳入 CI 的独立 job）。
10. **MES-PERF 延迟与错误率**：断言=turn 端到端时延分布（scripted 下测的是主链开销）、检索耗时（含 >1000 记忆压力集）、错误分类正确率；见 §5 Latency/Error Rate 公式。

---

## 5. 指标公式（分母、采样、不可比条件）

统一记号：评估集为 C 个 case，每 case 可跑 r 次（repeat.runs）。

- **Memory Precision** = |{召回且相关}| / |{召回}|。分母=被注入 payload 的记忆条数（跨 case 累计）；相关判定=seed 元数据标注的 `relevant_to_turn` 字段（规则可判，主题词/谓词匹配 + 人工复核样本）。采样：全量。不可比：不同 maxMemories 预算或不同数据集版本之间。
- **Memory Recall** = |{召回且相关}| / |{应召回}|。分母=seed 标注的该轮应召回集合（preconditions 显式给出）。**误召回率（Wrong Recall Rate）** = |{召回且相关集之外}| / |{召回}|（与 Precision 互补但按"有害误召回"子集统计：被注入且与当前话题冲突/过时的条数）。
- **Unsupported Fact Rate** = |{assistant 回合含事实性声明且 payload 无对应证据}| / |{assistant 回合含事实性声明}|。事实性声明检测：scripted 模式由剧本标注；live 模式由规则抽取（数字/专名断言）+ 人工复核。分母只数"含事实性声明"的回合（不是全部回合）。
- **Retraction Leakage Rate** = |{撤回后 payload 中出现该记忆}| / |{撤回操作数}|。目标恒 0（M3 泄漏门禁同款：retractedOrDeleted 计数）。分母=撤回操作次数；任何 >0 即 FAIL（硬门禁）。
- **Personality Drift** = 预置固定证据+固定输入序列下，首回合与末回合 system prompt 人格段的加权差：`Drift = Σ_d |p_d^(T) − p_d^(0)| / (4·100)`（四维各除满量程 100 归一）。**注意**：Drift 在"证据固定"前提下应恒为 0（payload 确定性）；nonzero 即确定性缺陷。**跨长时漂移**另用 longitudinal 模式测 G1 偏移 |offset_d|（预期 ≤8 且可回滚），两者不可混用。不可比：不同 growth 证据集之间。
- **Provider Switch Continuity** = 切换 provider 前后 payload 中人格/记忆/情绪/自我模型块的哈希一致率 = |一致块| / |比对块（4 类）|。目标 1.0；任何 <1.0 记 FAIL 并输出差异块。不可比：与未切换场景无关，仅限含切换步骤的 case。
- **Turn Completion** = |{user 消息得到 assistant 终态（成功或明确失败态）且无孤儿}| / |{user 消息数}|。孤儿=有 assistant 流式 delta 但无落库消息、或有 user 无任何 turn 终态。与现有 turn-state-sequence 断言对应。
- **Latency**：P50/P95 端到端（IPC send → 最后一个 delta 落库）；scripted 模式测主链开销（排除网络），live 模式另列。**Error Rate** = |{回合以 PROVIDER_*/IPC 错误终态}| / |{回合数}|（按错误码分桶）。不可比：scripted 与 live 的延迟不可同表；不同机器需附基准硬件说明。
- **反思命中（Reflection Hit Rate）** = used_observed / (used_observed + not_observed)，按 producer 分组——来自 `reflection_finding_routes` 消费追踪，是算法 A6-b 的直接数据源。
- **情绪连续性（Emotional Continuity）** = Pearson 相关 Corr(Δvalence_t, polarity(user_input_t))，极性由 seed 标注；预期显著正相关（ Spearman 备选）。不可比：不同事件注入序列之间。

所有指标结果文件必须携带：MORROW_EVAL_SHA、dataset_version、provider_mode、runs、硬件/CI 环境标识。

---

## 6. 首批高价值样例（15 个，宁缺毋滥）

1. MES-MEM-001 改写召回：seed"住杭州"→ 问"我们这边天气怎么样"→ 断言 payload 含杭州记忆（A2-a 语义通道关时应 FAIL——作为预期失败样例登记，打开开关转 PASS）。
2. MES-MEM-002 误召回：seed"猫叫团子"+"狗叫豆豆"→ 问"豆豆今天吃了什么"→ 断言 payload 不含猫记忆条目。
3. MES-MEM-003 冲突进视野：seed"住杭州"→ 用户说"我搬去苏州了"→ 断言 payload 同时含杭州记忆+冲突标记（A2-b 的回归锚）。
4. MES-MEM-004 纠正后旧值退场：纠正居住地后新轮 payload 只出现苏州（历史值块仅对"之前住哪"类问题出现）。
5. MES-MEM-005 撤回零泄漏：撤回"住杭州"后连续 3 轮无关话题 → 任意 payload 与 memories 查询均无该记忆；Retraction Leakage Rate=0。
6. MES-MEM-006 删除级联：硬删含事实账本的记忆 → fact_records/证据/重要性行全消失 + deletion_journal 一行 + secure_delete 生效（文件字节级抽查可选）。
7. MES-CTX-001 跨会话恢复：会话 A 谈项目 deadline → 新会话首轮"那个项目后来怎样了"→ payload 含 A 会话相关记忆且 query 扩宽正确。
8. MES-CTX-002 指代回指：上轮提及"团子"→ 本轮"它多大了" → 检索 query 含团子（A1-b 的回归锚）。
9. MES-ID-001 跨 Provider 连续性：同一对话历史在 deepseek 配置与 local 配置间切换 → Provider Switch Continuity=1.0。
10. MES-EMO-001 情绪衰减：注入 negative_feedback 后假时钟 +6h → 断言 valence 回到 |v|<0.05（半衰期公式重算）。
11. MES-CONF-001 candidate 确认闭环：含糊承诺 → candidate pending → IPC accept → goal active + candidate 终态 + 重启后一致（Stage 4 交付后启用）。
12. MES-SEC-001 无 consent 不出网：拒绝 consent 对话框 → 断言零网络调用（providerCalls=0）且记忆操作按 AUD-11 语义可解释（本 case 同时固化当前行为，修复后更新断言）。
13. MES-RES-001 取消一致性：流式 2 chunk 后取消 → SQL 无 assistant 消息、turn=cancelled、renderer 无残留流。
14. MES-OPS-001 恢复后转移：备份 → 撤回 → 恢复 → 对该记忆 confirm → 成功（AUD-04 回归锚，当前应 FAIL）。
15. MES-PERF-001 规模压测：seed 1100 条活跃记忆 → 断言 degradation 事件 `memory.retrieval_truncated` 出现（A2-d 回归锚）且 P95 检索 <50ms（本机基准）。

样例 1/3/14/15 被刻意设计为"当前基线上预期 FAIL"——它们是算法研究与审计发现的直接回归锚，先登记失败再随修复转绿，这正是 `tests/eval-assertions.test.ts` 原则的推广。

---

## 7. 自动化与真人盲评分工、防模型自评偏差

- **分工**：客观断言 100% 自动化（vitest 或 eval runner）；主观维度（自然度/温度/人格感/时机适宜度）100% 真人盲评——评审人只看对话转写，不知道 provider 与实现版本（转写文件剥离 modelId 字段后再交评审，参照 `evals/*/transcripts/` 模式）。评分表：每维度 1-5 + 一句理由；每场景 ≥2 名评审，Krippendorff's α ≥0.4 才采纳均分，否则该场景主观分标 PENDING_HUMAN。
- **防模型自评偏差**（三层）：①禁止用 LLM 给自然度打分充当真人评审（仓库已有纪律：不得用脚本自评冒充真人评审，Issue #37 §6 同款）；②LLM 只允许做**预筛**（标记可疑样本供人工优先看），其输出不进任何 PASS 判定；③凡涉及"模型行为是否自然"的断言，一律 scripted 剧本固定或人工——绝不引用被测模型自己的评价。
- **主观样本量**：首批 12 个 stage-5 临场感场景 + MES 主观维度场景，每轮盲评 ≤30 段对话（评审疲劳上限）。

---

## 8. baseline / candidate / ablation 对比方案

- **baseline**：固定研究分支起点 SHA（如本基线 3812b18）+ 数据集版本固定 → 产出 baseline 结果文件入库（模式照 `evals/stage-2/results/` 现状）。
- **candidate**：每个算法候选（03 文档 P1/P2 项）合并前在同一数据集版本上全量重跑，与 baseline 逐指标对比；**对比表必须同 provider_mode、同 dataset_version、同 runs**，否则拒绝比较。
- **ablation**：沿用 stage-3 ablation 4 臂模式（full / no_growth / no_exploration / no_reflection），MES v2 新增按候选算法命名臂（如 no_semantic_channel / no_contested_channel / no_dialogue_state）；每臂只关一个机制，产出"该机制对哪些指标负责"的证据。
- **回归门禁**：candidate 任一硬门禁指标（Retraction Leakage、safetyCriticalPassRate、payload 泄漏扫描）劣化即阻塞合并；非门禁指标劣化 >5% 需在 PR 说明。

---

## 9. 可重复性与版本策略

1. **数据集**：MES 数据集独立 semver（mes-ds-YYYY.M），种子内容变更即升版；历史版本保留（目录 `evals/mes/datasets/<ver>/`），旧结果永远可回放。
2. **确定性**：scripted 模式必须全路径确定性（假时钟注入 + 固定 id + 固定序列），`deterministicReplay` 检查（现有 cognitive 四件套已有该指标）推广到 MES 全部 runner。
3. **live 重放**：live 结果不可重复属预期，因此 live 结果只作证据不作门禁；门禁一律 scripted。
4. **CI 接线建议**：第一优先把 stage-3 harness（60 场景 final-closure）与 MES 前两类（MEM/SEC）纳入 CI 独立 job（时长可控）；打包验收脚本作为每周手动或 tag 触发 job（修复 AUD-38）。
5. **规模纪律**：MES 总场景数上限 120（十类 × ~12），任何扩容需先删后增或证明新场景对应未覆盖缺陷模式——落实"不得为凑数生成海量低质量测试"。

---

## 10. 与其他工作包的衔接

- 工作包 B 的每条 finding 若可用场景表达 → 进 MES（AUD-04→MES-OPS-001、AUD-09→MES-PERF-001、AUD-10→MES-MEM-003、BL-01→MES-CONF registry 完整性断言）。
- 工作包 C 每个算法候选声明了自己的离线指标与消融臂（见 03 文档各节），MES §8 提供执行框架。
- 工作包 E 路线图的"评测阶段"直接以本蓝图 §2 缺口矩阵为任务清单、§6 样例为首批交付。
- PR #38 §12 的 Agent 评测清单在伴侣本体验收后并入 MES（06 文档 §8 衔接说明）。
