# 自我模型与偏好/价值更新算法

## 1. 候选来源与提取

`deriveSelfModelCandidates(text, evidenceRefs)` 只从用户的**明确陈述**提取，不从行为猜测：

- `我(更/最/比较/很)喜欢|爱|偏好|重视|看重|在意…` → `type=preference`，`stance=support`，`origin=user_explicit`，`scope=user`
- `我(更/最/比较/很)不喜欢|讨厌|厌恶…` → `type=preference`，`stance=oppose`
- `我不想|不要|不接受|不允许|不能接受…` → `type=boundary`，`stance=oppose`
- `我会|能|擅长|不会|不能|不擅长…` → `type=capability`
- `我认为|觉得|相信|意识到…` → `type=claim`，`stance=neutral`

模型推断必须由调用方以 `origin=model_inference` 或 `model_proposed_candidate` 显式调用 `propose`，不会被提取器伪装成用户事实。

## 2. 评分公式

固定权重（评测前冻结，变更需新算法版本）：

`C = 0.35E + 0.20R + 0.20S + 0.15K − 0.10X`

| 变量 | 定义 | 范围 |
|---|---|---|
| E 证据质量 | `min(1, 0.5 + 0.1 × evidenceRefs.length)` | 0–1 |
| R 重复/跨情境支持 | `1 − exp(−evidenceRefs.length / 2)` | 0–1 |
| S 来源可靠度 | user_explicit 1.0；system_constraint 0.95；retrieved_memory 0.72；model_proposed_candidate 0.55；model_inference 0.5；unknown 0.2 | 0–1 |
| K 一致性 | 同 proposition/stance 1；无先例 0.5；相反 0 | 0–1 |
| X 未解决冲突 | 相反且有先例 0.7，否则 0 | 0–1 |
| C | 最终候选分 | 0–1 |

`confidence = round(C × 100)`，限制 1–100。

## 3. 更新决策

| 条件 | 决策 | 写入状态 |
|---|---|---|
| 无先例，C ≥ 0.55 且 origin 为 user_explicit/system_constraint | activate | active |
| 无先例，0.40 ≤ C < 0.55 | candidate | candidate |
| 无先例，C < 0.40 | reject | rejected |
| 同 proposition/同 stance，C ≥ 0.50 | reinforce | active，revision +1，旧行 superseded |
| 同 proposition/同 stance，C < 0.50 | weaken | weakened，revision +1，旧行 superseded |
| 相反 stance，C ≥ 0.62 且 E ≥ 0.80 | revise | active，revision +1，旧行 superseded |
| 相反 stance，证据不足 | conflict_pending | conflict_pending，不覆盖旧状态 |

- proposition 相似度：先做 token 重叠；中文长句再去除 `我/更/喜欢/讨厌/不/会/能…` 等 stance frame 后比较字 bigram，避免“我更喜欢安静”与“我讨厌安静”被当作两个无关命题。
- 权重/阈值是排序启发式，不是校准概率；必须在报告中标注。
- 用户显式陈述的 `origin=user_explicit` 只代表“用户说过”，不代表 Morrow 自己形成该偏好。

## 4. 上下文使用

`buildSelfModelContextBlock` 将最多 4 条 active/weakened 状态加入 system context，格式：

`[type/stance] 「proposition」（来源 origin，置信度 N/100，revision N，证据 N 条）`

并明确要求模型只作有界上下文使用，不编造记忆/感受/经历。
