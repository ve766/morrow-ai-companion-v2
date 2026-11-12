# Stage 3 最终门槛矩阵（独立审计）

- 审查 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`。状态口径：PASS / PARTIAL / FAIL / BLOCKED / NOT_RUN / NOT_IMPLEMENTED，非 PASS 不计入通过率分子。
- 证据缩写：[Acceptance] = docs/audit/stage-3-independent-final-acceptance.md；[Lineage] = docs/audit/stage-3-runtime-and-data-lineage-review.md；[Repro] = docs/reports/stage-3-reproducibility-log.md；[Defects] = docs/reports/stage-3-open-defects-and-blockers.md。

## 门槛 A：工程真实性

| 项 | 状态 | 证据 |
|---|---|---|
| A1 基线与祖先关系 | PASS | head 领先 base 33 提交、0 落后、merge-base=base tip（8467079），base 未变；PR OPEN/MERGEABLE [Repro §1] |
| A2 TypeScript | PASS | `npx tsc --noEmit` 退出码 0（审查 SHA 复跑，11.4s）[Repro §2] |
| A3 全量测试 | PASS（注记） | 95 文件中 94 过、**888/888 断言全过**；1 个文件（offline-evaluation.test.ts）因本机 esbuild 无法写 %TEMP% 而无法装载——TEMP 重定向后 6/6 过、CI 同 SHA 双平台绿，判环境缺陷 [Repro §2/§6] |
| A4 构建 | PASS | `npx electron-vite build` 退出码 0 [Repro §2] |
| A5 主评测套件 | PASS | 审查 SHA 复跑 15 PASS / 1 NOT_RUN（L15 按设计由纵向运行器承担），**首次绑定 5fe62f54**（`evals/stage-3/results/20261101T045020Z-5fe62f5.json`，未入库，工件见 [Repro §2]） |
| A6 消融 | PASS | 4 臂：no_growth→L4/L12 FAIL、no_exploration→L5 FAIL、no_reflection→L5/L9 FAIL——逐模块真实承重（`evals/stage-3/ablation/results/20261101T045045Z-5fe62f5.json`） |
| A7 纵向 | PASS | 注入时钟、标注 `clock: injected` + clockNote、正例真实发生（day1 raised=1）、冷却 +1h 拒/+7h 许、半衰 fresh=3/aged=1.5（复跑 PASS） |
| A8 重启 | PASS | 同文件重建完整运行时、非零漂移前置守卫、撤回级联出 payload（复跑 PASS） |
| A9 长对话 | PASS | 30 轮/3 会话（复跑 PASS） |
| A10 C1 机制套件 | PASS | 22 场景/88 断言全过，绑定 5fe62f54（复跑） |
| A11 Electron 冒烟 | **CI PASS / 本机 BLOCKED** | run 41270227620/41270251780（5fe62f54，3 job 全 success，15 步冒烟含真实 Electron）；本机渲染进程启动即崩 0x80000003（--no-sandbox 下 0xC0000005），另见 esbuild %TEMP% 写拒绝 [Repro §6] |
| A12 结果文件绑定 | **PARTIAL** | 仓库内旧结果：主套件最新绑 b0e719a（早于 C1/迁移 v36-38）、C1 有效结果绑 6ae4520、6 份 `codeCommit:"unknown"`（BLOCKED，不作 HEAD 证据）；live 结果绑 6a885fa。**审查复跑前无任何结果绑定 5fe62f54** [Defects D-2/D-3] |

## 门槛 B：认知有效性（真实生产路径）

| 能力 | 状态 | 证据 |
|---|---|---|
| B1 C1 语境/意图理解 | 机制 PASS / 语义 BLOCKED | 机制：22 场景走真实发送链、只记哈希、变异必须使判定移动（A3 假绿修复含 `个函数`/`张图` 形态守卫）；语义：`BLOCKED_NO_SECRET`（两份记录在案）[Repro §3] |
| B2 记忆连续性 | 机制 PASS / 模型层 PARTIAL | 撤回/纠正/删除/重启/跨会话均有链路级测试（L1/L2/L3/L11/L12/restart）；真实转写暴露轮 13（已投递未使用）与轮 31（跨会话检索零命中→自信否认）[Acceptance §5] |
| B3 Morrow 自身兴趣 | 机制 PASS / 真实 NOT_RUN | 证据行级 origin 硬隔离、按侧晋升、反证降级 [Lineage §4]；L5 全链 12 断言过；真实运行 morrowInterests=0（缺口 1<3）；"模型提问→候选"生产者不存在（P0-3） |
| B4 人格身份与成长 | **G2 PASS / G1 FAIL** | 身份基线只有用户写路径；G2 交互画像：双向证据（L4）、删除重算（L12）、重启连续（restart）、进 payload（effectiveProfile+describe）；**G1 台账不可达+无读者（死代码）**，`effective_d=baseline+growth_offset` 未实现 [Lineage §2][Defects D-1] |
| B5 内在状态 | PASS | 更新事务化+幂等+重放；真实消费：检索放宽（有界）、prompt 引导、反思 bias 证据；不参与探索排序/人格；无数值外泄 [Lineage §7] |
| B6 反思 | **PARTIAL** | 游标增量、限频、恰好一次、7 类候选；兴趣候选→payload 链成立（L5）；**其余 findings 无 prompt 消费者；自动路径不进 pending items（仅手动 IPC）** [Lineage §6][Defects D-10/D-11] |
| B7 长期目标 | 机制 PASS | 对话创建→下轮 payload→完成消失→含糊仅候选；owner 三分；过期/源删除级联（L10 复跑 PASS）[Lineage §5] |
| B8 自主探索 | 机制 PASS / 真实 NOT_RUN | 状态机 9 态、(turn_id,state) 幂等、预算原子预留、uncertain 单列、失败/取消释放；负例单测 20 条；真实运行 attempted=0/raised=0；**`user_rejected` 无写入路径** [Lineage §3][Defects D-4] |
| B9 语音 | **NOT_IMPLEMENTED** | src/ 无任何 ASR/TTS/录音代码 [Lineage §10] |

## 门槛 C：真实互动质量

| 项 | 状态 | 证据 |
|---|---|---|
| C1 契约与凭据 | BLOCKED_NO_SECRET | 契约要求 `spark-x2.6` @ `/v2/chat/completions`、`MORROW_TEST_API_KEY`；环境探测：变量未设置、`.tmp/` 不存在、无凭据文件 [Repro §3] |
| C2 审查 SHA 上真实重跑 | BLOCKED_NO_SECRET | 可直接复跑命令：`MORROW_TEST_API_KEY=… npm run eval:stage3:live`（凭据须由维护者在本机安全注入，不得粘贴于聊天/GitHub） |
| C3 既有真实证据 | PASS(9/10)+1 FAIL+NOT_RUN（绑定 6a885fa） | spark-x2.6、32 轮/3 会话、0 失败轮；唯一 FAIL=风格证据门槛（signals 2<3，offsets 恒 0）；Morrow 兴趣 NOT_RUN；**早于 C1 主链改动（a0405cd..9ac4bd5），不能证明最终 HEAD** [Defects D-3] |
| C4 人工质量复核 | **AI 独立审阅完成 / 真人复核 PENDING** | 审查者逐轮审阅 32 轮转写：13 处 PASS 证据、3 处 FAIL/弱点（轮 13、轮 31、风格脱节）[Acceptance §5]；性质是对既有证据的阅读，真人复核仍未发生（三份 live 文件 manualReview 均 PENDING） |
| C5 校准 | NOT_RUN | 无标注集，`calibration.measured=false`（entry-brief 自认） |

## 门槛 D：平台与产品

| 项 | 状态 | 证据 |
|---|---|---|
| D1 GitHub Actions | **PASS（新事实）** | run 41270227620 + 41270251780 @ 5fe62f54（2026-11-01T03:42，pull_request）：ubuntu/windows 冒烟 job（15 步）与 Windows 升级路径 job（9 步）全部 success——**开发者文档仍写"CI BLOCKED（计费）"，已过时** [Defects D-6] |
| D2 Electron renderer | CI PASS / 本机 BLOCKED | CI 真实 Electron 冒烟双平台过；本机 0x80000003（--no-sandbox 后 0xC0000005）复现，判环境 [Repro §6] |
| D3 Windows 安装/升级/卸载 | NOT_RUN | NSIS 配置存在、`scripts/windows-alpha-install-acceptance.ps1` 存在、无干净授权机器执行记录；升级路径仅 CI 迁移测试级 |
| D4 语音 | NOT_IMPLEMENTED | 同 B9 |
| D5 CI 对 stage-3 套件的覆盖 | **PARTIAL** | CI 只跑 stage-1/2 离线评测（`npm run evaluate`/`evaluate:cognition`），**不跑任何 eval:stage3\* 套件**——stage-3 回归依赖开发者或审查者本地执行 |

## 整体

- 全部强制门槛中：真实互动质量 BLOCKED、认知有效性 PARTIAL（D-1/D-9/D-10）、平台 PARTIAL（Windows/语音）。
- **整体：NO-GO**（Stage 3 不得标记完成；PR #19 不具备合并条件）。依据任务 §5 决策规则，无需叠加即已禁止整体 PASS；结构性缺口与修复顺序见 [stage-3-final-decision.md](stage-3-final-decision.md)。
