# Post-release backlog（P2/P3）

不在本 RC 内实现；登记以免扩大范围。每项需产品决策或独立校准。

| ID | 级别 | 事项 | 位置 | 影响 | 建议 |
|---|---|---|---|---|---|
| BL-01 | P2 | 反思路由表缺 `open_question` | `src/cognition/reflection-routing.ts` | 某类 finding 无消费路由（fail-closed，不误用） | 产品确认后加入 registry + 测试 |
| BL-02 | P2 | pending 决策状态收敛 | `src/cognition/pending-items.ts` | accepted→done、rejected/dismissed→dropped；route 行不写终态 | 明确状态映射并补审计测试 |
| BL-03 | P2 | `getProvider()` 不返回 spark | `src/app/companion-service.ts` | Spark 无 renderer 配置入口 | 增加 spark UI/选择逻辑 |
| BL-04 | P2 | `GROWTH_MIN_CONFIDENCE` 死常量 | `src/personalization/personality-growth.ts` | 误导读者 | 删除或接线 |
| BL-05 | P2 | 兴趣晋升无时间跨度 | `src/self-model/self-model-domain.ts` | 同分钟 3 条证据即可晋升 | 需 24h 跨度/显式授权；会改变既有阶段证据，需配对评测 |
| BL-06 | P2 | 归档记忆重述不恢复召回 | `src/memory/memory-service.ts` | 用户重述已归档事实不会回到上下文 | 产品语义确认后改 confirm/restore |
| BL-07 | P3 | 无语义嵌入召回 | `src/memory/memory-context-assembler.ts` | 同义改写依赖词法/槽位 | 接入授权语义通道并做 Recall@k/MRR 评测 |
| BL-08 | P3 | 多机/网络存储一致性 | 持久层 | 当前仅单机 SQLite 多进程 | 若引入网络存储需重评 lease/文件锁 |
| BL-09 | P3 | DeepSeek 真实 Key 端到端 | provider | 仅注入 fetch 测试 | 持 Key 用户按 README 执行一次 |
