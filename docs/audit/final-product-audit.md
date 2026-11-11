# Morrow V2 最终产品全仓审计（Issue #33/#34）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`release/morrow-v2-final-delivery`（自 PR #30 head `b4d3bd4` 延续）
- 审计基线：代码 SHA 见交付报告（本文件行号对应最终 release head）
- 审计方式：三个只读子代理分别审计 记忆检索 / 人格·反思·探索 / Provider·安全·迁移·打包，随后人工复核并修复确认的缺陷

## 1. 六阶段判定

| 阶段 | 状态 | 证据 |
|---|---|---|
| 1 真实对话核心 | **PASS** | 真实 spark-x2.6 12/12 客观（Stage 5 live，最终 SHA）；P01/P02 生产链 |
| 2 记忆与认知基础 | **PASS** | P03–P08 生产链；事实账本/索引/RRF；`evals/final-product/results/` |
| 3 人格、偏好与自我模型 | **PASS** | G1/G2 分离、±8 上限、45 天半衰、3 轮门槛（`personality-growth.ts:35-43,108-129`）；prompt 消费 G1（`companion-service.ts:1151-1166,2133`） |
| 4 反思、探索与受控更新 | **PARTIAL** | 反思路由/预算/冷却已验证；剩余：路由表未含 `open_question`（P2）、pending 决策状态收敛（P2，见 backlog） |
| 5 长期体验与可靠性 | **PARTIAL** | 删除/恢复/多进程并发已验证；真人自然度 PENDING_HUMAN、第二 Provider NOT_RUN、真机安装 PENDING |
| 6 Agent 操作能力 | **NOT_STARTED** | 按产品顺序保留；本任务不开发 |

## 2. 审计矩阵（发现 → 修复/处置）

| ID | 等级 | 文件/符号 | 问题 | 处置 |
|---|---|---|---|---|
| A1 | P1 | `memory-context-assembler.ts:60` `RRF_MAX` | 归一化按 2 通道硬编码，4 通道命中饱和为 1.0 | **FIXED**：按实际通道数归一化 |
| A2 | P1 | `memory-service.ts` correct 验证 | 新旧事实未绑定被纠正的 memory id，其他记忆可满足验证 | **FIXED**：`sourceMemoryId === target.memoryId` |
| A3 | P1 | `memory-service.ts:342` `pendingProvenance` | 纠正失败后 one-shot 来源残留，可能盖到后续 create | **FIXED**：`finally` 清空 |
| A4 | P1 | `interaction-profile.ts:76-89` | G2 偏移读时不衰减、删除信号后才重算 | **FIXED**：读时按账本 fold（半衰生效） |
| A5 | P1 | `companion-service.ts:840` `promptBlock()` | 反思提示未带 turn id，`injected_turn_id` 从未写入，消费追踪失效 | **FIXED**：`promptBlock(turn?.turnId)` |
| A6 | P1 | `exploration-policy.ts:87` | 直接请求回合仍可能插入自发话题 | **FIXED**：`directRequest` 抑制 + 测试 |
| A7 | P1 | `preload/index.ts:67` + `ipc.ts:269-271` | 清除口令按钮永远清 DeepSeek（本地 providerId 被丢弃） | **FIXED**：请求参数贯通 `parseProviderGetRequest` |
| A8 | P1 | `app/index.ts:271` | 降级库（<v46）启动即因 reconcile 崩溃 | **FIXED**：schema <46 跳过并告警 |
| A9 | P0 | `effect-ledger.ts` `complete/fail` | 租约被接管后旧 worker 仍可标 done（无 fencing） | **FIXED**：v47 `lease_generation`；complete/fail 带代际条件；drain `lostLease`；真实进程反例测试 |
| B1 | P2 | `reflection-routing.ts:32-40` | 路由表缺 `open_question` | backlog |
| B2 | P2 | `pending-items.ts:299-302` | 决策状态收敛为 done/dropped，`rejected/dismissed` 未落 route | backlog |
| B3 | P2 | `companion-service.ts:1248` | `getProvider()` 永不返回 spark | backlog（Spark 无 UI 配置路径） |
| B4 | P2 | `personality-growth.ts:167` | `GROWTH_MIN_CONFIDENCE` 死常量 | backlog |
| B5 | P2 | `self-model-domain.ts:190` | 兴趣晋升无时间跨度要求 | backlog（改动会破坏既有阶段证据） |
| B6 | P2 | `memory-service.ts:164-170` | 归档记忆重述不会恢复召回 | backlog（产品语义需决策） |
| B7 | P3 | 检索 | 无语义嵌入通道；词法+槽位+值+事实四通道 RRF | backlog（需嵌入服务） |

无未解决 P0。P1 全部修复并有测试（全量 1014 通过）。

## 3. 关键正面证据（按 #33 F1–F11 核验）

| 项 | 结论 |
|---|---|
| F1 来源 fail-closed | 保持 `0b9071e` 行为；`observe()` 事务内读来源+会话校验（`relationship-threads.ts:260`） |
| F2 目标化撤回 | mutation 联合类型 + clarify；19 项 Stage 5 修复测试 |
| F3 distress 语境 | 分句/否定/引用/转述/假设 + E/C 独立；22 用例 |
| F4 outbox fencing | 本次 A9 修复（v47） |
| F5 记忆原子性 | create/correct 事务内验证、rolled_back/recovery_required；Stage 4-A 修复测试 |
| F6 检索 | 四通道 RRF（A1 修复归一化）；final-closure 8 同义用例 recall@2=1.0、MRR 0.948 |
| F7 人格成长 | G1/G2 分离、门槛/上限/半衰；G2 读时衰减（A4） |
| F8 反思受控 | 路由注册表 fail-closed；B1/B2 为 P2 |
| F9 迁移/删除/恢复 | v1→current 迁移测试；v44/v46 删除传播；备份恢复+journal replay 测试 |
| F10 Provider/安全 | URL gate、loopback、SecretStore、密钥不出现在 DB/日志（smoke 断言） |
| F11 安装 | NSIS 安装包已生成；无人值守安装在本机挂起 → 真机验收 PENDING_HUMAN |
