# Morrow V2 能力成熟度矩阵（M0–M6）

> 审计基准：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 评分只看证据，不看文档声称。

---

## 0. 分级定义（本文件严格按此执行）

| 级别 | 含义 |
|---|---|
| **M0** | 未实现（无代码） |
| **M1** | 有代码，但不在生产装配中 |
| **M2** | 已装配，但生产主链不会真正走到（含「结构性不可达」） |
| **M3** | 已调用并持久化，但未证明影响下一轮 payload 或行为 |
| **M4** | scripted provider + 真实服务 + 真实数据库验证了确定性闭环 |
| **M5** | 真实 Provider / 模型行为有可复现证据 |
| **M6** | 有真实时间跨度与真实互动样本支持长期稳定 |

**关键区分**：本矩阵额外给出「出厂默认下的有效级别」。因为认知核心出厂默认关闭（`cognitive-settings.ts:22-27`，界面 `index.html:317` 明确写「默认关闭」），若干 M4 能力在**新装机器上根本不运行**。

---

## 1. 总表

| # | 能力 | 机制级别 | 出厂默认有效级别 | 一句话理由 |
|---|---|---|---|---|
| 1 | 语境 / 意图理解 | **M4** | **M0** | 闭环成立，但默认关闭 |
| 2 | 记忆形成 | **M4**（M5 n=1） | M4 | 手工 + 模型建议两条路；真实模型只跑过 1 次 |
| 3 | 记忆纠正与修订 | **M4** | M4 | 旧值确实退出下一轮 payload |
| 4 | 记忆巩固 | **M3** | M3 | 启动期写，**无任何生产读路径** |
| 5 | 记忆冲突 | **M4** | M4 | 检测→投递→守卫→待决项全链 |
| 6 | 记忆重要度 | **M3** | M3 | 分数**不参与检索排序**，只决定归档 |
| 7 | 记忆衰减 / 归档 | **M3** | M3 | 只在启动期跑；用户不可见、不可恢复 |
| 8 | 撤回 / 删除传播 | **M4** | M4 | 触发器完备；但会误删整条兴趣 |
| 9 | 人格稳定（用户基线） | **M4** | M4 | 编辑→payload→重启 全链 |
| 10 | 人格成长（有界漂移） | **M3** | M3 | 写路径真实；**读路径零断言** |
| 11 | Morrow 自身兴趣 | **M1** | **M0** | `observeMorrow()` 只有评测调用 |
| 12 | 兴趣三分（user/shared/morrow） | **M2** | **M0** | 三行代码存在，只有 `user` 可达 |
| 13 | 受约束自主探索 | **M2** | **M0** | 门禁每轮跑，但永远返回「无候选」 |
| 14 | 反思 | **M3** | M3 | 跑、存、去重；结论不影响任何载荷 |
| 15 | 自我模型 | **M3** | M3 | 进 payload，但无断言、无确认、无 UI |
| 16 | 内在状态 / appraisal | **M4** | **M0** | 数值进 payload 且被断言；默认关闭 |
| 17 | 长期目标跨会话 | **M2** | **M0** | 有读路径，**无生产写入** |
| 18 | 独立判断 / 非迎合 | **M2** | M2 | 只有一行固定原则；两条断言是同义反复 |
| 19 | 多轮连续对话 | **M4** | M4 | 12 条窗口 + 30 轮评测 |
| 20 | 语音输入输出 | **M0** | M0 | 全仓无相关代码 |
| 21 | 真实云 Provider | **M5\***（Spark, n=1） | — | 一次真实调用，且在 stage-2 提交上 |
| 22 | 真实本机 Provider | **M4** | — | 真 HTTP 回环，但模型回复是假的 |
| 23 | 长期稳定（真实时间） | **M0** | M0 | 最长真实运行 71 秒 |
| 24 | 隐私与数据安全 | **M4** | M4 | 代码与测试都强 |
| 25 | 安装 / 升级 / 恢复 | 安装器 **M1**；备份 **M4**；崩溃恢复 **M4** | — | 无安装包、无升级实跑 |

**分布**：M0=1（语音）+1（真实时间），M1=1，M2=4，M3=6，M4=11，M5=1（n=1，带星号），M6=0。

---

## 2. 逐项证据

### 1. 语境 / 意图理解 — M4 / 默认 M0

