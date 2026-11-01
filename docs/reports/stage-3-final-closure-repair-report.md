# Stage 3 Final Closure 修复报告（唯一收口轮）

- 任务:Issue #22 评论(全阶段独立审计后的最终修复总任务);审计基准 HEAD `96984e97`。
- 配套:[全阶段审计记录](../audit/stage-3-whole-phase-independent-audit.md) · [实现设计 v4](../algorithms/stage-3-final-closure-implementation-design-v4.md)(架构沿用 v3 文档+v41 增量) · [验收矩阵](../testing/stage-3-final-closure-repair-acceptance.md)。

## 执行顺序对照(任务 §13)

1. 基线核验:远端 head=96984e97=本地,树干净,PR OPEN/base 未动 ✓
2. **R2 撤回复活**:reindexMemory 非 active 守卫先于 INSERT(空索引撤回记忆 reindexAll 后 0 active facts,测试固定);reindexMemory 改为 throw+BEGIN IMMEDIATE 事务,MemoryService.reindexFact 记 degradation(不静默)
3. **R1 多事实+溯源**:`extractFactSlots` 逐子句抽取(疑问/假设/转述/模态一律不出事实,未知形状保留原文走文本检索);v41 重建 fact_records(source_revision/polarity/value_normalized/provenance_kind,UNIQUE(memory,revision,predicate,value,polarity));valid_from=revision 生效时间;provenance=legacy+null 诚实标注;supersedes 仅限同 memory+predicate;跨 memory 冲突保留为候选
4. **R3 查询计划+J1**:裸属性断言("我在北京",活动动词排除)→单值属性事实全在视;F59(=J1 同型,走生产链)与 F60 通过;J5 真实模型引用杭州证据
5. **P0-C 门**:四类→故障分类扩为 evidence_delivered/retrieval_miss/model_unused/answer_conflict;manifest=selected/conflict/omitted(原文不出 prompt/日志);AnswerConfidence 有界启发式;fail-closed=敏感度上限/撤回/策略收窄
6. **R6 评测器**:mustMention 客观检查;mustNotAssert 拒绝语境感知(J3 正确拒绝不再误判);J8 三维(接受纠正/承认旧值/不静默改写);J2 分类=PROVIDER_RESPONSE(仅瞬时超时/限流重试);重跑 12 调用 0 错误,AWAITING_MANUAL_REVIEW
7. **R5 消费 trace**:observeConsumption(注入轮回复确定性词元证据→used_observed/not_observed;模型自述无效);CHECK 扩展(v41 迁移调整)
8. **CI**:ci.yml 已本地提交(4e8547a)——七套件+intent 为必需步骤;**推送被拒(workflow scope)**,见下
9. 干净 SHA 回归:见验收矩阵
10. 交付回复:Issue #22 + PR #19

## R8 卫生

560 个 `.tmp-run` 调试/缓存文件移出索引并删除;`.gitignore` 增补(.tmp-run/.tmp);`different`/`same` 不存在于本分支;`.env.real-model.example` 无真实凭据;全库密钥正则扫描 0 命中。

## 已知风险与边界(如实)

- 多事实抽取以子句为单位,复合句的多谓词覆盖取决于规则表;未知形状诚实回退文本检索
- memoryUse/used_observed 是确定性词元/值级标签,不是理解证明
- fact guard 是受限模式匹配,不是通用事实校验器
- manifest 原文不出 prompt/日志(隐私约束),ids+状态可审计

## 迁移

v41(fact-ledger-multi-fact-provenance):fact_records 重建(派生态,启动 reindexAll 重建数据);v40→v41 与 v39→v41 升级测试随迁移谱系覆盖;回滚=前向兼容。
