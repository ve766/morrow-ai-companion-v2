# 行为评测 A–K

所有场景均为本地确定性测试或 loopback HTTP provider 的生产调用链；没有用 mock 函数替代 `ChatService`。命令：

```bash
npx vitest run src/affective-state/appraisal-engine.test.ts \
  src/affective-state/emotion-service.test.ts \
  src/self-model/morrow-trait-service.test.ts \
  src/self-model/intrinsic-reward.test.ts \
  src/self-model/affect-attention.test.ts \
  src/app/personality-affect.integration.test.ts
```

| 场景 | 状态 | 输入/操作 | 观察到的证据 | 负例/边界 |
|---|---|---|---|---|
| A 正向发现/喜悦 | PARTIAL | 显式正向反馈；`verifiedProgress` appraisal | `appraisal-engine.test.ts` 生成 joy/relief；生产 integration 的 provider system prompt 含 affect + joy，DB 有 emotion event；`observeThoughtReviews` 有 reward 测试 | 没有在真实 cloud Provider 上制造“Morrow 自己发现新证据”的完整回合；progress→affect 在 integration 中因无 message FK 被 catch（reward 仍写入） |
| B 目标受阻/挫败 | PARTIAL | 纠错/负向反馈 | 生产 integration 连续 7 个独立回合生成 frustration→responsibility observations，最终 active trait；emotion event 幂等测试 retry 不重复 | anger 只在 `priorCorrectionStreak` 高且 S/E 高的 unit test 出现，生产没有稳定 anger 场景 |
| C 失去/悲伤 | PARTIAL | `morrowLoss` API（knowledge_gap / interest_invalidated / relationship_ended） | `appraisal-engine.test.ts`：knowledge gap 只产生 concern，不产生 sadness；invalidated/relationship loss 才允许 sadness/loneliness | 生产只接 knowledge gap→concern；interest invalidation/relationship loss 的自动触发未接 |
| D 不确定/担忧 | PARTIAL | 普通不确定问题；关系相关用户情绪 | 普通未知不产生 fear；关系相关 user distress 只产生 user-context concern（弱、traitEligible=false） | fear 没有生产触发；高风险/低控制场景未接入 |
| E 期待/宽慰/共存 | PARTIAL | 规划、先前 concern、正向反馈 | appraisal unit 产生 anticipation；prior concern + positive 产生 relief；merge 测试允许不同 family 共存 | 没有真实多轮“事件接近→阻碍解除”的 live 场景 |
| F 正反证据 | PASS | trait observation + counter evidence | 9 个 trait 测试：单 observation 不晋升；3 会话/2 情境/24h 后 active；重复同 turn 不计数；反证→weakened；retract 冷却 | 没有真实用户长期 7 天数据；用测试时钟模拟时间跨度 |
| G 用户适配隔离 | PASS | “说话温柔一点” | `deriveGrowthSignals` 产生 user_adaptation signal；`MorrowTraitService` 观测表仍为空 | 不能把 user_adaptation 说成 Morrow 人格 |
| H 情绪与表达 | PARTIAL | 同一请求 + frustration vs joy | `deriveExpressionPolicy` 对 relevant frustration 产生 `affectStrategy='repair'`，joy 无策略；direct request 优先并清空策略；生产 prompt 有 affect 行 | 没有真实模型回复的 A/B 文本对比；只验证策略对象与 payload |
| I 重启与删除 | PASS | 记录→关闭/重开 DB；删除会话；clear | emotion reopen 一致；trait reopen 一致；conversation delete 删除 event 并重建 projection；clearAll 清空 | 消息级删除后的即时 trait 重算依赖 startup；会话删除已覆盖 |
| J 奖励扩展契约 | PASS | verified progress / user praise | reward 单测：verified progress 幂等；用户赞美/留存/依赖/自夸拒绝；promoted-thought bridge 写入一条 reward | 生产只跑 scheduler bridge 的单元等价；没有真实 5 分钟 scheduler 观察 |
| K 误判边界 | PASS | 引用、转述、否定、讽刺、短感谢、礼貌拒绝、用户悲伤、混合语言 | `appraisal-engine.test.ts` 10 个边界断言；user sadness 不产生 Morrow sadness；quoted/reported 不产生候选；sarcasm/refusal 不产生 anger/sadness；短感谢只 joy | 中文反讽/多语言混合仍是规则集，不是完整语义分类器 |

## 结论

- 可区分的 joy/frustration/concern/curiosity/relief 等候选有真实形成规则和证据结构；sadness/anger/fear 只在边界测试或显式 API 中成立，**没有把它们写成生产 PASS**。
- 情绪进入生产 prompt、探索排序和 inner-cognition 巩固触发；表达策略有对象级差异。没有把“prompt 中出现”当作“真实行为差异”的唯一证据。
- 行为评测整体 **PARTIAL**：A–E、H 为 PARTIAL；F/G/I/J/K 为 PASS；没有真实 cloud Provider 的 A–K 全量 live 运行。
