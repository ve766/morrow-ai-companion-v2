# Stage 3 重启评测

## 目的

证明**整个运行时**可以在同一个数据库文件上被拆掉再重建，并且下一轮对话读取的是上一个进程写入的状态。

不是"SQLite 能存行"。评测会重新构造 database、migrations、repositories、services 和 `CompanionService`，然后发一轮真实请求。

## 执行

```bash
npm run eval:stage3:restart
```

结果写入 `evals/stage-3/restart/results/<UTC timestamp>-<head-shortsha>.json`。

## 覆盖

| 断言 | 含义 |
|---|---|
| 重启前写入记忆与漂移 | 第一阶段确实写了记忆并产生了非零漂移 |
| 重启后记忆进入最终 payload | 不是查库，而是最终序列化请求里出现 |
| 重启后人格漂移连续 | 两阶段的偏移量逐维相等 |
| 重启后自身兴趣仍带独立来源 | `origin != user`，且 id 未变 |
| 重启后基线未被改写 | 用户编辑的基线版本未被后台覆盖 |
| 重启后撤回仍使内容退出 payload | 重启后删除语义仍然生效 |

## 不覆盖

- 进程崩溃（kill -9）中途恢复：由 `b4-recovery` 系列单测与阶段二的恢复路径覆盖。
- 备份导出/恢复：由 `backup-ipc.test.ts` 覆盖，本评测不复用。

## 2026-10-31 最终纠偏轮

- 结果：`results/20261031T064150Z-b0e719a.json`，6/6 断言通过
- 做法：同一个 SQLite 文件上关闭并重建整套运行时（数据库、迁移、仓储、服务、CompanionService），没有任何 stub
- 覆盖：重启后记忆仍进入最终 payload、交互偏移连续、身份基线未被改写、撤回内容退出 payload
- 与 P0-2/P0-3 的关系：重启后的 outbox 重放与反思游标恢复由 `tests/correction-round.test.ts` 覆盖，这里覆盖的是可见行为
