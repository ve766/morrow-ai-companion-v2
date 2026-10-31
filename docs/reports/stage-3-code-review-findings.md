# Stage 3 代码纠偏：P0 逐条根因、修复与复核

> 基准：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 本文件对应任务 §1 的 P0-1…P0-8。每条给出：根因 → 修改位置 → 修复前后行为 → 回归证据 → 状态。

---

## 总览

| 编号 | 主题 | 状态 |
|---|---|---|
| P0-1 | Morrow 自身兴趣没有真实生产来源 | **已修（通道 + 一种真实生产者）** |
| P0-2 | 消息删除后兴趣聚合残留 / 证据孤儿 | **已修** |
| P0-3 | 认知更新在提交后执行，崩溃即丢 | **已修** |
| P0-4 | 用户表达偏好被当作 Morrow 人格成长 | **已修（拆分）** |
| P0-5 | 重要度不进检索；revision 冒充重复 | **已修** |
| P0-6 | 长期目标只是服务层读入 | **部分**（创建链路已通，确认 UI 未做） |
| P0-7 | 评测假阳性 | **已修（含变异测试）** |
| P0-8 | 探索检测与预算状态机 | **已修（uncertain + 按 turn 键）** |

---

## P0-1 Morrow 自身兴趣没有真实生产来源

**根因**：`observeMorrow()` 存在，但反思路径调用的是 `interests.observe()` 且不传 `origin`，落库为 `user`。L5 通过直接调用 `observeMorrow()` 造出「Morrow 兴趣」，绕过了生产链。

**修复**（三层）：

1. **新增缺口信号**：事实守卫把无依据的个人断言改写时（`guard.verdict === 'rewrite'`），在 assistant 消息的**同一事务**里写 `cognition.knowledge_gap` 事件，只含派生主题标签与 conversationId，不含原文。
   - `src/app/companion-service.ts`（`afterPersist` 内）
2. **反思生产候选**：反思把「同一标签在 ≥2 个独立会话里出现」的缺口提升为 `morrow_interest_candidate` finding，并过滤问题残留标签（`哪里`/`到哪`/`来着` 等）。
   - `src/self-model/reflection-service.ts`（`promote` 段 + `applyEffect` 的 `morrow_interest` 分支）
   - `src/self-model/reflection-mapping.ts`（新 effect，topic/conversation 作为结构化载体）
3. **归属语义**：`observeMorrow` 的证据 `kind='reflection'`；若同一主题已有用户证据，归属升级为 `shared`（双方各有独立证据），而不是被用户侧吞掉。
   - `src/self-model/interest-service.ts`（`applySupport`）

**修复前**：`SELECT origin,COUNT(*) FROM interests GROUP BY origin` 永远只有 `user`；探索门禁恒返回 `no_morrow_candidate`。
**修复后**：L5 走真实链路（2 个会话 → 守卫改写 → 2 个缺口 → 回合后反思 → 候选 → `shared` 兴趣），证据账本为 `message,message,reflection`。

**回归**：`eval:stage3` L5 六条断言全 PASS；**变异测试**：把缺口写入改成 `if (false && ...)` 后 L5 立即 FAIL（`gaps=0`）。

**残留局限（必须承认）**：只覆盖「回答被事实守卫改写」这一种缺口。用户问「你记得吗」而守卫未触发时不会产生缺口。覆盖率有限，不是通用的问题生成器。

---

## P0-2 消息删除后兴趣聚合残留

**根因**：迁移 30 的 `interest_evidence` 没有对 `interests(id)` 的外键；删消息触发器只删证据，聚合行的 `evidence_count/strength/status` 仍是旧值；同时另一个触发器会**整行删除**兴趣，抹掉其它消息的支持。

**修复**（迁移 34）：

- `interest_evidence` 重建，`interest_id REFERENCES interests(id) ON DELETE CASCADE`，复制时过滤孤儿；
- `interests.stale_at`：证据变化时由触发器标记，读路径 `reconcile` 重算并清空；
- 触发器改为「删证据 → 标 stale → 若无任何证据则删聚合」；
- `activeForContext` 拒绝 `staleAt` 非空的行；
- 新增 `InterestService.recompute(id)`，不依赖下一次读取。

