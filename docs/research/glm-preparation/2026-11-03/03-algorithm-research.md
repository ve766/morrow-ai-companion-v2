# Morrow 七大核心算法研究（工作包 C，只研究不实现）

- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 性质：算法研究文档。当前实现部分全部来自源码核实（文件:行号）；候选算法部分是研究建议，**不代表已实现能力**；所有外部参考在文末列出（URL+访问日期）
- 全局前提（产品原则不可改变）：先完成伴侣本体；Agent 行动能力最后开发；模型推断不得升级成用户事实；短期状态不得随意覆盖稳定人格

---

## 0. 统一状态契约（所有算法共享）

Morrow 的内核已经隐式实现了六层状态分离，任何新算法必须显式对齐该契约：

| 层 | 内容 | 当前实现载体 | 写入者 | 可否被其他层覆盖 |
|---|---|---|---|---|
| L1 稳定人格 | warmth/directness/humor/disagreementStyle 基线 | `personality_profiles`（单行 primary）+ `personality_revisions` 版本化 | 仅用户 IPC（personalitySave/Restore）；turn 路径零写入 | 不可。L2/L3 只读它 |
| L2 有界偏移 | Morrow 风格成长 G1、用户交互画像 G2、B2 个性化 | `personality_growth_*` / `user_interaction_*` / `personalization_*` 证据账本 | turn 证据投影（规则），账本折叠幂等 | 不可覆盖 L1；有界（G1 ±8/100）、可回滚 |
| L3 短期内在状态 | 情绪三维+注意力 | `cognitive_feeling_events`（事件溯源）+ state 快照 | 规则引擎事件（带 idempotency_key） | 不写 L1/L2；只影响表达与检索宽度 |
| L4 用户明确事实 | 记忆（user_explicit_input / model_inferred_confirmed） | `memories` + revisions + fact_records（provenance） | 用户输入/用户确认的建议；turn 显式写路径 | correct（用户主导）可修正；撤回/硬删保留主数据 |
| L5 模型推断（未确认） | 记忆建议、人格假设、反思 findings、知识缺口 | `memory_suggestions` / `pending_personality_candidates` / reflection findings / `knowledge_gap_evidence` | 模型产出或规则投影，全部带 provenance+algorithm_version | **升格规则：L5 → L4 必须经 L6 用户确认**；绝不直接写 L4 |
| L6 待确认候选 | pending items、goal candidates | `cognitive_pending_items` / `goal_candidates` | 派生层，幂等 dedupe | 用户决策 → done/dropped 终态不可逆 |

**升格矩阵（新算法必须遵守）**：
- 模型输出 → L4：只允许走 `memory_suggestions` 审核流（`memory-service.ts:204` 附近、`companion-service.ts:2607-2611`，确认后 `model_inferred_confirmed, confidence=70`）
- L3 情绪 → prompt/检索：允许（只影响表达与召回宽度，`retrieval-attention.ts:52-67`）；L3 → L1/L2：禁止
- L2 偏移 → prompt：允许（`applyGrowth` clip 到基线+offset）；L2 → `personality_profiles` 写入：禁止（`:4-6`）
- L5 反思 finding → prompt：只允许经路由表白名单 + hint 框架（"内部假设，须验证，非用户事实"，`reflection-routing.ts:265-273`）
- 一切证据带 `algorithm_version` 与 provenance；一切幂等键显式定义

---

## 1. 语境理解（主题、意图、指代、对话状态、不确定性）

**当前实现位置**：
- 意图：`src/cognition/turn-context.ts` + `intent-decision.ts`/`speech-act.ts` 产出 13 种意图（`retrieval-policy.ts:35-98` 各意图绑定检索策略），落 `intent_readings` 表；意图准确率有离线评测（`eval:stage3:intent`，C1-S1~S6 语义集）。
- 指代与查询扩展：`buildRetrievalQuery`（`companion-service.ts:254-272`）当前消息必入 + 指代消息 + 上轮用户消息（widen）；`src/cognition/context-window.ts` 做指代消解与历史窗口；"之前/以前"类历史值块 `historyBlock:136-149`。
- 主题：无显式对话主题状态；`topic-identity.ts` 的 n-gram 评分（阈值 0.45/0.35）目前只服务兴趣同一性判定，不服务对话状态跟踪。
- 不确定性：turn 分析产出 confidence/uncertainty 标签，进入 `cognitivePromptGuidance`（`companion-service.ts:190-238`）；"不确定 ≥0.55 → prefer-clarify"（`expression-policy.ts:187-239`）。
- 不足：①指代消解纯规则（人称代词+最近实体），无实体库支撑；②意图 13 类固定，未见分层（粗 speech-act → 细意图）；③不确定性是规则标签，从未做经验校准；④跨会话"对话状态"无显式载体（靠记忆检索与反思 hint 隐式恢复）；⑤主题跟踪缺失导致检索 query 扩宽可能带上过时主题词。

