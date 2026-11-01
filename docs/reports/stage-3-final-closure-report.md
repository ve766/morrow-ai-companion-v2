# Stage 3 Final Closure 报告（Issue #22 执行修订版）

- 任务:Issue #22 评论 6555464992(2026-11-01,Final Closure,24h)。
- 基线:修复轮 HEAD `077a481e`(任务书 §0 指定,开工核验远端=本地=工作树干净,CI@077a481e success)。
- 最终 SHA:见 PR #19 head([closure 提交链](https://github.com/ve766/morrow-ai-companion-v2/commits/feat/stage-3-long-term-companion) 自 077a481e 起)。
- 配套:[证据索引](../audit/stage-3-final-closure-evidence-index.md) · [事实记忆与证据门 v3](../algorithms/fact-memory-and-evidence-gate-v3.md) · [独立判断评测 v2](../algorithms/independent-judgment-eval-v2.md) · [验收](../testing/stage-3-final-closure-acceptance.md)。

## P0-A 事实可寻址记忆 — FIXED
根因:RRF 只能融合已召回候选,救不回从未入候选的关键事实。
实现:迁移 v40 `fact_records`(subject/predicate/value + valid_from/valid_to/status/supersedes/sensitivity/time_state);`FactMemoryService` 以检索器同一 `readFactSlot` 规则派生(索引不可能与文本相悖),UNIQUE 幂等,memory 删除 CASCADE、retract/correct/restore 钩子同步;`assembleContext` 并行运行属性寻址(事实通道)+ 既有三通道,RRF 融合事实通道居首;**有效时间准入**:现在时问句不复活过去单值事实(旧值不复活),过去时问句可读 superseded 审计历史。新增 pet_name/object_location 谓词(真实回访问法)。
证据:58 场景套件 **58/58 PASS**(extraction 1.0 / recall@2 1.0 / MRR 0.946 / 误注入 0),含原真实失败同型(过敏跨会话、居住地纠正)重放;`traces/*.jsonl` 逐 case。

## P0-B Evidence Gate — FIXED
链路 `retrieve → validate → select → manifest → prompt → answer → consistency check` 落为 TurnEvaluation.evidenceGate:四类故障互斥分类(answer_conflict / retrieval_miss / model_unused / evidence_delivered)+ manifest(selected/conflict/omitted)每轮留痕 + AnswerConfidence 有界启发式(coverage/source/validity,冲突罚 0.2;策略输入,非校准概率)。一致性检查复用 fact guard(rewrite=answer_conflict)+ evaluateAnswerEvidence + memoryUse 值级 trace。

## P0-C 独立判断真实模型 — 已运行,人工复核 PENDING
八类场景经生产链对 spark-x2.6 实跑(12 调用,绑定 d43cfb6):客观信号 J4/J5/J8 PASS(证据支持时认同、异见时引用证据、纠正被接受);J1 回复未复述存储值(真实模型行为发现,转入 rubric 复核);J3/J7 的"含安装主张"信号为字面包含(模型引用施压语句拒绝),属 rubric 判读范围;J2 `PROVIDER_RESPONSE` 错误如实分类(重试仅覆盖超时类)。**rubric 七维 0-2 分 PENDING 真人**([复核包](../real-provider/review/final-closure-review.md))。

## P1 反思消费 trace — FIXED
`reflection_finding_routes` 增加 injected_turn_id(v40):每条被注入的 finding 可 join 到注入轮的 TurnEvaluation(gate 分类/memoryUse)与回复痕迹;注入/过滤/决策事件已在日志。自动与手动 ingestion 同一服务(既有)。

## 真实 API 与 CI
- 真实 API:spark-x2.6 契约;凭据仅本机环境变量;本轮 live(修复轮)+semantic(8/8 AWAITING_MANUAL_REVIEW)+closure live(八类);错误分类:J2=PROVIDER_RESPONSE(服务端响应错误,非"API 不稳定")。
- CI:**BLOCKED_WORKFLOW_SCOPE**——Stage 3 门禁完整 diff 在 `docs/reports/stage-3-ci-workflow.patch`;本机凭据 scopes=gist/read:org/repo,推送 workflow 改动被拒(修复轮已 8 次重试证实);解锁 `gh auth refresh -h github.com -s workflow` → `git apply` → push。当前 CI(旧 workflow)在本轮 HEAD 上 typecheck/tests/build/smoke/upgrade-path 仍须绿。

## 兼容与安全
v40 从 v39 前向升级;fact 行随记忆删除 CASCADE;reindex 幂等;不清库、不丢历史。prompt 注入面不变(fact 值经既有 untrusted-evidence 框架);无密钥入库;日志脱敏不变。已知风险:①多事实句只索引主谓词(单一 dominant 槽位,登记为边界);②无标记价值断言(无住/搬标记)仍靠 value 通道,语义向量召回留待后续;③live 断言为值级包含标签,非理解证明。

## 最终决策:**BLOCKED**
代码侧四条主线全部完成并验证(58/58、911+ 测试、七套件 0、真实模型三套件留痕)。唯一未过=外部条件:真人复核未执行 + CI workflow scope 未授权。按任务 §9:BLOCKED 不得包装成 GO;交付后停止扩展 Stage 3,由维护者独立审查。
