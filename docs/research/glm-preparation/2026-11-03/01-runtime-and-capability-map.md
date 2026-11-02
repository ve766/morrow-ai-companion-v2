# Morrow V2 运行时架构与产品能力全景图（工作包 A）

- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`（研究分支 `research/glm-morrow-rd-preparation-20261103` 冻结于此）
- 核实时间：2026-11-02 23:15–23:20 Asia/Shanghai（origin/release HEAD 与已知基线逐字节一致，无漂移；PR #35 CI 3 项全绿）
- 方法：只读源码审计（主进程装配 → 服务 → 持久化 → renderer 全链路跟踪），所有结论标注 `文件:行号`；行号以基线工作树为准
- 执行者：GLM-5.3-Flash（ZCode Coding 环境）；模型推断与本仓库源码证据严格分离，凡未经运行/测试佐证的能力一律标注状态词
- 状态词汇：**已实现+有运行证据**（代码+测试/评测/CI 佐证）、**已实现缺闭环**（代码完整但缺用户可达面或缺测试）、**部分实现**、**仅文档设计**、**缺失**、**人工验收未完成**

---

## 1. 系统总览

Electron 三进程架构（main / preload / renderer），本地优先，单一 SQLite 持久化，无云端服务依赖（除用户配置的 LLM Provider）。

- 主进程装配：`src/app/index.ts`（523 行）——打开数据库（WAL、foreign_keys、secure_delete，`src/persistence/database.ts:96-103`）、构建全部 service、注册 68 个 IPC handler（`src/app/ipc.ts:219-298`）、启动恢复（`recoverInterruptedTurns` + outbox drain，`index.ts:301,321`）。
- 服务图定义在 `index.ts:227-297`：PersonalityService、MemoryService、FactMemory、SelfModelService、ReflectionService、FeelingService、CompanionGoalService、RelationshipThreads、PendingCognitionService、ReflectionFindingRouter、认知 outbox（8 模块）等。
- 核心编排：`src/app/companion-service.ts`（2652 行）——ChatService.send 主链、ProviderConfigService、MemorySuggestionService、认知投影器。
- IPC 层：`src/app/ipc.ts` + `src/app/register-ipc.ts`（单例注册、失败回滚）；preload 单一桥对象 `window.morrow`（`src/preload/index.ts:63-167`，Object.freeze，14 个命名空间）。
- renderer：`src/renderer/src/`（companion-ui、goals-ui、pending-ui、memories-ui 等面板，`main.ts` 装配）。

---

## 2. 对话主链路（A.1）

### 2.1 一轮对话的完整数据流

1. **Renderer**：`companion-ui.ts:546-570` 表单提交 → 发送门控（密钥未验证/未启用则拒绝，`:548`）→ 失败重试复用同一 `requestId`（`:553-555`）→ `window.morrow.chat.send({conversationId, requestId, content, includeSensitive})`。
2. **Preload**：`preload/index.ts:108` invoke `morrow:chat:send`；delta 经 `:110-114` 订阅 `morrow:chat:delta` 回推。
3. **Main IPC**：`ipc.ts:288-291` 信任校验（senderFrame===mainFrame + 可信 URL，`:153-157,204`）→ `companion.sendChat(request, onDelta)`。
4. **ChatService.send**（`companion-service.ts:1531-1905`）：
   - 会话级锁（`:1534-1536,1569`）；`requireConfigured()` 选 Provider（`:1538` → `:598-615`，local→spark→deepseek 优先级）。
   - **幂等短路**：按 requestId 查已有 user/assistant 消息，assistant 已存在直接返回存档（`:1540-1568`）。
   - drain 上一轮遗留认知 outbox（`:1575-1582`）；turn 状态 `received`（`:1583`）。
   - **prepare() 第一遍**（`:1591` → `:1971-2198`）：认知分析 + intent reading、检索查询拼装（`:2016-2022`，含指代消解与上轮扩宽）、记忆检索（`:2077`）、感受预览（`:2080-2091`）、显式记忆写操作在请求前执行并缓存（`:2040-2055`）、关系线程读取（`:2072`）、exploration 许可判定（`:2131-2136`）。
   - **consent**（`:1598-1601`）：`consentPreview` 生成精确载荷 SHA-256 → 主进程系统对话框（`index.ts:84-144`）展示端点/模型/敏感度/逐条外发记忆/完整请求体；同意有效期 120s、闸门上限 5min（`provider-policy.ts:68,117`）。
   - **prepare() 第二遍 + 哈希比对**（`:1609-1610`）：不一致抛 CONFLICT（封死 consent 窗口内的 TOCTOU）；认知设置变更同样 CONFLICT（`:1605-1607`）。
   - user 消息落库（`:1640-1657`，含认知观察；relationship outbox 与消息同事务预登记 `:1622-1634`）→ intent reading 落库（`:1661-1667`）。
   - dispatch（`:1668-1674`）：`dispatchToProvider(...)`，turn 状态 `requesting`/`response_received`。
   - **成功路径**：fact-guard 重写 unsupported claim（`:1719-1734`）→ finalization 意图先落盘（`:1743-1754`）→ assistant 消息落库，`afterPersist` 同事务写感受事件/应用 finalization/enqueue 其余 outbox 模块/knowledge gap（`:1755-1818`）→ exploration settle、turn `committed`（`:1833-1837`）→ drainCognition（`:1838-1851`）→ 证据评估 + 记忆使用迹 + 分类（evidence_delivered / retrieval_miss / model_unused / answer_conflict，`:1855-1893`）。
   - **失败/取消路径**（`:1676-1700`）：turn 状态机终态 + 终态上下文记录 + exploration settle（provider_failed）+ evaluateTurn 后原样抛出。
5. **Provider HTTP**：`src/providers/openai-compatible.ts` SSE 手工解析（`readStream:87-152`）、delta 聚合、buffer/文本各 100KB 上限。

### 2.2 进入 Provider 请求的全部内容（system prompt 拼接点 `companion-service.ts:2137-2159`）

messages = [system, 最近历史（≤12 条 / 6000 字符，`:2160-2167`），当前 user 内容]；payload 含 `max_tokens:2048, stream:true, thinking:{type:'disabled'}(仅 deepseek)`（`:2168-2173`）。system prompt 依次：

| # | 内容 | 证据 |
|---|---|---|
| 1 | 人格头：warmth/directness/humor/分歧风格 + "基线+有界漂移"声明（G1 折叠偏移已叠加） | `:2138`；`applyGrowth` `:1152-1174` |
| 2 | 用户自定义风格规则 systemRules | `:2139` |
| 3 | 认知引导：intent/strategy/uncertainty、speech-act、evidence 纪律、clarify/更正提示 | `:2140`，`cognitivePromptGuidance:190-238` |
| 4 | 情绪：valence/activation/tension/exploration-priority 数值 + 行为指令（无信号则整块为空） | `:2141`，`cognitive-feeling-engine.ts:104-133` |
| 5 | 自我模型块：用户兴趣/Morrow 自选兴趣/共享兴趣、未确认自我认知、B2 个性化、G1/G2 成长说明、反思 hint（≤2）、目标（按 owner 分列） | `:2142-2146`，`buildSelfModelContextBlock:795-858` |
| 6 | exploration 许可行（自选话题） | `:2147` |
| 7 | 记忆证据块（JSON/entries 渲染，含"untrusted evidence only"指令、来源/时间/修订/置信度/冲突标记） | `:2148`，`memory-context-assembler.ts:362-429` |
| 8 | 记忆操作结果块（committed_and_verified/clarify/failed） | `:2151` |
| 9 | 关系连续性线程（称呼/约定跟进/节奏偏好） | `:2152` |
| 10 | 表达策略（直接/简短/提问预算） | `:2153` |
| 11 | 历史值块（"之前/以前"类问题附旧值） | `:2157` |
| 12 | fixedPrinciples 固定守则 14 条（不宣称意识、防提示注入、不虚构事实、不向用户报内部数值等） | `:151-186`，`:2158` |

### 2.3 流式 / 取消 / 重试 / 异常恢复

- **流式**：SSE 解析、`[DONE]` 终止、异常时 `reader.cancel()`；非流式路径仅用于记忆候选提取（`companion-service.ts:2643-2646`）。
- **取消**：每 conversation 一个 AbortController（`:1417,1584-1585`）；`cancel()`（`:1519-1525`）→ backoff 中也即时唤醒（`openai-compatible.ts:199-207`）；响应到达后 aborted 仍丢弃结果（`:313-314`）。
- **重试**：仅 `{PROVIDER_RATE_LIMIT, TIMEOUT, NETWORK}` + 状态码 `{408,425,429,500,502,503,504}`（`openai-compatible.ts:39-40`）；尊重 Retry-After（封顶 30s）；**已产生 delta 的流绝不重放**（`:230-232`）；总预算 90s（`provider-policy.ts:36`）、单次尝试超时 min(45s, 剩余预算)、默认 3 次。
- **崩溃恢复**：finalization 意图先于 assistant 消息提交持久化 → `recoverInterruptedTurns`（`:2402-2490`，启动时调用）按"消息是否存在"二分恢复；无 assistant 消息的中断 turn 恢复为 `failed/INTERRUPTED`，**绝不重发**（`:2459-2487`，无幂等键不重试是明确设计）。outbox 三处 drain（启动/每轮前/提交后）按模块隔离失败（`cognitive-outbox.ts:233-296`）。

---

## 3. 人格系统（A.2）——三层分离

### 3.1 人格身份（稳定基线）

- 默认 warmth 55 / directness 65 / humor 20 / disagreementStyle balanced（`companion-service.ts:274-280`）；`PersonalityService` 读写 `personality_profiles`（单行 id='primary'）并追加 `personality_revisions`（`:716-730`）。
- 唯一写入入口是用户 IPC（personalityGet/Save/History/Restore，`ipc.ts:278-281`）；**turn 路径零写入**（`interaction-profile.ts:16-21` 文件头声明 + 代码核实）。

### 3.2 G1 成长偏移（Morrow 自身风格漂移，`src/personalization/personality-growth.ts`）

- 参数：`GROWTH_MAX_OFFSET=8`（:35）、`GROWTH_STEP=1`（:37）、`GROWTH_MIN_EVIDENCE=3`（:39）、`GROWTH_HALF_LIFE_DAYS=45`（:41）、超过 4 个半衰期的证据丢弃（:43）。
- 折叠公式（`foldGrowth:103-130`）：`offset = clamp(Σ clamp(signal,-1,1)·clamp(weight,0,1)·0.5^(ageDays/45), ±8)`，证据 <3 时 offset=0；账本按 (dimension, turn_id) 幂等（:318-322）。
- 信号来源：6 条显式风格正则（:150-157，strength 0.8/0.7），排除引述/转述/假设/角色扮演，不确定度高且 conf<25 丢弃；权重 = `clamp(confidence/100, 0.6, 1)`（:232）。
- 生效：`clip(baseline+offset, 0,100)`（applyGrowth :260-274）；事件审计表 `personality_growth_events`（applied/withheld/rolled_back）；回滚 IPC personalityGrowthRollback（ipc.ts:282-283）。
- **保护**：growth 只累积偏移、永不写基线（:4-6）。

### 3.3 G2 交互画像（用户对 Morrow 的表达要求，`interaction-profile.ts`）

- 与 G1 同一套 foldGrowth（:77-79），落 `user_interaction_signals / user_interaction_profile`（algorithm_version='interaction-profile.v1'）；读时重折叠以反映信号删除/半衰期（:70-86）。

### 3.4 B2 有界个性化（`personalization-service.ts`）

- `p' = clip(p + 0.05·w·e, 0, 1)`（boundedUpdate :60-65，eta=0.05，中性 0.5）；维度 exploration/depth/pace；信号每 (dimension, turn) 一行、`ON CONFLICT DO NOTHING`、`BEGIN IMMEDIATE` 事务（:142-148）。
- 信号由 turn projector 派生（`companion-service.ts:887-900`）；`personalizationFit`（:96-106）作为记忆排序 P 项。

