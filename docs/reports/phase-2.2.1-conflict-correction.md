# Phase 2.2.1 — 冲突与纠正

## 1. 系统层

| 机制 | 位置 | 证据 |
|---|---|---|
| 同主题分组 | `MemoryContextAssembler.assignConflictGroups` | 两条同主题 → 同一 `conflictGroup`，不同主题不分组 |
| 冲突指令 | 请求 instruction | `conflictGroup may contradict: ask which is current` |
| 明确纠正 | `MemoryService.correct` + revision | `v2-correction-current`：请求含杭州、不含上海 |
| 撤回 | SQL `status='active'` + 装配过滤 | `v2-retracted-context`、`retracted-old-value` |
| 删除 | `DELETE` + `deletion_journal` | 既有 `drops a deleted memory on every route` |

系统层能证明的是：双方都被送达、关系被标注、纠正后的旧文本不再出现。

## 2. 模型层（真实运行）

clean 运行 `20261027T064032Z-2132d7`，代码 `c0d27ca`：

| 用例 | 判定 | 回复 | 归因 |
|---|---|---|---|
| `v2-conflict-group` | **fail** | 「你住在上海。」——只选一边 | `delivered_but_not_used` |
| `v2-correction-current` | **fail** | 「你住在哪个城市？」——反问，未用纠正值 | `delivered_but_not_used` |
| `v2-elliptical-context` | pass | 提到杭州 | — |

`notDelivered = 0`。冲突双方与纠正值都进入了请求，模型没有使用。

## 3. 本轮新增覆盖

| 场景 | 状态 |
|---|---|
| 两条有效记忆给出不同值 | 系统层已测；模型层 fail（1 次） |
| 用户明确纠正旧值 | 系统层已测；模型层 fail（1 次） |
| 不同时间段的两条记忆 | **未验证** |
| 不同对象的两条相似记忆 | **未验证** |
| 明确陈述 vs 模型推断 | **未验证** |
| 用户表示不确定 | **未验证** |
| 冲突一方已撤回 | 系统层由撤回过滤覆盖；模型层未单独运行 |

## 4. 结论

- 系统层：冲突关系可追踪，纠正/撤回边界成立。
- 模型层：冲突披露与纠正遵循**失败**，且只有 1 次运行，不能推断稳定性。
- 不能把「指令送达」当作「模型理解冲突」。

## 5. 未完成

- 上述 5 个未验证场景需要独立数据集与重复运行。
- 无独立人工复核。