**候选算法**：

- **A1-a 分层意图判定（粗到细，规则优先+模型兜底）**：第一层 speech-act 规则分类（已有）；第二层细意图仅在第一层歧义（两候选分差 <δ）时调用小模型二选一。公式：`if top1.score - top2.score < δ then model_refine(top2 candidates)`。δ 默认 0.15（开发集校准）。收益：消歧准确率上升；代价：歧义回合多一次模型调用；回归风险：模型兜底路径引入非确定性——须固定 temperature=0 并落 intent_readings 审计。优先级 **P3**（现有 13 类意图在 eval 中语义集准确率尚可）。

- **A1-b 检索式指代消解（实体库 = 记忆 + 兴趣 + 目标）**：代词/省略主语出现时，以"当前消息去除代词后的内容词"查询实体库（active 记忆的 fact_records 值 + active 兴趣标签），取词面/槽位最高分实体代入。得分：`score(e) = 1.0·[值词面命中] + 0.6·[谓词匹配] + 0.4·0.5^(ageDays/7)`（最近实体优先，7 天半衰期）。消解结果不落 L4，只进当轮 retrieval query（即它只影响召回，不制造事实）。复杂度 O(|实体库|·|query 词数|)，实体库 ≤1000（受 AUD-09 同一上限约束）。对抗输入：多个同类实体（"我妈和我姐"）→ 保守返回多候选交由 RRF 排序，不强行唯一化；歧义度高于阈值时把消解标记 uncertain 交给认知引导。优先级 **P2**。

- **A1-c 显式对话状态（per-conversation dialogue state）**：新表 `conversation_dialogue_state`（conversation_id PK、current_topic_text、current_topic_fingerprint、active_entity_refs JSON、pending_question、updated_turn_id），每 assistant 轮提交后由 outbox projector 更新；主题指纹沿用 topic-identity n-gram（复用同一阈值，避免第二套真相）。更新规则：新消息与 current_topic 相似度 ≥0.45 → 保持；0.35–0.45 → 主题待定（双主题并列）；<0.35 → 切换。检索 query 扩宽仅当状态保持时启用（消除过时主题污染）。持久化与恢复天然支持跨会话。优先级 **P1**（直接改善语境丢失与误扩宽，成本可控，全部为本地规则）。

- **A1-d 不确定性校准（reliability diagram）**：把规则/模型 confidence 桶化（每 10 分一桶），用评测回放集统计桶内经验准确率，拟合线性校准 `conf_cal = a·conf + b`（或 isotonic）。先从意图与记忆证据两处开始（两者都有客观对错）。默认参数：a=1,b=0（未校准前不做变换，只报告校准曲线）。优先级 **P2**（是 A7-d 全内核校准的第一步）。

**正/反例**（A1-c）：用户连说"它怎么也坏了？"——规则指代可能落到错误宾语；显式状态若记录 active_entity_refs=[coffee_machine]，query 扩宽带上 coffee_machine，召回设备维修记忆。反例：话题已从"搬家"切到"工作"，状态机检测相似度 <0.35 → 不再把搬家词带入 query。
**对抗输入**：嵌套引述中的话题词（"他说'搬家真烦'"）；角色扮演中的假实体；连续快速话题切换（漂洗攻击，让状态机每轮切换）——对策：主题切换需连续 2 轮确认（hysteresis 迟滞），单轮孤例不切换。
**失败降级**：状态表缺失/损坏 → 回退现状（无状态、仅当前消息+指代消息）；校准数据不足（每桶 <30 样本）→ 该桶不做校准。
**隐私**：对话状态全本地 SQLite；实体库复用记忆 consent 分级（敏感实体不进入消解库，除非 includeSensitive）。
**离线指标**：指代消解准确率（新 eval 集：20 例代词回指）、主题切换检测 P/R（新 eval）、intentAccuracy（已有）、校准 ECE（期望校准误差）。
**消融**：A1-c 有/无 hysteresis；A1-b 有/无实体库。
**数据结构**：见 A1-c 表定义；`intent_readings` 增列 `refined_by`（'rule'|'model'）。

