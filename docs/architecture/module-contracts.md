# 模块契约（Module Contracts）

每个模块声明：职责、对外接口、状态所有权、失败处理、依赖方向。跨模块只经接口调用；除 `persistence` 拥有的数据库外，任何模块不得直接改动他模块的状态存储。

## 01 persistence（基础设施/持久化）

- **职责**：SQLite 打开/迁移/事务、版本化 schema（v1–v15）、备份/恢复、删除边界日志、统一事件日志。
- **接口**：`SqliteDatabase`（open/close/transaction/schemaVersion）、`applyMigrations`、`BackupService`、`EventLogService.record/tryRecord/list/count`、`MorrowEvent` 事件信封（schemaVersion、occurredAt、sourceModule、eventType、actor、subjectType/Id、correlationId、有界 payload）。
- **状态所有权**：全部数据表；`schema_migrations` 的版本与命名（实现线指纹，防外来库 fail-closed）。
- **失败处理**：迁移逐版本事务化；失败回滚并拒绝打开（低于 `DEGRADED_OPEN_MINIMUM_VERSION=9` 时 fail-closed）；备份校验（integrity、外键、版本、字节/哈希、清单计数）。
- **依赖**：仅依赖 node: 内置模块；无人依赖方向约束。

## 02 providers（模型供给）

- **职责**：统一 `ProviderPort` 接口下的 DeepSeek（remote）与本地 OpenAI 兼容（local）实现；出口策略与同意协议。
- **接口**：`ProviderPort.generate(ProviderInput, onDelta?)`、`ProviderProfile{id, providerClass, configured}`、`consentPreview/assessProviderRequest/dispatchToProvider`、`ProviderConsent`（payload 哈希 + timing-safe 比较 + ≤5 分钟 + 敏感度门禁）。
- **状态所有权**：无（无状态协议层）；凭据经 `security.SecretStore` 读取。
- **失败处理**：payload ≤64KB、local 类仅回环（`security/url-gate.isLoopbackEndpoint`，文本层证明，不做 DNS 信任）、HTTP 状态→安全错误码（AUTH/RATE_LIMIT/MODEL/TIMEOUT/NETWORK）、调用方取消与超时分离。
- **依赖**：security、shared。禁止依赖 conversation/memory。

## 03 conversation + cognition + personality（对话与理解）

- **职责**：会话/消息持久化与幂等重放；轮次分析（意图/主题/信号/证据引用）；人格档案（0–100 维度 + 争议风格 + 用户规则）与版本修订。
- **接口**：`ConversationService.create/list/read/appendMessage/delete`；`analyzeCognitiveTurn/boundCognitiveHistory`；`PersonalityService.get/save/history/restore`（变更仅由用户发起，全部带版本与 change_type）。
- **状态所有权**：conversations/messages、cognitive_turn_observations、personality_profiles/personality_revisions。
- **失败处理**：认知观察持久化失败降级为核心聊天；人格保存事务化；恢复=以 'restored' 类型新增版本（不抹历史）。
- **依赖**：persistence、shared、memory（仅类型）。

## 04 affective-state（计算性内在状态）

- **职责**：valence/activation/tension 三维 + explorationPriority 注意信号的证据加权规则引擎（`evidence-weighted-rules-v1`）。
- **接口**：`createCognitiveFeelingEvent`（事件识别与构造）、`applyFeelingEvent/decayFeelingState/previewFeelingUpdate`、`feelingPromptGuidance`、`CognitiveFeelingService.snapshot/recordCompletedTurn/preview/clearHistory`。
- **状态所有权**：cognitive_feeling_state/events/revisions（含 dirty 触发器重建）。
- **不变量**：幂等键唯一（重放返回 false 且语义冲突即拒绝）、单事件限幅（|Δ|≤0.16–0.22×可靠性权重）、半衰期衰减（valence 6h/activation 0.75h/tension 24h/attention 36h）、基线恢复、证据仅存消息引用（`rawTextStored:false`）、状态永远不覆盖事实/指令/安全（prompt 引导措辞强制声明）。
- **依赖**：persistence（含事件日志汇总写入）、cognition（类型）。

