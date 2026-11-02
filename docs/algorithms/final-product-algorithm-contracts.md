# 最终产品算法契约（Issue #34）

实现入口、参数与失败语义的完整索引见 `docs/algorithms/final-product-algorithm-index.md`。
本文件给出审计要求的输入/输出契约与边界。

## 1. 记忆检索

- 输入：query、active memories（权限/敏感上限过滤后）。
- 输出：selected + conflicts + retrieval state（none/partial/degraded）。
- 通道：fact-index、lexical、slot/predicate、normalized-value；RRF(k=60)，按实际通道数归一化。
- 硬约束：deleted/retracted 不可作为当前事实；superseded 仅历史；无证据 abstain。
- 失败：索引不可用 → degraded + 词法/主题回退，不当作零命中。

## 2. 记忆操作

- 输入：本文 messageId、历史、active facts。
- 输出：none/create/correct/clarify/rejected/failed + 结构化 target/old/new/source。
- 事务：记录 + revision + 事实账本 + 复读验证同事务；仅索引降级 → recovery_required。
- 失败：验证不符 → rolled_back；不得宣称已保存。

## 3. 关系连续性

- 输入：source message id + conversation id（不接受 caller text）。
- 输出：mutation（support/replace/retract/retract_kind/retract_all/clarify）+ thread ids。
- 打分：`clip(Σ w·s·exp(−ln2·age/halfLife),0,1)`；称呼 180 天，其余 90 天。
- 删除：证据删除 + tombstone（无 value/source 指针）。

## 4. Outbox

- claim：条件 UPDATE + `lease_generation`；complete/fail 必须带代际。
- 失败：retryable → pending + 退避；5 次 → terminal；租约被接管 → lostLease，不标 done。

## 5. 人格/兴趣/反思/探索

- G1：3 独立回合、步长 1、±8、45 天半衰；prompt 数值 = 基线 + G1。
- G2：同 fold 公式，读时重算；仅表达层。
- 兴趣：≥3 独立证据、≥2 会话晋升；来源删除/撤回降级。
- 反思：注册路由 + provenance/TTL + pending 决策；未知 kind fail-closed。
- 探索：相关性/预算/冷却/去重；直接请求、纠正、高不确定 → 禁止。

## 6. 内在状态 / distress

- 状态：有界 valence/activation/tension，只影响表达策略。
- distress：分句 → 引用/否定/转述/假设作用域 → E；C 独立躯体线索；T 前序张力；
  `D=0.55E+0.25C+0.20T`；直接请求最高优先级。

## 7. 参数版本

`EXPRESSION_POLICY_VERSION=expression-policy.v2`；人格/成长参数集中于对应服务常量；
所有参数为固定启发式，不是概率；变更需配对测试与理由。
