# Stage 3 未解决缺陷与阻塞清单（独立审计）

- 审查 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`。
- 分级：P0=阻断"完成"或数据/授权正确性；P1=阻断对应能力宣称成立；P2=字面缺口/文档失实；P3=卫生问题。
- 类别：[代码] / [文档] / [评测] / [环境]。

## 缺陷

### D-1 G1 人格成长台账是完全休眠的死代码，而文档称"生产者每轮运行" — P1 [代码+文档]
- 证据：`growth.apply` 唯一调用点 `companion-service.ts:1080` 位于 `onTurnCompleted`（`:1045-1109`）；该钩子唯一调用点 `:1687` 在 outbox 分支的 else（`:1676/1684`）；outbox 只要有 selfModelLoop 必然创建（`:1131`）且投影器恒非空 → 钩子不可达（生产与评测皆然）。读取侧 `describeGrowth`/`forgetTurn`/`rollback`/`recomputeAll` 无生产调用点。outbox 的 `growth` 模块（`:782-795`）喂 `interaction.apply`（G2）。纵向结果 dayLog 十日 `{0,0,0}` 为运行时旁证。
- 文档失实处：algorithm-registry `:32`、runtime-map `:101`、gap-closure `:40` 称生产者存在且每轮运行；`companion-service.ts:717-720`、`:1787-1789` 注释把 G2 输出标为 "Stage 3 G1"。
- 影响：任务完成定义中"人格成长进入 Prompt 并影响实际回复"由 **G2** 满足，但"G1 成长台账"这一声称的实体不存在于任何执行路径；基于 G1 台账的任何后续设计（如 effective_d=baseline+growth_offset）都建立在不运行的代码上。
- 最小修复方向：二选一并如实改文档——(a) 删除 PersonalityGrowthService 与其表，声明 G2 即人格漂移的唯一实现；(b) 在 'growth' 投影器中真正调用 `growth.apply` 并让 `effectiveProfile` 读 growth 偏移，补消费者测试。责任角色：实现者。

### D-2 六份评测结果 `codeCommit:"unknown"` — P2 [评测]
- 证据：`evals/stage-3/intent-understanding/results/20261031T14*|16*`（6 份）；产出自无 `.git` 的 morrow-stage3 工作树（`head()` 回退 'unknown'，`harness.ts:252-260`）。
- 影响：按任务规则"结果不能绑定提交时标记 BLOCKED"，其中 `20261031T161448Z-unknown.json`（机制套件 22/22）被 final-verification 引用为 C1 机制证据——该引用无效。
- 已缓解：本审查在 5fe62f54 复跑机制套件（22 PASS，绑定 HEAD）；**新结果文件未入库**（本任务只允许提交审计文档），需实现者以绑定 HEAD 的运行替换unknown 文件的证据角色。
- 修复方向：结果文件一律在 git 检出内产出；无法绑定即显式 BLOCKED。

### D-3 既有真实模型证据早于 C1 主链改动 — P1 [评测]
- 证据：live 结果（876d263/ee728fd/6a885fa）均早于 `a0405cd..9ac4bd5`（speech-act/context-window/intent-reading、v38 intent_readings 进入主链）；主套件最新绑定 b0e719a。
- 影响：C1 改动直接改变每轮分析与 payload 组成，32 轮真实行为证据不能外推到 HEAD；C1 的真实模型语义验证从未发生。
- 修复方向：凭据恢复后先跑 `eval:stage3:live` + `eval:stage3:intent:semantic` 各一次并入库。

### D-4 `user_rejected` 探索状态无生产写入路径 — P2 [代码]
- 证据：`markUserRejected`（`exploration-policy.ts:355-358`）全仓无调用点；renderer 无探索提案的拒绝交互。
- 影响：F2 要求的状态之一不可达；"用户拒绝"在真实产品中无法被记账（当前用户根本看不到探索提案）。
- 修复方向：要么给用户可见的探索确认交互，要么在文档中把 `user_rejected` 从可达状态集中移除。

### D-5 真实转写暴露记忆使用层缺陷 — P1 [模型/检索]
- 证据：`20261031T085512Z-6a885fa.json` 轮 13（苏州记忆已投递 `selectedMemoryIds=[fa31af19]` 而模型称"没有可用记录"）、轮 31（"我对什么过敏来着？"检索零命中→自信否认；轮 14 同型问题命中）。
- 影响：跨会话检索不稳定 + 投递后模型层不使用，直接对应任务最关心的"记忆连续性"；失败形态是"自信地不知道"而非澄清。
- 修复方向：检索零命中且问题指向个人事实时注入"未检索到 ≠ 没有"的显式提示已有机制（P0-4），但对"投递了未使用"与"同型问题命中不稳定"无对策——需检索排序与 prompt 措辞联合调参，并在凭据恢复后复测。

### D-6 权威文档互相矛盾/陈旧（7 处） — P2 [文档]
1. live 断言计数："8/9"（delivery-report:192、correction-report:32）/"9 条 8 PASS"（evidence-index:172）vs 结果文件实为 **10 断言 9 过 1 败**。
2. acceptance-matrix:31（P1-15）"身份演化生产者仍不存在" vs registry:308/代码实况（生产者代码存在但不可达——两处各错一半，正确表述见 D-1）。
3. registry:231 "S3-01 未实现（反思把候选写成用户兴趣）" vs gap-closure:14 PASS 与 `reflection-service.ts:669/678` 代码。
4. Electron 状态漂移：delivery/acceptance/correction 写 BLOCKED（0x80000003）vs final-verification/gap-closure 写 PASS（其本机运行当时未复现）；两状态都真（不同环境），但"最后一轮"的 acceptance-matrix 未更新。
5. acceptance-matrix 引用的 C1 证据文件是已知假绿存档（6ae4520）。
6. delivery-report §6.1"记忆巩固未实现"（:139）与 §8"§2A 已实现"（:174）并存无标注。
7. 全部文档写 "CI BLOCKED（计费）"——**CI 在 5fe62f54 已全绿**（run 41270227620/41270251780）。
- 修复方向：每份固定报告加"状态截至 SHA + 已被后续纠偏否定的条目"标注；CI/Electron 状态以 run ID+日期为准。

### D-7 包版本回退 2.0.0 → 1.0.0 — P3 [代码]
- 证据：stage-3 分支 package.json/package-lock version=1.0.0；phase-2 主线已修为 2.0.0（2026-10-29 复核记录）。
- 影响：与 README/验收报告陈述冲突。

### D-8 `memory-importance.ts` 头注释与实现漂移 — P3 [文档]
- 证据：注释称重复项 R 来自 revision history，实现为 evidence ledger DISTINCT independence_group（`:196-200` vs 头注释）。

### D-9 L6 未按 F7 重写 — P1 [评测]
- 证据：`harness.ts:517-526` L6 仅两条结构断言（system 含 'Morrow' 或长度>200；不含 'always agree'）。F7 要求的对照场景（施压附和错误判断/偏好无证据/证据不足/证据支持用户/证据支持异见）、事实-观点-未知区分、礼貌异见检测均未实现；全套件与单测中亦无等价物（grep 无"施压/附和/表达不同判断"场景）。
- 影响：任务完成定义"L6 真实验证有依据的独立判断"未达成（开发者以"客观 PASS/模型层 BLOCKED"如实标注，但客观层本身过弱）。
- 修复方向：scripted 层至少断言"payload 不会被迎合要求改写原则块"之外，增加"原则块的对抗性表述在施压轮保持逐字不变 + 无'同意'标记注入"两类负例；模型层留 BLOCKED。

### D-10 反思 findings 无 prompt 消费者（兴趣候选链除外） — P1 [代码]
- 证据：`buildSelfModelContextBlock`（`:684-736`）不读 reflection_findings；自动路径丢弃 run summary（`:843-849`）；pending items 吸收仅挂手动 IPC（`app/index.ts:428-440`）。
- 影响：7 类 findings 中 5 类（memory_gap/intent_correction/bias_hint/next_turn_suggestion/consistency_note）产出后只落库，对后续回合零影响——任务 §2C"候选必须能在后续真实回合被检索并影响 payload；若未影响，应如实记录"的后半句未被任何文档满足（文档未明确记录"不进 payload"）。
- 修复方向：把 ≤2 条高置信 finding 注入 context block（带"假设，非事实"框架），或在算法登记表中把 findings 明确标为"仅审计用"。

### D-11 反思自动路径不进 pending items — P2 [代码]
- 证据：同 D-10 的挂载点差异（自动 projector vs 手动 runReflection）。
- 影响：renderer 的待确认项列表在纯自动使用下永远为空；反思的"最后一公里"仍依赖手动触发。

### D-12 巩固/衰减无调度器，仅启动时执行 — P2 [代码]
- 证据：`consolidate()`/`archiveBelow()` 调用点仅 `app/index.ts:205-206`（注释自认）。
- 影响：长驻进程内记忆不衰减；跨日会话若不重启则重要性视图陈旧。

### D-13 CI 不运行任何 stage-3 评测套件 — P2 [评测]
- 证据：workflow 只含 `npm run evaluate`/`evaluate:cognition`（stage-1/2）。
- 影响：L1–L16/消融/纵向/重启/长对话/C1 的回归全靠人工本地跑；stage-3 劣化可能无 CI 信号。

## 阻塞（外部条件）

| 阻塞 | 证据 | 解除条件 |
|---|---|---|
| BLOCKED_NO_SECRET（真实 Provider / C1 语义） | `MORROW_TEST_API_KEY` 未设置、`.tmp/` 无凭据文件（审查环境探测） | 维护者本机安全注入凭据后按 repro-log §3 命令复跑并入库 |
| Windows 安装/升级验收 | NSIS 未构建、无干净授权机器 | 构建安装包 + 干净机器执行 `windows-alpha-install-acceptance.ps1` 流程 |
| 语音 | src/ 无实现（NOT_IMPLEMENTED，非阻塞而是未做） | 按任务 §2F 的 Provider-neutral 架构立项 |
| CI（历史计费） | 已解除：5fe62f54 全绿 | —（文档需更新） |
| 真人人工复核 | 三份 live 文件 manualReview=PENDING | 维护者按结果文件逐轮阅读并出具 review 记录 |
| 本机渲染进程崩溃 / esbuild %TEMP% 拒写 | 0x80000003 / 0xC0000005；Access is denied（审查机，repro-log §6） | 更换主机或修复本机 AV/GPU 环境；CI 已覆盖冒烟 |