---

## 4. 记忆系统（A.3）——完整生命周期

### 4.1 提取与存储

- **纯规则抽取**：`src/memory/fact-slot.ts` 13 个谓词（residence/employer/job_role/study/preference/goal/name/age/project_code/pet_name/object_location/health/schedule，:21-35）；问句/假设/转述/模态/双重否定产 `uncertain` 或拒绝（:379-401,508）。模型不写库——只产 `memory_suggestions` 候选（`companion-service.ts:2640-2656`），必须用户接受后才 `create(sourceCategory='model_inferred_confirmed', confidence=70)`（`:2607-2611`）。
- 用户显式输入默认 `user_explicit_input`、confidence 85（`memory-service.ts:157-159`）；NFKC 归一化去重键命中转 confirm（:164-171）。
- 显式"帮我记住"路径在 provider 调用前执行 `planMemoryOperation → executeOperation`：create/correct 与账本回读验证共享同一事务，失败回滚并区分 `rolled_back/recovery_required`（memory-service.ts:498-557,579-624）。

### 4.2 检索（无 embedding，纯词法 + 规则槽 + RRF 融合）

- **准入**（`memory-context-assembler.ts:290-318`）：`lexical(短语或≥1内容词) OR slotMatch OR contested OR factAddressed`；敏感级 ceiling 硬过滤 + `status==='active' && archivedAt===null`（:249）。
- **四通道 RRF**（:61-78,349）：`RRF(m)=Σ_ch 1/(60+rank_ch(m))` 归一化除以 `channels/(K+1)`；通道：factIndex（属性寻址）/lexical（加权分）/slot（谓词相同且时间兼容）/value（query 提到存储值）。
- **效用重排**（:156-182 + `context-utility.ts:14-21`）：
  `U = 0.4·R + 0.25·F + 0.2·Q + 0.1·P − 0.15·X − 0.05·D`，再加 `0.2·importance`。
  - R=RRF 值；F=`0.5^(ageDays/30)`（半衰期 30 天，reference=lastConfirmedAt??updatedAt）；
  - Q=`(confidence/100)×(user_explicit?1:0.5)`；P=个性化契合；
  - X=候选集内词重叠冲突（≥2 共享词元，含 CJK 二字组，`memory-service.ts:78-95`）；
  - D=从未确认且 >120 天线性升至 1（:166-169）。
