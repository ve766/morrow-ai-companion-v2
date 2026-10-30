# 自审：阶段二最终收尾

| 项 | 值 |
|---|---|
| 任务 | issue #17 评论 6517598292 |
| 结果生成 SHA | `a8e382de96840e72effa9c8d7901971bee6e6e89`（干净工作树） |
| 开工基线 | `9837b59fbf5d1088f06814fdd2a3632792142a38` |
| 环境 | Windows 10.0.26200、Node v22.22.2、npm 10.9.7 |
| 对照交付报告 | [`docs/reports/stage-2-final-closeout.md`](../reports/stage-2-final-closeout.md) |
| 结论 | B1/B4/B5 **PASS**；B2/B3/A1–A3 回归 **PASS**；CI、真实 Provider、安装器升级 **BLOCKED / NOT_RUN** |

本文件记录本轮**发现的错误**、根因、改动与回归风险，不复述开发报告。

---

## 1. 本轮抓到的真实缺陷（都不是"为了让测试过"）

| # | 缺陷 | 怎么发现的 | 根因 | 修法 |
|---|---|---|---|---|
| 1 | `recovering` 状态写不进去，轨迹永远停在 `recovery_required` | 恢复测试断言终态为 `failed`，实际读到 `recovery_required` | 状态机枚举加了 `recovering`，但 `turn_states` 的 CHECK 仍是十态；写入抛错又被生命周期记录器**静默吞掉** | 迁移 28 重建表并放宽 CHECK |
| 2 | 迁移 28 首版丢失两个级联触发器 | `turn-state-machine.test.ts`「删除会话时清理生命周期」、`b4-recovery` 删除用例同时变红 | 触发器挂在 `conversations`/`messages` 上（不是 `turn_states`），表重命名后其主体指向临时表名，DROP 临时表并不会删除它们；随后 `CREATE TRIGGER` 因重名失败 | 先 `DROP TRIGGER IF EXISTS` 再重建两个触发器 |
| 3 | 迁移注释里的反引号截断模板字符串 | 三个测试文件同时"Transform failed" | 注释写在 SQL 模板字符串内，却用了反引号包裹表名 | 注释改为普通文本 |
| 4 | 反思重跑会重复计数 | 新增幂等测试读到 `duplicates=0`、证据数增加 | 原实现每条 finding 无条件插入并立即应用效果，没有身份概念 | 迁移 27 加 `dedupe_key` 唯一索引；先落库成功再执行效果 |
| 5 | 人格建议没有落点 | 代码审查：`bias_hint` 只写 finding，没有任何"待确认"载体 | 缺 `pending_personality_candidates` | 迁移 27 建表；映射器只在 finding 声明维度时才产出该效果 |
| 6 | 恢复无法处理"无意图但卡在非终态"的轮次 | 子进程在 Provider 调用中强杀后，库里只有 `requesting` 状态，恢复完全看不到它 | 恢复只扫 finalization 意图 | 增加第二遍：扫非终态并结算为 failed/committed，不重发请求 |

## 2. 本轮我自己的操作错误（也记录）

| # | 错误 | 影响 | 处理 |
|---|---|---|---|
| A | `npm run typecheck` 实际是红的（`ProviderProfile` 未标注），我先前的 `npx tsc --noEmit \| grep b4-crash` 过滤把错误筛掉了 | 首份验证日志 `typecheck exit=2` | 修正类型；重跑并把 typecheck 纳入固定命令表 |
| B | 首份验证日志在**脏工作区**生成（脚本刚创建未提交） | 结果无法绑定提交 | 删除该日志（从未推送），提交脚本后在干净树重跑 |
| C | 收尾脚本用 `execFileSync('npx' / 'node')` | Windows 下 ENOENT | 改用 `process.execPath` + vitest 入口 |
| D | 收尾脚本把"结果 SHA"与"提交结果的 SHA"混为一谈 | 提交证据后 HEAD 前移，脚本拒绝运行 | 结果绑定 `commitSha`（生成时），另记 `publishedInCommit`，并校验前者是后者祖先 |
| E | 幂等测试假设 `events.list` 是升序 | 断言取到最早一条，`duplicates=0` | 改为取 `[0]`（最新在前），并在测试里注明 |

## 3. 与任务假设不一致、但被证据推翻的两点

### 3.1 "消息已提交、意图未清理"不可能由崩溃产生

