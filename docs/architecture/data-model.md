# 统一数据模型（Data Model）

SQLite（STRICT 表），单一数据库文件 `morrow.sqlite3`（用户目录），WAL、外键开启、`secure_delete=ON`。版本迁移 v1–v15，逐版本事务应用，`schema_migrations` 记录版本+命名（实现线指纹，不匹配即拒绝打开）。

## 领域表

| 表 | 版本 | 所有权 | 关键列 |
|---|---|---|---|
| memories | v14（重建） | memory | id, original_text, current_text, source_category(3 类), status(active/retracted), sensitivity(3 档), revision, **confidence 1–100**, **last_confirmed_at** |
| memory_revisions | v14（重建） | memory | memory_id FK, revision, content, source_category, change_type(created/corrected/retracted/restored/confirmed), previous_revision（自引用链）, confidence |
| memory_suggestions | v14（重建） | app | 来源消息 FK、claim、status(pending/accepted/rejected)、accepted_memory_id FK、evidence_hash；CHECK 绑定 status 与 reviewed_at/accepted_* 的一致性 |
| conversations / messages | v5 | conversation | 消息带 sequence、turn_id（请求幂等），UNIQUE(conversation,turn,role) |
| provider_profiles | v13（重建） | providers | id('deepseek'/'local-openai'), provider_class('remote'/'local')；DeepSeek 行 CHECK 钉死端点与模型 |
| personality_profiles / personality_revisions | v6/v8 | conversation(人格) | warmth/directness/humor 0–100、disagreement_style、system_rules ≤1500、版本号 |
| goals/goal_tasks/goal_actions/goal_approvals/goal_audit | v3 | motivation | 动作参数哈希、审批单次消费、审计事件流 |
| reminders / reminder_settings / reminder_decisions | v4 | motivation | 同意、暂停、冷却 |
| cognitive_turn_observations / cognitive_core_settings | v9 | cognition | 每消息尝试序号、分析 JSON（含证据引用） |
| cognitive_feeling_state / events / revisions | v10 | affective-state | 单行状态+revision、事件幂等键 UNIQUE、前后状态 JSON、dirty 触发器 |
| deletion_journal | v11 | persistence | (entity, entity_id) 主键；deleted/retracted/unretracted |
| event_journal | v12 | persistence | append-only：id UNIQUE、source_module、event_type、actor、subject_type/id、correlation_id、payload_json |
| interests | v15 | self-model | label、status(candidate/active/archived/dropped)、evidence_count、conversation_count、strength 0–1、confidence、首/末见时间、**terms_json**（词项集身份） |
| self_model_entries | v15 | self-model | kind(fact/inference/unknown/correction)、status(active/superseded/retracted)、superseded_by FK、confidence、消息证据 |
| reflection_runs / reflection_findings | v15 | self-model | trigger_kind、检查计数、findings（kind、置信度、evidence_json） |

## 统一事件信封（event_journal 行的语义模型）

```ts
interface MorrowEvent {
  id: uuid(v4, 小写)
  schemaVersion: 1
  occurredAt: ISO-8601 Z
  sourceModule: 'app'|'conversation'|'memory'|'personality'|'cognition'|'affective-state'
              |'motivation'|'self-model'|'providers'|'security'|'persistence'
  eventType: /^[a-z0-9_-]{2,32}(\.[a-z0-9_-]{2,32}){1,3}$/   // 如 memory.corrected
  actor: 'user' | 'system' | 'provider'
  subjectType: string        // 'memory' | 'interest' | 'self_model_entry' | 'feeling_state' | ...
  subjectId: string | null
  correlationId: string | null   // 建议接受时=建议ID；聊天相关=会话ID
  payload: Record<string, unknown>  // ≤32 键，单值序列化 ≤2000 字符；禁止原文与凭据
}
```

写入规则：业务事务内可同步写（memory 转换）；观察性写入用 `tryRecord`（失败返回 null，绝不阻塞闭环）。append-only，无 UPDATE/DELETE 路径。

## 关键不变量

1. 记忆修订链线性：previous_revision 指向上一版，删除主记录级联删除全部修订。
2. 删除边界：memory/conversation 的删除与撤销状态进入 deletion_journal；备份恢复后按日志重放边界（备份之后的删除仍然有效）。
3. 感受事件幂等键 UNIQUE；重复提交语义必须完全一致才视为已处理。
4. interests.label 唯一（lower），身份合并依据 terms_json 共享 ≥2。
5. 自我模型纠正必然成对：新 correction 条目 + 旧条目 status=superseded 且 superseded_by 指向新条目。
6. 凭据只存 safeStorage 加密文件（secrets/*.bin），任何表不存明文（冒烟断言校验）。

## 兼容性策略

- 只增不改地叠加迁移；CHECK 约束变更通过“重建表 + 具名迁移”完成（v13/v14），保持 v1–v11 的历史名与序不变（外来实现线数据库 fail-closed）。
- 降级锚点 `DEGRADED_OPEN_MINIMUM_VERSION = 9`（命名常量，非相对偏移）：新迁移失败时应用仍能以 v9 核心聊天能力打开。
- 升级前自动 `VACUUM INTO` 备份（校验完整性后保留最近 2 份，成功启动后清理）。