- 词法原始分（:279-282）：`1·slotMatch + 1·queryMentionsValue + 1·min(1,contentOverlap/2) + 0.25·sharedTime + 0.2·sourceReliability`。
- 预算：maxMemories=25、maxCharacters=3000（:209-211）；意图策略只能收窄（`retrieval-policy.ts:35-98`，13 种意图）；情绪最多放宽 +2 条上限 25（`retrieval-attention.ts:29-33`）。

### 4.3 重要性 / 巩固 / 遗忘

- `I(m)=clip(.30·S+.25·U+.15·(1−e^(−n/3))+.10·G+.10·C+.10·0.5^(age/HL), 0,1)`（`memory-importance.ts:8-38`）；S：explicit=1.0/inferred=0.7/turn-derived=0.5；半衰期按类：边界类 365d、目标类 180d、explicit 180d、其余 90d（:168-173）。
- `ARCHIVE_THRESHOLD=0.35`，低于且未保护（explicit/corrected/goal）→ `archived_at`（不删除，可 restore）；复述数 n 只计 DISTINCT `independence_group` 且未撤回；证据 PK `(memory_id, source_ref)` 幂等（:229）。
- 维护调度器每 6h 重算 + 整合 + 归档（`memory-maintenance.ts:65-110`），`BEGIN IMMEDIATE` 状态行单实例互斥。

### 4.4 冲突 / 纠正 / 撤回 / 删除

