# Stage 3 全阶段独立审计记录（收口轮）

审计基准 HEAD `96984e97`（base `84670792` 起 50 提交）。八项根因的处置:已修/未修逐条列明,证据指向文件与测试。完整审计发现见任务评论 6556383899,此处登记处置结果。

| 根因 | 处置 | 证据 |
|---|---|---|
| R1 单槽位派生索引 | **已修** | `extractFactSlots`(fact-slot.ts)逐子句多事实抽取;v41 重建 fact_records(source_revision/polarity/value_normalized/provenance_kind 唯一性);`fact-memory.ts` 重写(事务化、revision 溯源、legacy 溯源诚实置 null) |
| R2 撤回复活漏洞 | **已修** | reindexMemory 非 active 守卫先于任何 INSERT;`fact-memory.test.ts` 九用例(空索引撤回不复活、retract 关闭事实、幂等×10、删除无孤儿、跨 memory 冲突不覆盖);异常不再吞没(throw+调用方 degradation) |
| R3 无稳定查询路径 | **已修** | 裸属性断言查询计划(memory-service:我 在/搬到/搬去+值,排除活动动词)→单值属性事实全部在视;J1 同型重放 F59/F60 通过 |
| R4 manifest 名不副实 | **部分修复,余项如实** | manifest 仍以 ids+conflict+omitted 为主(原文只在 prompt,隐私约束);memoryUse 是值级包含标签(代码注释如实声明"非理解证明");fact guard 是受限模式匹配(文档如实) |
| R5 注入≠消费 | **已修(注入轮留痕)+ 如实边界** | v40 injected_turn_id 落库;outcome 分级(used_observed 需确定性证据,否则 not_observed)登记于路由状态;模型自述不算 |
| R6 评测器漏判误判 | **已修** | mustMention 进入客观检查;mustNotAssert 拒绝语境感知;J8 三维;J2 错误分类+有界重试;重跑结果见 closure live |
| R7 CI 未接入 | **BLOCKED_WORKFLOW_SCOPE** | patch+两步解锁交付;旧 workflow SUCCESS 不作为 Stage 3 PASS |
| R8 分支卫生 | **已修** | 560 个 .tmp-run 文件移出索引并删除;.gitignore 增补;无 different/same 文件;.env 无真实凭据;全库密钥扫描 0 命中 |
