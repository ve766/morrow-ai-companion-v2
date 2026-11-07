# 00 · 执行发现

- 任务：Issue #65 全仓逐文件审计与核心认知系统归正
- 分支：`feat/whole-project-return-to-core-20261107`
- 权威实现基线：`e1d85137b64f4e6d65750a11eb27757135c1f32b`（PR #62 head）
- 可见 main：`8b207b7d7b80b91ed4369d02fd6ef7e170b81133`（184 files，不是本任务产品基线）
- PR #64：`b63c998...`，OPEN、未合并；本任务只复用其 v53 schema 以兼容已迁移的 acceptance DB，不合并其认知代码
- 最终状态：**PARTIAL**（P0 身份已修复并有真实 Provider 证据；全仓 100% 逐行人工审计和完整行为矩阵未完成）

## 最重要结论

1. **身份失效的根因是请求组装缺少应用级身份契约**，不是模型“不听话”：最终 system context 有性格数值、记忆、认知提示，但没有“Morrow 是主体、Provider/Model 是基础设施”的第一优先级约束；Provider 默认自我介绍可直达回答。
2. 修复后，干净会话真实 Provider 回答：
   - “我叫 Morrow。当前会话的计算服务由 Spark 验收 Provider / spark-x2.6 提供，它是基础设施，不是我的身份。”
   - “切换后我仍是 Morrow。模型服务只是算力来源，不决定身份。”
   - “我叫 Morrow，这是我的身份。讯飞星火不是我的身份，它是这次对话背后的服务方，负责提供计算支撑。至于为什么叫 Morrow，我没有关于命名由来的证据，不清楚确切的起源。”
3. **不能把模块/表/测试数量当产品能力**：PR #64 的 self-model/consent 是 PARTIAL；本任务在干净基线上只修复身份与审计，未把 PR #64 自动并入。
4. 全仓 1348+ 文件已完成自动清点/静态扫描；生产 P0 文件逐行人工审阅；其余文件标为 `AUTOMATED_REVIEWED` / `EXCLUDED_BINARY`，不冒充 100% 人工逐行审阅。

## 状态

- P0 身份锚点：PASS（真实 Provider 语义验证）
- P0 Provider 身份隔离：PASS（同一请求链路，所有 Provider 共享 system contract）
- P0 最终 system context 信任优先级：PARTIAL（身份契约置顶；历史/记忆仍按既有 untrusted 证据处理）
- P1 认知闭环：PARTIAL（既有 memory/reflection/exploration；PR #64 新状态未并入本基线）
- 全仓 100% 人工逐行审计：NOT_COMPLETED
- 完整行为矩阵/消融：PARTIAL / NOT_RUN
