# Phase 2.1 — 最终阶段报告（任务 8 · 交付物 H/J）

报告日期：2026-10-27。范围：`ve766/morrow-ai-companion-v2`，分支 `feat/phase-2-companion-core`，PR #3。
本报告只汇总本轮（Phase 2.1）新证，各任务细节见同目录七份分报告；结论以分报告为准，本文不复述其论证。

## 8.1 交付物索引

| 交付物 | 文件 | 状态 |
|---|---|---|
| A 基线审计 | `docs/reports/phase-2.1-baseline-audit.md` | 已交付 |
| B 记忆生命周期与授权 | `docs/reports/phase-2.1-memory-lifecycle-audit.md` | 已交付 |
| C 语境与跨会话回归 | `docs/reports/phase-2.1-context-regression.md` | 已交付 |
| D 评测器有效性 | `docs/reports/phase-2.1-evaluator-validity.md` | 已交付 |
| E 人格与内在状态 | `docs/reports/phase-2.1-persona-continuity.md` | 已交付 |
| F 多轮与持久化 | `docs/reports/phase-2.1-concurrency-persistence.md` | 已交付 |
| G 安全与 Provider | `docs/reports/phase-2.1-security-audit.md` | 已交付 |
| H 本报告 | 本文 | 已交付 |
| I 测试/评测/实验记录 | `src/evaluation/*`、`evaluation/fixtures/context-memory-v1.json`、`evaluation/reports/*.20261027T*.json`、`evaluation/reviews/20261027T034222Z-d3839e.review.json` | 已随代码提交 |
| J 提交/PR/CI 清单 | 本文 §8.7 | 已交付 |

## 8.2 实际修复的缺陷（P0，共 2 处，均带回归测试）

1. **逐字用户语句绕过敏感记忆授权**（安全缺陷）。`explicitSelfFact` 把最多 3 条用户原话注入每一次请求，从不检查 `includeSensitive`——用户关掉唯一的授权开关，仍会发出他明确拒绝发送的原话。修复：`src/app/companion-service.ts` 的自我模型注入块改为受 `includeSensitive` 门禁，标签由 "self-knowledge" 改为 "quoted verbatim, not verified and not self-knowledge"。回归测试：`cognitive-loop.integration.test.ts`「withholds verbatim user statements unless the turn is authorised for sensitive content」（含"抑郁症"原话的断言）。同提交附带两条生命周期测试：用户否认不触发记忆静默改写、单条负反馈不改变人格（`companion-core.integration.test.ts`）。
2. **评测器把非答案判成通过**。`b8` 以虚构天气通过（缺席型规则天然满足）、`a5` 以问号通过、`b3` 以复述 system prompt 通过。修复：`src/evaluation/verdict.ts` 四态判定（`pass`/`fail`/`uncertain`/`needs_review`，缺席/形式检查全过只给 `uncertain`）+ 回声检测（与请求 ≥40 字符逐字重合则降级 `uncertain`）；人工复核独立成 `evaluation/reviews/<runId>.review.json`（`human-review.ts`、`review-cli.ts`、`npm run review:summary`，复核者可不同意但不可改判定）；`b2` 增加唯一一条实测否决条件 `mustNotMention: ["不存在实际居住地址"]`。

没有其他生产代码改动。P1 观察（兴趣标签无敏感度分类、`score > 0` 检索过滤、记忆 JSON 数值进 prompt）只记录不修，理由见各分报告。

## 8.3 能力证据表