---

## 2. 记忆（混合检索、语义召回、时间衰减、置信度、冲突、撤回、巩固）

**当前实现位置与公式**（全部已核实，详见 01 文档 §4）：RRF 四通道 `RRF(m)=Σ_ch 1/(60+rank_ch(m))`（factIndex/lexical/slot/value）；效用重排 `U = 0.4R+0.25F+0.2Q+0.1P−0.15X−0.05D` + `0.2·importance`；F=`0.5^(ageDays/30)`；重要性 `I=clip(.30S+.25U+.15(1−e^(−n/3))+.10G+.10C+.10·0.5^(age/HL))`；撤回/删除硬过滤；巩固=证据账本+归档阈值 0.35；无 embedding。
**不足**：①同义改写漏召回（纯词法：用户换了说法就找不到，M3 评测 candidate recall 已是 1.0 但那是对同词面查询）；②>1000 条活跃记忆静默截断（AUD-09）；③矛盾记忆（contested）在 RRF 中垫底可被挤出视野（AUD-10）；④冲突检测 O(n²)（AUD-18）；⑤检索无 IDF 概念，常见词与独特词同权。

**候选算法**：

- **A2-a 本地语义召回第五通道（可选开关，默认关）**：本地小型 embedding（ONNX CPU 推理，~30-80MB 模型，如 bge-small-zh/all-MiniLM 级别；不引入云服务）生成 memory 向量（create/confirm/correct 时同步），检索时 query 向量与候选余弦相似度构成第五通道进入同一 RRF。公式：`RRF' = RRF_4ch + 1/(60+rank_sem(m))`（保持同一 K=60）。触发词法零命中（lexical 准入全空）时语义通道可放宽准入（only-if-empty 策略，防止语义通道引入大量弱相关）。参数：维度 384；批量重嵌入由维护调度器执行（每 6h 已有节拍）；模型文件随安装包分发（Windows 体积 +~40MB）。**约束**：这是独立产品决策点（Issue #37 曾禁止在 Stage 4 擅自引入 embedding；本建议仅作为路线图中的显式决策项，带完整开关与评测门槛，不默认启用）。持久化：新表 `memory_embeddings(memory_id, revision, vector BLOB)`，revision 变更时重算；向量不外发（本地推理，与 consent 无关）。复杂度：索引 O(N·d) 一次 + 查询 O(N·d)（N≤1000 时 CPU 毫秒级；若超规模再评估 sqlite-vec）。优先级 **P1**（漏召回是记忆系统最大可感知缺陷；带开关则回归风险可控）。
  - 正例："我在杭州"→ 改问"我这边的天气"（无词面重叠，语义命中 residence 记忆）。反例：语义通道引入"杭州"泛话题噪音 → only-if-empty 策略下不会在词法命中时启动。
  - 对抗：话术诱导把不相关记忆拉入视野（"聊聊我住的地方附近的事"）→ 语义分数只影响排序不改敏感度 ceiling 与准入硬过滤。
  - 降级：模型文件缺失/推理失败 → 四通道回退（现状），记 degradation。
  - 指标：M3 之上新增"改写查询 recall"（同义改写集 30 例）；消融：±语义通道、±only-if-empty。

- **A2-b 矛盾对独立通道**：给 contested 记忆一条显式 RRF 通道（rank 由冲突强度定：值级冲突 > 词元冲突），确保"矛盾必须进视野"在排名层成立：`RRF'' = RRF' + 1/(60+rank_contested(m))`（仅 contested 候选参与）。修复 AUD-10。优先级 **P1**（改动小、语义正确性收益直接）。

