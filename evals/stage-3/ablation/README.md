# Stage 3 消融方法

## 目的

回答一个窄问题：**这个模块是否改变了任何可观察行为？**

不是回答"这个模块有没有用"。15 个脚本化场景覆盖不到的部分，消融结果一律视为"未观察"，而不是"无贡献"。

## 四个臂

| 臂 | growth | exploration | reflection | 说明 |
|---|---|---|---|---|
| `full` | on | on | on | 完整系统 |
| `no_growth` | **off** | on | on | 关闭人格有界漂移 |
| `no_exploration` | on | **off** | on | 关闭自主话题门禁 |
| `no_reflection` | on | on | **off** | 关闭回合后反思 |

## 执行

```bash
npm run eval:stage3:ablation
```

结果写入 `evals/stage-3/ablation/results/<UTC timestamp>-<head-shortsha>.json`，包含每臂逐场景状态与相对 `full` 的差异场景列表。

## 判读规则

- `changedCount > 0`：该模块在这些场景里是承重的，差异场景 ID 会被列出。
- `changedCount === 0`：**只能说这 15 个脚本化场景没有触达它**，不能写成"该模块无作用"。
- 不得为了让差异出现而修改场景断言方向；断言来自需求，不来自结果。

## 已知局限

- 脚本化 Provider 不产生语义输出，因此任何依赖模型行为的差异都不可见。
- 消融臂共享同一套场景与同一临时库构造方式，差异只来自模块开关。

## 2026-10-31 最终纠偏轮

- 结果：`results/20261031T063933Z-b0e719a.json`（`codeCommit` = `b0e719ad116db5607295da9f5ccddc6e2f4589b4`）
- 基线：16 场景 15 PASS / 1 NOT_RUN
- `no_growth` → L4、L12 改变（交互画像被移除，风格证据与删除传播都不再成立）
- `no_exploration` → L5 改变（没有探索门，`model_attempted` 与 `actually_raised` 都不产生）
- `no_reflection` → L5、L9 改变（没有反思就没有 Morrow 兴趣，也没有 finding）

每个臂都真的改变了执行路径；没有出现"关了模块但行为不变"的空消融。注意：这只是 scripted provider 下的接线差异，不证明真实模型质量。
