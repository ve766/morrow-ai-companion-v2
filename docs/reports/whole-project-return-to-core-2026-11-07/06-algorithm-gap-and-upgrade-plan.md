# 06 · 算法缺口与升级计划

## 已存在

- 记忆：4 通道 RRF（fact-index/lexical/fact-slot/value），冲突并列，撤回/过期过滤；`src/memory/memory-context-assembler.ts`。
- 兴趣：跨会话证据、promotion 阈值、强度/置信度公式；`src/self-model/interest-service.ts`。
- 探索：interest-based gate + cooldown/daily cap；`src/self-model/exploration-policy.ts`。
- 反思：runs/findings/dedupe/hint 注入；`src/self-model/reflection-service.ts`。
- 人格：用户 baseline + 有界 growth + 交互风格；`personality/*`。

## 缺口与风险

1. **身份约束不是算法**：本轮新增 system contract；无 deterministic identity routing。真实 Provider 通过，但存在模型不服从风险。
2. **self-model 业务代码不在本基线**：v53 表存在，PR #64 未合并；本任务未把其公式当作已验证能力。
3. **语义 embedding 缺失**：无 neural semantic channel；4 通道 RRF 是 hybrid 的可用实现，但不能称为 neural semantic。
4. **反思写回缺失**：findings 只进入 hint/pending；没有 evidence gate → self-model revision 的生产路径。
5. **探索优先级**：只有 interest strength gate，没有 `I×IG×R×F×U−λRisk` 的可操作实现。
6. **完整评估缺失**：无 identity consistency / source attribution / memory recall@k / justified revision 的标准化数据集和盲评。

## 升级顺序（下一任务）

1. Identity deterministic intent path + provider/model honesty guard（仅身份问题），并与自然对话分流。
2. 把 PR #64 的 self-model/consent 代码逐文件审计后并入（先修 sensitive scope 文案/24h 授权边界）。
3. 语义检索：本地 embedding 或标注转述集；先建消融，再改默认召回。
4. Reflection→self-model evidence gate；候选默认不激活。
5. 探索 Priority 公式与 pending，不执行工具。
6. 行为评测集与冻结阈值。