| 维度 | 证据 |
|---|---|
| 代码 | `cognition/cognitive-turn-analyzer.ts:88-192`；规则 `intent-decision.ts`；置信度 `intent-confidence.ts` |
| 生产调用 | `companion-service.ts:1494-1522`，仅在 `settings.available && settings.enabled` 内 |
| 持久化 | `cognitive_turn_observations`（`:1225-1238`） |
| payload | `A local rule-based reading of this turn: intent=…; response route=…; uncertainty=…`（`:83`） |
| 行为 | **无**。脚本 Provider 忽略提示词 |
| 跨会话 | 观察持久化，但后续回合不重读 |
| 评测 | `companion-service.test.ts:282,340-344,392`（开关两态）；`intent-decision-synthetic-example.json` 报 `accuracy 1 / 25 cases`，但那是自写夹具 |
| 未验证 | 置信度校准（`confidenceBasis:'unvalidated_rule_strength'`） |
| 阻塞 | **出厂默认关闭**，新装机器上不分析任何一轮 |

### 2. 记忆形成 — M4（M5 n=1）

手工创建（`memory-service.ts:85-125`）+ 模型建议（`companion-service.ts:1968-2032`）。payload 断言见 L1（`harness.ts:229-231`）。真实模型证据只有 `evals/stage-2/provider/phase24-real-model-26aeac7.json`，provider=spark，`runsPerScenario:1`，`mode:auto_approved_harness`，`production_equivalent:false`，且 `codeSha` 是 stage-2 提交。

**未验证**：`turn_derived_confirmed` 这一来源**没有任何生产者**（全仓只出现在枚举与权重表），即「从对话自动形成记忆」不存在。

### 3. 记忆纠正与修订 — M4

L2 断言「旧值消失、新值出现」（`harness.ts:246-250`）；长对话套件同样断言。修订链 `memory_revisions` 追加式，UI 可见（`renderer/src/main.ts:199`）。

### 4. 记忆巩固 — M3

`consolidate()`（`memory-importance.ts:215-242`）在 `index.ts:202` 每次启动执行，写 `memory_consolidations`。
**生产无读路径**：`consolidations()` 的唯一调用方是 `memory-importance.test.ts:148,158`；检索装配器从不读该表。
L16 第 6 条断言只检查 `consolidate()` 的返回值（`harness.ts:595`），不检查库行、更不检查 payload。

### 5. 记忆冲突 — M4

检测（`fact-slot.ts` + `memory-service.ts:154-169`）→ 投递（`memory-context-assembler.ts:295-334`）→ 提示词具名两值（`companion-service.ts:103-107`）→ 事实守卫改写（`conflict-handling.integration.test.ts:101-104`）。8 条集成用例含反例。
**未验证**：冲突**分类**（事实变化 / 偏好变化 / 时间变化 / 情境差异）未实现。

### 6. 记忆重要度 — M3

`scoreMemory`（`memory-importance.ts:79-118`）计算 `I = clip(.30S+.25U+.15R+.10G+.10C+.10T)`。
`grep -rn importance src/memory/memory-context-assembler.ts` → 只有一行注释。**分数不进排序**。
它唯一的下游作用是 `archiveBelow` 的阈值判定（`:181-185`）。所以「重要度影响检索」不成立，成立的是「重要度影响归档」。

### 7. 记忆衰减 / 归档 — M3

`archiveBelow(0.35, 180d)` 只在 `index.ts:203` 启动期执行，且失败被 `try/catch` 吞掉（`:207-209`）。
归档只写 `archived_at`，不改 `status`；检索侧过滤（`memory-context-assembler.ts:177`）。
**产品缺陷**：`archivedAt` 不出现在 renderer / preload / 共享类型；`restore()`（`memory-importance.ts:203-206`）没有 IPC。用户会看到某条记忆「突然不被想起」，既没有解释也没有入口。
L16 是直接调 `archiveBelow` 并用裸 SQL 回填日期（`harness.ts:577,581`），不经过启动期路径。

### 8. 撤回 / 删除传播 — M4

16 个触发器（见数据血缘文档 §3）+ `derived-deletion-boundary.test.ts`、`interest-invalidation.test.ts`。重启套件断言撤回文本退出 payload（`restart/run.ts:63-67`）。
**但**：删一条消息会删掉**整条兴趣**（`migrations.ts:758`），且 `interest_evidence.interest_id` 无外键 → 孤儿证据。这是隐私与血缘双重缺陷。

### 9. 人格稳定 — M4

