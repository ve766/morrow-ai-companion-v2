# Morrow V2 证据化缺陷与风险审计（工作包 B）

- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 审计方式：只读源码审计 + 逐项代码证据；不照抄旧审计（PR #35 报告、Issue #37 backlog），所有条目在基线 3812b18 上重新核实
- 置信度定义：**高**=有直接代码/测试证据可复核；**中**=逻辑推断成立但未构造运行时复现；**低**=标注待验证
- 类型词汇：Bug / 设计缺陷 / 未实现能力 / 评测不足 / 人工验收阻塞 / 外部环境问题
- 总体结论先行：**未发现 P0/P1**。发现 7 条 P2、约 20 条 P3。核心链路（consent、turn 状态机、outbox/租约账本、撤回删除）工程质量高；缺陷集中在三类结构性缺口：①用户确认面断链（服务能力存在、用户入口不存在）②注册表/决策面不同步 ③规模化与真实验证缺口。

---

## 1. Issue #37 三项复核结论（基线 3812b18 实测）

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| 1 | BL-01：反思路由缺 open_question | **仍存在**（潜伏缺陷） | `src/cognition/reflection-routing.ts:32-40` REFLECTION_FINDING_KINDS 与 `:58-94` FINDING_ROUTES 均无 open_question；而 `src/self-model/self-model-domain.ts:23`（producer 类型）、`src/cognition/pending-items.ts:18,137`（source 集合与摘要模板）、`src/persistence/migrations.ts:1044,1547`（DB CHECK 允许）、`src/self-model/reflection-mapping.ts:62`（映射 descriptive）四处均承认它。当前无 producer 发射该 kind，故为潜伏：一旦有生产者（或旧库遗留行重放），`ingestRun`（reflection-routing.ts:153-158）会记 `reflection.finding_unroutable` 并永久跳过。行为已被测试固化为 fail-closed（`reflection-routing.test.ts:144-150`），不能靠放宽默认路由解决 |
| 2 | BL-02：pending 终态与 route 行收敛 | **部分修复** | 已防护：终态单向（complete/drop 带 `WHERE status='open'`，`cognitive-context-repository.ts:187-202`；upsert 的 ON CONFLICT 不触碰 status 列 `:134-159`），"复活"不成立。未收敛：`PendingCognitionService.decide`（pending-items.ts:299-302）只更新 pending item 单行；`reflection_finding_routes.status` 全库仅 3 处 UPDATE（reflection-routing.ts:227/256/278，均为注入/消费追踪），**没有任何代码路径写 rejected/dismissed**（CHECK 约束与 TS 类型声明均为死值）——用户决策在 route 表上永久显示 `routed`。另 `ingestRun`（:160-173）中 route INSERT 与 absorbReflection 两条语句无事务包裹，崩溃可留悬挂行；decidePendingItem IPC 不记审计事件 |
| 3 | BL-03：goal candidate 确认闭环 | **仍存在**（验收阻塞） | `src/motivation/companion-goal.ts:271,296,347` 的 listCandidates/acceptCandidate/rejectCandidate 在全 src 中除定义与测试外零调用；`src/shared/contracts.ts:57-65` 无 candidate 通道；preload/renderer 零命中。生产端 goal projector（`companion-service.ts:947-957`）每回合仍写 pending 候选（goal_candidates 表无 TTL）——候选无限累积、永不转化。`acceptCandidate` 服务层本身实现质量好（单事务+幂等+源消息校验），只是不可达 |

---

## 2. Findings 明细

### P2 级（7 条）

---

**AUD-01 pending 用户决策不回写 route 行，消费评测链路失真**
- 级别 P2｜类型 设计缺陷｜置信度 高｜模块 cognition
- 证据：`src/cognition/pending-items.ts:299-302`（decide 只写 item）；`src/cognition/reflection-routing.ts:103`（RoutedFinding.status 声明含 rejected/dismissed）与 `src/persistence/migrations.ts:2208`（CHECK 允许）为死值。
- 触发：用户对 pending_user 类反思项（intent_correction）做任何决策。
- 影响：route 行永远停留 `routed`；按 route 状态统计"用户否决了多少反思建议"的评测与审计拿不到数据；与 BL-02 的验收要求（accepted→done / rejected→dropped 且 route 状态可审计）不一致。
- 根因（事实）：decide 路径与 route 表从未接线。根因（推测）：BL-02 修复时只做了 item 侧终态守卫，route 侧写入被遗漏。
- 修复方向：decide 在同一事务内回写对应 route 行（accepted→consumed 类终态、rejected/dismissed→对应终态）+ 最小审计事件（ID/状态/时间/decision，无原文）。
- 回归测试：三决策路径的 item/route 状态一致性；重复决策幂等；终态后相反决策 conflict。
- 交付阻塞性：Issue #37 Stage 4 范围内，阻塞其验收。

