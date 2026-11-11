# 算法数学复核与启用状态

原则：区分「论文结论 / 已发表支持 / 工程启发式 / Morrow 新假设 / 实测」；没有实测就不写 ESTIMATED 为实测。参考用户材料 `docs/reference/morrow-2026-11-08/`，不重复转换。

| 算法 | 数学/实现复核 | 当前生产状态 | 结论 |
|---|---|---|---|
| A1 Dense+BM25+WRRF+Cross-Encoder | 未新增 Dense/Cross-Encoder；现有 FTS5、Fact Slot、冲突检索、RRF 仍是独立通道 | **EXPERIMENTAL / 未上线** | 不把 RRF 称为语义检索；无模型、无 benchmark、无内存/包体数据 |
| A2 HippoRAG/PPR | 未实现实体归一、关系抽取、图边置信或 PPR | **NOT_IMPLEMENTED** | 不做未验证多跳扩散 |
| B1 OCC/PAD/OU | 已有多族离散事件 + 3D feeling；新 emotion 逐族指数衰减，不是完整 OU 过程；无随机扰动/θ→0 处理 | **PARTIAL** | 不声称完整 OCC/PAD/OU 理论；discrete emotion 与连续 mood 未完全分离 |
| C1 人格更新 | trait 使用有界 S = .30Q+.25I+.20X+.15R−.30K、独立会话/情境/24h、反证/迟滞/冷却；不是 fractional Beta | **PARTIAL** | 不声称 Beta 后验；observation log 可重放，`user_adaptation` 隔离 |
| D1 Surprise/IAC | 无 IAC/KL；只有 Morrow-owned appraisal 与 verified progress reward；用户新话题不直接形成兴趣 | **PARTIAL** | 无 cold-start 反操纵完整模型；不声称 IAC |
| E1 冲突/VoI/VoC | inner cognition 有证据 gate 和 5 分钟 review；无 VoI/VoC 公式、无统一预算/停止条件；不是 Botvinick conflict monitor | **PARTIAL** | 保留为 bounded review，不称为 Hopfield energy |
| F1 CLS/ACT-R/双时态 | 未实现 CLS/ACT-R/valid-time/transaction-time；现有记忆不可逆删除边界由既有 memory 模块负责 | **NOT_IMPLEMENTED** | 不把 summary 当原始证据 |
| G1 ToM/JSD/Subjective Logic | 无 ToM/JSD/主观逻辑；用户情绪与 Morrow 情绪已在 appraisal 层隔离 | **NOT_IMPLEMENTED** | 不从单次语言猜用户心理事实 |
| H1 证据独立性/不确定性 | 独立性按 conversation/turn/message 去重；无祖先链 Jaccard、无 ECE/Brier/NLL 校准 | **PARTIAL** | 不声称 calibrated probability；温度 1.35 未采用 |
| I1 统一认知架构 | 有模块契约/事务 outbox/单一 affect 权威；没有 GWT/LIDA/预测加工实现 | **CONCEPTUAL** | 只作为模块边界，不声称理论已实现 |

## 数学审查发现（必须保留）

- B1 的 OU 公式 `x_{t+Δ}=μ+(x_t−μ)e^{−θΔ}+σ√((1−e^{−2θΔ})/(2θ))ε` 需要 θ→0 极限、缺失值和边界裁剪；当前实现是逐族指数衰减，不是该随机过程。
- C1 若使用 Beta，后验均值必须是 `α/(α+β)`，不得再次在分母加先验样本量；当前实现没有 Beta，报告不冒充。
- E1 冲突分数必须按候选数量/尺度归一；当前 inner cognition 的 score 是 bounded evidence score，不是 Botvinick conflict。
- H1 温度缩放必须用保留验证集拟合并报告 ECE/Brier/NLL；本轮没有做，使用固定规则分数。
- 所有未验证算法保持关闭默认路径；没有新增网络/工具/训练。

## 证据

- `src/affective-state/appraisal-engine.ts`（weights/potential）
- `src/self-model/morrow-trait-service.ts`（fold/status）
- `src/self-model/inner-cognition.ts`（evidence gate）
- 报告 `06` 的检索基准为 NOT_RUN。

## 第二轮补充

- 新增 MoodService：确定性指数均值回归 `m(t+Δ)=μ+(m(t)-μ)e^{-λΔ}`；没有随机项，因此不声称 OU 过程/概率。
- Reflection state gate：bounded score `0.50*confidence + 30*min(1,independent/2) + 5 - counter`，是工程规则，不是 Beta posterior/校准概率。
- 自主问题 priority 是启发式加权和，不是 VoI 或概率。
- v56 migration 只有 mood 表；A1/A2/F1/G1 仍未实现，保持 EXPERIMENTAL/NOT_IMPLEMENTED。

## 第三轮

- Mood 仍是确定性指数均值回归，不是随机 OU；pause 先结算 elapsed 衰减，resume 不补算。
- Reflection 独立性是 root/correlation cluster 计数，不是概率；分数仍是 bounded heuristic。
- 未新增 Dense/PPR/F1/G1；A1/A2 仍 EXPERIMENTAL/NOT_IMPLEMENTED。