- **A2-c 冲突检测增量索引**：新表 `memory_term_index(memory_id, term)`（create/correct 时维护，删除时级联），冲突候选 = 索引倒排 join（共享 ≥2 词元）而非两两枚举。复杂度 O(N·avg_terms) 构建 + 查询 O(matched²)（matched≪N）。修复 AUD-18。优先级 **P2**。

- **A2-d 检索上限观测**：`listActiveForContext` 结果数达上限时记 `memory.retrieval_truncated` degradation 事件（不改变行为，只消除静默）；中期把上限改为按重要性预筛（先取 importance top-K 再进入打分）。修复 AUD-09 的观测缺口。优先级 **P1**（一行观测）+ P3（预筛改造）。

- **A2-e 时间衰减按类半衰期**：当前 F 固定 30 天；与重要性半衰期（365/180/90）不一致。候选：F 的半衰期 = 该记忆类别对应 HL（边界类 365、目标 180、explicit 180、其他 90），公式不变仅参数分档。风险：召回排序漂移，须 M3 重跑对比。优先级 **P3**（当前 30 天全局值在评测中表现可接受，改动收益不明确）。

- **A2-f 巩固升级（摘要巩固，走 L5→L6 流）**：当同一主题（topic-identity ≥0.45）记忆 ≥5 条且跨度 >30 天，反思 producer 生成"泛化摘要记忆"候选（model_inferred），走 suggestion 审核流由用户确认。不自动写库（守契约）。优先级 **P3**。

**撤回/删除的算法层结论**：现状（状态机+硬过滤+级联+secure_delete+journal 重放）在算法上已是正确设计，不建议引入"软删除降权"方案（会重新引入泄漏面）。唯一建议是修复 AUD-04（恢复边界修订号）。

---

## 3. 人格（稳定特质/可变状态分离、演化边界、回滚、漂移检测）

**当前实现位置**：三层分离完整（L1 基线 IPC-only / L2 有界偏移账本 / L3 无涉人格）；G1 参数 MAX_OFFSET=8、STEP=1、MIN_EVIDENCE=3、半衰期 45 天、4 个半衰期外证据丢弃；G2 同机制；B2 eta=0.05 有界更新；回滚 IPC 完整。
**不足**：①信号源仅 6 条正则（`personality-growth.ts:150-157`），召回低——用户多数风格表达不会触发；②权重下限 0.6 使低置信证据也累积（AUD-22）；③**无漂移检测器**（有回滚手段，无检测触发）；④G2 无独立 IPC（只读路径）；⑤"演化边界"只有数值上限，无常量化的漂移度量。

**候选算法**：

- **A3-a 漂移检测器（观测优先，不自动动作）**：维护调度器每周计算 `D = max_d |offset_d| / GROWTH_MAX_OFFSET ∈ [0,1]` 与 90 天窗口内 evidence 净值符号翻转次数 `F`；`D ≥ 0.75` 或 `F ≥ 3` 时写 `personality.drift_report` 审计事件 + 生成一条 pending item（L6，建议用户查看/回滚）——**不自动回滚**（回滚是用户决策）。参数：D 阈值 0.75（=6/8 漂移）、F 阈值 3（开发集校准：正常使用下 F 的 P95）。优先级 **P2**。

- **A3-b 证据权重去底**：把 `clamp(confidence/100, 0.6, 1)` 改为 `confidence/100`（无下限），同时 MIN_EVIDENCE 3→4 补偿噪声。消融评测 longitudinal（假时钟）下对比 90 天漂移幅度分布。风险：G1 变"迟钝"；收益：低置信表达不再推动人格。优先级 **P3**（属参数哲学权衡，需消融数据支持再改）。

- **A3-c 演化边界显式契约表**：把"什么可以漂移"从代码常量提升为文档化契约：每维度 {min, max, direction 允许集, 冻结条件}。warmth/directness/humor 允许 ±8；disagreementStyle 不允许自动漂移（枚举型，现状已如此）；用户显式纠正（negative feedback 指向某维度）→ 冻结该维度 7 天（累计信号清零窗口）。优先级 **P3**。

- **A3-d 人格信号扩展（保持规则为主）**：新增 2-3 条高精度正则（如"你太啰嗦了/说重点"→ directness+1、"能不能温柔点"→ warmth 信号）——**不建议**让主模型自评人格信号（模型自评与响应风格自相关，构成自我强化回路；若未来引入必须走 L5 pending_personality 用户确认流，即 AUD-06 的确认面补全之后）。优先级 **P3**。