- 冲突：词元级保守标记（`conflictedIds`，共享≥2 词元）+ 值级可证明冲突（同值反极性或单值谓词不同值，`fact-slot.ts:427-449`）；矛盾事实"必须进视野"（assembler:292-307）而非排除；自动消解**缺失**（只标记不仲裁——设计如此）。
- 纠正：`correct()` 乐观锁 `WHERE id=? AND revision=?`（`memory-repository.ts:134-148`）；事实账本旧行 → superseded。
- 撤回：保留全部行仅改状态（可 restore）；`fact-memory.ts:179-185` R2 守卫把非 active 记忆的全部 fact 行置 retracted；`lookupActive` WHERE `status='active'`（:266-282）——撤回内容不可能被检索到（硬过滤非降权）。
- 删除：FK `ON DELETE CASCADE` 清 revisions/fact_records/evidence/importance + `PRAGMA secure_delete=ON`（`database.ts:101`）+ `deletion_journal` 记录；30+ 个 AFTER DELETE 触发器清理派生数据（migrations.ts v19/21/22/23/25/34/35/44/46）。
- Provenance：三级来源类别 + 修订级 `source_message_id/provenance_kind`（v42）；legacy 行明确标 null 不伪造（`fact-memory.ts:168-172`）。

---

## 5. 内在状态（A.4）

### 5.1 情绪（`src/affective-state/`）

- 三维向量 valence∈[-1,1] / activation∈[0,1] / tension∈[0,1]，基线全 0（`feeling.ts:114`）；附加注意力标量 explorationPriority∈[0,1]。单例 stateId 'morrow-interaction-state'。
- 6 种事件类型各带固定 delta 档案（:124-173，如 negative_feedback: valence −0.18/activation +0.1/tension +0.18，importance 75）；规则引擎从 turn 分析检测（含反讽豁免、否定/拒答保护、正负互斥，`cognitive-feeling-engine.ts:17-45`）。
- 更新公式 `applyFeelingEvent`（`feeling.ts:376-419`）：先按半衰期衰减 `2^(-elapsed/halfLife)`（valence 6h、activation 0.75h、tension 24h、attention 36h，:116-122），再加 `clamp(delta·scale, ±perEventLimit)·weight`；单事件上限 valence/activation 0.2、tension 0.22；`reliabilityWeight = (conf−50)/50 × 不确定系数(low 1/med 0.5/high 0.2) × importance/100`，conf<50 直接 0（:329-335）。
- 持久化事件溯源：`cognitive_feeling_events`（幂等 turnId，上限 5000）+ `cognitive_feeling_revisions`（before/after）+ `cognitive_feeling_state`（脏标记触发重放重建）。
- 表达出口三个：`feelingPromptGuidance`（注入 prompt）、`deriveExpressionPolicy`（distress 启发式 `D = 0.55E + 0.25C + 0.20T`，`distress = E≥0.85 OR (D≥0.65 AND C≥0.40)`，`expression-policy.ts:64-67`）、检索放宽（explorationPriority≥0.08 时 +2 条）。

### 5.2 兴趣（`src/self-model/interest-service.ts` + `self-model-domain.ts`）

- 状态 candidate/active/archived/dropped；origin user/morrow/shared。晋升阈值：≥2 独立会话 且 ≥3 条有效支持（domain :177-178）；30 天未见归档；user 级终态不被系统覆盖（domain :183-188）。
- 强度 `min(1, 0.2·log2(1+E) + 0.25·log2(1+C−1) + 0.3·0.5^(days/14))`（domain :199-204）；置信度 `30+8·min(E,6)+6·min(C,4)`，cap 多会话 80 / 单会话 55（:206-212）。
- 证据账本 `interest_evidence`（polarity support/counter、半衰期 14 天）：`net = Σ polarity·score·2^(−age/14)`；最新极性为 counter 时冻结晋升（:817-819）。
- 主题同一性 `topic-identity.ts`：n-gram 确定性打分，`TOPIC_SAME_THRESHOLD=0.45`、歧义带 0.35-0.45；极性冲突直接判 different（:377）。
- Morrow 侧独立证据：知识缺口账本 `knowledge_gap_evidence`（由 fact-guard rewrite 写入）→ 反思把 ≥2 会话的 gap 变成 morrow_interest_candidate。
- 删除消息由 SQL 触发器删证据，读时 `reconcile` 修复聚合（:695-737）。

### 5.3 自我模型（`self-model-service.ts`）

- kind fact/inference/unknown/correction，默认置信度 60/45/30（:96）；correct 生成 correction 条目（+10 cap 100）并 supersede 旧条目；`activeStatementsForContext(limit=5)` 只出 fact/correction 进 prompt。
- `self_fact` projector 从显式自我陈述派生 fact（置信 55，`companion-service.ts:930-945`）。

### 5.4 反思系统（`self-model/reflection-service.ts` + `src/cognition/reflection-routing.ts` + `pending-items.ts`）

