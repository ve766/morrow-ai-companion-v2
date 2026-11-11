# Outbox 跨进程不变量与删除竞态

对应实现：`src/app/cognitive-outbox.ts`、`src/app/effect-ledger.ts`、
`src/relationship/relationship-threads.ts`（F1/F6，代码 SHA `0b9071e`）。
本文说明 claim/lease/ack/删除/恢复的真实边界，以及真实 OS 进程测试的结构。

## 1. 状态机

| 任务要求 | 实现 |
|---|---|
| pending | `cognitive_outbox.status='pending'` |
| processing + lease | `cognitive_effect_ledger.state='running'`、`claim_owner`、`lease_until = now + 60s` |
| committed | `outbox.status='done'` + ledger `applied` |
| retryable failure | outbox 回 `pending`、attempts+1；ledger `failed_retryable`（lease 清空） |
| dead_letter | outbox `failed`（≥5 次）；ledger `terminal_failed` |
| 删除取消 | `cognitive_outbox_cancel_with_message`：pending → cancelled |
| 崩溃恢复 | 启动 `drainCognition()`；`running` 行在 lease 过期后可被接管 |

一次 drain 的单模块顺序：

```
pending() 读取行
  → ledger.begin(identity)         [事务：INSERT ... ON CONFLICT DO NOTHING; 条件 UPDATE]
      ├─ 'applied' → outbox done（replayed，不执行副作用）
      ├─ 'busy'    → 保持 pending，另一个 owner 正在执行
      └─ 'run'     → projector.project(input)
                       → observe() [事务：读来源 + 写证据/线程/事件]
  → ledger.complete(identity)       [条件：claim_owner = 本 worker]
  → outbox mark done
  catch → ledger.fail(identity)     [failed_retryable / terminal_failed]
        → outbox pending / failed
```

## 2. Claim 的原子性

`begin()` 在一个 `database.transaction()` 内：

1. `INSERT ... ON CONFLICT(turn_id, module, handler_version, effect_key) DO NOTHING`；
2. 条件 `UPDATE`：
   ```
   SET state='running', claim_owner=?, lease_until=?, attempts=attempts+1
   WHERE ... AND state IN ('pending','failed_retryable')
   ```
   或
   ```
   WHERE ... AND state='running' AND lease_until < now
   ```
3. `changes === 1` 才返回 `run`；否则读行返回 `applied` 或 `busy`。

SQLite `BEGIN IMMEDIATE` 获取写锁；两个独立连接/进程的 claim 串行化，只有一个 changed=1。
`workerId` 是每个 ledger 实例的随机 id，`complete`/`fail` 都带 `claim_owner = workerId`，
避免一个 worker 完成另一个 worker 的 claim。

## 3. 跨进程时序

### 3.1 两进程争抢

```
A: begin() ──changed=1──> running(lease=T+60s) ──projector 等待屏障
B: begin() ──changed=0──> 读行 running, lease 未过期 ──> busy, 行保持 pending
A: go ──> observe 写证据 ──> complete(applied) ──> outbox done
```

测试断言：B `done=0,busy≥1`；A `done=1`；证据 1；ledger `applied` 1。

### 3.2 claim 后崩溃与租约接管

```
A: begin() → running(lease=T+60s) → process.exit(9)（projector 内，业务写前）
B (clock=T+61s): begin() → lease 过期 → 条件 UPDATE 接管 → observe 写证据 → done
```

测试断言：A exit 9；B `done=1`；证据 1；ledger applied 1。

### 3.3 删除与投影并发

```
A: begin() → running → projector 等待
T: 另一连接 DELETE message → 触发器删证据/清指针/tombstone；outbox pending→cancelled
A: go → observe 事务内 SELECT message → 不存在 → skipped=source_missing → 零写入
   → outbox mark done
```

若删除发生在 A 的 observe 事务提交之后，删除触发器会在同一事务内清掉证据；最终证据仍为 0。
两种交错都满足“删除后不复活”。

### 3.4 旧任务与更新决定

`observe()` 使用 obligation 的原始 `occurredAt`；`supersedeIfStale()` 把
`lastSeenAt > input.at` 的更新值保留为 active，把旧值标为 `superseded`。
跨进程 worker 重放旧 obligation 的结果与单进程一致。

## 4. 不变量

| 不变量 | 保证方式 | 证据 |
|---|---|---|
| 最多一个有效 claim owner | 条件 UPDATE + `BEGIN IMMEDIATE` + 60s lease | 两进程测试 |
| 成功投影只发生一次 | effect ledger `applied` 短路；证据 `(thread,message)` 唯一 | 两进程 + 重复 drain |
| 删除后不复活 | v46 触发器 + observe 事务内来源校验 | 删除并发测试 |
| 旧任务不覆盖新决定 | `lastSeenAt > at` + `supersedeIfStale` | 跨进程旧任务测试 |
| 失败可恢复、不永久卡死 | `failed_retryable` + 退避；`terminal_failed` 可见 | 既有 outbox 测试 + 崩溃接管 |
| 同一消息不重复计权 | 证据主键 + outbox 幂等键 | 重放测试 |

**幂等与“只执行一次”的边界：** 若一个慢 worker 的租约过期、另一个 worker 接管，
两个进程可能都执行 projector。业务写是幂等的（evidence `ON CONFLICT DO NOTHING`、
upsert 复用线程），最终状态只一份；effect ledger 记录接管的 owner。测试验证的是
**状态只发生一次**，不是“代码绝不执行两次”。这是一致性不变量，不是分布式互斥的
强声明。

## 5. 真实进程测试结构

`src/app/stage5-final-audit-repair.multiprocess.test.ts`：

1. 用 esbuild 把 `evals/stage-5/final-audit-repair/worker.ts` 打成 `.mjs`；
2. `spawn(process.execPath, [bundle, dbPath, turnId, clockIso, barrierDir, mode])`；
3. 每个 worker `SqliteDatabase.open(dbPath)`，拥有独立连接；
4. claim 后用 `ready-<pid>` 文件通知测试；测试放行用 `go` 文件；
5. `Atomics.wait(..., 25ms)` 轮询屏障；20s timeout 仅作挂死保护，不是竞态手段。

测试覆盖：两进程争抢、崩溃接管、删除并发、旧任务重放、重复 drain。

## 6. SQLite 边界

- WAL 模式 + `busy_timeout=5000`；写事务串行化。
- 跨进程删除与 observe 写事务互斥；删除若先提交，observe 读到缺失；若 observe 先提交，
  删除触发器清理证据。
- 不声称跨机器分布式一致性：这是单机本地数据库，适用边界为同一数据库文件的多进程。
- 若未来引入多写实例/网络存储，需要重新评估文件锁与 lease 语义。