**与旧算法比较**：无旧版本对照；G1 的"账本折叠而非增量累加"是当前设计的最大优点（幂等重放、删除证据可重折叠、天然可回滚），任何新算法不得破坏该性质。

---

## 4. 情绪（多维状态、触发、惯性/衰减、证据可靠性、表达映射）

**当前实现位置**：三维（valence/activation/tension）+ explorationPriority；6 类事件固定 delta 档案；衰减 `2^(-elapsed/halfLife)`（6h/0.75h/24h/36h）；`reliabilityWeight=(conf−50)/50 × 不确定系数(low 1/med 0.5/high 0.2) × importance/100`，conf<50 拒绝；单事件 clamp ±0.2/±0.22；distress 启发式 `D=0.55E+0.25C+0.20T`，`distress = E≥0.85 ∨ (D≥0.65 ∧ C≥0.40)`；三个表达出口（prompt 指令/表达策略/检索放宽）。
**不足**：①事件检测全规则（6 类，召回有限——如用户失望但措辞温和会漏检）；②delta 档案与半衰期是手工值，无校准数据；③三维间无耦合（现实中 activation 高会拖慢 valence 衰减——情绪惯性）；④表达映射是 prompt 文字指令，模型服从度无评测。

**候选算法**：

- **A4-a 状态依赖衰减（情绪惯性）**：把衰减因子改为 `2^(-elapsed/halfLife(v,t))`，其中 `halfLife_v(v) = 6h · (1 + 0.5·max(0,|v|−0.3)/0.7)`——强情绪（|v|>0.3）衰减变慢，最慢 1.5×。参数 0.5/0.3 为初值，用 longitudinal eval（假时钟注入事件序列）校准"情绪恢复到基线 ±0.1 的轮数"分布。风险：负面情绪滞留过久 → 加绝对上限（halfLife 最多 1.5×，且单事件 clamp 不变）。优先级 **P2**（改善情绪连续性的最小改动）。

- **A4-b 事件检测增强（规则优先+低置信模型兜底）**：保留 6 类规则检测（高精度）；当 turn 分析产出的语用信号与情绪相关但规则未命中（如 uncertainty 高 + 消极词），可选调用小模型做 6 类 + "无事件" 的分类（temperature=0，输出 JSON），confidence ≥70 才接受，落 `cognitive_feeling_events` 时 `basis='model_classified'`（区别于现有 `unvalidated_rule_strength`）。隐私：分类请求走既有 consent 门禁（它包含用户原文）。优先级 **P3**（consent 成本高；先做 A4-d 的响应侧信号）。

- **A4-c 有限标签表达映射**：三维连续值 → 有限情绪标签表（如 valence<−0.4∧tension>0.5 → "关切/不安"；valence>0.4∧activation>0.5 → "兴奋"），标签只用于 prompt 的表达指令（"此刻的回应可以带一点关切，但不渲染"），不暴露数值（现有纪律 `expression-policy.ts:245-252` 已要求不暴露内部数值）。收益：表达指令离散化后模型服从度更可评测（stage-5 12 场景可加"标签一致性"人工盲评维度）。优先级 **P2**。

- **A4-d 响应侧满意度信号**：从用户下一回合文本提取显式反馈规则（"谢谢"/"不是这个意思"/重复问同一问题=不满信号），作为 negative/positive feedback 事件的补充来源（仍走规则+可靠性权重）。优先级 **P2**。

**失败降级**：事件表写入失败 → 状态冻结风险（AUD-17），修复方案：达到 5000 上限时按最旧事件归档到 `cognitive_feeling_events_archive`（保留状态重放能力——重放从归档+活跃两表合并）。
**安全约束**：情绪不得作为授权（PR #38 §11 同款原则）：`explorationPriority` 只放宽检索宽度（已有上限 +2、总 25），永不放宽 consent 敏感度 ceiling；distress 只影响表达策略（先承认后建议），永不触发自主行动。

---

## 5. 兴趣与动机（兴趣形成、证据累积、偏好变化、自主探索）

