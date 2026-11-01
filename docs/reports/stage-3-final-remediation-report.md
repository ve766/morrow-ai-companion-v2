# Stage 3 最终修复总报告（D-1～D-13）

- 任务：Issue #22（2026-11-01T05:14Z），修复独立审计列出的 13 项缺陷，24 小时时限。
- 修复分支：`feat/stage-3-long-term-companion`（PR #19 保持 OPEN、未合并，base 不变）。
- 修复起点：审计文档 HEAD `4dd0d7c0af6a2f16ddc303470640e78b5aedd25a`（业务代码基线 `5fe62f54`）。
- 状态口径：FIXED / BLOCKED / NOT_APPLICABLE；每项附代码、测试与评测证据，详见 [stage-3-remediation-evidence-index.md](../audit/stage-3-remediation-evidence-index.md)。

## 逐项状态

### D-1 G1 人格成长死链 — FIXED
根因（审计确认）：`growth.apply` 唯一调用点在不可达的 `onTurnCompleted` 回退钩子；effectiveProfile 只读 G2。
修复：outbox `growth` 投影器按 D-1 目标架构同时写 G1（`personality_growth_signals`）与 G2（`user_interaction_signals`），各自以 `(dimension, turn_id)` 幂等；`effectiveProfile` 改为 `applyGrowth(baseline, growth.list())`——prompt 人格三数值来自 G1 折叠；prompt 头部与 context block 分别标注 Morrow 证据形成倾向与用户沟通适配，禁止混写；删除不可达回退（替换为诚实降级信号）；新增 IPC `personalityGrowthGet/Rollback`（诊断与用户回滚）。公式不变（±8、45 天半衰、3 独立回合），理由：复核未发现公式错误（见 [personality-growth-runtime-v2.md](../algorithms/personality-growth-runtime-v2.md)）。
证据：`src/app/stage3-remediation.integration.test.ts` 六项（outbox 写入/prompt 数值=G1 fold/3 轮门槛与 2 轮不移动/删除重算/回滚/跨重启连续）。

### D-2 结果绑定 — FIXED（流程）
所有新结果在 git checkout 内产出并绑定完整 SHA；`codeCommit:"unknown"` 的六份旧文件保留但不再被任何文档引用为当前证据（本报告与证据索引全部指向新 SHA 结果）。CI 中 Stage 3 套件失败即 job 失败。

### D-3 live 证据早于 C1 改动 — FIXED（已重跑）
真实 spark-x2.6 在**修复后 SHA**上重跑：`eval:stage3:live`（32 轮/3 会话）与 `eval:stage3:intent:semantic`（6 场景/8 轮），结果文件绑定新 HEAD，见证据索引（数字在结果文件与本索引 §5）。

### D-4 user_rejected 不可达 — FIXED（诚实移除）
无提案 UI → 按任务"最小真实方案"移除：状态机类型、`markUserRejected`、迁移 v39 重建 `exploration_events` CHECK（历史行不含该值，升级不丢数据），测试断言新 CHECK 拒写死状态。扩展点：未来加提案 UI 时以新迁移恢复。

### D-5 检索与使用层 — FIXED
三层修复：①查询理解——fact-slot 疑问/口语形（住哪/搬去）+ 三处疑问词表纳入裸"哪"；②三通道召回（lexical/slot/value）+ RRF(k=60) 融合，被点名的争议事实与查询断言冲突的存储事实不再被策略隐藏；③使用层——固定原则新增"检索到的优先核对、缺失/冲突即澄清"，TurnEvaluation 增加 `memoryUse` 值级 trace。新回归套件 `eval:stage3:memory`（10 场景，recall@1/MRR=1.0）覆盖真实运行轮 13/31 同型。详见 [memory-retrieval-and-use-v2.md](../algorithms/memory-retrieval-and-use-v2.md)。

### D-6 文档矛盾 — FIXED
七处逐一处理：live 断言计数订正为"10 断言 9 过 1 败"（本报告 §错误计数说明）；G1 生产者表述以本报告与 v2 算法文档为准；S3-01 PASS 成立（registry 陈旧行加订正注记）；Electron 状态分层记录（CI 双平台 PASS / 特定本机 0x80000003 环境 BLOCKED）；CI 状态以 run 41270227620/41270251780（5fe62f54 全绿）+ 本轮 CI 为准，"计费阻断"注记 superseded；delivery-report §6.1 vs §8 冲突以 §8（v2 生命周期已实现）为准并加注。各受影响文档头部/尾部加 "superseded/订正" 注记，不改写历史正文。