**修复前**：删一条消息 → 兴趣整行消失（其它证据被抹掉）；或（v30 之后）计数残留，旧兴趣继续进 payload。
**修复后**：删一条 → 其余证据仍支撑，计数重算；删最后一条 → 聚合被清除，不再进 payload。

**回归**：`src/persistence/migrations.test.ts`（删除边界）、`src/self-model/interest-evidence.test.ts`（降级/恢复）、`src/app/interest-payload-invalidation.integration.test.ts`。

---

## P0-3 认知更新在提交后执行

**根因**：`onTurnCompleted` 在 assistant 消息提交**之后**、单个 try/catch 里串行做 5 件事。崩溃在提交后 → 重试走重放分支，钩子永不执行 → 该回合证据永久丢失；任一模块抛错 → 其余模块被跳过。

**修复**：

- 新增 `src/app/cognitive-outbox.ts`：`cognitive_outbox(turn_id, module, handler_version)` 主键，6 个模块行在消息事务内写入，只存引用与结构化 signals；
- `ChatService.afterPersist` 入队；提交后 `drainCognition(turnId)` 逐模块执行；
- 每个模块独立 `try/catch`：失败行保留 `pending` 重试，`OUTBOX_MAX_ATTEMPTS` 后停为 `failed` 并可观测；
- 启动期 `companion.drainCognition()` 重放未完成行，并记 `cognition.outbox_replayed`；
- 删消息时触发器把该回合的 pending 行置为 `cancelled`，不再重试。

**修复前**：崩溃窗口丢证据；一个模块失败带走其余。
**修复后**：7 条单测覆盖幂等（drain 10 次只执行 1 次）、模块隔离、永久失败停泊、崩溃重放、删除取消、不存原文。

---

## P0-4 用户表达偏好被当作人格成长

**根因**：`personality-growth` 从「直接一点/温柔一点/幽默一点」提取证据并修改 `warmth/directness/humor` 的有效人格，语义上把「适应用户的表达方式」写成了「Morrow 的人格成长」。

**修复**：

- 新增 `src/personalization/interaction-profile.ts` + 迁移 34 的 `user_interaction_profile` / `user_interaction_signals`；
- 生产写入改到交互画像（outbox 的 `growth` 模块 → `interaction.apply`）；
- `effectiveProfile` 只叠加交互偏移，`disagreementStyle` / `systemRules` / `version` 恒为身份基线；
- 提示词文案改为「Interaction style adapted to what this user asked for … does not change Morrow's identity」；
- `rollback(dimension)` 只清表达偏移，不触碰身份。

**修复前**：用户一句「说话直接点」被描述为人格成长；身份与表达共用一组字段。
**修复后**：L4 断言「身份基线字段未被交互画像改动」；`interaction-profile.test.ts` 断言回滚后 `personality_profiles` 仍为空。

**未做**：Morrow 身份自身的慢速演化没有生产者（没有「她自己的稳定选择」这一证据源）。这是有意的：宁可不做，也不再用用户偏好冒充。

---

## P0-5 重要度不进检索；revision 冒充重复

**根因**：`rankScore` 不读 `memory_importance.score`；`extraMentions` 默认取 `revision - 1`，而 revision 是编辑次数。

**修复**：

- `memory_evidence` 账本（迁移 34）：来源、独立性分组、证据类型、算法版本；
- `recompute` 的重复项改为「`evidence_type='restatement'` 的独立分组数」，无账本行时为 0，不再用 revision；
- 类型化衰减：边界/身份 365 天、目标关联与用户明确 180 天、其余 90 天（`halfLifeDaysFor`）；
- `rankScore` 增加 `IMPORTANCE_WEIGHT(0.2) × I`，**加法**而非乘法：只影响近分排序，不能救回未通过相关性准入的记忆；
- 装配器按 memoryId 记忆化查询，避免比较器里做 O(n log n) 次数据库读。

