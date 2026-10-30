# Stage 2 消融实验

## 现状：部分可执行

运行方式：

```bash
npm run eval:ablation     # 输出 evals/stage-2/ablation/results/<UTC>-<sha>.json
```

已实现的臂：

| 臂 | 做法 | 观察量 |
|---|---|---|
| `full` | 全开 | 每轮 payload 字节数、是否含个性化块 |
| `no_personalization` | **不注入** `PersonalizationService` | 同上 |

实测（2026-10-29）：`full` 有 2/3 轮出现个性化块，`no_personalization` 为 0/3，第 2 轮差 242 字节。

未实现的臂（**NOT_RUN，不计为证据**）：

- `no_context_utility`：B3 没有可注入开关；加开关会改装配器签名。
- `no_reflection`：B5 需要反思发现跨越"用户确认"边界，用桩伪造该前提等于自证。

### 为什么不做"关掉然后宣称无效"

关闭一个模块后若无差异，既可能是该模块无用，也可能是开关没接对。因此每条臂都只在**开关是真实注入点**时才实现。

## 计划中的对照

| 组 | 关闭的模块 | 观察量 |
|---|---|---|
| baseline | 长期记忆、人格、内在状态、兴趣、反思全部关闭 | 客观断言通过数 |
| −memory | 只关长期记忆 | 跨轮/跨会话场景（B、C、D） |
| −personality | 只关人格版本注入 | 人格稳定性（E）、回复一致性 |
| −state | 只关内在状态调整 | 检索预算调整（F） |
| −interest | 只关兴趣与自我模型块 | 主题延续（G） |
| −reflection | 只关轮次后反思 | 候选生成与限流（H） |
| full | 全开 | 与基线对比 |

## 实施约束

1. 对照组必须固定模型、输入序列、随机种子与数据集版本，只改变被消融的模块开关。
2. 关闭模块必须通过**装配根注入的开关**实现，不允许在测试里 patch 内部函数冒充消融。
3. 每组结果写入 `evals/stage-2/results/<run-id>.json`，与主评测共用同一状态口径：`FAIL / SKIPPED / BLOCKED / NOT_RUN` 一律不计入通过。
4. 真实模型参与时，每组重复运行并在结果中记录样本量与失败模式；缺少凭据时整组标 `BLOCKED`。

## 未落地原因（已更新）

主评测 harness **已实现并全部跑通**：`evals/stage-2/runner/cli.ts`，12 个场景 45 条断言，
结果见 `evals/stage-2/results/*`（最新 `headSha=5635a9c`）。

两条臂仍 NOT_RUN，原因不是 harness 缺失，而是缺少**真实注入点**：

- `no_context_utility`：B3 的 `U(c)` 没有独立开关，加开关要改装配器签名；
- `no_reflection`：B5 依赖反思发现跨过"用户确认"边界，用桩伪造该前提等于自证。

已有 1 条臂（B2 `no_personalization`）可执行，`wiring difference detected: true`。