### D-7 版本回退 — FIXED（package.json/lock 回到 2.0.0）

### D-8 注释漂移 — FIXED（memory-importance 头表 R 行改指 evidence ledger DISTINCT independence_group）

### D-9 L6 重写 — FIXED（scripted 层）
八类施压矩阵（P1 附和被反驳事实/P2 偏好当事实/P3 无证据索要确定答案/P4 证据支持用户/P5 证据支持异见/P6 观点当事实/P7 改写核心原则/P8 有效纠正）全部走生产链；断言只及机制可证者（原则与基线存活、观点不入库、成长台账不动、证据按策略投递、无迎合注入），语言质量与真实抗迎合由 live runner 逐场景评测（本轮已运行，见证据索引）+ 真人复核（PENDING）。PARAMS_VERSION 升 v3。旧"prompt 字符串存在性"断言删除。

### D-10/D-11 反思消费 — FIXED
路由注册表（7 类，无回退）+ `reflection_finding_routes` 持久化（v39）+ 唯一摄入路径（自动投影器与手动 IPC 同一 `ingestRun`）+ prompt 注入 ≤2 条带 provenance/TTL/非事实框架 + pending items `decide(accepted/rejected/dismissed)`（IPC + renderer 待确认面板），拒绝持久化且同 dedupe key 不复活。详见 [reflection-routing-v2.md](../algorithms/reflection-routing-v2.md)。

### D-12 巩固/衰减调度 — FIXED
`MemoryMaintenanceScheduler`：启动 catch-up + 6h 间隔 + 绝对时间门（`memory_maintenance_state.last_run_at`，休眠/崩溃不可能重复施加衰减——每次从证据台账重算）+ 单实例互斥（同事务 claim）+ 失败记录与重试 + before-quit stop + 可注入时钟。保护逻辑留在 `archiveBelow`（pin/边界/纠正豁免）；归档≠删除语义不变。

### D-13 CI 覆盖 — BLOCKED（推送凭据 scope）
变更已完成并本地验证（七套件命令逐条退出码 0、结果绑定 SHA、失败即失败），但本机 gh 凭据 scopes 为 gist/read:org/repo——**无 workflow scope，GitHub 拒绝任何改 `.github/workflows/ci.yml` 的推送**（远端逐字拒绝，重试 8 次同因）。完整 diff 保留于 `docs/reports/stage-3-ci-workflow.patch`，解锁步骤：
1. `gh auth refresh -h github.com -s workflow`
2. `git apply docs/reports/stage-3-ci-workflow.patch && git commit && git push`
其余 Stage 3 套件已全部在本机以退出码 0 验证（证据索引 §3）；此阻塞不涉及任何业务代码，也不影响 D-13 的技术内容正确性。

## 迁移与兼容

- v39 `exploration-states-and-finding-routing`：重建 exploration_events（CHECK 移除 user_rejected，行保留）、新增 reflection_finding_routes、memory_maintenance_state。
- 升级测试：`migrations.test.ts` v39 用例（v38 库→升级→行保留→新 CHECK/约束生效）；全迁移谱系测试随 CURRENT_SCHEMA_VERSION 自动覆盖 v1→v39。
- 回滚策略：代码回滚至 v38 兼容——v39 新表对旧代码不可见即忽略；exploration_events 重建保持列集不变，旧代码读新表无差异；**无破坏性变更，不需要数据清除**。

## 错误计数说明（对审计发现的订正）

审计指出旧文档把 live 断言计数写成 "8/9"。真实结果文件为 **10 条断言、9 PASS、1 FAIL**（风格证据门槛）；本轮修复后 live 重跑的新计数以 `evals/real-provider/results/` 最新文件为准。

## 未完成项（如实）

- 真人人工复核：PENDING（复核包已生成于 `evals/real-provider/review/`，待维护者执行；AI 审阅不冒充）。
- 语音：NOT_IMPLEMENTED（按任务 §0-4 留待独立阶段）。
- Windows 安装/升级验收：NOT_RUN（无干净授权机器；迁移谱系测试与 CI 升级路径 job 除外）。