---

**AUD-02 ingestRun 非原子，崩溃可留"已路由无消费面"悬挂行且永不自愈**
- 级别 P2｜类型 Bug｜置信度 高｜模块 cognition
- 证据：`src/cognition/reflection-routing.ts:160-173`——route 行 INSERT 与 `PendingCognitionService.absorbReflection` 两条独立语句无事务包裹；projector 路径（`companion-service.ts:991-1002`）抛错标记 outbox failed_retryable，重放时会**新跑一次 reflection**（新 run 新 findings），旧悬挂永不修复。
- 触发：route 写入成功后、absorbReflection 前进程崩溃。
- 影响：该 finding 永久"已路由但无 pending item"；审计与评测计数失真。
- 根因（事实）：无事务边界。仓库已有 `database.transaction`（顶层 BEGIN IMMEDIATE、嵌套 SAVEPOINT，`persistence/database.ts:142-163`）可直接复用。
- 修复方向：ingestRun 包进单事务。
- 回归测试：事务中途故障时 route 与 item 同时回滚（可用 SAVEPOINT 注错或故障注入）。
- 交付阻塞性：Issue #37 Stage 4 范围内（BL-02 的组成部分）。

---

**AUD-03 goal candidate 用户确认闭环缺失，候选无限累积**
- 级别 P2｜类型 未实现能力（服务层已实现、用户入口缺失）｜置信度 高｜模块 motivation / app / preload / renderer
- 证据：见 Issue #37 复核第 3 项。补充：`goal_candidates` 表无 TTL/expires_at，仅消息删除触发器置 expired（`migrations.ts:2007-2018`）。
- 影响：含糊期限的长期目标（needsConfirmation=true，置信度 0.45）永久滞留 pending，产品内"这是不是我的长期目标"永远问不到用户；候选表持续膨胀；eval L10 已验证的 detect→prompt 链停在半程。
- 根因（事实）：detectFromTurn 由 outbox 每回合驱动，accept/reject/list 无 IPC/preload/renderer 三层接线。
- 修复方向：按 Issue #37 §1.3 补三层入口 + 轻量候选确认区；拒绝必须持久化。
- 回归测试：Issue #37 §4 "Goal candidate confirmation" 全矩阵（并发 accept 幂等、来源删除不可接受、重启一致、owner 语义不变）。
- 交付阻塞性：Issue #37 的核心交付项。

---

**AUD-04 备份恢复重放撤回边界后修订号错位，该记忆后续任何转移永久失败**
- 级别 P2｜类型 Bug｜置信度 高｜模块 persistence
- 证据：`src/persistence/backup-service.ts:396-427` 重放 delete/retract/unretract 边界时 `appendBoundaryRevision`（:82-102）向 `memory_revisions` 插入 `MAX(revision)+1`，但 `retractMemory/unretractMemory` 的 UPDATE 不递增 `memories.revision`。恢复后该记忆的 `memories.revision` 停在原值（如 2），而 revisions 表已有修订 3。此后任何 confirm/correct/restore 走 `transitionMemory` 计算 revision=3，`insertRevision` 撞 PK `(memory_id,revision)`（`memory-repository.ts:158-175`），事务回滚且原始 SqliteError 未包装——用户表现为"对该记忆的确认/纠正全部失败"。
- 触发：备份导出 → 期间对该记忆撤回/恢复（产生 journal 行）→ 恢复 → 之后对该记忆做任何生命周期转移。
- 根因（事实）：边界重放写 revisions 表但不同步 memories.revision 列。现有备份测试只断言时间线渲染，未测"恢复后再转移"（A3 审计盲区 ①）。
- 修复方向：边界重放时同步 `memories.revision = MAX(revision)+1`（或重放后校正一次）。
- 回归测试：恢复 → retract → confirm/correct 全链；冲突时错误应包装为领域错误而非裸 SqliteError。
- 交付阻塞性：不阻塞 PR #35 合并门槛（触发链窄），但属数据可靠性缺陷，建议下一修复轮处理。