唯一写入者是用户编辑（`companion-service.ts:535-553`），版本单调；payload 行 `:1558` 有断言（`companion-service.test.ts:163-219`）；场景 E 重启后 `version:2, warmth:70`（`tests/acceptance/scenarios.test.ts:236`）。
**未验证**：先编辑基线、再跑成长回合的交互，无测试。

### 10. 人格成长 — M3

写路径：`onTurnCompleted` → `deriveGrowthSignals` → `growth.apply`（`companion-service.ts:876-885`），L4 确实得到 `directness 3 / +2.016`、`humor 3 / −1.302`。
读路径：`effectiveProfile`（`:835-845`）→ `:1485` → `:1558` 的三个数值 + 漂移行（`personality-growth.ts:268-276`）。
**读路径零覆盖**：`grep -rn "Bounded style drift" src tests evals` 只命中生产者；`effectiveProfile` 也只有定义与调用点。删掉读路径，L4 仍然全绿。
L11「重启后人格漂移连续」的实测 detail 是 `{"warmth":0,"directness":0,"humor":0}` —— 因为它的三句话是裸命令句（`harness.ts:492`），分析器读成 `uncertain`，成长门禁 abstain。**0 == 0 通过了。**
`rollback()` 无 IPC、无 UI，用户既看不见也回不去。

### 11. Morrow 自身兴趣 — M1

`observeMorrow()`（`interest-service.ts:309-318`）是 `origin='morrow'` 唯一生产者，调用方只有 4 处，**全在 evals**。
反思路径不传 `origin`（`reflection-service.ts:396-411`）→ 落库为 `user`（`interest-service.ts:408`）。
文档已承认（`stage-3-followup-implementation-report.md` §9 记 S3-01 = OPEN），但同一份文档 §1 又把「兴趣归属」记为已修。**内部矛盾。**

### 12. 兴趣三分 — M2

三行代码在（`companion-service.ts:657-671`），但 `shared` 依赖 `morrow`，`morrow` 不可达 → 生产中最多出现一行（`user`）。
L5 第 3 条断言之所以过，是因为评测自己调了 `observeMorrow`（`harness.ts:329`）。

### 13. 受约束自主探索 — M2

门禁每轮执行（`:790-812`），预算事务化（迁移 33），状态机六态（`exploration-policy.ts`）。
但 `decideExploration` 只接受 `origin ∈ {morrow, shared}`（`:71`），生产永远返回 `no_morrow_candidate`（`:83`）。
**附加缺陷**：预算在 `prepare` 里预留（`:1552-1556`），早于授权（`:1203`）；拒绝/冲突路径不释放（只有 `:1269,1284,1377` 三处结算）→ 两次拒绝耗尽当日配额。当前因不可达而潜伏。

### 14. 反思 — M3

`run()`（`reflection-service.ts:175-376`），限频 6/小时，`dedupe_key` 去重，证据有效性校验。
结论**不进任何载荷**：`buildSelfModelContextBlock` 从不读 findings。唯一下游是 `interest_evidence` → **用户**兴趣。
手动触发有 IPC，但 renderer 无调用方（`grep -rn reflection src/renderer` 无匹配），所以「回合后结论 → 待决项」这条只在手动路径成立。
**未验证**：结论质量、反证、候选验证（§2C 未实现）。

### 15. 自我模型 — M3

`record/correct/retract`（`self-model-service.ts:87-141`），payload 行 `:672-675`。
**无断言**：`grep -rn "Unverified self-knowledge"` 只命中生产者。
**无确认语义**：代码注释自认（`self-fact-statement.ts:13-15`）；correct/retract 有 IPC 但无 UI。
`kind ∈ inference/unknown` 生产从不写入 → 反思依赖它们的两个分支是死的。

### 16. 内在状态 — M4 / 默认 M0

6 类事件固定增量表（`feeling.ts:124-176`），衰减 + 单事件幅度上限；进 payload（`:1561`）且有精确数值断言（`companion-service.test.ts:291-292`）；状态在消息事务内提交（`:1337`）；重启可重放（场景 C/E）。
**不改变**权限、敏感度、记忆内容；只调检索宽度（+0~2 条）与一行提示词。
L7 第 2 条断言 `first.includes('state')` 会被记忆指令里的 "Each entry **states** its source" 满足（`memory-context-assembler.ts:231`）——即使删掉全部感受提示词也能过。
§2B「appraisal 重构」未实现。

### 17. 长期目标 — M2

