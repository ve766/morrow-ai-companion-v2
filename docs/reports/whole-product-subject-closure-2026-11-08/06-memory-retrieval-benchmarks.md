# 记忆检索与冲突基准

## 状态：NOT_RUN

本任务第一轮没有新增 100/500/1000/5000 合成记忆基准，也没有 Dense/Cross-Encoder/PPR 实现。因此不报告 Top-K recall、MRR/nDCG、冲突召回、误合并、p50/p95 或内存数字，也不声称 5x 提速。

## 现有检索基础（代码事实）

- `src/memory/`：FTS5/Fact Slot/冲突检测/多通道 RRF/Context Utility；这是当前生产检索，不是 Dense Semantic Retrieval。
- `src/memory/memory-context-assembler.ts` 仍按既有 policy/敏感度/冲突通道组装；本任务未改其核心。
- 情绪/兴趣对检索的影响是 policy 顺序和 query 相关性过滤，不是新的向量模型。

## 为什么未跑

- 没有可用的 ONNX runtime/113MB 模型；`feature/algorithm-v2-phase-a` 未合并，不能把缺失模型当已上线。
- 没有先建立固定 seed 的 100/500/1000/5000 synthetic corpus、query set、relevance/conflict labels。
- 没有在相同 SHA 上跑 baseline/hybrid 对照，因此任何数字都不可归因。

## 复现缺口（下一轮）

1. 固定 seed 生成 100/500/1000/5000 记忆；含中英 paraphrase、精确实体/数字、冲突/撤回。
2. 记录 Top-K recall、MRR/nDCG、冲突召回、false merge、p50/p95、峰值内存、包体。
3. 模型缺失时 graceful fallback，默认不下载、不联网。
4. 在默认关闭的 EXPERIMENTAL 路径下比较，达到门槛才接入。

## 证据

- `src/memory/*` 读取与现有测试；未产生新 benchmark 日志。
- `results/` 中没有虚构的检索 JSON。
