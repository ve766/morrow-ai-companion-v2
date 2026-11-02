# 最终产品根因审计（Issue #34 F-01…F-07）

代码：`release/morrow-v2-final-delivery`；详细矩阵见 `docs/audit/final-product-audit.md`。

| ID | 结论 | 证据 / 处置 |
|---|---|---|
| F-01 堆叠链未收敛 | **FIXED** | PR #19→#24→#26→#28→#30 经 `merge-base --is-ancestor` 核验为线性后代；release 分支建于链顶，最终 PR 指向 main；详见 `final-product-pr-integration-map.md` |
| F-02 真实链路只靠载荷断言 | **PARTIAL→证据补强** | Stage 5 live 12/12 + 语境 probe 绑定 release SHA；`evals/final-product/transcripts/20261102T140416Z-526be27.md`；真人自然度 PENDING_HUMAN |
| F-03 记忆生命周期 | **FIXED / 复验** | 四通道 RRF（归一化修复）；纠正验证绑定 memory id；删除/撤回/备份恢复 P03–P08、P16 |
| F-04 人格/兴趣污染 | **FIXED / 复验** | G1/G2 分离、±8/45 天/3 轮门槛；G2 读时衰减修复；兴趣晋升/删除来源测试通过；时间跨度要求列为 P2（会改变既有阶段证据） |
| F-05 反思/探索跑题 | **FIXED / 复验** | 路由注册表 fail-closed；探索直接请求抑制修复；pending/reject 幂等测试通过；P2 追踪缺口见 backlog |
| F-06 内在状态误称情绪 | **NO NEW DEFECT** | 状态只影响策略；否定/引用/转述/假设作用域 22 用例；用户情绪不进入 Morrow 状态的既有测试通过 |
| F-07 安装/升级 | **PARTIAL / BLOCKED** | NSIS 安装包已生成（SHA-256 见索引）；无人值守安装在本机挂起，真机安装/升级 PENDING_HUMAN |

## 未解决 P0/P1

- P0：无。
- P1：审计发现的 A1–A9 全部修复（见 audit 矩阵）；无未解决 P1。
- P2/P3：路由 `open_question`、pending 决策状态、spark UI、死常量、兴趣时间跨度、归档重述、语义嵌入通道 → `docs/backlog/post-release-backlog.md`。