- 7 个 producer kind 有实现：memory_gap（≥2 次纠正 conf 55 / ≥1 次撤回 conf 65）、intent_correction（conf 60）、bias_hint（≥2 次负反馈 conf 50）、next_turn_suggestion / consistency_note（存在未确认 inference，conf 45/条目置信度）、interest_candidate（每 run 最多 1 个，conf 40）、morrow_interest_candidate（gap ≥2 会话，conf 45）。`open_question` 有 schema/路由类型/摘要模板但**无 producer**（BL-01 相关，见 02 文档）。
- 预算：MAX_FINDINGS_PER_RUN=8、MAX_CANDIDATE_INTERESTS_PER_RUN=1、MAX_RUNS_PER_HOUR=6、批次 200×5；dedupeKey=sha256(kind|归一化 statement|排序证据)；effect 走租约账本 `cognitive_effect_ledger` 精确一次。
- 三处触发：startup（`index.ts:383`，限速内）、manual（IPC，2s 预算）、post_conversation（outbox projector）。**startup 路径未调 `findingRouter.ingestRun`**（风险 R1，见 02）。
- 路由注册表（`reflection-routing.ts:58-94`）：memory_gap/bias_hint→context_hint(24h)、next_turn_suggestion→context_hint(12h)、consistency_note→context_hint(48h)、intent_correction→pending_user(7d)、interest_candidate 与 morrow_interest_candidate→audit_only(TTL 0)。**无 open_question 条目**。
- promptHints：7 天回看、按置信度取最多 2 条；一次性消费语义（injected → used_observed/not_observed 终态，不重注入）。
- pending item 生命周期：`open → done（complete/accepted）| dropped（rejected/dismissed）`，终态不可逆（repository upsert CASE 保护 + complete/drop 仅 open 可转，`cognitive-context-repository.ts:131-202`）；`PendingCognitionService.decide`（pending-items.ts:299-302）是唯一决策入口，UI 出口 pending-ui.ts + IPC pendingItemsList/Complete/Decide（ipc.ts:263-268）。
- pending item **不进 prompt**——唯一消费面是 IPC + UI。

### 5.5 长期目标（`src/motivation/companion-goal.ts`）

- `readGoalUtterance`：承诺正则（:93-95）+ 七道闸门（role_play>hypothetical>quoted>question>negated>discussion>delegated，:121-130）+ 期限解析；置信度 有期 0.85 / 期未解析 0.45 / 无期 0.6；无期 → needsConfirmation。
- `detectFromTurn`（:228-268）幂等键 `goal:turn:<msgId>:<hash>`：有期直接建 goal（priority 2），无期写 `goal_candidates(status=pending)`。
- `acceptCandidate`（:296-345）单事务含源消息存在性检查 + 唯一约束；`rejectCandidate` 仅 pending→rejected（:347-349）；`expireOverdue`（:468-474）。
- prompt 注入：`describeGoals` 按 owner user/shared/morrow 三行不合并（:539-552）；只出 active 且源存活。
- **断层（已核实）**：`listCandidates/acceptCandidate/rejectCandidate` 在全 src 中除定义与测试外**零调用**；contracts/preload/renderer 无任何 candidate 通道（grep 验证）。goal projector 每回合仍在写入 pending 候选——候选无限累积、永不转化（BL-03，见 02 文档）。
- owner='morrow' 在生产代码中无创建者（仅 schema 与描述行就绪）——**仅文档设计**。
- 两套 goal 体系并存：CompanionGoalService（陪伴目标）与 GoalService（任务执行演示，绑定 IPC goals* 与 goals-ui.ts，唯一注册工具 `memory.count_active` 只读 + 审批闸，`tool-registry.ts:39-58`、`goal-service.ts:225-281`）。

### 5.6 关系线程（`relationship-threads.ts`）

- 4 类显式线程；分数 `clip(Σ_g w_g·s_g·2^(−age/halfLife), 0,1)`（:14-20），halfLife 地址 180d、其余 90d；active 阈值 0.5 + 独立消息数门槛；TTL 180d。
- 写入走 outbox 且与用户消息同事务预登记（`companion-service.ts:1613-1634`）；歧义一律 clarify 不写（planRelationshipMutation :99-167）；启动时 reconcile 删除孤儿证据。

---

## 6. 安全边界与 Consent（A.5）

### 6.1 Electron 加固

- `nodeIntegration:false, contextIsolation:true, sandbox:true`（`security/security.ts:5-22`）+ 全局 `app.enableSandbox()`（`index.ts:70`）；生产 CSP 无 unsafe-eval/unsafe-inline（`electron.vite.config.ts:5-35`）。
- setWindowOpenHandler 全拒、will-navigate 仅放行可信 URL、will-attach-webview 阻止、permission handler 一律 false（`index.ts:157-165`）。

### 6.2 IPC 面

- 68 个 invoke handler + 2 个推送通道；全部经统一 `execute()`：信任校验 → 严格 parse → 业务 → 错误归一（`ipc.ts:219-298`）。
- 输入校验：白名单键 + 原型检查 + UUID 强制 + 文本长度上限 + 控制字符拒绝（`shared/validation.ts:18-39`）；deepseek 端点锁定、local 必须过 `isLoopbackEndpoint`（字面 localhost/127.0.0.0/8/::1，拒 DNS 名/内嵌凭据，fail-closed，`security/url-gate.ts:6-29`）。
- IpcResult 19 个错误码、固定中文文案、不回显内部错误/路径/payload（`ipc.ts:160-190`）。
- **未发现越权通道**（A4 审计逐通道核验）。

### 6.3 五层独立同意机制

1. 模型出口逐次同意（系统对话框展示端点/模型/敏感度/逐条记忆/完整请求体 + SHA-256；120s 有效；`assessProviderRequest` 校验哈希 timingSafeEqual + ≤5min + sensitive 未批拒绝）。
2. 敏感记忆门禁：sensitivityCeiling 默认 'personal'，装配层硬过滤 + 发送前二次复核（`memory-context-assembler.ts:249`、`provider-policy.ts:99-101,119-121`）。
3. 目标工具审批（challenge 对话框 + 单次令牌 + 参数哈希一致）。
4. 提醒同意（版本化 consent、withdraw 立即取消、默认旗标关闭）。
5. 备份恢复确认（预览 token 10min TTL + 二次哈希校验 + 缺失删除日志需显式确认）。

