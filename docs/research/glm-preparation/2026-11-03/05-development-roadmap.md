# Morrow 后续研发路线与阶段任务草案（工作包 E）

- 依据：工作包 A（01 能力全景）、工作包 B（02 缺陷审计）、工作包 C（03 算法研究）、工作包 D（04 评测蓝图）、工作包 F（06 Agent 评审）的证据
- 基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`
- 性质：**建议草案**。不创建后续开发 Issue、不派发实现任务、不修改现有 Issue；每个阶段的正式任务书仍需人工确认后另行发布
- 排序原则（唯一推荐顺序，产品原则不可改变）：① 产品交付与遗留 Bug 收口 → ② 基础文件能力补全（无自主 Agent）→ ③ 核心认知算法升级 → ④ 真人体验与 Provider 质量评测 → ⑤ 伴侣本体验收后启动 Agent 准备
- 纪律：每个子阶段 ≤24 小时独立完成；阶段间显式依赖；每阶段有停止条件与回滚；不把全部工作塞入单个超大阶段

---

## 总览

| 大阶段 | 子阶段 | 交付物 | 依赖 |
|---|---|---|---|
| ① 交付收口 | 1A 确认闭环（Issue #37）、1B 数据可靠性、1C 体验小修、1D 可观测闭环 | PR（base=release 分支）×4 | 无 |
| ② 文件能力 | 2A 导出、2B 导入、2C 数据文件管理 | PR ×3 | ①完成 |
| ③ 认知算法 | 3A P1 批、3B 语义召回、3C/3D P2 批 | PR ×4 + 消融报告 | ①完成（3B 依赖 4A 的评测集先行） |
| ④ 评测与真人 | 4A MES 骨架、4B live 收口、4C 真人盲评、4D 安装验收进 CI | PR ×4 + 盲评报告 | 4A 可与②并行；4B/4C 依赖①③ |
| ⑤ Agent 准备 | 5A PR#38 修订冻结、5B A0/A1 门槛检查 | 修订 PR + 检查清单签署 | **①②③④全部关闭后**才允许 5B |

---

## 大阶段 ①：产品交付与遗留 Bug 收口

### 子阶段 1A：Stage 4 确认闭环（即 Issue #37 任务本体，建议原样执行）

- **目标**：关闭 BL-01/BL-02/BL-03（02 文档 §1）+ 连带 AUD-01/02/07。
- **范围**：reflection-routing 注册表补 open_question（route=pending_user）；decide 事务内回写 route 行 + 审计事件；ingestRun 包事务；goal candidates 三层接线（IPC/preload/renderer 轻量确认区）；startup 反思补 ingestRun。
- **非目标**：不重构人格/情绪/记忆算法；不引入 Agent/新 Provider/新数据库。
- **代码证据/文件定位**：`src/cognition/reflection-routing.ts:32-40,58-94,153-173,227-278`；`src/cognition/pending-items.ts:299-302`；`src/persistence/cognitive-context-repository.ts:131-202`；`src/motivation/companion-goal.ts:271-349`；`src/app/index.ts:383-384,447-452`；`src/shared/contracts.ts:57-65`；renderer `pending-ui.ts`。
- **架构/数据契约**：状态机 `open→done|dropped`（item）与 `routed→rejected|dismissed|consumed`（route）在同一事务内收敛；幂等键沿用 dedupe_key；终态后相反决策返回 conflict。
- **公式/伪代码**：见 Issue #37 §1.2 状态转移表（本文件不复制，引用之）。
- **调用链/状态变化**：decidePendingItem IPC → PendingCognitionService.decide → [transaction: pending item 终态 + route 行终态 + event_journal]。
- **持久化/事务/权限/审计**：全部写入走现有 repository 事务；IPC 输入 schema 校验；审计只记 ID/状态/时间/decision。
- **失败恢复/回滚**：迁移不需要（无 schema 变更）；事务失败整体回滚。
- **测试命令**：`npx tsc --noEmit`、`npx vitest run`、`npm run build`、`npm run eval:stage3`；新增 Issue #37 §4 测试矩阵。
- **报告路径**：`docs/reports/stage-4-companion-confirmation-closure-report.md`（Issue #37 已指定）。
- **依赖/风险/停止条件**：无前置依赖。风险：route 终态命名需与 CHECK 约束对齐（migrations.ts:2208 已允许 rejected/dismissed，无需迁移）。停止条件：若 acceptCandidate 源消息校验语义与 UI 期望冲突，停下来交人工决策，不得绕过 service 写表。

### 子阶段 1B：数据可靠性修复

- **目标**：AUD-04（备份恢复撤回边界修订号错位）、AUD-08（intent_readings 删除残留）、AUD-14（伪 degraded 事件）、AUD-15（删除无审计）。
- **代码证据**：`src/persistence/backup-service.ts:82-102,396-427`；`src/persistence/migrations.ts:2128-2156`；`src/memory/memory-service.ts:418-421`。
- **契约**：边界重放后 `memories.revision` 必须与 `MAX(memory_revisions.revision)` 一致（不变式 + 迁移内一次性校正既有库）；intent_readings 增加 `AFTER DELETE ON conversations` 触发器（新迁移 v48）；记忆删除新增 `memory.deleted` 审计事件。
- **实现顺序**：AUD-04 修复+校正逻辑 → 触发器迁移 → 删除路径去 reindexFact → 审计事件。
- **测试**：恢复→撤回→confirm 全链（新增）；迁移重跑 no-op；删除审计事件断言。命令同 1A。
- **报告路径**：`docs/reports/data-reliability-fixes-report.md`。
- **风险**：v48 迁移必须可重跑、事务化、失败保持原库可恢复（沿用 v42 先例）。停止条件：校正脚本在真实用户库上影响行数异常时中止。

### 子阶段 1C：体验小修包

- **目标**：AUD-05（Spark UI 卡片）、AUD-13（pending 决策失败提示）、AUD-27（模型文案统一）、AUD-26（死常量合并）、一行类 P3：AUD-16/24/31/36。
- **代码证据**：`companion-ui.ts:110,116-119,137-139`；`pending-ui.ts:66-69`；`shared/companion.ts:6`；`personality-growth.ts`（无需改，仅 AUD-22 记录不修）；`reflection-service.ts:449`；`companion-goal.ts:121-130`；`validation.ts:~241`；`vitest.config.ts:8`。
- **测试**：仅启用 Spark 的 renderer 门控单测（新增）；其余回归全量。
- **报告路径**：`docs/reports/ux-small-fixes-report.md`。
- **风险/停止条件**：低。若 Spark UI 暴露引出新的 provider 信任问题（如模型 id 自由输入），停在白名单现状并上报。

### 子阶段 1D：可观测性闭环

- **目标**：AUD-33（event_journal 用户可读出口）、日志落盘选项、AUD-30（logger msg 脱敏）、AUD-28（主库 0600）。
- **范围**：新增只读 IPC 通道 `journal:list`（分页、脱敏、默认最近 200 条）+ 设置页"活动记录"面板；日志文件开关（默认关，开启后写 userData/logs 按天轮转、复用现有脱敏）；logger 对 msg 同样应用 redact。
- **测试**：IPC 权限与脱敏断言；轮转测试。
- **报告路径**：`docs/reports/observability-closure-report.md`。
- **停止条件**：审计原文级别取舍（只出元数据 vs 出文本）若与隐私原则冲突，交人工。

---

## 大阶段 ②：基础产品能力补全（文件能力，无自主 Agent）

**共同边界**：所有文件操作都是**用户显式发起**（按钮→系统对话框），主进程执行，renderer 不传路径；不引入任何模型/Agent 驱动的文件写入；复用现有三处 fs 纪律（0600、原子写、路径白名单）。

### 子阶段 2A：对话与记忆导出

- **目标**：单会话导出 Markdown、全量记忆导出 JSON/Markdown（用户点按钮 + showSaveDialog）。
- **代码定位**：复用 `backup-service.ts` 的 dialog+原子写模式；数据读取走现有 repository 只读方法。
- **契约**：导出文件含 manifest 头（版本/时间/SHA）；敏感记忆默认排除，包含需勾选+确认；导出不写库（纯读）。
- **审计**：`memory.exported` / `conversation.exported` 事件（只记数量不记内容）。
- **测试**：导出内容快照测试；敏感排除断言；命令同前。
- **报告路径**：`docs/reports/export-capability-report.md`。
- **停止条件**：涉及第三方云上传的任何提议直接拒绝（超出本阶段边界）。

### 子阶段 2B：记忆批量导入

- **目标**：从导出的 JSON 导入记忆（逐条走 `memory_suggestions` 审核流——**导入内容一律按 L5 模型推断同级对待**，用户逐条/批量确认后才成 L4）。
- **契约**：导入文件 schema 校验（版本/字段白名单）；`source_category='imported'`（新枚举值，迁移 v49 + CHECK 更新）；重复检测复用 normalizedMemoryKey。
- **测试**：schema 拒绝用例；重复合并；审核流端到端。
- **报告路径**：`docs/reports/import-capability-report.md`。
- **风险**：新枚举值对既有 CHECK/查询的影响面排查（fact-slot、统计查询）。

### 子阶段 2C：备份文件管理

- **目标**：备份目录内列出历史备份（manifest 解析）+ 删除旧备份（确认对话框 + 仅限 Morrow 自产文件名模式）。
- **代码定位**：`backup-service.ts:190-223` 目录约定 `Morrow-Backup-*`；删除仅匹配该模式（路径白名单哲学同 `secrets.ts:101-103`）。
- **测试**：模式外文件拒绝删除；损坏 manifest 处理。
- **报告路径**：`docs/reports/backup-management-report.md`。
- **停止条件**：用户选择非 Morrow 目录时的行为交人工定义（建议只读提示）。

---

## 大阶段 ③：核心认知算法升级

**共同前置**：MES 骨架（4A）先行提供回归锚——03 文档 P1 项中有 4 个是"评测先行的正确性修复"。

### 子阶段 3A：P1 算法批（正确性修复型）

- **目标**：A2-b 矛盾对独立 RRF 通道、A2-d 检索上限观测、A6-a 反思循环切断、A1-c 显式对话状态。
- **代码定位**：`memory-context-assembler.ts:349`（加第五通道）、`memory-service.ts:166`（截断观测）、`reflection-routing.ts`（injected_turn_id 集合传入 producer 过滤）、新表 `conversation_dialogue_state`（迁移 v50）+ outbox projector。
- **公式/伪代码**：见 03 文档 §1 A1-c、§2 A2-b/A2-d、§6 A6-a（本文件不复制）。
- **契约**：对话状态属新 L3.5 层（派生状态，可随时重建——由 outbox 重放或维护调度重建）；不参与任何升格。
- **失败恢复**：状态表损坏 → 重建任务（reindex 模式同 `factMemory.reindexAll()`）。
- **测试**：MES-MEM-003/006、MES-CTX-002 转绿；deterministicReplay 保持；全量回归。
- **报告路径**：`docs/reports/cognitive-p1-batch-report.md` + `evaluation/reports/`消融结果。
- **风险**：A1-c 是四项中唯一带新 schema 的，若 24h 内含迁移+投影+测试超载，允许拆出 A1-c 单独成阶段（3A 只做三项一行级/小改动）。

### 子阶段 3B：本地语义召回（独立产品决策点）

- **目标**：A2-a 第五通道，**开关默认关**；提供评测证据后由人工决定默认值。
- **前置**：4A 的 MES-MEM-001（改写召回集）已建成并有 baseline 数字。
- **范围**：ONNX 本地模型打包（+40MB 体积评估）、`memory_embeddings` 表（迁移 v51）、create/confirm/correct 同步嵌入、维护批量补嵌、检索 only-if-empty 准入。
- **隐私约束**：本地推理不出网；向量与文本同敏感级存储；consent ceiling 逻辑不变。
- **回滚**：feature flag 关闭即回到四通道；表保留无害。
- **测试**：MES-MEM-001/002 + M3 全套 + 泄漏门禁；体积/耗时基准。
- **报告路径**：`docs/reports/semantic-recall-decision.md`（含推荐与反方观点）。
- **停止条件**：CPU 推理 P95 >100ms 或精度增益 <5pt recall → 不合并，记录决策依据。

### 子阶段 3C/3D：P2 算法批

- **3C（情绪与表达）**：A4-a 情绪惯性（衰减公式分档）、A4-c 标签映射、A4-d 响应侧信号规则。测试：MES-EMO-001 + stage-5 回归。
- **3D（判断与反思）**：A6-b producer 命中率校准、A6-d open_question producer（若 1A 未含）、A7-a 判断矩阵（收拢现有启发式为显式表）、A7-b 拒绝分类学、A7-c 澄清节流。测试：MES-CONF + expression 相关回归。
- 报告路径：`docs/reports/cognitive-p2-batch-{emo,judge}-report.md`。
- **停止条件**：任何主观盲评维度劣化（stage-5 回归）→ 该项单独回滚。

---

## 大阶段 ④：真人体验与 Provider 质量评测

### 子阶段 4A：MES v2 骨架与首批 15 样例

- **交付**：`evals/mes/` 目录（schema 校验器 + runner 复用 stage-3 harness）、15 样例（04 文档 §6）、baseline 结果入库、CI 接入第一类（MES-MEM/SEC）。
- **测试命令**：`npm run eval:mes`（新 script，esbuild 两段式照现有模式）。
- **报告路径**：`docs/reports/mes-v2-bootstrap-report.md`。
- **依赖**：无硬依赖，可与②并行。

### 子阶段 4B：live Provider 质量收口（AUD-37）

- **目标**：用第二真实 Provider 重跑 final-closure-live 8 场景；修复现有 FAIL 的具体原因（需先诊断：是剧本断言过严还是真实行为缺陷）；主观项全部转人工评审队列。
- **报告路径**：`evaluation/reports/live-closure-<date>.json` + 人工评审表。
- **停止条件**：无有效 API key → 如实 BLOCKED，不得用 mock 顶替。

### 子阶段 4C：真人盲评轮

- **交付**：≤30 段对话转写（剥离 modelId）、≥2 评审人、Krippendorff's α 校验、`docs/reports/human-blind-review-<date>.md`。
- **停止条件**：评审人不足 → PENDING_HUMAN 如实登记。

### 子阶段 4D：安装/升级验收进 CI（AUD-38）

- **交付**：windows-install-acceptance job（tag 触发 + 手动触发）；首次在 CI 产出 NSIS 包 + smoke --verify-upgrade 证据。
- **风险**：CI runner 上 NSIS 静默装需要管理员上下文——若不可行，退化为本地脚本+上传产物证据，但必须把 NOT_RUN 状态消除。

---

## 大阶段 ⑤：Agent 准备（伴侣本体验收后）

### 子阶段 5A：PR #38 修订与冻结

- **交付**：06 文档 §7 的三处修订（ADR-010 前置声明、§7.3 合并标注、ADR-004 审批单轨）+ §2 复用清单补 tool-registry.ts；架构文件头部加"参考规格，非开工依据"。
- **性质**：纯文档 PR，不改代码。

### 子阶段 5B：A0/A1 启动门槛检查（只做检查，不实现）

- **门槛清单**：①②③④全部子阶段关闭；PR #35 人工验收三项（真人盲评/第二 Provider live/真机安装升级）PASS；BL-01/02/03 关闭；MES 硬门禁在 baseline 全绿。
- **产出**：签署式检查清单（每项附证据链接）；通过后才允许发布 A0/A1 实现阶段任务（另行起草，不在本文件范围）。
- **停止条件**：任何门槛未关 → 保持 Agent 不启动（产品原则）。

---

## 全局风险与跨阶段原则

1. **每阶段一 PR、base=release 分支**（或后续主干分支），不混装；报告与证据索引随 PR 提交。
2. **迁移纪律**：新迁移一律可重跑、事务化、升级前 VACUUM 备份（现有机制）；版本号从 v48 顺序分配。
3. **评测先行**：③类改动必须有 4A 的回归锚在手才动手；先登记预期失败再转绿。
4. **人工验收不冒充**：PENDING_HUMAN/NOT_RUN/BLOCKED 不得写成 PASS（全阶段适用）。
5. **总时长估计**：①约 4 个工作日、②约 3 天、③约 5-6 天、④约 4 天（4C 受评审人时间约束）、⑤检查 0.5 天——全部为并行可压缩的独立 24h 单元。
