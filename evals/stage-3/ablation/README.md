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