---

**AUD-05 Spark Provider 无 renderer 表面，仅启用 Spark 时 UI 发送按钮永久禁用**
- 级别 P2｜类型 设计缺陷（前后端能力不同步）｜置信度 高｜模块 renderer / app
- 证据：`src/renderer/src/companion-ui.ts:137-139` 只加载 deepseek+local 两个 provider 卡片；`:116-119` 发送门控为 `deepseekReady || localReady`；后端 `requireConfigured()`（`companion-service.ts:598-615`）却会优先选 spark。grep `spark` 在 `src/renderer/` 命中 0 次。
- 触发：用户只配置 Spark（适配器与服务级测试齐全，`openai-compatible.test.ts:154-222`、`cognitive-continuity-phase24.integration.test.ts:268-274`）。
- 影响：后端可发送但 UI 永远禁用发送、状态栏显示错误对象——真实用户旅程被堵死。
- 根因（事实）：renderer provider 面板与后端 registry 优先级不同步。
- 修复方向：renderer 补 spark 卡片，或将后端优先级与 UI 暴露面对齐。
- 回归测试：仅启用 Spark 的端到端 UI 旅程（当前零覆盖）。
- 交付阻塞性：不阻塞（DeepSeek/本地路径可用），属交付质量缺口；"第二真实 Provider"人工验收的前置。

---

**AUD-06 pending_personality_candidates 只写不读，人审面缺失**
- 级别 P2｜类型 未实现能力｜置信度 高｜模块 self-model
- 证据：`src/self-model/reflection-service.ts:713-736`（bias_hint → 写入 pending_personality_candidates，14 天过期字段存在但无清理作业）；`ReflectionService.pendingPersonalityCandidates()` 唯一调用在测试 `self-model.test.ts:294`。无 IPC、无 UI、无消费者。
- 影响：反思产生的"人格假设"永远无用户确认渠道；与产品原则"模型推断不得升级为用户事实"一致（它确实没有自动应用——防护正确），但确认面缺失意味着这条证据积累通道是死胡同。
- 修复方向：接入 pending 决策面（与 AUD-01/AUD-03 同一 UI 面）或明确删除该通道并记录决策。
- 回归测试：候选过期清理；接受/拒绝后不复活。
- 交付阻塞性：不阻塞当前交付；建议与 Stage 4 确认闭环同轮处理。

---

**AUD-07 startup 触发的反思不经过路由，findings 静默丢失**
- 级别 P2｜类型 Bug（调用链不一致）｜置信度 高｜模块 app / cognition
- 证据：`src/app/index.ts:383-384` 启动时 `reflection.run('startup')` 后未调 `findingRouter.ingestRun`；而 manual（IPC reflectionRun）与 post_conversation（outbox projector）两条路径均接 ingestRun。
- 影响：启动反思产生的 findings 不产生 context hints / pending items；只有后续 run 因 dedupeKey 重放同 finding 时才被路由——若证据老化（如 14 天半衰期）则永远不可达。无任何测试覆盖此差异。
- 根因（事实）：三处触发点接线不一致，startup 处遗漏。
- 修复方向：startup 路径补 ingestRun（或有意为之则加注释与测试固化）。
- 回归测试：startup 触发产生 pending item / hint 的集成测试。
- 交付阻塞性：不阻塞；与 Stage 4 反思收口同轮处理自然。

---

### P3 级（汇总表 + 关键条详注）