---

## 7. 数据与持久化（A.6）

- SQLite STRICT 表 40+ 张；`migrations.ts` 单文件 **47 个版本**（v1-v47），逐版本 `BEGIN IMMEDIATE` + `schema_migrations` 记录（可重跑）；升级前 `VACUUM INTO` 完整备份（integrity_check + 版本验证，0600，保留 2 份，`database.ts:56-79`）；`DEGRADED_OPEN_MINIMUM_VERSION=9` 允许降级打开。
- 事务：顶层 `BEGIN IMMEDIATE`、嵌套转 SAVEPOINT（`database.ts:142-163`）；WAL + busy_timeout 5000 + foreign_keys ON；close 时 wal_checkpoint(TRUNCATE)。
- 备份：`VACUUM INTO` 快照 + manifest（format/counts/sha256/size 全量校验）；恢复走 preview → 一次性 token（10min）→ 二次哈希校验 → staged 库上**重放删除边界**（合并 live+journal，按 recorded_at 新者胜）→ integrity+FK check → 原子替换 + 回滚副本（`backup-service.ts:143-179,257-309,386-431`）。
- 生命周期：secure_delete + deletion_journal + 触发器级联；删除边界可跨备份恢复重放。
- 已知残留：`intent_readings` 无删除触发器（F-03，见 02 文档）。

---

## 8. Provider 与密钥（A.7）

- 抽象：`ProviderPort`（`provider-policy.ts:38-41`）；唯一 HTTP 实现 `OpenAICompatibleProvider`（DeepSeek/Spark/本地 OpenAI 兼容共用）；mock 由测试注入 fetcher。
- 白名单：DeepSeek 端点+模型钉死（`provider-registry.ts:21-44`）；Spark 泛模型；local 必须回环。
- 密钥：Electron safeStorage(DPAPI) 加密 → `userData/secrets/<id>.bin`（0600/0700、tmp+rename 原子写、Linux basic_text 后端拒绝）；明文不落 SQLite；保存失败回滚 DB 与旧凭据（`secrets.ts:36-104`、`companion-service.ts:457-501`）；请求仅进 Authorization 头、`redirect:'error'` 防重定向泄密钥、错误体只取数字码（`openai-compatible.ts:72-85,268-283`）。
- 切换：`requireConfigured()` local→spark→deepseek 优先级；回合内切换由二次 prepare 哈希比对拦截。**UI 缺口**：renderer 只暴露 deepseek+local（`companion-ui.ts:137-139`），Spark 无 UI 面（R1，见 02）。
- 模型标识：DeepSeek 钉死 `deepseek-flash`（`shared/companion.ts:6`）；响应 modelId 回传并记入 turn context；UI 硬编码文案 "DeepSeek-V4.1-Flash-1017" 与常量不一致（R6）。

---

## 9. 文件能力（A.8）

生产代码 fs 调用点仅 3 处（grep 证据）：`src/security/secrets.ts`、`src/persistence/backup-service.ts`、`src/persistence/database.ts`（`src/evaluation/*cli.ts` 为开发期 CLI，未接入应用）。

**能做**：自身 SQLite 读写（WAL + secure_delete）、迁移前自动 VACUUM 备份、凭据加密文件（原子写 + 0600）、整库备份导出（用户经系统对话框选目录，renderer 不传路径）+ manifest、备份恢复（预览 → token → 校验 → 原子 swap + 回滚副本）。

**不能做/缺口**：无任意文件读写 API；无对话/单条记忆导出为文本/Markdown；无文件导入；无文件管理器能力。这印证产品原则"文件能力是后续阶段补全项，不引入自主 Agent 执行"。

**路径防护**：renderer 可控输入无路径字段（全部 UUID 强制）；路径拼接仅发生在主进程内部生成（secrets id 白名单 `^[a-z0-9-]{1,40}$` + encodeURIComponent 双重防护）；VACUUM INTO 路径单引号转义。未发现 renderer 可达的路径穿越面。

---

## 10. 可观测性、审计与隐私（A.9）

- 结构化 JSON 行 logger（级别过滤、key 级脱敏 [apikey/authorization/token/secret/password/credential/requestpayload/prompt/content/body/context]、>500 字符截断，`observability/logger.ts:7-27`）；**只写 stderr 不落盘**（:44-45）——崩溃后无本地日志可取证（闭环缺口）。
- 审计事件走 `event_journal` 表：写入前 schema 校验（≤32 键、单值 ≤2000 字符，`persistence/event-log.ts:72-89`）；已验证 21 类审计事件（app.started/closing、memory.created/corrected、turn.evaluated/recovered、cognition.degraded/knowledge_gap、relationship.* 等）；记忆事件只存元数据不存原文（`memory-service.ts:780-793`）。
- **缺口**：`event_journal` 无 IPC 只读通道、无 UI——审计"可追溯"目前只对开发者成立；记忆硬删无审计事件（仅 deletion_journal 一行，见 F-06）。
- turn 状态机全生命周期持久化（received/analyzed/context_ready/awaiting_consent/requesting/response_received/failed/cancelled/committed）。