任务要求覆盖「assistant commit 后 intent 清理前崩溃」。审查代码后发现：`appendMessage` 的事务内部依次执行 写消息 → `applyFinalization` → `remove(intent)`。**提交与清理是同一事务**，进程在 `remove` 处死掉会让整个事务回滚，消息也不会留下。

因此这个窗口在现设计中只能由**清理自身失败**产生（服务有意吞掉该失败并保留意图，让恢复补记账）。子进程测试因此用"注入清理失败"覆盖该窗口，而不是伪造一次崩溃。这是设计更强、而非更弱。

### 3.2 `no_reflection` 消融此前无差异不是反思无用

旧夹具只有对话、没有记忆。反思的输入是**记忆事件**，没有记忆就没有可反思的证据。正向夹具（2 条同主题记忆 + 2 条同主题对话）才让两臂产生结构性差异。旧结论保留，未被改写。

## 4. 回归风险评估

| 改动 | 风险 | 缓解 |
|---|---|---|
| `recovery_required` 前驱扩到所有非终态 | 可能把"卡住的轮次"误判为已恢复 | 只结算为 `failed`（或已投递时 `committed`），从不凭空产生回答；有删除会话用例与幂等用例 |
| 迁移 28 重建 `turn_states` | 可能丢数据或丢级联 | 行数据逐条复制；两个触发器显式重建；`turn-state-machine.test.ts` 与 `b4-recovery` 覆盖删除级联 |
| 迁移 27 给 findings 加唯一索引 | 历史重复行可能导致索引创建失败 | 该表历史上没有 dedupe 概念，重复行可能存在；`ALTER` 只加列，唯一索引建在**新列**上（历史行为 NULL，不受唯一约束影响） |
| 反思改为"落库成功才应用效果" | 落库失败会静默丢掉效果 | 落库失败只可能是 dedupe 冲突（已存在）；事件 `reflection.completed` 记录 `stored/duplicates/rejected`，可审计 |
| B1 权重（e 占 0.6） | 过拟合小样本 | 双集验证（dev+fixture 共 52 例）、约束禁止零权重与单一特征主导；对外只称 `uncalibrated_heuristic` |

## 5. 未完成项与原因

| # | 项 | 状态 | 原因 / 缺什么 |
|---|---|---|---|
| 1 | 错误高置信度率的**统计意义** | 已统计但样本小 | 26 例里 0 例高置信度错误；样本量不足以给出比率置信区间 |
| 2 | `Map(R_t)` 独立映射函数 | 未实现 | 反思当前不写人格（只产出 `pending_personality_candidate`），没有可映射的目标维度；实现它需要先定义"哪类建议改哪个维度"，属产品决策 |
| 3 | OS 级断电恢复 | 未覆盖 | 只做进程强杀，未做文件系统断电/损坏模拟 |
| 4 | 多进程并发恢复 | 未覆盖 | 恢复按单进程串行设计，无跨进程锁 |
| 5 | CI | BLOCKED | 账号计费：`runner_id=0`、`steps=0`，注解为付款失败/额度不足 |
| 6 | 真实 Provider 本轮重跑 | NOT_RUN | 本会话无可用凭据；旧报告保留自身 `codeSha` |
| 7 | 安装器升级验证 | BLOCKED | 无干净测试机与旧版安装包；`package:win` 构建与"升级"是两件事 |

## 6. 隐私与凭据

- 本轮未新增任何凭据读写；测试用占位 key。
- 恢复流程只写 sanitized reason code（`INTERRUPTED`、`INTERRUPTED_UNKNOWN_OUTCOME`、`intent_without_settlement`），不含用户文本。
- 反思发现只存 id 引用；`self-model.test.ts` 断言序列化后不含用户原文。
- 本轮报告与结果文件均不含 key/token（已检查）。

## 7. 结论

- **P0-1 / P0-2 / P0-3：PASS**，均有代码、测试与机器结果三层证据；三个窗口用真实子进程 SIGKILL 验证。
- **P1-1：PASS**，未重写既有实现，全量回归绿。
- **P1-2：CI BLOCKED、真实 Provider NOT_RUN、安装器升级 BLOCKED**，均已给出原始状态与解除条件。
- **阶段二整体：PARTIAL。** 三项算法缺口闭合，三项外部条件未解除；不建议合并 PR #15。
- **阶段二自此冻结**，未完成项转入阶段三已知限制，不再开阶段二修复任务。
