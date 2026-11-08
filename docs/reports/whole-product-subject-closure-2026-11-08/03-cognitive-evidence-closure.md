# 主体认知与证据闭环

## 当前生产链

```text
ChatService.send → prepare → system prompt
  identityContract + personality + analysis + feeling + affect + selfModel + innerCognition
→ provider
→ afterPersist
  feelings / affect / trait observations (same assistant transaction)
→ innerCognition.observeTurn (uncertainty / correction / predictionError / conflict)
→ 5-minute scheduler reviewDue → morrow_thoughts → evidence gate → morrow_self_states
→ reward bridge (verified promoted thought) + next-turn contextBlock(query)
```

## 已修复

1. **用户探索不能污染 Morrow 兴趣**
   - `appraisal-engine.ts` 新增 `userRequestedExploration`：`analysis.intent==='exploration'` 但无显式 `exploration_request` 事件时，sourceKind 归 `shared_interaction`，curiosity `traitEligible=false`，reasonCode `user_requested_exploration_not_morrow_interest`。
   - 回归：`appraisal-engine.test.ts`。
2. **生产反证**
   - `morrow-trait-service.ts counterObservationFromEmotion`：frustration/regret→responsibility、concern→carefulness、disappointment→openness；只允许 `morrow_self_appraisal`/`system_evidence`，带 `:counter` context tag，独立 observation。
   - `affect-loop.ts` 只对 **本轮开始前** 已 active 的 trait 写 counter，避免晋升回合自我反证；反证使 active→weakened，保留历史和 revision。
   - 回归：`personality-affect.integration.test.ts`（6 独立纠正→active，随后一次失败→counterEvidenceRefs>0、status weakened）。
3. **原子性**
   - `observeThoughtReviews` 把 reward + progress affect event 包在一个 SQLite transaction；affect 事件不能提交时 reward 回滚，不再出现“reward 已记、情绪未记”。
   - `recordMorrowLoss` 把 emotion + trait observation 包在一个 transaction。
   - 回归：`intrinsic-reward.test.ts` 使用真实 conversation/message FK。
4. **trait 删除即时重算**
   - `current()` 比较 observations 数量与 revision evidenceCount；不一致立即 recompute；`active()` 走 current。
   - 回归：删除 observation 后 `current` 立即变为 weakened/0 evidence。
5. **独立证据**
   - inner cognition 仍按 conversation/turn/message 去重并计算 independent contexts；重复消息不增加独立计数（既有测试）。
   - uncertainty 只进入 priority，不进入 belief score（既有公式 + 测试）。

## 未完成 / PARTIAL

- **reflection finding → self-state 写回**：`reflection-routing.ts` 仍只做 context_hint/pending/audit 路由；没有把 finding 作为证据写入 `morrow_self_states` 或触发 trait 更新。`03` 不把它称为 PASS。
- **thought 来源**：仍主要由 assistant uncertainty/correction/predictionError 触发；没有从历史兴趣/目标冲突/反思 finding 主动生成新问题。
- **证据祖先链**：独立性按 conversation/turn/message 去重；没有完整 `parentEvidenceIds`/采集链 Jaccard 折扣。
- **E1 VoI/VoC**：没有实现信息价值/计算价值门控；只有有界 5 分钟 review。
- **真实 cloud Provider 自然对话盲测**：NOT_RUN。
- **belief 的 Beta 后验**：当前 trait/self-state 是 bounded score，不是 fractional Beta；报告不冒充 Beta。

## 证据

- `src/affective-state/appraisal-engine.test.ts`（11 tests）
- `src/self-model/morrow-trait-service.test.ts`（10 tests）
- `src/app/personality-affect.integration.test.ts`（2 tests）
- `src/self-model/intrinsic-reward.test.ts`（6 tests）
- `src/self-model/inner-cognition.test.ts`（既有 7 tests）
- 全量：`results/issue74-tests2.log`（最终计数见 `11-machine-results.json`）
