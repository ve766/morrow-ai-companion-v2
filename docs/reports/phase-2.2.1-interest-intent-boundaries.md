# Phase 2.2.1 — 疑问、陈述、请求与不确定表达

- 实现：`src/self-model/interest-intent.ts`
- 接入：`CompanionService.onTurnCompleted` → `InterestService.observe({ intent })`
- 测试：`interest-intent.test.ts`、`self-model.test.ts`、`cognitive-loop.integration.test.ts`

## 1. 规则

| 意图 | 含义 | 能否新建兴趣 | 能否强化已有兴趣 |
|---|---|---|---|
| `statement` | 关于用户的陈述 | 是 | 是 |
| `mixed` | 陈述 + 提问 | 是 | 是 |
| `question` | 只提问 | 否 | 是（仅强化已陈述主题） |
| `task_request` | 帮我研究/查/推荐 | 否 | 否 |
| `third_party` | 朋友/同事/他/她 | 否 | 否 |
| `uncertain` | 不确定/不知道/是不是 | 否 | 否 |
| `withdrawn` | 已经没兴趣了 | 否 | 否 |

判定顺序：`withdrawn → uncertain → self-fact → third_party → task_request → question → statement`。陈述优先于第三方，避免「我喜欢…，我朋友也是」被误判。

## 2. 十个边界句

| # | 句子 | 判定 | 是否创建 | 说明 |
|---|---|---|---|---|
| 1 | 抑郁症一般怎么治疗？ | question | 否 | 询问不等于拥有 |
| 2 | 我最近抑郁得厉害。 | statement | 是（sensitive） | 明确的自我陈述 |
| 3 | 帮我研究一下抑郁症的治疗方法。 | task_request | 否 | 任务请求 |
| 4 | 我对天文学很感兴趣，有推荐吗？ | mixed | 是 | 陈述 + 提问 |
| 5 | 不知道自己是不是喜欢天文学。 | uncertain | 否 | 保持不确定 |
| 6 | 我以前喜欢摄影，现在已经没兴趣了。 | withdrawn | 否 | 已撤回的兴趣 |
| 7 | 我想了解咖啡，但不确定自己是否喜欢。 | uncertain | 否 | 保持不确定 |
| 8 | 我朋友喜欢天文学。 | third_party | 否 | **修复的泄漏** |
| 9 | 我很喜欢天文学。顺便介绍一下最近的发现。 | statement | 是 | 陈述 + 任务 |
| 10 | 我是不是对天文学感兴趣？ | uncertain | 否 | 自我疑问 |

## 3. 修复的实际缺陷

旧实现只有 `question | statement`：

- **「我朋友喜欢天文学」会为用户创建「天文学」兴趣**——第三方属性被写进用户模型。现在判定 `third_party`，不写任何行。
- **「帮我研究抑郁症」会创建敏感兴趣**——任务请求被当成属性。现在 `task_request`，不写行。
- **「不知道自己是不是喜欢」会创建兴趣**——不确定被当成事实。现在 `uncertain`，不写行。

## 4. 保留的学习能力

- 陈述与「陈述 + 提问」仍会创建兴趣；不会把所有疑问句永久丢弃。
- 疑问句仍可强化用户已陈述过的主题（旧测试「跨两个会话晋升」因此保持通过）。
- 明确陈述**不能**绕过敏感度分类：`我最近抑郁得厉害` 仍生成 `sensitive` 兴趣，未授权时被请求体过滤。

## 5. 证据

- `interest-intent.test.ts`：10 句逐一断言，另有「其他」不被当作第三方、陈述优先于第三方、创建/强化矩阵。
- `self-model.test.ts`：`third_party` 返回 `null`、`task_request` 返回 `null`、`mixed` 创建一行。
- `cognitive-loop.integration.test.ts`：「抑郁症一般怎么治疗？」不产生兴趣行，随后陈述句才产生敏感兴趣。

## 6. 局限

1. 仍是句式启发式，不是语义理解。反讽、长距离指代、引述他人原话可能误判。
2. `withdrawn` 只阻止新建，**不会**自动归档已存在的同名兴趣；这需要与 `archive` 生命周期结合，本轮未做。
3. 「只用疑问句表达的偏好」会被漏记（有意取舍：漏记可恢复，误记敏感属性不可恢复）。
4. 第三方判定基于「我朋友/他/她」等标记；「我们」这类集体主语未单独处理。