**修复前**：重要度只决定归档；编辑 9 次的记忆被当成「提及 9 次」。
**修复后**：`memory-importance-ranking.test.ts` 证明「只翻转分数就能翻转顺序」，且「满分但无关的记忆仍不被检索」；`does not treat an edit as a repetition` 证明 revision 不再进入重复项。

---

## P0-6 长期目标只是服务层读入

**根因**：`SelfModelLoopServices.goals` 的类型是 `Pick<…,'activeForContext'>`，类型层就排除了写入；`goals:create` 指向任务型 `GoalService`。

**修复**：

- 迁移 34 新增 `goal_candidates`；outbox 新增 `goal` 模块；
- `CompanionGoalService.detectFromTurn()`：显式长期意图 + 期限 → 直接创建用户目标；含糊意愿 → 待确认候选；
- 注入类型放宽为 `Pick<…,'activeForContext' | 'detectFromTurn'>`；
- 修掉 `describeGoals` 用字面 `'\n'` 连接导致提示词出现反斜杠的缺陷。

**修复前**：`companion_goals` 永远为空；L10 靠直接调 `create`。
**修复后**：L10 用一句真实对话创建目标并进入下一轮 payload；含糊意愿只产生候选。

**未做**：候选的**确认入口**只有服务方法（`acceptCandidate` / `listCandidates`），没有 IPC 与 UI。任务要求「用户确认后才创建」，当前对含糊意愿确实停在候选，但用户无法在界面里确认。**这是本轮明确的缺口。**

---

## P0-7 评测假阳性

**根因**：至少 16 条断言在功能被删除时仍通过。

**修复**：

| 原断言 | 现在 |
|---|---|
| `memoryBlockEmpty` 标记缺失返回 true | 标记缺失 → **false**（视为回归） |
| L11 两侧全 0 相等即 PASS | 先断言「重启前确有非零偏移」，再比相等 |
| L5 用 `observeMorrow` 造正例 | 走守卫 → 缺口 → 反思 → 候选的真实链 |
| L10 直接 `goals.create` | 真实对话创建 + 含糊意愿只成候选 |
| L5 只查 `permitted` 存在 | 按 `interestId` 判定「被许可的是不是用户话题」 |
| 消融各臂无差异 | `no_growth→L4`、`no_exploration→L5`、`no_reflection→L5,L9` |

**变异测试（本轮实际执行）**：把知识缺口写入短路后重跑主评测 → `PASS 14 / FAIL 1`，L5 FAIL。恢复后回到 `PASS 15 / NOT_RUN 1`。

---

## P0-8 探索检测与预算

**根因**：`detectRaised` 的 `uncertain` 被折叠成 `not_raised`；预算 reservation 按当天写入，consume/release 又用「结算当天」查找，跨 UTC 日会找不到原预约。

**修复**：

- 迁移 34 重建 `exploration_events`，状态加入 `uncertain`；
- `settle()` 返回 `uncertain` 并单独记录，不消耗预算；
- 预算表主键改为 `(scope, turn_id)` + `reservation_day`，consume/release 只按 turn 查找；
- 单测覆盖：跨日重置、未提出释放、失败释放、两次拒绝不泄漏（预留计入已用）。

**未做**：语义级提出检测。`detectRaised` 仍是词面匹配，`uncertain` 是对其局限的诚实表达，不是解决方案。

---

## 附：本轮修掉的迁移陷阱

`ALTER TABLE ... RENAME` 会同时改写**触发器体**与**外键引用**。本轮踩了两次：

1. `interest_evidence` 重建时，只 DROP 已知的两个触发器会让 `memories` 的 UPDATE 报 `no such table: interest_evidence_v29`；
2. `reflection_findings` 重建时，先改名旧表会让 `pending_personality_candidates` 的外键指向被删掉的副本。

修法：先 DROP 所有引用该表的触发器；重建改用「建新表（临时名）→ 拷贝 → DROP 旧表 → RENAME 到位」，而不是「改名旧表 → 建新表」。
