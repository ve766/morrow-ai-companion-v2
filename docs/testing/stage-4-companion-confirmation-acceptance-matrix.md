# Stage 4 产品闭环验收矩阵（Issue #37）

代码 SHA `7b83fea`；机器结果 `evals/stage-4-companion-confirmation/results/<UTC>-7b83fea….json`。

## 1. Reflection routing / pending lifecycle

| 要求 | 测试 | 结果 |
|---|---|---|
| open_question 从 producer 到 pending item | `reflection-routing.test.ts` “registers open_question…” | PASS：route=pending_user、item.findingId 正确 |
| 自动反思与手动入口同 finding 只产生一个 item | “keeps its dropped status…” / dedupe 既有用例 | PASS |
| 每个 producer kind 都有且仅有一个 route | “covers every finding kind…”（规范 domain 列表） | PASS |
| 未知 kind fail-closed 并留审计事件 | “records unroutable kinds…” | PASS |
| accepted/rejected/dismissed 三条路径 item/route 一致 | “accepted, rejected and dismissed converge…” | PASS：done+consumed / dropped+rejected / dropped+dismissed |
| 同一决策重复调用幂等 | 同上 accepted replay | PASS：`unchanged` |
| 终态后相反决策 conflict | 同上 | PASS：`conflict current=accepted` |
| 事务中途故障 item 与 route 同时回滚 | “rolls the item back when the route terminal write fails” | PASS：ABORT 触发器后 item open |
| 拒绝后重复 ingest/重启不复活 | 既有 rejected 用例 + upsert 语义 | PASS |
| 审计事件不含 statement 原文 | “writes a sanitized audit event” | PASS |

## 2. Goal candidate confirmation

| 要求 | 测试 | 结果 |
|---|---|---|
| 无可解析期限的明确承诺生成 candidate，不生成 goal | `goal-lifecycle.test.ts` “creates a candidate with the raw horizon…” | PASS |
| 可解析期限保持既有行为 | “writes the resolved deadline…” / goal time cases | PASS（未回归） |
| question/negation/quote/hypothetical/role-play 不产生 candidate | `readGoalUtterance` gate cases | PASS |
| list 返回 pending candidate（含 owner/due） | `listCandidates` + IPC list 用例 | PASS |
| accept 后 goal 出现、candidate 不再 pending | “accepts a candidate atomically…” | PASS |
| reject 后 goal 不出现、candidate 消失 | “reject is durable…” | PASS |
| 双击/并发 accept 只创建一个 goal | accept 重放用例 + 唯一键 | PASS |
| 重复 reject 幂等 | “reject is durable…replayed: true” | PASS |
| 来源删除后不能接受为有效目标 | “a disappeared source persists expired…” | PASS：status=expired、source_state=source_deleted 持久 |
| 重启后 candidate/goal/rejection 一致 | 服务测试 + SQLite 持久化；重启由 P09 既有覆盖 | PASS（持久状态） |
| owner=user/shared 不变 | candidate/goal 断言 owner | PASS |
| UI 真实调用 bridge | `tests/goal-candidates-ui.test.ts` 2 用例 | PASS：accept/reject 均调用 `window.morrow.companionGoals` |
| IPC 参数校验/错误结构 | `ipc.test.ts` 候选用例 | PASS：list/accept/reject + 非 UUID 拒绝 |

## 3. 全量回归

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 108 文件 / 1025 测试 |
| `npm run build` | 0 | 成功 |
| `npm run eval:stage5` / `:live` | 0 | 12/12 / 12/12 |
| `npm run eval:stage3` / `:stage4a` | 0 | 15+1NOT_RUN/16 / 7/7 |

## 4. 外部项（未改写）

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | BLOCKED（环境；CI 另列） |

## 5. 结论

BL-01、BL-02、目标候选服务/UI 闭环全部通过可执行测试；无 FAIL。
