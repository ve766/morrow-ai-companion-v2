# 最终产品 PR 整合图（Issue #33 §7 / #34 F-01）

- 仓库：`ve766/morrow-ai-companion-v2`
- 整合分支：`release/morrow-v2-final-delivery`，最终 PR base 为 `main`

## 1. 依赖图（实测，非编号猜测）

```
main (8b207b7)
  └─ feat/stage-3-long-term-companion (548d40e, PR #19, OPEN)
       └─ feat/stage-4a-companion-continuity (57d2ff3, PR #24, OPEN)
            └─ feat/stage-5-relational-presence (a889ca8, PR #26, OPEN)
                 └─ fix/stage-5-review-findings (9d54c6e, PR #28, OPEN)
                      └─ fix/stage-5-final-closeout (b4d3bd4, PR #30, OPEN)
                           └─ release/morrow-v2-final-delivery（本任务）
```

逐对 `git merge-base --is-ancestor` 核验：#19→#24→#26→#28→#30→main 全部为祖先链，
`origin/main` 是 release head 的祖先（225 个提交、695 个文件差异）。

## 2. 整合决策

堆叠链是**线性后代**：main 已包含在每个上层分支的历史中。因此不逐个 cherry-pick
（那会制造重复提交与冲突），而是把 release 分支建立在 PR #30 head 之上 ——
它已经按依赖顺序包含 #19/#24/#26/#28/#30 的全部生产代码 —— 再叠加本任务的修复与交付物，
最终以一个 PR 指向 main。没有任何 stacked PR 被直接合并进 main，历史未被重写。

## 3. 本任务提交（在 release 分支）

| 提交 | 目的 |
|---|---|
| `967f9f2` | outbox fencing：v47 `lease_generation`，complete/fail 条件化，drain `lostLease`，真实进程反例 |
| `526be27` | 审计修复：RRF 归一化、纠正验证绑定、provenance 清理、G2 读时衰减、反思 turn 追踪、探索直接请求抑制、provider IPC 参数贯通、降级启动守卫 |
| 文档提交 | 12 份固定交付物、final-product 评测结果与安装包证据 |

## 4. 原 stacked PR 处置

PR #19/#24/#26/#28/#30 全部保持 OPEN，base/head 未改、未合并、未关闭。
最终 PR 合并后它们将被 release PR 取代（由维护者决定何时标注 superseded）。

## 5. 冲突

无：release 分支是链顶后代 + 新提交，未产生任何合并冲突。