## 05 memory（可追溯记忆）

- **职责**：显式保存与“模型推断→用户审核”两条入库路径；来源分类（user_explicit_input | model_inferred_confirmed | turn_derived_confirmed）、置信度 1–100、last_confirmed_at、修订链（created/corrected/retracted/restored/confirmed）、敏感度三档、重复合并（NFKC 归一键 → confirm 原记录）、保守冲突标记（CJK bigram 共享 ≥2，仅建议）、过期识别（180 天未确认）、检索装配（词法分 × 置信度/50 × 30 天半衰期新近度，敏感度过滤，3000 字符预算）。
- **接口**：`MemoryService.create/correct/retract/restore/confirm/delete/search/history/detectConflicts/assembleContext`；`MemoryEventSink` 注入统一事件日志。
- **状态所有权**：memories、memory_revisions。
- **失败处理**：修订插入失败整体回滚（触发器测试覆盖）；事件记录 `tryRecord` 不阻塞主路径。
- **依赖**：persistence、shared。

## 06 self-model（兴趣/自我模型/反思）

- **职责**：跨会话兴趣形成（词项集身份、晋升需 ≥2 会话且 ≥3 证据、30 天归档、用户状态控制）；自我模型条目（fact/inference/unknown/correction，纠正=supersede 链）；有界反思（单趟、证据支撑 findings、8 条上限、1 个候选兴趣上限、6 次/小时硬限、绝不自触发）。
- **接口**：`InterestService.observe/archiveStale/setUserStatus/activeForContext`、`SelfModelService.record/correct/retract/activeStatementsForContext`、`ReflectionService.run/listRuns/findings/canRun`。
- **状态所有权**：interests、self_model_entries、reflection_runs/findings。
- **失败处理**：全部 `tryRecord` 事件化；观察/归档异常由调用方（聊天钩子）吞掉并降级。
- **依赖**：persistence、memory（读取记忆文本以派生候选）。

## 07 motivation（目标与提醒）

- **职责**：目标执行安全骨架（当前唯一受支持意图=只读记忆计数核对；prepare→approval（TTL 120s、单次有效、挑战回显）→执行→验证；审计全记录）；同意式提醒（调度、暂停、撤回、静音）。
- **接口**：`GoalService.create/prepare/requestApproval/approveAndExecute/cancelTask/stop/delete`、`ReminderService.*`。
- **状态所有权**：goals/goal_tasks/goal_actions/goal_approvals/goal_audit、reminders/reminder_settings/reminder_decisions。
- **失败处理**：中断恢复（recoverInterrupted）、超时→outcome_unknown（需用户确认才能再备）、审批过期拒绝。
- **依赖**：persistence、memory（只读工具）。

## 08 app（装配根）与 security

- **app**：Electron 生命周期、单实例锁、安全窗口（CSP/sandbox/导航拒绝/权限全拒）、IPC 注册（trusted-sender 校验）、Provider 同意对话框（按 providerClass 区分措辞与费用提示）、启动失败兜底、自环提供者优先级（local enabled → local，否则 deepseek）。
- **security**：`SafeStorageSecretStore`（Electron safeStorage/DPAPI，0600 原子写，损坏 fail-closed）、`isLoopbackEndpoint/isValidLocalModelName`、`request-guard`、渲染源信任校验。
- **失败处理**：凭据读写失败映射为用户可操作错误（PROVIDER_STORAGE_UNAVAILABLE / PROVIDER_CREDENTIAL_STORE_ERROR），聊天暂停而非崩溃；渲染加载失败 → 通用错误框 + 退出。

## 09 observability

- **职责**：JSON 行结构化日志；键级强制脱敏（apikey/authorization/token/secret/password/credential/requestPayload/prompt/content/body/context）+ 长串截断；日志自身永不抛出。
- **依赖**：无（sink 注入）。