| ID | 级别 | 类型 | 标题 | 模块 | 证据 | 置信度 |
|---|---|---|---|---|---|---|
| AUD-08 | P3 | Bug | 会话删除后 intent_readings 永久残留（无 FK、无触发器，含用户消息解析出的结构化意图，与 secure_delete 语义不一致） | persistence | migrations.ts:2128-2156 无删除路径；全库无 `DELETE FROM intent_readings` | 高 |
| AUD-09 | P3 | Bug/边界 | 检索候选池 `listActiveForContext(1000)` 硬截断无观测：>1000 条活跃记忆时最旧记忆无声退出全部召回（含 fact 通道），退化回退扫描仅 slice(0,200) | memory | memory-service.ts:166,214,393；memory-repository.ts:100-103；:292 | 高 |
| AUD-10 | P3 | 设计缺陷 | 仅经 contested 准入的矛盾记忆在 RRF 中垫底，候选池大时被挤出 prompt，模型在看不到矛盾时附和新说法——与"矛盾必须进视野"意图存在排名层落差 | memory | memory-context-assembler.ts:290-318,349,268-274 | 中 |
| AUD-11 | P3 | 设计缺陷 | consent 拒绝/冲突路径下显式记忆写操作已提交且来源消息未落库：记忆已写入但该回合无用户可见痕迹，provenance.sourceMessageId 指向未持久化消息 id（重发同文本会经归一化去重 confirm，不重复建行） | app/memory | companion-service.ts:2040-2055（有意设计，注释 :2036-2038）、:1601,1647；memory-service.ts:505-508 | 高 |
| AUD-12 | P3 | 设计缺陷 | 历史窗口从新到旧遇单条超预算消息整体 break：一条 >6000 字符消息截断其后所有更短历史，极端下 prompt 无历史 | app | companion-service.ts:2160-2167；cognitive-turn-analyzer.ts:48-63 | 高 |
| AUD-13 | P3 | Bug | renderer pending 决策失败静默：`result.ok` 才刷新，失败无提示；快速双击第二次被后端守卫挡住但 UI 无反馈 | renderer | pending-ui.ts:66-69 | 高 |
| AUD-14 | P3 | Bug | 每次硬删记忆产生伪 `memory.fact_index.degraded` 事件（级联已清 fact_records，删除后的 reindexFact 必然 FK 失败，计数污染） | memory | memory-service.ts:418-421；fact-memory.ts:135-141 | 高 |
| AUD-15 | P3 | Bug | 删除记忆无审计事件（全库无 memory.deleted 事件类型，仅 deletion_journal 一行无 payload），可追溯性弱于其他转移 | memory/observability | memory-service.ts:418-421 对照 event-log 事件清单 | 高 |
| AUD-16 | P3 | Bug | 反思 run 审计字段 `examinedTurns: feedbackEvents.length` 语义错位（记 feeling 事件数非轮数） | self-model | reflection-service.ts:449 | 高 |
| AUD-17 | P3 | 设计缺陷 | 情绪事件表 `MAX_COGNITIVE_FEELING_EVENTS=5000` 无裁剪/归档：达上限后每次写抛 STORAGE_ERROR，情绪状态永久冻结（长期使用触发） | affective-state | cognitive-feeling-service.ts:16,114 | 高 |
| AUD-18 | P3 | 性能 | conflictedIds O(n²) + 全量正则分词，每次装配最多 1000 条两两词元集交集（≈50 万次），significantTerms 每条重算 | memory | memory-service.ts:236-251 | 高 |
| AUD-19 | P3 | Bug | 重申式 create 合并（归一化去重转 confirm）丢失 provenance：confirm 修订无 source_message_id，事实账本 source 停留旧消息 | memory | memory-service.ts:164-171,795-811 | 中高 |
| AUD-20 | P3 | Bug | 恢复边界修订硬编码 `source_category='user_explicit_input'`，对 model_inferred_confirmed 记忆重放撤回时修订来源错标 | persistence | backup-service.ts:399-402 | 高 |
| AUD-21 | P3 | 死代码 | `memory_evidence.retracted_at` 无生产写者（撤回抑制实际靠 status 分支），注释与实现漂移 | memory | memory-importance.ts:196-198 | 高 |
| AUD-22 | P3 | 设计权衡 | growth 权重下限 0.6：conf<60 的低置信显式风格请求仍获 ≥0.6 权重，3 轮即过 MIN_EVIDENCE 门槛产生 ±1 漂移，与"置信度即可靠度"注释意图有张力 | personalization | personality-growth.ts:232 | 中 |
| AUD-23 | P3 | 设计缺陷 | 反思 hint 一次性消费（not_observed 后永不重注入）未在文档/注释中说明为有意策略，无评测覆盖 | cognition | reflection-routing.ts:196,254-260 | 中 |
| AUD-24 | P3 | Bug | goal 闸门顺序 question 在 negated 之前："我不打算X？"先被 question 闸拦截——结果同为拒绝但 gate 归因不准 | motivation | companion-goal.ts:121-130 | 高 |
| AUD-25 | P3 | 设计缺陷 | interests.list() 读路径执行写（reconcile 修复/删行），且发生在 prompt 组装内；单进程写锁下安全但读放大写 | self-model | interest-service.ts:393-400,695-737 | 中 |
| AUD-26 | P3 | 死常量 | `maxMemoryContextCharacters`（companion-service.ts:284）死常量与 assembler 默认 3000 双源，单改其一静默漂移 | app/memory | companion-service.ts:284；memory-context-assembler.ts:210 | 中 |
| AUD-27 | P3 | Bug | UI 硬编码文案 "DeepSeek-V4.1-Flash-1017" 与后端模型常量 `deepseek-flash` 不一致，模型更名时误导 | renderer | companion-ui.ts:110；shared/companion.ts:6 | 高 |
| AUD-28 | P3 | 设计缺陷 | 主库文件未显式 chmod 0600（迁移备份/凭据文件均有），Windows ACL 兜底但与"0600 为私密基线"做法不一致 | persistence | database.ts:93-128 | 高 |
| AUD-29 | P3 | 设计缺陷 | 备份导出为明文整库写用户任选目录，UI 未警示云同步风险 | persistence | backup-service.ts:190-223 | 高 |
| AUD-30 | P3 | 设计缺陷 | logger 的 msg 字段不脱敏（redact 仅作用 fields）；现网调用点均固定文案无泄漏，框架约束不足易引入回归 | observability | logger.ts:54 | 中 |
| AUD-31 | P3 | Bug | `src/shared/validation.ts` 源文件内嵌原始控制字节（NUL），语义正确但文件被识别为 data，工具链脆弱点（应写 `\u0000`） | shared | validation.ts ~:241 | 高 |
| AUD-32 | P3 | 边界 | chat.onDelta 推送无渲染端归属校验，多会话并发取消后陈旧 delta 需 UI 自行丢弃（request-guard 未覆盖 delta 流） | preload/renderer | preload/index.ts:110-114 | 中 |
| AUD-33 | P3 | 设计缺陷 | event_journal 无用户可读出口（无 IPC/UI），审计"可追溯"只对开发者成立 | observability | 全库无 journal 查询通道 | 高 |
| AUD-34 | P3 | 设计缺陷 | 反思 bias_hint 引用人格维度 depth 的依据链弱（仅凭 ≥2 次负反馈），可能产生误导性自我批评 hint | self-model | reflection-service.ts:338-354 | 低（待验证） |
| AUD-35 | P3 | Bug | register-ipc 模块级单例二次调用静默返回旧 unregister 不注册新 handler（当前仅调用一次，脚枪非可达缺陷） | app | register-ipc.ts:7 | 中 |
| AUD-36 | P3 | 文档 | vitest.config.ts 注释称迁移"38 versions"，实际 CURRENT_SCHEMA_VERSION=47 | 构建 | vitest.config.ts:8 | 高 |