| 能力 | 源码证据 | 自动测试 | 真实模型验证 | 人工复核 | 结论 |
|---|---|---|---|---|---|
| 跨会话回忆 | `memory-context-assembler.ts` topic/continuity/explicit-recall 三路由；记忆全局可见（`memory-service.ts`） | 撤回记忆三路由剔除；`b2` 结构检查 9/9 | `8d96a5f` 干净树 3 次：2/3 提及杭州（`T034120Z` 命中、`T034129Z` 否认型自称阿里云、`T034137Z` 命中但虚构时间戳）；连同上一轮 5 次合计 4/8 | `d3839e` 复核：命中均属"用户说……"第三人称转述，非以用户身份回答 | **部分证实**：投递已证实；模型层使用不稳定（4/8），且伴随否认与编造，不构成稳定能力 |
| 冲突记忆 | 汇编器同载两条冲突记录 + 显式说明冲突的指令 | 「carries both sides of a conflict and the instruction to surface it」 | `b7` 4/4 只答上海、不提冲突（稳定缺陷）；`c4` 4/4 fail | `d3839e` 确认 fail | **系统层已证实，模型层未证实** |
| 过期记忆 | `memory-domain.ts:142` `isStaleMemory`（>180 天）→ `stale:true` + 要求表达疑问的指令 | 「flags a stale record and instructs the model to voice the doubt」 | `b5` 3/3 把 200 天未确认记忆当现状，其中 1 次虚构 `"confidence":85`；三次 `needs_review` 全文留存 | 无机械规则可用，回复全文保留待人工读（评测器有效性 §4.5-3） | **系统层已证实，模型层未证实** |
| 撤回与删除 | SQL `WHERE status='active'` + 汇编器双重过滤；`deletion_journal` 恢复重放 | 三路由剔除撤回记忆；删除后各路由剔除；备份恢复不复活删除项 | 按适用范围：纯本机行为，不由模型执行；冒烟覆盖重启后持久性 | 测试断言逐条复核（见分报告 B） | **已证实** |
| 语境理解 | `companion-service.ts` `prepare()` 固定装配顺序（人格→风格→认知→状态→长期层→记忆→原则→历史） | 离线 22/22（hash `2a089d6c`），12 项要求系统层全部达标 | 模型层仅 2 项可确认（`b3`、人工认可的 `a6`）；`a4` 假通过、`b9`/`a1` 失败 | `d3839e`：自动 2 pass/7 fail/3 uncertain ↔ 人工 2/8/2，1 假通过（`a4`）1 假失败（`a6`） | **部分证实**：系统层证实；模型层 2/12，且自动判定两个方向都会错 |
| 人格连续性 | `PersonalityService.save` 唯一写入口；prompt 首段带版本与四项数值 | 「puts the stored personality…follows an edit」；「does not change the personality because of one negative message」；重启谱系恢复 | `c1` 2 次 uncertain（无机械规则判定"行为符合人格"） | — | **结构层已证实**（含单条负反馈不改人格）；行为层未验证；人格随互动自调整未实现 |

## 8.4 已完成 / 未完成 / 阻塞

**已完成**：任务 1–8 全部执行。工程链：`typecheck` 0 错；`vitest` **50 文件 / 435 测试**全过（含 `migrations.test.ts` 10 条）；四个离线评估全部 `passed:true`（`evaluate` 2 项、`evaluate:cognition` 26+34+28 用例、`evaluate:companion`、`evaluate:context` 22 用例 hash `2a089d6c` 未变）；`build` 通过。真实模型实验 7 轮（3 次 `verify:real` + 4 次 `verify:context:real`，runId 见 §8.7），失败结果全部留存。

**未完成（有意不做，不冒充完成）**：
- `a2`/`b10`/`c1`/`c2`/`c3` 无机械规则，未做真机验证——证据等级为"源码+离线断言"。
- 数据集仍为 `context-memory-v1`（22 用例）；"长对话早期约束"只有字符预算断言，无跨 30 轮行为观察（P2）。
- 人格"模型输出符合人格约束"无判定规则，列为未验证（分报告 E §5.5）。
- 记忆装配失败的降级路径（`companion-service.ts:923-929`）无注入测试，读代码可确认（分报告 F §6.3）。
- 复核记录的 `reviewer.kind` 是 `agent`：证明的是"自动判定与人工复核可分离、可追溯"，**不是**人工质量复核已完成。

**阻塞（环境，非代码）**：本机 `npm run smoke` 无法执行。现象：Electron 渲染进程启动即崩溃（0x80000003 STATUS_BREAKPOINT，electron.exe 同一偏移），空白 `data:` 页面同样复现、在未修改的 `main` 工作树同样复现（2026-10-26 阶段一已证伪为代码问题）；`--no-sandbox` 下 `loadFile` 成功，指认渲染进程沙箱初始化受本机环境干扰（另有 GPU 进程 0xC0000005 与 Dawn Graphite 缓存共享冲突 0x20 伴随发生，`--disable-gpu-sandbox` 可消除后者但不救活渲染进程）。Windows 事件日志显示 2026-10-11 的 Electron 43.1.0 同签名崩溃，属本机长期问题。**处置：冒烟由 CI 覆盖**（双平台 `Morrow smoke passed`），本报告不声称本地冒烟通过。

## 8.5 安全与数据完整性结论

