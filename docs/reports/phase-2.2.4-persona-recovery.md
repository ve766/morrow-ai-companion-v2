# Phase 2.2.4 — 人格反馈应用的原子性与崩溃恢复

基线 `bf4da91`，修复提交 `b1c7195`。

## 1. 修复前的技术事实（先回答问题再改代码）

任务要求先确认四件事，实测答案如下：

| 问题 | 答案 |
|---|---|
| 人格状态与应用记录是否在同一 SQLite 库？ | **是**。`personality_profiles`、`personality_revisions`、`persona_feedback_candidates`、`persona_feedback_applications` 同库 |
| 是否同一连接同一事务？ | **同连接**，但**不同事务**：`PersonalityService.save()` 自己 `BEGIN`，`apply()` 另开一个事务更新状态 |
| 人格保存是否有事务外副作用？ | **无**。只有两条 SQL（UPDATE profile + INSERT revision），无文件写入 |
| `baseVersion` 是否在写入时校验？ | **否**，只在请求开始时比较 `baseVersion` 与调用方传入的 `currentVersion`。两者都来自调用方，等于自己校验自己 |

第三条是决定性的：既然没有事务外副作用，就可以用同一个事务包住全部步骤，不需要外部补偿。

## 2. 修复方式：单事务提交

`FeedbackCandidateService.apply()` 现在整体在一个事务内：

1. 事务内**重新读取**候选（防止 preflight 之后被并发撤回/应用）；
2. 校验状态、敏感度授权、`applicationFor(id)` 是否已存在；
3. 插入 `applying` 应用记录（`candidate_id` 唯一索引，并发第二次插入失败）；
4. 调用 `options.apply(candidate)` → `personality.save()` → 嵌套 `SAVEPOINT`；
5. **写入时**校验：返回的版本必须等于 `baseVersion + 1`，否则 `CONFLICT`（防止基于过期版本写入）；
6. 更新应用记录为 `applied`、候选为 `applied`，写入实际版本号；
7. 提交。

任一步抛错 → 整个事务回滚 → **人格回到修改前**，候选仍是 `supported`，即 `not_applied`。

回滚之后，在事务外写一条 `failed` 应用记录作为审计。这条记录只在新候选没有应用记录时写入：如果已存在 `applying` 行（上次崩溃留下的），**不覆盖**——覆盖会把「结果未知」洗成「失败」，那才是真正的丢证据。

## 3. 崩溃点与预期状态

| 崩溃/失败点 | 修复前 | 修复后 |
|---|---|---|
| 写应用记录前 | 候选 supported | 事务回滚，候选 supported，`failed` 记录 |
| 应用记录创建后、人格更新前 | `applying` 悬挂，恢复 → `needs_review` | 回滚，无人格变更，`failed` 记录 |
| 人格更新过程中失败 | 半提交风险（同库同连接，实际由 SQLite 保证） | 回滚 |
| **人格更新后、应用记录完成前** | **人格已变，候选仍 supported，`applying` → `needs_review`** | **不可能发生：同一事务** |
| 两个并发请求应用同一候选 | 唯一索引拦截第二次 | 同左，且在事务内重读状态 |
| 两个候选基于同一过期版本 | 双方都可能写入 | 第二个的 `version !== baseVersion+1` → `CONFLICT` |
| 恢复程序重复运行 | 幂等（只改 `applying`） | 同左 |
| 回滚人格后 | 应用记录仍 `applied`，指向已不存在的版本 | 同左（记录保留，可对照 `personality_revisions`） |

## 4. 测试与结果

`src/self-model/feedback-candidate-service.test.ts`（直接查库，不看返回值）：

| 测试 | 验证内容 | 结果 |
|---|---|---|
| 保存成功后请求失败 → 人格回滚 | `personality.get().version` 与 `warmth` 均为修改前；候选 `supported`；应用记录 `failed` | 通过 |
| 写入未落在声明的 base 版本 | 回调内连做两次 save，返回版本 = base+2 → `CONFLICT`，人格回滚 | 通过 |
| 版本/候选/记录互相一致 | `applied.appliedPersonalityVersion === personality.get().version`，且该版本在 `personality_revisions` 中 | 通过 |
| 至多一次 | 第二次 `apply` → `CONFLICT` | 通过 |
| 敏感候选未授权 | `FORBIDDEN` | 通过 |
| 崩溃留下的 `applying` 行 | 恢复 → `needs_review`；失败尝试不覆盖该行 | 通过 |

## 5. 保证范围（不得夸大为「绝对原子」）

- **保证**：人格写入、应用记录、候选状态三者要么同时提交，要么同时不提交。这由 SQLite 单库单连接事务提供，不是应用层约定。
- **不保证**：`options.apply` 回调若做了**事务外**的事情（写文件、调用外部服务），回滚不会撤销它。当前唯一的生产用法是 `PersonalityService.save`，无事务外副作用；这条前提写在代码注释里。
- **不保证**：进程在 `COMMIT` 期间被强制杀死。SQLite 的 WAL + 原子提交覆盖这一点，但本轮**没有**做 kill -9 级别的故障注入测试，只做了「抛错」级别的注入。
- `recoverInterruptedApplications()` 仍然存在，用于处理升级前遗留或外部写入的 `applying` 行；新代码不会再产生这种行。

## 6. 结论

| 项 | 状态 |
|---|---|
| 单事务提交（应用记录 + 人格 + 候选） | **PASS** |
| `baseVersion` 写入时校验 | **PASS** |
| 并发重复应用 | **PASS**（唯一索引 + 事务内重读） |
| 失败后人格不变 | **PASS** |
| 审计可对照 | **PASS** |
| 进程 kill -9 级故障注入 | **NEEDS_REVIEW**（未做，只有异常注入） |
| 人格回滚后的自动对账 | **NEEDS_REVIEW**（记录保留，但无自动比对程序） |