---

## 3. 评测不足与人工验收阻塞专项

| ID | 级别 | 类型 | 内容 | 证据 |
|---|---|---|---|---|
| AUD-37 | P2 | 人工验收阻塞 | live 真实模型评测最近两次结果 FAIL（stage-3 live 30 轮 spark；final-closure-live 8 场景），主观评分全部 manualReview PENDING——最终 RC 的真实模型证据链弱于脚本化证据 | `evals/stage-3/live/results/20261031T073847Z-876d263.json`、`evals/real-provider/results/20261101T091701Z-d43cfb6-final-closure.json`（status=FAIL、PENDING） |
| AUD-38 | P2 | 人工验收阻塞 | Windows 安装/升级/卸载全流程验收（windows-alpha-install-acceptance.ps1）无 CI 且自记 NOT_RUN；`package:win` 不在 CI | `docs/testing/stage-3-final-gate-matrix.md:53`（D3=NOT_RUN）、`.github/workflows/ci.yml` 无对应 job |
| AUD-39 | P3 | 评测不足 | evals 全部 stage runner（stage-2/3/4a/5/final-product，含 60 场景 final-closure 与 P01-P20）不在 CI，只能手动运行；CI 仅带走 evaluate/evaluate:cognition 两个离线套件 | ci.yml :38-41 与 evals/ 目录对照 |
| AUD-40 | P3 | 评测不足 | 真人盲评（自然度/温度）零自动化且零已签署结果；`evals/*/review/` 依赖人工，当前 PENDING_HUMAN | evals/stage-5 等 review 目录 |
| AUD-41 | P3 | 评测不足 | 本机 Windows 实测：2 个测试套件因 esbuild 写临时文件 Access is denied 失败（环境问题非断言失败；CI 同基线全绿）。测试对临时目录写权限/杀软干扰敏感，建议 runner 侧重试或使用项目内临时目录 | 本次基线实测 vitest 输出：`stage5-final-audit-repair.multiprocess.test.ts`、`offline-evaluation.test.ts` |