凭据只存 `safeStorage` 加密文件（`secrets/*.bin`），SQLite 无明文、请求体无密钥、日志按键名脱敏；损坏密文拒绝静默替换并在出网前阻断；授权发生在请求构建后且有 TOCTOU 比对；撤回/删除无缓存泄漏（每轮重新装配 + 双重过滤）；备份恢复重放 `deletion_journal` 不复活已删项。本轮唯一 P0（§8.2-1）已修复并有回归测试。残余 P1：兴趣标签无敏感度列、脱敏按键名不按值、`PROVIDER_RESPONSE` 不留存原始回包（有意，代价是排障只能看错误码）。

## 8.6 尚存风险与下一阶段建议

按优先级：(1) 兴趣标签敏感度分类（迁移 v16 `interests.sensitivity`）；(2) 真实人工（非 agent）复核一轮 `b5` 全文与 `b7` 稳定缺陷，决定是否在 prompt 层强化冲突披露；(3) 记忆检索 `score > 0` 过滤导致零词面重叠永不召回（结构性，需检索方案变更）；(4) 数据集 v2 补长对话与行为层规则；(5) 人格行为符合度的判定方案。**不建议**在这些完成前扩大真实模型测试规模——先修评测器可信度（已做）再扩样本，否则假通过会按比例增长。

## 8.7 交付清单 J：提交、PR、CI

| 项 | 值 |
|---|---|
| 代码提交 | `a79a7d0`（评测器四态判定 + 复核分离）、`751beb9`（P0 授权修复 + 生命周期测试）、`8d96a5f`（回声检测） |
| 报告提交 | 本文所在 docs 提交（见 PR 时间线末条） |
| PR | [#3](https://github.com/ve766/morrow-ai-companion-v2/pull/3)，OPEN，未合并 |
| PR base | `chore/phase-1-engineering-consistency` @ `12f83e19172d02648ff5007ba14fa9ad9d640525` |
| PR head | `8d96a5f92dca6248191930da5ff73019c47861e2`（随本 docs 提交推进，以 PR 页面为准） |
| 前一绿灯 | run [40439959438](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40439959438) @ `6bfe910`，success 3/3 attempt 1（Ubuntu / Windows / 升级路径），双平台 `Morrow smoke passed` |
| 本轮代码绿灯 | run [40450911191](https://github.com/ve766/morrow-ai-companion-v2/actions/runs/40450911191) @ `8d96a5f` — 见下表实测 |

本轮 CI 实测（run 40450911191，`8d96a5f`）：

| Job | 结果 | 证据 |
|---|---|---|
| Typecheck, tests, build and smoke (ubuntu-latest) | **success** | `gh run view 40450911191`；同 run 内含 `Morrow smoke passed`（CI 日志） |
| Typecheck, tests, build and smoke (windows-latest) | **success** | 同上 |
| Windows upgrade path (schema migrations under the real app) | **success** | 同上；本地 `migrations.test.ts` 10/10 另行复核 |

run 40450911191 全 run `conclusion: success`（3/3 Job，attempt 1）。本地 `npm run smoke` 不通过的原因见 §8.4 阻塞段，不以 CI 绿灯冒充本地通过。

真实模型运行 ID（全部 `codeCommit: 8d96a5f` 或对应时点、`sampling: provider_default`，文件在 `evaluation/reports/`）：
`T033843Z-a0ccc7`、`T033851Z-279771`、`T033859Z-0bdf46`（`verify:real` 预跑）；`T033908Z-c4ec90`、`T033916Z-68b1e7`、`T033926Z-71bbb2`、`T033938Z-f27545`（`verify:context:real` 预跑）；`T034120Z-1e538d`、`T034129Z-1cc940`、`T034137Z-c7062d`（跨会话重复 3 次）；`T034149Z-35fd58`、`T034200Z-76f626`、`T034212Z-bfeb47`（定向 3 次）、`T034222Z-d3839e`（全量 12 用例，人工复核对照 run）。历史 20261026 五份 run 为前一轮证据校准恢复件，未重复引用。

## 8.8 明确的能力边界声明

**有证据支持**：记忆的存取/更正/撤回/删除与备份边界（系统行为，全部有测试）；请求组装顺序与授权门禁（含 P0 修复后）；人格版本的持久与唯一写路径；评测器的四态判定与人工复核可分离性；运行记录的可追溯性（runId + COPYFILE_EXCL）。

**不能证明**：模型会稳定回忆跨会话事实（4/8 且伴随否认/编造）；模型会披露冲突记忆（4/4 失败）；模型会识别过期记忆（3/3 失败）；模型输出符合人格设定（无判定）；模型会主动表达不确定（未观察到）。本报告不宣称 Morrow 已达到成熟 AI 伴侣水平。
