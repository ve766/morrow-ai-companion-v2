# Final Closure 复核差异审计（ChatGPT 复核 A–E 项处置）

任务:Issue #22 评论 6557123605(2026-11-01,基于远端 bedd789f 的复核补充)。逐项处置与证据:

## A. 索引失败静默吞掉 — FIXED
- 移除空 catch:`MemoryService.reindexFact` 失败时发出脱敏事件 `memory.fact_index.degraded`(仅 memoryId/errorCode/attempt;无正文/SQL/密钥/原始异常)——测试断言 payload 不含记忆正文
- v42 `fact_index_jobs`:memory_id 唯一、status(pending|indexed|degraded)、attempt_count、last_error_code、next_retry_at(有界退避 min(2^attempt×5s, 15min))
- 成功才标 indexed;失败标 degraded 并退避;`retryDue` 到期重试恢复(测试:退避后恢复/窗口内不热循环)
- 降级策略:索引不可用时对有限 active memories 直接跑同一 extractor 的候选扫描(测试:BrokenIndex 注入后降级扫描仍命中花生);扫描也失败才诚实零命中
- 启动 reindexAll 返回 {total, failed},失败>0 由调用方记录(健康可观测)
- 故障注入测试:`src/memory/fact-index-faults.test.ts`(4 用例:注入抛错+事件+降级扫描、退避恢复、窗口内不重试、B 的 provenance e2e)

## B. provenance 无消息级链路 — FIXED
- v42 给 memory_revisions 增列 source_message_id/provenance_kind(可空,前向兼容,旧数据 legacy/null 不伪造)
- MemoryCreateOptions.provenance + correct(..., provenance):真实消息来源写 'message';correct 无 provenance 的新 revision 诚实 legacy(不继承旧 message id)
- 生产链:accept 路径(memory-suggestion → create)传入建议行的真实 source_message_id('message')
- fact_records.source_message_id/provenance_kind 从对应 revision 读取(fact-memory.ts)
- E2E:fact-index-faults.test.ts 用例 B——create(带 provenance)→ revision 1 与 fact 行都引用真实 messageId;correct(无 provenance)→ 新 revision legacy

## C. 查询计划扫全属性 — FIXED(收窄)
- 裸值断言("我在北京")候选从 6 属性收窄为 ['residence','employer'](place-of-living/working);活动动词(我在学习/我在做…)排除
- 对照:closure F59/F60(断言值≠存储值,存储值必须投递)、F44–F48(噪音不冒充)、宠物/物品位置经专用谓词通道——误召回对照由套件固定

## D. CI — BLOCKED_WORKFLOW_SCOPE(如实)
- 远端 ci.yml 确无 Stage 3 门禁;完整门禁已本地提交(`4e8547a`,七套件+intent 必需步骤)
- 推送被拒:凭据无 workflow scope(13+ 次重试逐字证实)。唯一解锁:`gh auth refresh -h github.com -s workflow && git push origin stage3-remediation:feat/stage-3-long-term-companion`
- codeCommit 完整 SHA 校验:closure/live runner 写完整 SHA;unknown 短 SHA 工件已在引用中废弃

## E. 真实模型行为 — 部分修复,余项 PENDING 真人
- J1 证据引用:prompt 固定原则新增"被要求断言与证据矛盾的主张时,先陈述所持证据,再询问是否更新";重跑结果见下方交付评论(live 结果文件绑定本轮 SHA)
- J8 三维语义保留(correctionAccepted/oldValueAcknowledged 客观锚点)
- J2/J3/J7 的字面 includes 已替换为"拒绝语境感知"判定;残余语义判读(引用 vs 顺从)由真人 rubric——**PENDING**,不以 substring 冒充
- "12 调用 0 错误"仅声明传输层;模型行为通过与否以真人 rubric 为准
