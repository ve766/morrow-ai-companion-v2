# Morrow 研发准备总包·执行摘要（GLM，2026-11-03）

- 执行者：GLM-5.3-Flash（ZCode Coding 环境）；任务性质：只读研发准备（代码审计/架构梳理/缺陷定位/算法研究/评测设计/路线草案），**无产品源码、测试、配置变更**
- 冻结基线：`release/morrow-v2-final-delivery` @ `3812b185398c0442fcc0d0ba5b180713cafee1d9`（启动时重新核实：origin/release HEAD 与已知基线逐字节一致，无漂移；PR #35 CI 3/3 SUCCESS）
- 执行窗口：2026-11-02 23:15 – 2026-11-03（Asia/Shanghai），细节见 `work-log.md`
- 关联事项实时状态（核实于 2026-11-02 23:15）：PR #35 OPEN（RC，head=基线 SHA）；PR #38 OPEN（base=release 分支，三份 Agent 研究文件）；Issue #37 OPEN（Stage 4 收口任务）

## 一句话总结

Morrow V2 RC 的伴侣本体核心链路**实现完整、证据充分、无 P0/P1 缺陷**；结构性缺口集中在"用户确认面断链"（正是 Issue #37 的范围）、"可观测性闭环"与"规模化/真实验证"三处；后续研发建议按 ①交付收口 → ②文件能力 → ③认知算法 → ④评测与真人 → ⑤Agent 准备 的唯一顺序推进，每步 24h 可完成单元已备好草案。

## 各工作包核心结论

**工作包 A（01-runtime-and-capability-map.md）**：
- 18 个 src 模块全链路梳理完成；对话主链（幂等/锁/turn 状态机/崩溃恢复二分不重发）、五层 consent、记忆全生命周期（RRF 四通道+效用重排+重要性+巩固归档+撤回删除硬过滤）、人格三层分离（基线 IPC-only / G1 有界偏移 / G2 画像）均有完整代码证据与测试背书。
- 人格/情绪/记忆/自我模型/关系/目标**确实全部注入 Provider 请求**（拼接点 `companion-service.ts:2137-2159` + payload 断言测试），不存在"内置状态与真实请求脱节"。
- 能力矩阵（01 §12）按六态严格区分：核心能力多数"已实现+有运行证据"；关键缺环为 goal candidate 确认闭环（部分实现）、Spark UI 面（已实现缺闭环）、语义召回与文本导出（缺失）、真人盲评/真机安装验收（人工验收未完成）。

**工作包 B（02-evidence-based-audit.md）**：
- **无 P0/P1**；7 条 P2 + 34 条 P3，全部带文件:行号证据，同步登记 `evidence-index.json`（AUD-01~41）。
- Issue #37 三项复核：BL-01 仍存在（潜伏缺陷，无 producer）、BL-02 部分修复（终态防复活成立，route 行终态不同步）、BL-03 仍存在（服务完整、用户入口缺失）。
- 最值得注意的新发现：AUD-04（备份恢复撤回边界修订号错位→该记忆后续转移永久失败）、AUD-09（>1000 条记忆静默截断）、AUD-10（矛盾记忆可被挤出视野）、AUD-07（startup 反思不路由）。
- 安全面（IPC 越权/路径穿越/凭据泄漏/撤回泄漏）逐项检查**未发现问题**，检查方法已记录。

**工作包 C（03-algorithm-research.md）**：
- 七大算法逐项给出：当前实现位置与不足、候选算法、公式、参数、伪代码、复杂度、正反例、对抗输入、降级、隐私约束、新旧对比、数据结构、指标与消融、优先级。
- 统一状态契约（六层 + 升格矩阵）显式化；P1 算法四项：显式对话状态、矛盾通道、检索上限观测、反思循环切断（防自我强化）；唯一需产品决策项：本地语义召回（开关默认关）。

**工作包 D（04-evaluation-blueprint.md）**：
- MES v2 蓝图：统一场景 schema、十类评测、10 个指标公式（含分母/采样/不可比条件）、首批 15 个高价值样例（其中 4 个刻意设计为基线上预期 FAIL 的回归锚）、真人盲评与防模型自评偏差三层机制、baseline/candidate/ablation 方案。

**工作包 E（05-development-roadmap.md）**：
- 唯一推荐顺序 ①→⑤，拆分为 15 个 ≤24h 子阶段，每个含目标/范围/非目标/文件定位/契约/事务/测试命令/报告路径/停止条件。

**工作包 F（06-agent-readiness-review.md）**：
- PR #38 三份文件事实核查基本准确（16 项抽查 14 准确）；ADR 原则层值得保留且与现有代码同构（审批/租约/审计/工具注册表均有现成落点）；代码级草案应冻结为参考规格；A1 启动必须等①-④全部关闭 + PR #35 人工验收三项 PASS。

## 交付清单（九文件，全部入库于研究分支）

1. `00-executive-summary.md`（本文件）
2. `01-runtime-and-capability-map.md`
3. `02-evidence-based-audit.md`
4. `03-algorithm-research.md`
5. `04-evaluation-blueprint.md`
6. `05-development-roadmap.md`
7. `06-agent-readiness-review.md`
8. `evidence-index.json`
9. `work-log.md`

## 完成状态

**COMPLETE**（九文件齐备且非空；关键结论均有源码/测试证据；能力矩阵未将设计冒充实现；finding 区分事实/推测/待验证；七算法含公式/伪代码/边界/评测/数据契约；阶段均 ≤24h；无产品代码变更）。

遗留限制（如实声明）：
- 本机 Windows 运行 vitest 时 2 个套件因 esbuild 临时文件权限失败（环境性问题，CI 同基线全绿）；typecheck 与 1003 个测试通过。
- PR #38 分支因网络未本地 fetch，三份文件经 GitHub API（gh，PR head SHA 固定）读取原文，内容完整性以 API 返回为准。
- 行号基于基线工作树，后续基线变动需按 finding_id+符号名重新定位。
