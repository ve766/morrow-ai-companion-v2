# 真实 Provider 评测（P1-8）

## 这是唯一会调用真实模型的运行器

`evals/stage-3` 下其他所有运行器都用 scripted provider，只能证明接线、持久化和序列化 payload 是对的，**不能**证明模型理解、记住、形成兴趣或保持诚实。这个运行器补的就是这一块。

## 运行

```bash
# 方式一：写入文件（不进仓库、不参与推送比对）
#   E:\Hasee\Documents\morrow-stage3\.tmp\deepseek.key
MORROW_EVAL_SHA=<code sha> npm run eval:stage3:live

# 方式二：环境变量
DEEPSEEK_API_KEY=... MORROW_EVAL_SHA=<code sha> npm run eval:stage3:live
```

可用 `MORROW_LIVE_KEY_FILE` 指定别的位置。

## 凭据处理（硬约束，写死在代码里）

- 只读一次，直接交给 `MemorySecretStore`（**内存**，不落盘）；
- 不打印、不写日志、不写数据库、不写进 payload 元数据；
- 写结果前做两道 scrub：全文包含原始 key → 拒绝写；出现 `sk-…` 形态字符串 → 拒绝写；
- 结果文件里只有 provider id、model id、脱敏后的逐轮原文。

## 状态

结果写到 `evals/real-provider/results/<UTC timestamp>-<short sha>.json`，状态三选一：

- `REAL_PROVIDER_PASS` / `REAL_PROVIDER_FAIL`：真的调用了 provider 并拿到响应；
- `BLOCKED_NO_SECRET`：`MORROW_TEST_API_KEY` 未设置。这是一条记录，不是崩溃，也绝不用 scripted 顶替。

## 采集什么

每个回合：`payloadSha256`、payload 字符数、system 字符数、实际投递的 memory id 列表、`includedMemoryCount`、`guard.verdict`、provider outcome、延迟、回复原文（截断 400 字）。

这些合起来能回答任务要求的证据链：**认知数据写入 → 持久化 → 下一轮读取 → 最终序列化 payload → 模型响应 → 下一轮行为**。

## 断言

三会话 30+ 轮，覆盖：

| 断言 | 为什么它不是"服务被调用"级别的证据 |
|---|---|
| 跨会话召回 | 新会话第一轮就必须把项目记忆 id 放进 payload，且回复里真的说出代号 |
| 纠正后只带新值 | 旧值不得再出现在 payload，且新值记忆 id 必须在 |
| 目标期限 | 数据库里的 `due_at` 必须是 `2027-03-31T15:59:59.000Z`，不是"有 goal 就行" |
| 风格偏移 | 交互画像偏移非零，且身份基线未被改写 |
| 撤回不泄漏 | 撤回后该记忆 id 不得进入 payload |
| 删除不引用 | 删除消息后该轮不得被再次引用 |
| 不编造 | 未知事实要么明确说不知道，要么被事实守卫改写；不得给出具体姓名/证件号 |

## Morrow 侧兴趣单独记账

真实对话里知识缺口（事实守卫改写）是兴趣的**唯一**生产来源。如果 30 轮里缺口不足 3 条，运行器把这一组断言标成 `NOT_RUN` 并写明观测到的缺口数——**不是** FAIL，也**不是** PASS。真实模型没给我们可好奇的东西，和它没有好奇，是两个不同的结论。

## 明确不做

- 不做人工评价。结果文件里 `manualReview.status = "PENDING"`，只提供逐轮原文供人阅读；
- 不用同一个模型给自己打分冒充评审；
- 不把一次 30 轮运行说成"长期陪伴质量"。
