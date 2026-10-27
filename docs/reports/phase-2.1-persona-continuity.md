# Phase 2.1 — 人格与内在状态连续性（任务 5）

## 5.1 四个验收条件被有意拆开

任务要求区分四件事。本轮的结论是：**前两件已证实，第三件部分证实，第四件未实现。**

| 层级 | 含义 | 证据 | 结论 |
|---|---|---|---|
| 1. 请求中存在人格数据 | 每次请求的 system 首段带四项数值 + version | 「puts the stored personality and its version into every request and follows an edit」 | 已证实 |
| 2. 模型输出符合人格约束 | 回复体现 warmth/directness 等 | 无自动判定；`c1-personality` 只断言 version 稳定 | **未验证** |
| 3. 多轮/跨会话行为稳定 | 相同设定下行为一致 | 「keeps the personality across a restart and restores it from a recorded revision」+ `c1` | 结构层已证实；行为层见 §5.3 |
| 4. 人格随长期互动有依据调整 | 有写路径 | **无写路径** | 只有设计，没有实现 |

## 5.2 会改人格的只有一条路

`PersonalityService.save` 是唯一写入口，`changeType` 默认 `user_edit`。模型回复、单轮情绪、认知分析都没有写人格的代码路径。本轮新增用例把这一点钉住：

- 「does not change the personality because of one negative message」：发送"谢谢你的回答，不过我不满意这个风格。"后，`version`、`warmth`、`directness` 全不变；请求里仍是同一个 `version`，并带两条原则——"这是对本次互动的反馈，不足以改变长期人格"和"不得静默改变已保存的人格"。

这条测试的价值在于它是**结构性**保证：不是"模型被劝住不要改"，而是"没有任何代码能改"。

## 5.3 内在状态：数值不进 prompt，措辞才进

`CognitiveFeelingService` 计算出的状态是**计算变量**。`prepare` 调 `feelingPromptGuidance(analysis, feelingState, feelingEvent, previousFeelingState)` 生成措辞，**不把数值写进 prompt**（有测试断言请求中不含情绪分值）。

真机观察到的问题不在这条链上，而在**记忆的数值被谁读**：`b5` 有一次回复自行输出 `"status":"active","confidence":85`，而请求的 JSON 里 `confidence` 是真实字段——模型照读了它，还补了一个请求里没有的约定。所以"数值不进 prompt"这条设计边界，在记忆通道上并不成立：记忆 JSON 自带 `confidence` 与 `stale`。

这不是缺陷（`confidence` 是排序依据，也是模型该看到的来源质量），但它意味着：**只要请求里有数值，模型就可能把数值当输出**。已记录的观察，不作为待修项。

## 5.4 内在状态的变化有触发依据

`createCognitiveFeelingEvent` 只在 `analysis` 存在且 `settings.available && settings.enabled` 时构造；事件应用有 `idempotencyKey`（等于 `requestId`），重试不会重复累加；`recordCompletedTurnInTransaction` 与助手消息同事务写入，失败时降级为"保留回复、不更新状态"（`companion-service.ts:842`）。

三条都有测试覆盖（`cognitive-feeling-service.test.ts` 9 条、`cognitive-feeling-engine.test.ts` 12 条）。

## 5.5 未验证与遗留

1. **"模型输出符合人格约束"没有证据。** 没有任何判定规则检查回复是否符合 warmth/directness。本轮的 `c1` 只证明 version 稳定。列为未验证。
2. **自我模型的语义混淆（P1）。** 记录的是用户原话（`explicitSelfFact` → `input.content`），注入标签曾是 "self-knowledge"。本轮修掉了标签与授权，但**没有**修改"用户陈述进入自我模型"这一设计。要修需要先决定：自我模型到底存"我是谁"还是"用户说了什么"。
3. **用户偏好与稳定倾向无法机械区分。** 两者都在同一个 `systemRules` 字段里，没有作用域或时效标记。
