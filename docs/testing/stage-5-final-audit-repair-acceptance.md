# Stage 5 最终定点修复验收（Issue #31）

- 分支：`fix/stage-5-final-closeout`（PR #30）
- 基线：`5b5b29c902db770fc4b448a0831f86e220b5addc`
- 本轮代码 SHA：`0b9071e40dea5822ac770c3f66a4ce14e39d3b99`
- 机器结果：`evals/stage-5/final-audit-repair/results/<UTC>-0b9071e….json`

每条 finding 的证据链：源码改动 → 针对性测试 → 集成/跨进程运行 → 最终 SHA。

## 1. F1 来源 fail-closed

| 要求场景 | 用例 | 结果 |
|---|---|---|
| 消息表为空 + 旧文本 | unit `refuses a source that does not exist`；integration `an obligation with no source message is refused` | PASS：零 thread/evidence，outbox done |
| 原消息删除 + 另一连接持旧 obligation | integration `a stale obligation whose message was deleted cannot revive it`；process `deleting the message … prevents projection` | PASS：证据 0，无线程 active |
| message 存在但 conversationId 不匹配 | unit `refuses a source from another conversation`；integration `a source from another conversation is refused` | PASS：`source_conversation_mismatch`，零写入 |
| SELECT 抛错/数据库异常 | integration `a database error while reading the source fails closed` | PASS：抛 `RelationshipSourceError`，零写入 |
| 合法来源 | 所有正常投影测试 | PASS |
| 删除与投影并发 | 真实进程 `deleting the message …` | PASS：删除后不复活 |
| 启动 reconcile / outbox replay / backup restore | 源码核对：所有投影只经 `observe()`；reconcile 只删不写；恢复后重启走同一路径 | PASS（源码 + 既有恢复测试） |

## 2. F3 语境与证据独立性

| 语境 | 输入 | E | rationale | Policy | 结果 |
|---|---|---|---|---|---|
| 肯定 | 我现在很烦。 | 1 | explicit_emotion_statement | acknowledge_first | PASS |
| 肯定 | 今天真的很难受。 | 1 | explicit_emotion_statement | acknowledge_first | PASS |
| 肯定 | 我撑不住了。 | 1 | explicit_emotion_statement | acknowledge_first | PASS |
| 肯定 | 这件事让我很难过。 | 1 | explicit_emotion_statement | acknowledge_first | PASS |
| 否定 | 我不是说我现在很烦。 | 0 | negated_emotion | none | PASS |
| 否定 | 我不难过，你不用安慰我。 | 0 | negated_emotion | none | PASS |
| 引用 | 你说“我现在很烦”。 | 0 | quoted_emotion | none | PASS |
| 转述 | 你刚才说我现在很烦。 | 0 | reported_emotion | none | PASS |
| 转述 | 我朋友说我最近很焦虑。 | 0 | reported_emotion | none | PASS |
| 假设 | 如果我很烦，我就先暂停一下。 | 0 | hypothetical_emotion | none | PASS |
| 混合 | 我不是真的难过，只是有点累。 | 0 | negated_emotion | none | PASS |
| 工具词 | 麻烦你帮我检查代码。 | 0 | no_distress_evidence | none | PASS |
| 工具词 | 这个操作很麻烦。 | 0 | no_distress_evidence | none | PASS |
| 否定评价 | 我不喜欢这个方案。 | 0 | no_distress_evidence | none | PASS |
| 直接请求 | 别安慰我，直接给修复方法。 | 0 | — | answer_directly | PASS |
| 直接+困扰 | 我现在很烦，别安慰我，直接给修复方法。 | 1 | — | answer_directly | PASS |
| 边界 | 你没有回答我的问题（T=0.2）。 | 0 | unresolved_tension_only | none | PASS |
| 轻度 | 我有点累。 | 0.6 | mild_without_independent_context | none | PASS |
| 轻度+独立佐证 | 我有点累，睡不着，也没力气（T=1）。 | 0.6 | contextual_corroboration | acknowledge_first | PASS |

独立性断言：`我现在很烦` 的 C=0（程度词/标点不计）；C 只来自躯体/行为线索；
T 只来自 feeling state。

## 3. F6 跨进程

| 用例 | 进程/连接结构 | 断言 | 结果 |
|---|---|---|---|
| 两进程争抢 | worker A、B 各自独立 Node 进程与 SQLite 连接；A claim 后文件屏障等待 | B `done=0,busy≥1`；A `done=1`；证据 1；ledger applied 1 | PASS |
| claim 后崩溃 | A 在 projector 内 exit 9；B 以 T+61s 接管 | B `done=1`；证据 1；applied 1 | PASS |
| 删除与投影并发 | A claim 后等待；测试用另一连接删除；放行 A | 证据 0；无线程 active；outbox 行存在 | PASS |
| 旧任务 vs 新纠正 | 旧 obligation 在新纠正后由 worker 重放 | 新值 active；旧值 superseded | PASS |
| 重复 drain | 同一 obligation 再跑 worker | pending=0；证据仍 1 | PASS |

## 4. 命令与结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 107 文件 / **1012 测试通过**（基线 993 + 19） |
| `npx vitest run src/relationship/relationship-threads.test.ts src/affective-state/distress-evidence.test.ts src/app/stage5-final-closeout.integration.test.ts src/app/stage5-final-audit-repair.multiprocess.test.ts` | 0 | **48/48** |
| `npm run eval:stage5` | 0 | 12/12 scripted |
| `npm run eval:stage5:live` | 0 | 12/12 live（spark-x2.6） |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16 |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | 成功 |
| 本机 `npm run smoke` | 1 | BLOCKED（`0xC0000005`，环境） |
| CI（本轮 head） | 见证据索引 | 新提交自己的 run |

测试环境：win32 / Node 22.23.2；跨进程测试使用 `spawn` 的独立 Node 进程，每个进程
独立 `SqliteDatabase.open(dbPath)`；不是同进程 Promise 并发。

## 5. 保持的状态

| 项 | 状态 |
|---|---|
| 真人自然度 | **PENDING_HUMAN**（盲评包 v2，增补 H–J） |
| 第二真实 Provider | **NOT_RUN**（无合法凭据/endpoint） |
| 本机 Electron smoke | BLOCKED（环境），CI 另列 |
| 历史结果 JSON / PENDING 标记 | 未改写、未升级为 PASS |

## 6. 结论

F1、F3、F6 的代码修复、针对性测试、真实进程验证和运行证据均完成；F5 外部项保持
PENDING/NOT_RUN。代码收尾为 **PASS**，整体交付仍为 **PARTIAL**。
