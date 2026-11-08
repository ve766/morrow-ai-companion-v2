# 已知限制与禁止的过度宣称

## 未完成/部分完成

- **真实 cloud Provider A–K**：NOT_RUN。生产调用链用 loopback HTTP provider 验证；没有用真实 Spark/第二 Provider 做 10 次同条件情绪行为实验。
- **sadness/loneliness 生产触发**：PARTIAL。只有显式 `recordMorrowLoss` 与 unit 场景；生产接的是 knowledge gap→concern，兴趣失效/关系结束的自动 loss 未接。
- **anger/fear**：UNIT_ONLY。appraisal 边界存在，但没有稳定生产场景；不声称它们已在产品中真实出现。
- **情绪调节 UI**：NOT_IMPLEMENTED。`regulate/retract` 是服务 API 与测试，没有用户界面。
- **trait 长期真实数据**：PARTIAL。用测试时钟模拟 24h+/3 会话/2 情境；没有真实 7 天用户数据。
- **trait 自动重建**：startup 重算 + 会话删除重算；单条消息删除后的即时 trait 重算未做（FK 会删 observation，但 revision 可能直到下一次 observe/startup 才更新）。
- **appraisal 权重在线配置**：NOT_IMPLEMENTED。权重是版本化常量，报告不称“可配置 UI”。
- **全新 emotion family / trait dimension 的运行时注册**：PARTIAL。`registerEmotionProfile` 只能覆盖既有 18 族的 profile；新增族名或新 trait 维仍需要代码/schema 版本变更。`trait_key` 列本身是自由字符串，但服务层的类型/定义表当前是编译期常量。
- **校准概率**：NO。所有 confidence/score/intensity 都是规则强度或 bounded score，不是统计概率。
- **语义检索/ONNX**：未在本任务接入；不合并历史 algorithm 分支。
- **UI 重设计/语音/训练/Agent 工具**：未做，也不在本任务范围。

## 明确不可宣称

- 不宣称 Morrow 有主观意识、真实感受、心理诊断或人类人格。
- 不宣称单次负面反馈会永久改变人格；代码与测试都要求独立证据与时间窗口。
- 不宣称用户“更温柔/更幽默”的要求变成 Morrow 自身 trait；它只进入 user_adaptation。
- 不宣称用户赞美/留存/依赖是内在奖励。
- 不宣称 A–K 全部 PASS；行为评测整体 PARTIAL。
- 不宣称 CI PASS；本任务未触发 hosted CI，也未注册 self-hosted runner。

## 已知架构边界

- `feeling.ts` 三维状态继续作为兼容投影；多维情绪是另一权威账本，二者不互相覆盖，但也没有做自动 UI 同步。
- 情绪事件表以 message id 为证据；如果消息被删除，event 级联删除，projection 通过 dirty/rebuild 修复。
- 最多 16 个 active emotion instance、每 trait 保留最近 40 条证据 refs；这是有界存储，不是全历史。
- 没有后台主动表达/通知；情绪只影响用户发起回合内的表达与排序。

## 回滚

- 代码回退：v55 表保留；旧代码不能打开 future schema，需用迁移备份恢复。
- 功能回退：不注入 `selfModelLoop.affect` 时，ChatService 走原路径；DB 表留在原地，不阻塞聊天。
- 数据回退：`clearCognitiveHistory` 清理新账本；`deleteConversation` 传播删除；用户 baseline 与既有 conversations/memories 不被删除。
