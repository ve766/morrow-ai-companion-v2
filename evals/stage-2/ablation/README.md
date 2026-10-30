# Stage 2 消融实验

## 现状：部分可执行

运行方式：

```bash
npm run eval:ablation     # 输出 evals/stage-2/ablation/results/<UTC>-<sha>.json
```

已实现的臂（四组，全部真实执行）：

| 臂 | 做法 | 观察量 |
|---|---|---|
| `full` | 全开 | payload 字节数、个性化块、记忆投递顺序、反思运行次数 |
| `no_personalization` | 不注入 `PersonalizationService` | 同上 |
| `no_context_utility` | `useContextUtility: false`（`MemoryService`/`MemoryContextAssembler` 的真实注入开关） | 记忆投递顺序 |
| `no_reflection` | 不注入 `reflection`（真实服务，不是桩） | 反思运行次数、注意力块 |

实测（`headSha=e25308c`）：

- 个性化块：`full` 3/4 轮，`no_personalization` 0/4 轮，第 2–4 轮各差 242 字节。
- 记忆投递顺序（夹具下标）：`full` `[3,2,0]`，`no_context_utility` `[2,0,3]` —— 没有效用排序时，陈旧记录按相关度排到最前。
- 反思：`full` 运行 4 次，`no_reflection` 0 次；两臂注意力块均为 0（这 4 轮没有产生可晋升的兴趣），**未见载荷差异**，如实记录，不解释为"无效"。

未实现：B1 无臂可做——置信度不改变策略，没有可切换的东西。

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

## 注入点从哪来

四组臂都用**装配根的真实开关**，没有 patch 内部函数：

- `no_personalization`：`selfModelLoop` 不传 `personalization`；
- `no_context_utility`：`new MemoryService(repo, …, { useContextUtility: false })`，
  装配器退回"只按相关度"的旧排序；
- `no_reflection`：`selfModelLoop` 不传 `reflection`（传的是真实 `ReflectionService`，不是桩）。

主评测 harness 也已跑通：`evals/stage-2/runner/cli.ts`，12 个场景 45 条断言，
结果见 `evals/stage-2/results/*`。