读路径每轮（`:690-698`），但 `companion_goals` **无生产写入**：注入类型是 `Pick<…,'activeForContext'>`（`:638`），`create` 在类型层面就被排除；`goals:create` IPC 指向任务型 `GoalService`。
L10 之所以 PASS，是评测直接调服务（`harness.ts:453-456`）。
**另有真 bug**：`describeGoals` 用 `'\n'`（字面反斜杠+n）连接三行（`companion-goal.ts:241`），多类目标同时存在时提示词里会出现 `\n` 文本。

### 18. 独立判断 / 非迎合 — M2

只有 5 条固定原则（`companion-service.ts:65-71`）恒定拼入。事实守卫（`:1291-1306`）改写的是**无依据的个人事实**，不是「敢于不同意」。
L6 两条断言：`system.includes('Morrow') || system.length > 200`、`!system.includes('always agree')` —— 后者检查的字符串任何代码都不会生成。**两条都是同义反复。**

### 19. 多轮连续 — M4

12 条 / 6000 字符窗口（`:154-155,1571-1578`）；长对话套件 30 轮 / 3 会话 8 条断言全过。
**未验证**：超过 30 轮；超出 12 条窗口后的行为（该套件测的是「已存为记忆」的内容，不是窗口边界）。

### 20. 语音 — M0

`grep -rn "voice|speech|microphone|SpeechRecognition|tts|audio" src` 只命中「reported speech」注释。无依赖、无 IPC、无 UI。

### 21. 真实云 Provider — M5\*（Spark, n=1）/ DeepSeek M1

唯一真实证据：`evals/stage-2/provider/phase24-real-model-26aeac7.json`，`spark-x2.6`，`runsPerScenario:1`，13/13 客观项，S4 SKIPPED，`codeSha 26aeac7`（stage-2 提交）。
授权是 `auto_approved_harness`，`production_equivalent:false`。
**DeepSeek 从未真实调用**；协议只由注入的 `fetch` 覆盖。

### 22. 真实本机 Provider — M4

`local-provider.integration.test.ts:38-80` 起真实 `node:http` 服务在 `127.0.0.1`，走真实 fetch 栈。
但服务端返回硬编码 SSE（`'Local model reply.'`，`:70`）。**从未跑过 Ollama / llama.cpp / LM Studio**；`evals/stage-2/results/2026-10-29T08-35Z-local-not-run.json` 本身就是 `NOT_RUN`。

### 23. 长期稳定 — M0

| 运行 | 真实耗时 |
|---|---|
| 纵向（10 个模拟日） | **5.2 秒**（结果文件 `realElapsedMs`），`clock:"injected"`，240 模拟小时 |
| 重启 | 1.2 秒 |
| 长对话（30 轮） | 5.1 秒 |
| 全量测试 | 71 秒（本次实测 1m38s 含安装缓存） |

没有任何进程跑过一天；没有任何记忆超过评测里手工回填的日期；`event_journal` 无轮转。

### 24. 隐私与数据安全 — M4

`safeStorage` 加密文件（0600/0700，原子 rename）、DB 无密钥列、日志键名脱敏、CSP/沙箱、IPC 来源校验、授权对话框展示完整 payload 与哈希、发送前二次校验、备份只含 DB。
**未验证**：真实 DPAPI 落盘（`secrets.test.ts` 只测 `hasSecureStorageBackend`）；两份文档对 smoke 是否通过互相矛盾（见审计总报告 §6）。

### 25. 安装 / 升级 / 恢复

| 子项 | 级别 | 说明 |
|---|---|---|
| Windows 安装器 | **M1** | `package.json:45-73` 配置齐全，无 `release/`、无产物、无升级实跑 |
| 备份 / 恢复 | **M4** | 13 条测试含篡改、路径逃逸、token 单次与过期、删除边界重放、交换失败回滚；UI 已接 |
| 崩溃恢复 | **M4** | `tests/b4-child-crash.test.ts` 用 SIGKILL 杀真实子进程，覆盖 4 个生命周期点 |

---

## 3. 评测层自身的成熟度

评测是「能力的证据来源」，所以它自己也要被评级。