---

## 4. 已检查、未发现问题的清单项（含检查方法）

1. **记忆撤回/删除彻底性**：撤回为状态转移 + R2 守卫把非 active 记忆全部 fact 行置 retracted（`fact-memory.ts:179-185`）；lookupActive WHERE status='active'（:266-282）——撤回内容不可能被检索（硬过滤非降权）。硬删走 FK 级联 + secure_delete + deletion_journal + 30+ AFTER DELETE 触发器。**未发现撤回内容回流路径**。
2. **Consent 门禁绕过**：全库仅 3 处 `dispatchToProvider` 调用（companion-service.ts:591/1674/2569），全部先 authorize；consent 绑定 providerId + payload SHA-256（timingSafeEqual）+ 120s/5min 时效 + sensitive 未批拒绝；发送回合二次 prepare 哈希不一致即 CONFLICT。**未发现绕过路径**（AUD-11 是本地写副作用，非 egress 绕过）。
3. **IPC 越权/路径穿越**：68 通道全白名单 + 统一 execute 信任校验（senderFrame===mainFrame + URL）；renderer 可控输入无路径字段（UUID 强制）；`../` 注入有测试（ipc.test.ts:199,450）；secrets id 白名单双重防护。**未发现越权或穿越面**。
4. **凭据泄漏**：密钥仅 safeStorage 文件 + Authorization 头；`redirect:'error'` 防重定向；错误体只取数字码；eval 写盘前 assertNoSecret（字面量 + sk-/ak- 正则，`evals/stage-3/shared/real-provider.ts:171-183`）；acceptance 场景测试含 journal 凭据泄漏扫描。**未发现泄漏路径**。
5. **并发与幂等**：send 锁检查与登记同同步块；消息按 (conversation,turn,role) 幂等；memory 操作按 sourceMessageId 重放；effect ledger lease_generation 防 fencing；detectFromTurn 检查-插入非事务但有唯一索引兜底。**未发现实际并发缺陷**。
6. **取消/超时/重试状态一致性**：取消不落 assistant 消息、finalization 意图先于消息持久化、recoverInterruptedTurns 二分恢复且不重发；多进程崩溃测试（b4-child-crash）覆盖 4 个生命周期阶段。**未发现半截消息/孤儿 turn**。
7. **Provider 切换身份连续性**：人格/感受/自我模型/记忆全部本地存储与 Provider 无关；回合内切换由二次 prepare 拦截。**未发现不连续路径**。
8. **日志/SQLite 泄漏用户原文**：logger 生产调用点全部固定文案；记忆事件只存元数据。**未发现泄漏**（AUD-30 是框架层前瞻性风险）。

---

## 5. 修复优先级建议（供工作包 E 路线引用）

1. **Stage 4 收口轮（Issue #37 范围）**：AUD-01、AUD-02、AUD-03、AUD-07（同轮顺带）+ 对应回归矩阵。
2. **数据可靠性轮**：AUD-04（备份恢复修订号）、AUD-08（intent_readings 残留）、AUD-14/15（删除观测）。
3. **体验补全轮**：AUD-05（Spark UI）、AUD-13（决策失败提示）、AUD-27（模型文案）、AUD-26。
4. **随做随清**：P3 各条在触及对应模块时顺带修复（成本极低的一行类修复：AUD-16、AUD-24、AUD-31、AUD-36）。

全部 finding 已同步登记至 `evidence-index.json`（finding_id ↔ AUD-xx 一致）。