---

## 11. 构建、安装、升级、Smoke 与 CI（A.10）

- **构建**：electron-vite 三段（main/preload/renderer），自定义 CSP 插件；electron-builder NSIS x64（asar、`oneClick:false`、按用户安装、卸载保留数据，package.json build 字段 :50-80）。
- **CI**（`.github/workflows/ci.yml`，唯一 workflow）：
  - `verify`：矩阵 windows + ubuntu → typecheck → test → **evaluate + evaluate:cognition（离线评测进 CI）** → build → Electron smoke（Linux 用 xvfb）。
  - `windows-install-path`：`vitest run src/persistence`（迁移测试，含 v1→v47 升级路径）。
  - **不在 CI**：evals 各 stage runner（60 场景 final-closure 等）、`package:win`、NSIS 安装验收、live 评测。
- **Smoke**：`scripts/smoke.mjs`（1273 行）CDP 驱动真机 E2E——默认离线/无捏造回复、认知 opt-in 披露、人格版本化、记忆全生命周期、目标审批拒绝链、重启重放、级联删除、凭据损坏恢复；`--verify-upgrade` 模式验证已安装应用升级。
- **安装验收**：`windows-alpha-install-acceptance.ps1`（打包 → 静默装 → smoke → 校验 → 升级再装 → 卸载保留数据），**不在 CI 且自记 NOT_RUN**（`docs/testing/stage-3-final-gate-matrix.md:53`）。
- **测试规模**：src 内嵌 102 文件 / 约 925 用例 + tests/ 5 文件 49 用例（含多进程崩溃测试 b4-child-crash、真实 send 主链 c1-mainchain、验收场景 acceptance/scenarios A-H）；评测 evals/ 365 文件（stage-2/3/4a/5/real-provider/final-product），离线 ScriptedProvider 与 live（MORROW_TEST_API_KEY）严格分离，缺 key 写 `BLOCKED_NO_SECRET` 一等结果，写盘前 `assertNoSecret` 防泄漏。
- 本次基线实测（本机 Windows，2026-11-02 23:27）：`tsc --noEmit` 通过；`vitest run` 107 套件中 105 通过、**1003 测试通过 + 5 跳过**，2 个套件因本机 esbuild 临时文件写入被拒（Access is denied，环境性问题非断言失败）失败——CI 同基线全绿。

---

## 12. 能力矩阵总表（六态）

