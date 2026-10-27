# Phase 2.2.2 — 基线与安全审查

## 0. 基线

| 项 | 值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 分支 | `feat/phase-2.2-memory-reliability` |
| 起点 HEAD | `430e001`（工作区 clean） |
| PR #3 | OPEN，head `e252d06`，base `chore/phase-1-engineering-consistency` |
| PR #4 | OPEN，head `430e001`，base `feat/phase-2-companion-core`（依赖 PR #3） |
| 起点 schema | v17 |
| 起点测试 | 54 文件 / 505 用例 |
| 起点 CI | run `40472248370` @ `430e001`，3/3 success |
| 模型 | 本地 `qwen2.5:0.5b`，无付费调用 |

## 1. 审查发现

| 编号 | 问题 | 证据 |
|---|---|---|
| 1 | 候选按 `evidence_hash` 全局唯一 | 同一句话换个 kind 会复用旧候选 |
| 2 | 敏感度/来源无证据级记录 | 合并后无法判断哪条证据更敏感 |
| 3 | `apply()` 先保存人格再改状态 | 崩溃窗口会产生「人格已变、候选未 applied」 |
| 4 | 会话删除只撤回候选，证据引用仍在 | 摘要、会话/消息 ID 仍保留 |
| 5 | 过敏原判定按整句 | 「可以吃花生酱，不过你对花生过敏」会被判安全 |
| 6 | 记忆请求没有主体声明 | 模型把用户事实说成自己的 |
| 7 | 无人工复核 | `reviewer.kind` 仍是 agent |

## 2. 可复用实现

- 人格版本：`personality_profiles` + `personality_revisions`，`save` 已使用事务，`restore` 写新版本。
- `SqliteDatabase.transaction` **不可重入**（`BEGIN IMMEDIATE`），因此不能把外部回调包进同一事务；C 阶段采用应用状态机而不是伪原子包装。
- 评测：`run-identity`、`verdict`、`context-memory-evaluation`、`long-behavior`。

## 3. 本轮迁移

- v17 → **v18**：候选唯一索引改为 `(evidence_hash, kind)`；证据表增加 `source`/`sensitivity`/`status`/`withdrawn_at`；新增 `persona_feedback_applications`。
- 只加列/加表/换索引，不改旧数据；升级测试保留 v16/v17 行。

## 4. 复现

```bash
npm run typecheck && npm test
npm run evaluate && npm run evaluate:cognition && npm run evaluate:companion
npm run evaluate:context && npm run evaluate:retrieval-context
MORROW_LONG_BEHAVIOR_RUNS=5 npm run verify:long:behavior
```
