# 01 · 当前实现与历史审计

## 当前生产

- identity：`identityContract` + `identityGuardReply`；真实 Spark 验证。
- inner cognition：`morrow_thoughts` / `morrow_self_states` v54；`InnerCognitionService`；scheduler 5 分钟。
- memory：4 通道 RRF（fact-index/lexical/fact-slot/value）。
- reflection/interest/exploration/personality/feeling：既有服务保留。

## 历史分支

| 分支 | HEAD | 结论 |
|---|---|---|
| feature/algorithm-v2-phase-a | a6f9e0be... | ONNX semantic 未恢复；runtime/model 缺失，BLOCKED |
| fix/memory-reliability-v0.1 | dca6486a... | timestamp-trust 未在当前；NOT_RESTORED |
| fix/phase-2.2.10-memory-trust-hardening | 60a88b85... | 同上 |
| feat/stage-6-appraisal-engine | b4d3bd40... | 当前 affective-state 保留；未新写 appraisal |
| PR #64 | b63c998... | 未合并；未整体复用 |
| PR #68 | efdbf52... | 本任务 base |

未整体 cherry-pick/merge；未修改 main/release。
