# Stage 3 后续实现报告（PR #19 认知缺口修复）

- 分支：`feat/stage-3-long-term-companion`
- 基线（本轮开工核验）：`0ebbdd71fb37cfef671c81f6884a0628ed0900f1`（未变化，无他人提交被覆盖）
- 目标分支：`feat/stage-2-delivery-hardening`
- 状态：**PARTIAL**（§7）
- 日期：2026-10-30

## 1. 本轮修了什么（F1–F7 逐项）

### F1 用户兴趣 / Morrow 自身兴趣混淆 —— 已修

| 改动 | 位置 |
|---|---|
| 兴趣新增 `origin ∈ {user, morrow, shared}`，默认 `user` | 迁移 30；`src/self-model/self-model-domain.ts` |
| 证据账本新增 `reflection` 来源（Morrow 自己的证据不能被伪装成用户消息） | 迁移 30（重建 `interest_evidence`） |
| 新增 `InterestService.observeMorrow()`：只由反思/未解决问题产生，`origin='morrow'` | `src/self-model/interest-service.ts` |
| 用户证据落在 Morrow 话题上 → `shared`；Morrow 证据落在用户话题上 → **仍为 user**（不冒名） | `applySupport()` |
| 长期层拆成三行：用户关注 / Morrow 自身关注 / 共同关注，各自措辞不同 | `buildSelfModelContextBlock()` |
| 探索资格只认 `origin ∈ {morrow, shared}`，用户兴趣再强也不可被当作她的话题提出 | `src/self-model/exploration-policy.ts` `decideExploration()` |

回归证据：L5 六条断言（含"用户兴趣不得被当作 Morrow 自身话题提出"）、`exploration-policy.test.ts` 中 `no_morrow_candidate` 用例。

### F2 探索事件重复写入、语义错误 —— 已修

旧实现把"许可"写成 `raised`，且 `prepare()` 被调用两次会重复计数。

新状态机（迁移 30 重建 `exploration_events`，唯一索引 `(turn_id, state)`）：

```
permitted → selected_for_prompt → actually_raised | not_raised
                               ↘ provider_failed
                               ↘ user_rejected
```

| 规则 | 实现 |
|---|---|
| 许可不是事件 | `decide()` 只写 `permitted`；`markSelected()` 只在许可行真正进入 payload 时写 |
| 只有持久化后的回复可计为提出 | `settle()` 在 assistant 消息落库之后调用（`ChatService.send`） |
| 检测不确定时不算成功 | `detectRaised()` 返回 `raised | not_raised | uncertain`，`uncertain` 记 `not_raised` |
| 失败/取消不消耗预算 | `provider_failed`；`recent()` 只统计 `actually_raised` |
| 重试/恢复幂等 | `ON CONFLICT(turn_id, state) DO NOTHING` |
| 写入失败不破坏主对话 | `settleExploration` 全包 try/catch + `cognition.degraded` |

回归证据：`exploration-policy.test.ts` 7 条服务级用例（许可不计数、回复未提及不计数、失败不计数、重复结算只计一次、重复 prepare 只有一行 `permitted`）。

### F3 L5 假阳性 —— 已重写

旧 L5 只检查 prompt 里有没有兴趣文字，脚本回复 `好的。` 也能通过。

新 L5 分四段，全部读数据库/payload：
1. 用户重复话题 → 标注为 `user`，且该轮**没有** `permitted`/`actually_raised`；
2. 用 `observeMorrow()` 独立种入自身兴趣 → `origin=morrow`；
3. 许可轮：payload 出现 `your own attention`，但脚本回复未提及 → 结算为 `not_raised`，`raisedLastDay=0`；
4. Provider 失败轮 → `provider_failed`，不计成功。

### F4 人格证据映射偏差 —— 已重写

旧映射把 `correction` / `explicitMemoryRequest` / 探索偏好当作 warmth/directness/humor 的证据。

新映射（`STYLE_RULES`，6 条）只认**显式风格指令**，且正负成对：

| 维度 | 正向 | 负向 |
|---|---|---|
| directness | 直接说/别绕/说重点 | 委婉/别这么直接/温和一点 |
| warmth | 温柔/多关心我/体贴一点 | 别煽情/别肉麻/保持距离 |
| humor | 幽默/开个玩笑/轻松点 | 严肃点/别开玩笑/正经点 |

- 引述内容先剥离（`stripQuotedAndReportedText`），别人说的话不算用户的偏好；
- 同一轮同一维度至多一条证据；
- 证据写入 `source` 列（迁移 30），偏移可解释到具体规则；
- ±8 上限、3 轮门槛、45 天半衰期、回滚语义不变。

回归证据：L4 四条断言（含"反向要求产生反向证据"且两维度均跨过门槛）、`personality-growth.test.ts` 18 条。

### F5 L11 不是真实主数据库 —— 已重写

旧 L11 另建一个 SQLite 文件关闭重开，只证明 SQLite 能持久化。

新 L11（与 `evals/stage-3/restart/` 同源）：在**同一路径**上完整重建 database、migrations、repositories、services、`CompanionService`，然后发新回合，断言记忆文本、逐维漂移、兴趣来源 id 都出现在**最终 payload** 里；再验证重启后撤回仍生效。

### F6 纵向把模拟时间当真实多日 —— 已修

