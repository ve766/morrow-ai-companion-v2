# 04 · 证据、反证与信念更新

公式（v1，score 不是 probability）：

`q = min(1, 0.45 + 0.15*min(2,independent) + 0.10*min(1,uniqueRefs/4))`

`C = 100*(0.50q + 0.25*min(1,independent/2) + 0.15*recency - 0.20*counter)`

- uncertainty 只进 exploration priority，不进 C；
- independent = distinct conversation；同 turn/message 去重；
- counter>0：active → weakened；否则 conflict_pending；
- revision append-only，旧 state superseded；
- 单会话 candidate；两独立会话且 C≥55 → active。

真实：`293a5774...` candidate score70 rev1 → `b07b848d...` active score91 rev2（旧公式含 uncertainty；新公式已改，live 未重跑）。

反证生产入口：`addCounterEvidence` 新增；单测 active→weakened。live 反证未跑。
