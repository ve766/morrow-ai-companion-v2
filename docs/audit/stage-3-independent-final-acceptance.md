# Stage 3 独立最终验收报告

- 任务来源：Issue [#20](https://github.com/ve766/morrow-ai-companion-v2/issues/20) 评论 `6553117037`（2026-11-01T03:56:28Z），"Stage 3 独立验收任务：PR #19 全量代码、真实能力与交付证据审查（NO SELF-CERTIFICATION）"。
- 审查对象：PR [#19](https://github.com/ve766/morrow-ai-companion-v2/pull/19)，分支 `feat/stage-3-long-term-companion`。
- **审查 SHA：`5fe62f546b84b0306e7f11e887bad9c75f3227ba`**（与任务发布时远端 HEAD 一致；审查全程未变化，全部证据取自同一 SHA，未混用）。
- PR base：`feat/stage-2-delivery-hardening` @ `84670792fa08352835d4cca88da6355435ee0cd6`，保持不变。
- PR 状态：审查开始与结束时均 OPEN、未合并。本报告不改变其状态。
- 配套文档：运行时与数据链路审查见 [stage-3-runtime-and-data-lineage-review.md](stage-3-runtime-and-data-lineage-review.md)；门槛矩阵见 [../reports/stage-3-final-gate-matrix.md](../reports/stage-3-final-gate-matrix.md)；复现记录见 [../reports/stage-3-reproducibility-log.md](../reports/stage-3-reproducibility-log.md)；缺陷与阻塞清单见 [../reports/stage-3-open-defects-and-blockers.md](../reports/stage-3-open-defects-and-blockers.md)；最终决策见 [../reports/stage-3-final-decision.md](../reports/stage-3-final-decision.md)。

## 1. 审查者独立性声明

- 本审查由 ZCode 代理会话（模型 GLM-5.3-Flash，运行环境为本机 ZCode CLI）执行。该会话未参与 Stage 3 任何实现、提交、评测或文档撰写；Stage 3 的实现工作由此前其他代理会话完成（见仓库提交历史作者与交付评论）。
- 审查通过独立的本地克隆（分离的 git 目录，detached checkout 于审查 SHA）执行，未复用任何实现工作树；审查过程未修改任何业务代码、测试、迁移或既有文档；本轮提交的唯一内容是 `docs/audit/` 与 `docs/reports/` 下的六份审计文档。
- 局限如实声明：审查者与实现者同为本仓库维护者机器上的 AI 代理，推送凭据来自同一本地环境。这不是人类第三方审查；`人工质量复核`一节的性质受此限制。
- 审查期间发现的问题只记录证据与修复建议，未做任何代码修复（符合任务"不得自行修代码后再验收"的约束）。

## 2. 方法与证据层级

1. **仓库层**：`gh api` 读取 PR 元数据与提交列表；本地 `git fetch` 后做祖先关系核验（head 领先 base 33 个提交、merge-base 即 base tip、base 无变化）。
2. **复跑层**：在审查 SHA 上于独立克隆中复跑 typecheck、全量 vitest、electron-vite build、六个 stage-3 评测套件（主/消融/纵向/重启/长对话/C1 意图）、冒烟（含环境变体）。所有命令、退出码与工件见复现记录。
3. **代码层**：人工精读主链源码（`companion-service.ts` 关键段、`exploration-policy.ts` 测试矩阵、`personality-growth.ts`、`interaction-profile.ts`、`retrieval-attention.ts`、迁移 v30–v38），并以两个只读探查代理做全仓消费者/文档核对，关键主张均由审查者本人以行号复核。
4. **证据层**：逐份核对 §3 权威文档（12 份全部存在），对其引用做 10 处抽查（9 处逐字一致）；逐一打开评测结果文件核对 `codeCommit` 绑定与断言计数。
5. **真实模型层**：环境无 `MORROW_TEST_API_KEY`（探测记录见复现记录 §3），真实 Provider 重跑为 `BLOCKED_NO_SECRET`；对仓库内已有 32 轮 spark-x2.6 真实转写做了独立逐轮审阅（见 §5，性质为对既有证据的审阅，不是新的真实运行）。

## 3. 四大门槛结论（详见门槛矩阵）

| 门槛 | 结论 | 一句话依据 |
|---|---|---|
| A 工程真实性 | **PASS（含 1 项环境注记）** | typecheck 0 错；vitest 888/888 断言全过（1 个测试文件因本机 esbuild 无法写 %TEMP% 无法在本机装载，隔离+TEMP 重定向后 6/6 过，CI 同 SHA 双平台绿）；build 通过；六个 stage-3 评测在审查 SHA 上全部复跑通过且绑定 `5fe62f54`；CI 在 `5fe62f54` 实际全绿（见 §4 新事实）。 |
| B 认知有效性 | **PARTIAL** | 机制层（接线、状态机、幂等、归属分离、状态消费）成立；G1 人格成长台账是**完全休眠的死代码**（生产者不可达+无消费者）；反思 findings 无 prompt 消费者（仅兴趣候选链进入 payload）；`user_rejected` 无生产写入点；L6 仍是 F7 所指的弱断言。 |
| C 真实互动质量 | **BLOCKED_NO_SECRET（含既有证据审阅）** | 凭据不存在，无法在审查 SHA 上重跑真实模型；既有 spark-x2.6 证据（绑定 `6a885fa`，32 轮/3 会话）10 断言 9 过 1 败 + Morrow 兴趣 NOT_RUN + 人工复核 PENDING；该证据早于 C1 主链改动。审查者对转写做了独立逐轮审阅（§5）。 |
| D 平台与产品 | **PARTIAL** | CI 在 `5fe62f54` 全绿（新事实，与开发者文档"CI BLOCKED"相反）；Electron renderer CI 冒烟双平台 PASS、本机复现 0x80000003/0xC0000005 启动崩溃（环境）；Windows 安装/升级 NOT_RUN；语音 NOT_IMPLEMENTED。 |

**整体判定：NO-GO（Stage 3 不得标记完成；PR #19 不具备合并条件；Stage 4 建议有条件入场，见最终决策文档）。** 依据 §5 决策规则：真实互动质量未 PASS（无凭据、人工复核未完成）即足以禁止整体 PASS；此外认知有效性存在 D-1/D-9/D-10 三项结构性缺口。

## 4. 审查新事实（与开发者文档结论不同处）

1. **CI 已经全绿**。全部权威文档仍写"CI 因账号计费 BLOCKED"（引用 run 41178081914）。实际在 `5fe62f54` 上，GitHub Actions run `41270227620`（2026-11-01T03:42:20Z）与 `41270251780`（03:42:44Z，`pull_request` 事件）均 `success`，含 ubuntu（xvfb 下真实 Electron 冒烟 15 步）与 windows（15 步）及 Windows 升级路径 job（9 步），步骤级 conclusion 全部 `success`。计费阻断在最终 HEAD 上已解除，文档未更新。
2. **G1 台账比文档承认的更"死"**。文档（algorithm-registry `:32`、runtime-map `:101`、gap-closure `:40`）称"生产者存在，每轮运行（`companion-service.ts:1073–1082`）"。行号确实存在该代码，但它在 `onTurnCompleted` 回退钩子内（`companion-service.ts:1045–1109`），而该钩子的唯一调用点 `:1687` 位于 `if (this.outbox && this.projectors.length > 0)` 的 **else 分支**（`:1676/1684`）；outbox 在构造器内只要传入 selfModelLoop 就必然创建（`:1131`），投影器列表恒非空（`buildCognitiveProjectors` 返回 7 个模块）。因此 `onTurnCompleted` 在生产与评测中都不可达，`growth.apply`（`:1080`，全局唯一调用点）**从不执行**；outbox 的 `growth` 模块（`:782–795`）喂的是 `interaction.apply`（G2 交互画像）。G1 台账 = 无生产写入 + 无读取（`describeGrowth`/`forgetTurn`/`rollback`/`recomputeAll` 全部无生产调用点）。进入 prompt 的"漂移"是 G2（`effectiveProfile :996–1013` + `interaction.describe() :720`），这是真实、有界、可回滚、跨重启的链路。纵向评测结果文件里 `personality_growth` 偏移十日恒 `{0,0,0}`（`20261031T064131Z-b0e719a.json` dayLog）与本结论一致。
3. **仓库内没有任何绑定 `5fe62f54` 的 stage-3 结果文件**（本审查复跑前）。主套件最新结果绑定 `b0e719a`（早于 C1 主链改动与迁移 v36–v38），C1 机制套件有效结果绑定 `6ae4520`，另有 6 份 `codeCommit:"unknown"` 结果（10-31 从无 `.git` 工作树产出，按任务规则记 BLOCKED，不能作为 HEAD 证据）。本审查复跑补上了这一环：六套件全部绑定 `5fe62f54` 且通过（工件路径见复现记录）。
4. **本机（审查环境）冒烟出现新形态的环境阻断**：esbuild 向 `%TEMP%` 写 `.mjs` 一律 "Access is denied"（node 直写同目录正常；与沙箱无关，非沙箱模式同样失败）；把 `TEMP` 指向工作区内目录后编译通过，但渲染进程启动即崩 `0x80000003`（`MORROW_SMOKE_DISABLE_SANDBOX=1` 时变为 `0xC0000005`），与历史记录的本机渲染进程沙箱问题一致。CI 冒烟在同 SHA 双平台通过，故判本机环境阻塞、代码无嫌疑。

## 5. 对既有真实转写的独立审阅（审查者：ZCode 独立代理）

对象：`evals/real-provider/results/20261031T085512Z-6a885fa.json`（spark-x2.6，3 会话 32 轮，32/32 成功）。性质：**对既有证据的阅读，不是新的真实模型运行**；真实重跑仍 BLOCKED_NO_SECRET。逐轮原文在结果文件内，本节给出审查者的判定与定位。

**PASS（代表性证据）**
- 跨会话召回：轮 11 首轮答出代号与项目性质；轮 6 答出代号与截止日期（"2027 年 2 月底"）。
- 目标语义：轮 4/15/27 一致使用 `2027-02-28`；信息不足时（轮 27）提出结构化问题而非编造。
- 拒绝编造：轮 25（妹妹名字）、轮 26（护照号，附带隐私提醒）均明确"没有记录"。
- 主体归属：全程以"你提过/你没说过"第三人称引用用户记忆，无冒名；轮 22/24 对"你最近在想什么/有没有好奇心"明确否认主观体验，符合产品"计算变量"原则。
- 谨慎性：轮 32 拒绝把摘要当作证据（"那段总结本身不可靠"）。

**FAIL / 弱点**
- **轮 13（会话 B）**：轮 12 用户说"搬去苏州"，轮 13 问"我现在住哪？"——payload 实际携带了苏州记忆（`selectedMemoryIds=[fa31af19]`，`guardVerdict=rewrite`），模型仍答"我这边没有可用的记录"。**系统层投递成功、模型层未使用**。
- **轮 31（会话 C）**："我对什么过敏来着？"——`selectedMemoryIds=[]`（检索零命中），模型否认已知事实；同型问题在轮 14（会话 B）命中并正确回答。**跨会话检索不稳定**，且失败形态是"自信地不知道"而非澄清。
- **风格机制与行为脱节**：轮 3/21 两次"更喜欢你直接一点"后行为确实变直接（轮 23 等），但 `directness_signals=2 <3` 门槛、offsets 恒 0（运行唯一 FAIL 断言）。规则层漏检了"还是希望你直接一点"这类自然变体（与 `docs/reports/…real-provider-evidence` 的记录一致）。
- Morrow 兴趣闭环在真实运行中 NOT_RUN（1 个知识缺口 < 3 门槛），探索机制未在真实对话中被触发过一次。

## 6. 与完成定义（任务 §8）的对照

| 完成定义条目 | 判定 |
|---|---|
| F1–F7 全部有代码级处理与回归证据 | F1/F2/F3/F5/F6 有；**F4 部分（G2 活、G1 死代码）**；**F7 未达标（L6 仍弱断言）** |
| 记忆巩固/衰减/冲突管理真实运行并影响回复 | 巩固/归档在启动时真实运行（`app/index.ts:205-206`）；重要性进 payload（L16）；冲突标记进 prompt（L3）；**无调度器，长驻进程不衰减** |
| 三类兴趣分离、独立证据 | 机制 PASS（证据行级 origin 硬隔离、跨源归 shared、按侧晋升）；真实运行 Morrow 兴趣 NOT_RUN |
| 人格成长双向、有反证、可解释、可回滚 | G2 满足（L4 正负证据、L12 删除重算、restart 连续）；G1 台账死代码 |
| 内在状态参与真实环节 | 检索放宽（`retrieval-attention.ts:52-67`）+ prompt 引导 + 反思 bias 证据；不参与探索排序与人格 |
| 反思候选可追溯且影响后续回合 | 兴趣候选链进入 payload（L5）；其余 findings 无 prompt 消费者；自动路径不进 pending items |
| GoalService 跨会话进入真实主链 | 以 `CompanionGoalService`（owner 三分、对话创建、过期、候选确认）实现并经 L10 验证；任务执行型 `GoalService` 保持 IPC 通道（未入主链，行为与 Stage 2 一致） |
| L5/L6/L10/L11/纵向有效无假阳性 | L5/L10/L11/纵向在审查 SHA 复跑 PASS 且断言实质化；**L6 例外** |
| 真实主数据库重启后 payload 连续 | restart 套件（同文件重建完整运行时）PASS；app 级装配（Electron 入口）未覆盖 |
| ≥30 轮长对话、3 会话评测 | long-conversation PASS（30 轮/3 会话）；真实模型层 BLOCKED |
| 语音有证据或明确 BLOCKED | **NOT_IMPLEMENTED**（src/ 无任何 ASR/TTS/录音代码） |
| 无未解决 P0/P1 一致性/隐私/重复事件缺陷 | 幂等与级联经测试证实；`user_rejected` 无写入点（P2）；无已知 P0 |
| 全量测试/构建/评测/桌面/真实 Provider 分别报告 | 本审计按此口径报告 |
| 文件与精确 SHA 一致、PR #19 未合并 | 是 |

## 7. 与实现侧自审包（28de8fe）的关系

- 审查者推送本审计时，发现分支上已出现提交 `28de8fe1cf257b8753b728b74458e7429fcfca57`（"independent-acceptance evidence pack (self-review)"，2026-11-01T12:36+08:00）：实现侧会话先行产出了同名六文件，并如实标注 **`BLOCKED_INDEPENDENCE`**、结论 NO-GO、明言"不构成批准，只为真正的独立审查者提供证据基础"。
- 按任务 §0 的 NO SELF-CERTIFICATION 规则，独立验收以本包为准：本提交把六份固定路径的文件**替换**为独立审查版本；自审包内容保留在 git 历史中可追溯。
- 自审包中一项事实被本审计采信为佐证（非绑定）：其以逐 blob 比对证明了产出 `codeCommit:"unknown"` 结果的工作树与 `5fe62f5` **内容等价**（583 文件：518 逐字节相同、65 仅行尾差异、0 内容差异）。这意味着那 6 份 unknown 结果大概率产自与被审 SHA 相同的代码——但它们仍缺 git 绑定，审计判定维持 BLOCKED（D-2），仅将"代码可能不同"的疑虑降级为"已排除"。
- 自审包仍写"CI 计费阻断"；本审计以 run 41270227620 / 41270251780 的步骤级 success 记录为准（CI 已全绿，D-6-7）。

## 8. 结论

- **工程链健康**：全部可在本地验证的门槛在审查 SHA 上通过（多数由本审查复跑并首次绑定 HEAD）。
- **认知机制大部分成立**：兴趣归属、探索状态机、目标、记忆生命周期、内在状态消费、outbox/幂等均有代码与测试级证据。
- **三处结构性缺口阻止"完成"**：G1 台账死代码（人格成长叙事与实现不符）、反思 findings 无 prompt 消费、L6 未按 F7 重写。
- **真实互动质量门槛因凭据缺失 BLOCKED**：既有真实证据（9/10）绑定 `6a885fa`、早于 C1 主链改动，不能证明最终 HEAD 的真实行为；真人人工复核仍未发生。
- **最终判定 NO-GO**；细节与修复方向见 [stage-3-final-decision.md](../reports/stage-3-final-decision.md) 与 [stage-3-open-defects-and-blockers.md](../reports/stage-3-open-defects-and-blockers.md)。