- `buildStack` 接受注入时钟，`PersonalityGrowthService` / `ExplorationService` / `CompanionService` 全部使用它；
- 结果文件新增 `clock: 'injected'`、`simulatedSpanHours`、`realElapsedMs`、`clockNote`；
- 冷却边界用注入时钟实测：提出后 +1h 必须拒绝（`cooldown`），+7h 恢复（`allowed`）；
- 正例真的发生：day 1 的回复提及自身话题 → `actually_raised`，`raisedLastDay=1`。

### F7 L6 只测 prompt 存在性 —— 部分修

- L6 现在只声明**客观检查**：固定原则仍在 system、未被用户的迎合要求改写。
- 真正的独立判断需要模型回复质量评分，**没有真实 Provider，标为 BLOCKED**，不再声称通过。

## 2. 本轮未完成的 Issue 章节

| 章节 | 内容 | 状态 |
|---|---|---|
| A | 记忆巩固、重要度、衰减/归档 | **已实现（M1）**：`src/memory/memory-importance.ts` + 迁移 31 + 11 条测试 + L16 |
| A | 冲突管理（保留不同时间/情境的冲突） | **部分**：既有 conflict 标记保留；未新增按时间/情境的分类 |
| B | 内在状态 appraisal / 调节重构 | **未实现**（沿用既有实现） |
| C | 反思候选类型扩展与质量评测 | **部分**（既有 findings 可追溯，未加质量指标） |
| D | 长期目标跨会话（§2D） | **已实现（D1）**：`CompanionGoalService` + 迁移 32 + 10 条测试 + L10 六断言 |
| E | 探索真实提出检测 | **已实现**（F2） |
| F | 语音闭环 | **未实现** |

这些未完成项不计入任何通过率。

## 3. 实际执行的命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | **84 文件 / 756 测试全通过**（M1 11 + D1 10 + S3-03/S3-04 新增 9） |
| `npx electron-vite build` | 0 | 构建成功 |
| `npm run eval:stage3` | 0 | **15 PASS / 0 FAIL / 1 NOT_RUN**（分母 16；L10 已可执行） |
| `npm run eval:stage3:ablation` | 0 | 差异见 §4 |
| `npm run eval:stage3:longitudinal` | 0 | 7 条断言 PASS（注入时钟） |
| `npm run eval:stage3:restart` | 0 | 6 条断言 PASS |
| `npm run eval:stage3:long-conversation` | 0 | 7 条断言 PASS（30 轮 / 3 会话） |

环境：Windows / Node 22 / `node:sqlite` / registry `registry.npmmirror.com`。

## 4. 评测结果摘要

| 套件 | 结果 |
|---|---|
| 15 场景 | 13 PASS / 0 FAIL / 2 NOT_RUN（L10 目标层、L15 由纵向覆盖） |
| 消融 | `no_growth→L4`、`no_exploration→L5`、`no_reflection→L9` |
| 纵向 | 漂移有界；正例 1 次；+1h 拒绝、+7h 允许；`fresh=3 / aged=1.5` |
| 重启 | 全运行时重建后 payload 连续、漂移一致、兴趣来源不变、撤回仍生效 |
| 长对话 | 30 轮 / 3 会话：忌口证据仍在、旧值消失、证据块未被挤掉 |

## 5. 数据模型变更

迁移 30 `interest-origin-and-exploration-lifecycle`：

- `interests.origin`（user/morrow/shared）
- `personality_growth_signals.source`
- `exploration_events` 重建为状态机 + `UNIQUE(turn_id, state)`
- `interest_evidence` 重建，允许 `reflection` 来源，保留 `evidence_revision`

> 迁移踩坑记录：`ALTER TABLE ... RENAME` 会把**所有**引用该表的触发器改写到新表名，只删掉已知的两个会导致 `memories` 的 UPDATE 报 `no such table: interest_evidence_v29`。因此 5 个触发器必须全部先 DROP 再重建。

## 6. 复现

```bash
npm install --ignore-scripts
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npx tsc --noEmit && npx vitest run && npx electron-vite build
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:ablation
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:longitudinal
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:restart
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:long-conversation
```

## 7. 结论

F1–F5 已按代码级修复并有回归证据，F6 已修，F7 只保留客观检查并明确 BLOCKED。§2A 的记忆重要度/衰减/合并已实现（M1）。

§2D 已用 `CompanionGoalService` 实现（理由见算法登记表 D1：现有 `GoalService` 只能表达固定 intent 的任务执行，属 Agent 侧，强行接入会把任务模型混进陪伴层）。

仍未完成：§2A 的冲突分类（部分）、§2B appraisal、§2C 反思质量评测、§2F 语音闭环。因此整体仍为 **PARTIAL**，不按"阶段三完整验收"合并。


---

## 9. 补充审查（S3-01 ~ S3-05）

见 `docs/reports/stage-3-followup-gap-closure.md`。摘要：

| 编号 | 结果 |
|---|---|
| S3-01 | **OPEN（P0）**：反思仍把兴趣候选写成用户兴趣，`observeMorrow()` 未被生产链使用 |
| S3-02 | 已修：L5 两条许可断言改为必须存在 `permitted`，消融恢复判别 |
| S3-03 | 已修：净证据聚合 + 不确定性门禁 + 非断言语气 abstain |
| S3-04 | 已修：事务内预算预留（迁移 33），失败/未提出释放名额 |
| S3-05 | 已修：登记表删除追加段，规则内联，旧映射标 deprecated |
