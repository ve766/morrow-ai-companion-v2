# 性能与可靠性

## 微基准

命令：`npm run eval:affect`（原始输出 `benchmark-raw.json`）。本机：Windows 11 x64，Node 22.23.2；不含 Provider/网络。

| 项目 | 样本 | p50 | p95 | max |
|---|---:|---:|---:|---:|
| appraisal（纯规则） | 500 | 0.015 ms | 0.060 ms | 3.208 ms |
| emotion projection merge | 300 | 0.053 ms | 0.183 ms | 13.726 ms |
| trait fold（最多 200 obs） | 100 | 0.173 ms | 0.733 ms | 1.789 ms |
| trait DB observation（含 revision 写入） | 200 | 6.923 ms | 14.016 ms | 199.177 ms |

说明：

- appraisal/projection 是纯 CPU 规则，远低于一次 Provider 请求的噪声；max 值来自 JIT/GC 首轮，不是稳定尾延迟。
- trait 写入每个 observation 会重算该 trait 的 fold 并写 revision；200 条时仍 <20ms p95。生产无高频循环，5 分钟 scheduler 一次最多 3 个 thought。
- 没有测 Provider TTFT、renderer 首 delta；这些属于 Issue #69 的聊天延迟范围，本任务不重复宣称。
- 没有 1000/5000 记忆检索 benchmark；不声称 5x 提速。

## 失败降级

- `AffectLoopService.preview` 在 `ChatService.prepare` 内 try/catch；失败只记录 `affect_preview` degradation，不阻塞聊天。
- `recordCompletedTurnInTransaction` 在 assistant 消息事务内执行；失败会把 `complete=false`，消息仍保留，后续 recovery 可重试；不影响用户答案。
- `recordKnowledgeGap` 内的 affect loss 是 best effort，失败只记录 `affect_knowledge_gap`，不 rollback 回答。
- `snapshot` 失败返回初始空状态；prompt 不注入；不把旧错误状态当新状态。
- `clearCognitiveHistory` 的 affect 清理失败会向调用方抛出，避免“只清了一半”的隐私承诺；feeling 的清理先执行。
- migration 失败由现有 `SqliteDatabase` 的备份/回滚/降级路径处理；v55 未删除旧表。

## 重启、删除、迁移

- emotion projection：DB 重开后 revision 一致（`emotion-service.test.ts`）。
- trait：DB 重开后 active/score/evidence 一致（`morrow-trait-service.test.ts`）。
- conversation delete：删除 emotion events，重建 projection；删除 trait observations，重算 trait（`emotion-service.test.ts`、代码路径）。
- clear：`emotion_events/states/revisions/regulations`、`morrow_trait_*`、`reward_signals` 全部清理。
- v55 migration 在完整 `migrations.test.ts`（23 tests）中应用；空库、升级、重复启动、身份不匹配 fail-closed 均保留原断言（仅把版本常量改为 `CURRENT_SCHEMA_VERSION`）。

## 未测

- 真实 cloud Provider 延迟/行为 A–K。
- 并发多进程写 affect（SQLite BEGIN IMMEDIATE + WAL 已有基础设施，但本任务无专门压力测试）。
- 长时间 7 天真实时钟的 trait 晋升；用测试时钟模拟 24h+ 窗口。
- renderer 可视化/可视化清除入口不存在。