| 项 | 评价 | 证据 |
|---|---|---|
| 真实数据库 | 是，文件库 + 真迁移 | `harness.ts:99-100` |
| 与生产装配一致 | **否** | 缺 `SafeStorageSecretStore`、真实授权对话框、IPC/renderer、`GoalService`、`ReminderService`、`BackupService`、启动期恢复与启动期反思；多了 `ScriptedProvider`、`MemorySecretStore`、自动同意 |
| 认知核心状态 | **与生产默认相反** | 评测强制 `enabled:true`（`harness.ts:157`），生产默认关 |
| 假阳性断言 | **至少 16 条** | 见下表 |
| 消融因果 | **循环** | 每个模块只被「测它自己的那个场景」观测；翻转开关只改那一个场景 |
| 真实模型 | 否 | `provider:"scripted-offline (not a model)"` |
| 真实时间 | 否 | 纵向注入时钟 |
| 数据集文件 | **未被加载** | `evals/stage-3/scenarios-v1.json` 声明 `stage-3-v1.3`，但 `grep -rn "scenarios-v1" --include=*.ts` 无匹配；`harness.ts:39-40` 硬编码 `stage-3-v1` |

**会「删掉功能仍然通过」的断言**（本次审计逐条核对）：

| 位置 | 断言 | 为什么能假通过 |
|---|---|---|
| `harness.ts:196-204` | `memoryBlockEmpty()` | 标记不存在时返回 `true` → 删掉整个记忆块，L3/L13 仍过 |
| `harness.ts:379` | `system.includes('Morrow') \|\| system.length > 200` | 系统提示永远 >200 字符 |
| `harness.ts:380` | `!system.includes('always agree')` | 该字符串任何代码都不生成 |
| `harness.ts:396` | `first.includes('state')` | 记忆指令里的 "states" 命中 |
| `harness.ts:443,508` | `version >= 1` | 默认档就是 v1 |
| `harness.ts:529,531` | `evidenceCount >= 0`、`after.offset <= before.offset + 1e-9` | 0 >= 0；L12 的句子不匹配任何风格规则 |
| `harness.ts:544` | `!/你叫[^\s，。]{1,6}/` | 模板永远不含该模式 |
| `harness.ts:363` | `!userOnlyStates.includes('permitted')` | 无任何事件时也成立 |
| `harness.ts:367` | `failedStates.includes('provider_failed') \|\| failedStates.length === 0` | `\|\|` 兜底吃掉失败分支 |
| `harness.ts:507` | `JSON.stringify(firstOffsets) === JSON.stringify(secondOffsets)` | 两边都是全 0 |
| `long-conversation/run.ts:60` | `growthRows <= turns` | 0 <= 30 |
| `longitudinal/run.ts:106,109` | `abs(offset) <= 8`、`version >= 1` | 全 0；默认 v1 |
| `restart/run.ts:57,60` | `payload.includes('Morrow')`、`version >= 1` | 种入的记忆正文本身就含 "Morrow" |

---

## 4. 与交付文档的差距（只列能力级别）

| 文档说法 | 实际 |
|---|---|
| 「§2D 长期目标已实现，L10 六条断言」 | 无生产写入路径，表永远空；L10 靠评测直调 |
| 「兴趣归属分离已修（F1）」 | schema/提示词已分离，但只有 `user` 类可达；同文档 §9 又记 S3-01 OPEN |
| 「X1 受约束自主话题已实现」 | 门禁真实，但资格集在生产恒为空 |
| 「G1 改变用户可见行为」 | 读路径零断言；唯一声称验证它的 L11 是 0==0 |
| 「记忆巩固与按重要度衰减已实现」 | 巩固无读路径；重要度不进排序 |
| 「15 场景 13 PASS / 2 NOT_RUN」 | 实测 16 场景 15 PASS / 1 NOT_RUN（分母 16） |
| 测试数（40/268、82/720、82/726、84/747、84/756 五种写法） | 实测 **84 文件 / 756 测试** |

---

## 5. 复现

```bash
npx tsc --noEmit                 # 0
npx vitest run                   # 84 files / 756 tests
npx electron-vite build          # 0
MORROW_EVAL_SHA=43c9281 npm run eval:stage3               # 15 PASS / 1 NOT_RUN（分母 16）
MORROW_EVAL_SHA=43c9281 npm run eval:stage3:ablation      # no_growth→L4, no_exploration→L5, no_reflection→L9
MORROW_EVAL_SHA=43c9281 npm run eval:stage3:longitudinal  # PASS，clock=injected
MORROW_EVAL_SHA=43c9281 npm run eval:stage3:restart       # PASS
MORROW_EVAL_SHA=43c9281 npm run eval:stage3:long-conversation  # PASS
```