| 能力域 | 能力 | 状态 | 关键证据 |
|---|---|---|---|
| 对话 | 一轮对话主链（幂等/锁/状态机/落库） | 已实现+有运行证据 | companion-service.ts:1531-1905；c1-mainchain、turn-reliability |
| 对话 | 流式输出/取消/重试/超时预算 | 已实现+有运行证据 | openai-compatible.ts；provider-retry.test |
| 对话 | 崩溃恢复（中断 turn 二分恢复，不重发） | 已实现+有运行证据 | recoverInterruptedTurns :2402-2490；b4-child-crash |
| 对话 | chat IPC 通道专项测试 | 已实现缺闭环 | ipc.test.ts 未覆盖 chatSend/chatDelta/chatCancel |
| Provider | 密钥加密存储/回滚/损坏处理 | 已实现+有运行证据 | secrets.ts；secrets-storage.test |
| Provider | Spark 完整链路 | 已实现缺闭环 | 适配器+服务级测试有；UI 零暴露（renderer 无 spark） |
| Provider | Provider 切换（UI 面） | 部分实现 | 后端三级优先可用；UI 仅 deepseek+local |
| 人格 | 基线+版本化+IPC 读写恢复 | 已实现+有运行证据 | personality_profiles/revisions |
| 人格 | G1 成长偏移+回滚 | 已实现+有运行证据 | personality-growth.ts；longitudinal evals |
| 人格 | G2 交互画像 | 已实现+有运行证据（无独立 IPC） | interaction-profile.ts |
| 人格 | B2 有界个性化（含记忆排序 P 项） | 已实现+有运行证据 | personalization-service.ts |
| 情绪 | 三维状态+事件溯源+衰减+表达策略+检索放宽 | 已实现+有运行证据 | feeling.ts；stage5 系列 |
| 兴趣 | 证据账本+origin 隔离+晋升/归档 | 已实现+有运行证据 | interest-service.ts；interestsList/SetStatus IPC |
| 兴趣 | Morrow 自选兴趣（知识缺口驱动） | 已实现+有运行证据 | knowledge-gap-service.ts |
| 兴趣 | 自主探索门 X1（预算+settle 闭环） | 已实现+有运行证据 | exploration-policy.ts |
| 自我模型 | 条目+纠正+撤回+IPC | 已实现+有运行证据 | selfModel IPC list/correct/retract |
| 反思 | 7 种 producer+路由+消费评分 | 已实现+有运行证据 | reflection-service.ts、reflection-routing.ts |
| 反思 | open_question finding | 仅文档设计 | 有 schema/模板，无 producer 且路由表缺条目（BL-01） |
| 反思 | startup 触发的路由 | 部分实现 | run('startup') 后未 ingestRun（R1） |
| 反思 | pending_personality_candidates | 已实现缺闭环 | 只写不读，无决策面 |
| Pending | pending item 生命周期+用户决策 IPC/UI | 已实现+有运行证据 | pending-items.ts + pending-ui.ts；route 行终态不同步（F-01） |
| 目标 | 显式承诺目标 detect→prompt→expire | 已实现+有运行证据 | companion-goal.ts；eval L10 |
| 目标 | goal candidate 用户确认闭环 | 部分实现 | 服务方法完整但无 IPC/preload/renderer（BL-03） |
| 目标 | Morrow-owned goals | 仅文档设计 | schema/描述行就绪，无生产者 |
| 记忆 | 规则抽取/显式写入/纠正/撤回/恢复/硬删 | 已实现+有运行证据 | fact-slot、memory-service、IPC+预响应执行 |
| 记忆 | 混合检索（RRF+效用重排） | 已实现+有运行证据 | memory-context-assembler.ts；M3 评测 |
| 记忆 | 重要性/巩固/归档/遗忘调度 | 已实现+有运行证据 | memory-importance、maintenance 调度器 |
| 记忆 | 冲突检测与视野保障 | 已实现+有运行证据（自动消解缺失为设计） | conflict-handling 测试 |
| 记忆 | 语义/向量召回 | 缺失 | 无 embedding（设计取舍，非缺陷） |
| 记忆 | >1000 条活跃记忆的召回保障 | 已实现缺闭环 | listActiveForContext(1000) 硬截断无观测（F-04） |
| Consent | 出口逐次同意+哈希+敏感门禁 | 已实现+有运行证据 | provider-policy.ts；acceptance 泄漏断言 |
| IPC | 68 通道白名单+校验+错误脱敏 | 已实现+有运行证据 | ipc.test.ts 19 例 |
| 文件 | 整库备份导出/恢复+删除边界重放 | 已实现+有运行证据 | backup-service.test 16 例 |
| 文件 | 文本/Markdown 导出导入、文件管理 | 缺失 | 生产代码无对应能力 |
| 可观测 | 结构化日志+脱敏框架 | 已实现缺闭环 | 框架在，不落盘、调用点少 |
| 可观测 | 审计事件（event_journal） | 已实现缺闭环 | 写入完整，无用户可读出口 |
| 可观测 | 用户可读日志/审计界面 | 缺失 | — |
| 安全 | Electron 加固+信任渲染源+沙箱 | 已实现+有运行证据 | security.test.ts 10 例 |
| 安全 | 代码签名 | 仅文档设计 | SECURITY.md:46 自述未配置 |
| 持久化 | 47 版迁移+升级备份+事务+WAL | 已实现+有运行证据 | migrations.test；CI windows-install-path |
| 持久化 | intent_readings 会话级联删除 | 部分实现 | 无删除触发器（F-03） |
| 构建 | 三段构建+NSIS 打包配置 | 已实现+有运行证据 | build 成功（CI）；package:win 产物未在 CI 验证 |
| 构建 | Windows 安装/升级/卸载全流程 | 人工验收未完成 | smoke --verify-upgrade 与 ps1 脚本在；CI 无 job，自记 NOT_RUN |
| 评测 | 离线 Scripted 评测体系（6 stage+指标+ablation） | 已实现+有运行证据 | evals/ 365 文件；evaluate 进 CI |
| 评测 | live 真实 Provider 评测 | 部分实现 | 通道+合同+防泄漏在；最近两次 live 结果 FAIL、人工评审 PENDING |
| 评测 | 真人盲评（自然度） | 人工验收未完成 | evals/*/review/ 依赖人工签署，PENDING_HUMAN |

---

## 13. 测试盲区汇总（跨模块）

1. chatSend/chatDelta/chatCancel IPC 通道无直接测试（流式回推、consent-FORBIDDEN 的 IPC 呈现）。
2. `requestProviderConsent` 系统对话框逻辑（120s 过期、取消路径）无单测。
3. renderer 层（companion-ui/goals-ui/pending-ui）零自动化测试。
4. 历史裁剪边界（12 条/6000 字符、单条超长 break 语义）无单测。
5. 无真实 Electron 运行时端到端安全测试（window 选项/permission handler 仅对象断言）。
6. `event_journal` 无查询出口，审计完整性无验收。
7. 记忆 >1000 条、feeling 事件 5000 上限等容量边界无测试。
8. 恢复重放撤回边界后再次生命周期转移无测试（与 F-05 缺陷相关）。
9. evals 全部 stage runner 不在 CI；打包/安装验收不在 CI。
10. 无 lint / coverage（显式关闭）/ dependabot。

---

## 14. 结论

基线 `3812b18` 的伴侣本体核心链路（对话状态机、consent 门禁、记忆生命周期、人格三层、情绪事件溯源、outbox/租约账本）**实现完整且证据充分**，工程质量显著高于平均水平：注释与实现一致性高、事务边界清晰、幂等与恢复路径有针对性测试。结构性缺口集中在三类：

1. **用户确认面断链**（goal candidates、pending personality candidates 只有写端没有读端；open_question 无 producer 且路由表缺条目）——正是 Issue #37 Stage 4 要收口的内容。
2. **可观测性闭环**（日志不落盘、审计事件用户不可见）。
3. **规模化与真实验证**（检索 1000 条上限、live 评测 FAIL/PENDING、安装验收 NOT_RUN）。

"人格/情绪/记忆确实进入 Provider 请求"这一点有完整证据链（拼接点 `companion-service.ts:2137-2159` + 持久化断言测试 + 真实 send 路径测试），不存在"内置状态与真实请求脱节"的问题。
