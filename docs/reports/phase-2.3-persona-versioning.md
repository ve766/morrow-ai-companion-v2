# Phase 2.3 — 人格版本与回滚

- 复用：`personality_profiles` + `personality_revisions`（Phase 1 已存在，未新建）
- 变更入口：`PersonalityService.save` / `restore`（唯一写路径）

## 1. 现有机制

| 项 | 行为 |
|---|---|
| `save(input)` | version + 1，写入 `personality_revisions`，`change_type` 记录来源 |
| `history()` | 最近 100 条版本，倒序 |
| `restore(version)` | 读取历史版本，写入**新**版本（`change_type='restored'`），不覆盖历史 |
| 当前版本 | `personality_profiles` 单行，`version` 单调递增 |

## 2. 与反馈候选的连接

`FeedbackCandidateService.apply(id, { includeSensitive, apply })`：

1. 校验状态（`pending` / `supported`）与敏感度授权。
2. 调用调用方提供的 `apply(candidate)`；调用方执行 `personality.save(...)` 并返回新版本号。
3. 候选写入 `status='applied'`、`applied_personality_version`、`decision_reason`。

没有回合钩子、定时器或后台任务调用 `apply`，所以候选不会自己生效。

## 3. 回滚

- 应用后：人格 version = N，候选记录 N。
- `personality.restore(1)`：写入 version = N+1，数值回到 v1。
- 候选仍保留 `applied` 与 N，审计链不断。

测试 `records the applied personality version and supports rollback` 覆盖：应用 → 版本前进 → 回滚 → 数值恢复、版本继续前进。

## 4. 防止异步覆盖

- 当前没有任何异步人格写入者；所有写入经过 `save` / `restore`。
- 回滚产生的是**新版本**而不是时间旅行，因此后来的写入不会「覆盖」回滚，而是叠加在其上。
- 若未来加入后台任务，必须先读取当前版本并做 CAS；本轮没有该任务，也没有假装已经防住。

## 5. 局限

1. 候选与版本之间只有审计字段，没有外键约束。
2. 没有 UI 展示候选或版本差异。
3. 没有「一次负反馈」到「候选」的自动识别入口；候选由调用方显式记录。