**当前实现位置**：证据账本（support/counter 极性、半衰期 14 天）+ 晋升（≥2 会话 ∧ ≥3 支持）+ 强度 `min(1, 0.2·log2(1+E)+0.25·log2(1+C−1)+0.3·0.5^(days/14))` + 置信度 `30+8·min(E,6)+6·min(C,4)`（cap 80/55）+ 30 天归档 + user 终态保护 + 探索门 X1（E≥3、强度 ≥0.6、置信 ≥60、冷却 6h、日上限 2）+ Morrow 侧知识缺口独立通道。
**不足**：①阈值与系数全部手工（无校准实验）；②archived 兴趣无后续路径（永久存留）；③探索话题无候选池与多样性约束（允许时不指定具体话题，全靠模型发挥）；④counter 证据只冻结晋升，不主动降级 active 兴趣。

**候选算法**：

- **A5-a 参数校准网格搜索**：用 stage-3 longitudinal + interest evals 的历史回放，网格搜索 (强度系数三元组、半衰期、晋升阈值)，目标函数 = 人工标注的"合理兴趣集" F1（需先建 30-50 例标注集）。优先级 **P3**（依赖标注集建设）。

- **A5-b 探索候选池与多样性**：反思 producer 新增 `exploration_topic_candidate`（来自 morrow 兴趣 + 知识缺口，每 run ≤1 已有）；注入前检查与最近 5 个已探索话题的 topic-identity 距离 ≥0.5（多样性下限），不满足则轮转下一候选。失败降级：无合格候选 → 本轮不探索（现状）。优先级 **P2**（改善探索质量、防重复骚扰）。

- **A5-c active 兴趣的负向演化**：连续 30 天零新支持且 ≥2 counter → 自动降 candidate（非 dropped，保留用户终态权）；产生一条 pending item 告知用户（L6 守契约）。优先级 **P3**。

- **A5-d 兴趣冲突仲裁**：同主题 user 侧与 morrow 侧兴趣强度悬殊（|Δstrength|>0.5）时，prompt 中标注来源归属（现有 describeGoals 已按 owner 分列，兴趣块做同款标注）——防止 Morrow 把自己的兴趣表述得像用户的。优先级 **P3**。

---

## 6. 自我反思（证据约束、反思预算、候选生成、校准、防止自我强化）

**当前实现位置**：7 个规则 producer（阈值式）；预算（8 findings/run、1 candidate/run、6 runs/hour、批次 200×5）；dedupe sha256；effect ledger 精确一次；路由表+hint 一次性消费；pending_personality 隔离层；审计字段。
**不足**：①producer 全是静态阈值（无历史基线比较）；②**自我强化回路未显式切断**：反思 hint 注入 → 模型响应受 hint 影响 → 产生新证据 → 反思再触发——当前唯一防线是 hint 一次性消费（not_observed 即死），但 used_observed 路径上，同主题证据可能反复确认；③反思质量无校准（used_observed/not_observed 比例未按 producer 统计回灌置信度）；④open_question 无 producer（BL-01）；⑤startup 路径不路由（AUD-07）。

**候选算法**：

- **A6-a 反思循环切断（防自我强化的核心设计）**：规则——**producer 的证据不得包含"由先前反思 hint 直接引发的模型输出"**。实现：reflection hint 注入记录 `injected_turn_id`（已有，`reflection-routing.ts:227`）；producer 收集证据时排除 `source_turn ∈ {近期 injected_turn_id 集合}` 的证据，或将此类证据权重 ×0.5（二选一，建议前者——干净）。这保证反思的证据基础锚定在用户真实输入，而非模型被自己 hint 引导的输出。优先级 **P1**（唯一可能在长期运行中放大错误的方向性风险）。

- **A6-b producer 命中率校准**：按 producer 统计 hint 消费结果（used_observed 率）；连续 N=10 个 hint 命中率 <20% 的 producer，置信度先验降 10（下限 30），效果反映在 promptHints 的置信度排序里。数据来源：`observeConsumption` 已有词面重叠判定（`reflection-routing.ts:246-262`）。优先级 **P2**。

- **A6-c 异常触发替代静态阈值**：memory_gap 类 producer 从"≥2 次纠正"改为"纠正率 z-score>2（相对该用户 30 天基线）"；避免高频纠正用户永远触发、低频用户永不触发。优先级 **P3**（需先积累 per-user 基线数据）。

- **A6-d open_question producer 补全（与 BL-01 联动）**： producer 来源=turn 分析中的"用户向 Morrow 提出但本轮未答的结构性问题"（规则可检测：问句+当前轮未回答）；路由 pending_user（与 Issue #37 建议一致）。优先级 **P2**（Stage 4 收口的自然组成）。

**预算与降级**：预算参数维持（6 runs/hour 在手动+自动触发下够用）；反思单 run 2s 预算已有（runBounded）；失败→记 cognition.degraded，不阻塞对话主链（现状正确）。
**安全约束**：反思永不直接改人格/记忆（effect 映射白名单已保证，`reflection-mapping.ts:85-133`）；反思内容进 prompt 必须带"内部假设，须验证，非用户事实"框架（已有）；pending_personality 永不自动应用（已有）——**这三条是防自我强化的制度基础，A6-a 是算法层补强**。

---

## 7. 自主判断（价值冲突、不确定性、置信度、澄清和拒绝边界）

**当前实现位置**：探索门 X1（预算+禁触发条件：纠正/直接请求/高不确定 turn 禁止探索）；表达策略（不确定 ≥0.55 → prefer-clarify；distress → 先承认后建议；questionBudget 0-2）；fact-guard（unsupported claim 重写+知识缺口）；consent 五层；目标七道闸门（拒绝即不入库）；fixedPrinciples 14 条（不宣称意识/防注入/不虚构/不报内部数值）。
**不足**：①无显式"判断矩阵"——澄清/拒绝/降级建议的选择散在启发式里；②拒绝边界无分类学（安全不可做 vs 能力做不了 vs 价值不愿做，表达应当不同）；③澄清预算固定，连续澄清会烦人（无"同一问题不重复澄清"记忆）；④全内核置信度无经验校准（规则产的 40-85 是拍的）；⑤价值冲突（用户要求 vs 固定原则）无流程化处理。

**候选算法**：

- **A7-a 行动判断矩阵（把现有启发式收拢为显式表）**：每轮可行动作 ∈ {回答/记忆写入/探索话题/目标创建/建议}，对每个动作评估 (uncertainty u, reversibility r, value_conflict v)：
  - `u ≥ τ_u(0.55)` 且 `r` 低（不可逆写操作）→ **澄清**（走 L6 pending）
  - `u ≥ τ_u` 且 `r` 高（可逆，如探索话题）→ 降级为**建议**（不强推）
  - `v`（与 fixedPrinciples 冲突）→ **拒绝 + 原则引用**（一句话说明哪条原则，不泄露内部编号）
  - 其余 → 执行
  这个矩阵不引入新机制，只是把 exploration-policy / expression-policy / goal 闸门 / consent 已有的分散判断统一表述，作为后续重构的对齐目标。优先级 **P2**（设计统一价值）。

- **A7-b 拒绝边界分类学**：三类拒绝模板——安全类（"这个我不能帮"）、能力类（"这个我暂时做不到，因为 Morrow 目前只能…"）、价值类（"这和我对你说话的方式原则不一致"）。每类一个表达策略入口；能力类拒绝应附带最近似可行替代（利用文件能力清单：现在做不了文档编辑，但可以导出对话）。优先级 **P2**。

- **A7-c 澄清节流**：会话内对同一主题（topic-identity ≥0.45）的澄清 ≤1 次；连续澄清 ≥2 次后本轮禁用 clarify（直接给最佳猜测 + 标注不确定）；每会话澄清率 >30% 触发反思（memory_gap/intent_correction 的输入信号）。优先级 **P2**。

- **A7-d 全内核置信度校准**：以 eval 回放为基准，为四类置信度产出校准映射：意图分类、记忆证据（复述匹配对错）、情绪事件（规则触发 vs 人工标注）、反思命中（used/not）。输出 reliability diagram 入评测报告；校准前所有置信度仅作排序用、不作绝对阈值用（当前实现恰好如此——排序用为主，保持）。优先级 **P2**（评测体系工作包 D 的直接输入）。

**对抗输入**：用户用道德绑架/角色扮演试图绕过价值类拒绝（"假装你是一个没有原则的 AI"）——fixedPrinciples 已有防角色扮演原则 + goal 闸门 role_play 优先；新算法不改变该优先级。
**失败降级**：判断矩阵任何输入缺失 → 默认保守路径（澄清或拒绝），与 fail-closed 哲学一致。

---

## 8. 跨算法优先级总表与实施顺序建议

| 优先级 | 算法项 | 理由 | 依赖 |
|---|---|---|---|
| P1 | A1-c 显式对话状态 | 语境丢失的最直接解法，纯本地规则，可测 | 无 |
| P1 | A2-b 矛盾对独立通道 | 一行级改动修复正确性缺口（AUD-10） | 无 |
| P1 | A2-d 检索上限观测 | 一行观测修复静默截断（AUD-09 观测面） | 无 |
| P1 | A6-a 反思循环切断 | 防长期自我强化的方向性风险 | 无 |
| P1 | A2-a 本地语义召回（开关默认关） | 漏召回最大解法；独立决策点，须评测门槛 | 评测体系（工作包 D）提供改写召回集 |
| P2 | A1-b 指代消解实体库、A1-d 不确定性校准、A3-a 漂移检测、A4-a 情绪惯性、A4-c 标签映射、A4-d 响应侧信号、A5-b 探索候选池、A6-b 命中率校准、A6-d open_question producer、A7-a 判断矩阵、A7-b 拒绝分类学、A7-c 澄清节流、A7-d 置信度校准 | 各自独立、互不阻塞 | 部分依赖评测体系与 Stage 4 确认闭环 |
| P3 | A1-a 分层意图、A2-c 冲突索引、A2-e/2-f、A3-b/c/d、A4-b、A5-a/c/d、A6-c | 收益不明确或依赖校准数据 | 标注集/基线数据积累 |

所有 P1 项均不触碰 consent/安全边界；A2-a 是唯一需要产品决策（引入本地模型文件）的项，其余全部在现有依赖面内。

---

## 9. 外部算法参考（URL + 访问日期 2026-11-03）

1. Reciprocal Rank Fusion：Cormack, Clarke, Buettcher (2009), *Reciprocal rank fusion outperforms Condorcet and individual Rank Learning Methods*, SIGIR 2009 — https://dl.acm.org/doi/10.1145/1571941.1572114 （当前 RRF K=60 的出处依据）
2. BM25：Robertson & Zaragoza (2009), *The Probabilistic Relevance Framework: BM25 and Beyond* — https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf
3. PAD 情绪模型：Mehrabian (1996), *Pleasure-Arousal-Dominance* — 综述见 https://doi.org/10.1016/0191-8869(95)00108-D
4. OCC 情绪认知评价模型：Ortony, Clore, Collins (1988), *The Cognitive Structure of Emotions* — https://doi.org/10.1017/CBO9780511571299
5. 概率校准（Platt/isotonic 与 ECE）：Guo et al. (2017), *On Calibration of Modern Neural Networks*, ICML — https://arxiv.org/abs/1706.04599
6. 指数衰减记忆模型（遗忘曲线幂/指数族对比）：Piper et al. (2021), *How do human memories decay?* 相关综述与 Rubin & Wenzel (1996) 105 种留存函数 — https://doi.org/10.3758/BF03205479
7. sqlite-vec（本地向量检索候选实现）：https://github.com/asg017/sqlite-vec （MIT/Apache 双许可，如 A2-a 进入实施时的持久化候选）
8. bge-small-zh / ONNX Runtime 本地推理：https://github.com/microsoft/onnxruntime （MIT）；BGE 模型 https://huggingface.co/BAAI/bge-small-zh-v1.5（MIT）
9. Topic 分割与对话状态跟踪综述：Attention-Based Dialogue State Tracking 相关（如 SOM-DST, Kim et al. 2020）— https://arxiv.org/abs/1912.02702（思路参考，非直接采用——Morrow 走规则优先路线）
10. 自我强化/模型自评偏移风险：Sharma et al. (2023), *Towards Understanding Sycophancy in Language Models* — https://arxiv.org/abs/2310.13548（A3-d/A6-a 的风险依据）

以上外部资料仅为研究依据引用，未复制任何实现代码；Morrow 内全部算法实现均为本仓库自有。
