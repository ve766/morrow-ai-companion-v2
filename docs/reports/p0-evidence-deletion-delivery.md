# Issue #83 交付报告：证据可信性、删除传播与认知恢复

## 0. 结论

- 仓库：`ve766/morrow-ai-companion-v2`
- Draft PR：#84 https://github.com/ve766/morrow-ai-companion-v2/pull/84
- Branch：`fix/morrow-p0-evidence-deletion-closure-20261110`
- Base：PR #82 head `dc2743d7a3877a56db4d3d3bb55feb574dc1a8e8`
- **最终代码 SHA**：`b229c1ae3005dbee2790e208df258363867a1b8d`
- 报告内容对应文档 HEAD：`13c13959cca205584f216513f9895bd8f2f3aa98`（JSON 的 finalHead 记账提交在其后一个 commit，不改变代码 SHA）
- Schema：v59（本 Issue 未新增迁移）
- 总体状态：**PARTIAL**。P0-A 与 P0-B 的代码闭环为 DONE；P0-C、P0-D 的主要生产路径和测试为 DONE，但仍列出未覆盖的验收子项，因此不把整个 Issue 标成 PASS。
- PR #82 未被 reset/force-push/覆盖；`main` 未修改；没有合并、关闭或发布 Release。

## 1. P0-A — 启动一致性 fail-closed（DONE）

旧代码在 `src/app/index.ts` 对 deletion journal replay、self-state revalidate、investigation recovery 分别 `catch` 后只写 warning，然后照常构造 CompanionService。删除/撤回未完成时仍可能发送旧派生上下文。

现在：

- `src/app/cognition-reconciliation.ts` 是唯一的启动/重试函数；
- `src/app/cognition-consistency.ts` 持有 `ready|locked`；
- `ChatService.send` 在 provider 配置和上下文组装之前调用 `assertReady()`，锁定状态抛 `COGNITION_LOCKED`；
- renderer 显示“数据一致性检查未完成，暂不可发送消息”横幅、稳定 reason code 和“重试检查”按钮；
- IPC 新增 `morrow:cognition:consistency:status` / `:reconcile`，bridge 为 `window.morrow.cognition.consistency()/reconcile()`；
- 锁定期间 inner-cognition scheduler 直接返回，不生成新 Thought 或关闭 Investigation。

故障注入测试证明了 journal 读取失败、self-state revalidation 失败、investigation recovery 失败都会锁定，且 provider 调用次数为 0；修复后重试解锁并保留会话历史。

## 2. P0-B — 证据父链与自身状态（DONE）

旧 `extractParentIds` 用 `filter(isUuid)` 静默丢弃非法父 ID；`verifyPersistedSource` 先递归父链、后检查当前 event 自身 subject，导致“父节点有效”可以掩盖“当前节点已删除/撤回”。

现在：

- `parseParentIds` 返回 `absent | empty | valid | malformed`，malformed 细分 `not_array / non_string / invalid_uuid / duplicate / too_many`；
- 当前 event 的 subject/deletion journal 检查在父链之前；
- `inner.thought.*`、`reflection.*`、`summary.*`、`synthetic.*` 无完整父链时拒绝，不能伪装 origin；
- Synthetic lineage 节点永不计独立来源；
- 稳定拒绝码由 `REFLECTION_GATE_REASONS` 提供，审计不写用户原文；
- 历史不完整记录保持 `legacy_unverified`/`malformed_parent_chain` 拒绝，不自动升级为 Morrow。

## 3. P0-C — 删除传播（PARTIAL）

新增 `src/persistence/source-validity.ts`，`ChatService.deleteConversation` 与 `MemoryService.retract/delete/restore` 接入：

- conversation：递归 lineage 失效、reflection findings/routes 删除、pending items 置 `dropped`、personality candidates 删除、outbox `cancelled`、effect ledger `terminal_failed + source_invalidated`、turn/relationship/context 投影删除、self-model 条目 retracted、goals 来自删除消息时 cancelled、仅由该会话支撑的 memories retracted 且 fact records 删除、interest evidence 删除并触发 reconcile；
- memory：lineage 标记、memory/fact/interest evidence 删除；restore 只恢复显式 origin，派生节点不自动复活；
- mood：`MoodService.deleteConversation` 删除来源 impulse 并重放剩余时间线；
- Provider payload：测试先断言“删除前包含 ORCA-831”，删除后下一次 payload 不包含；
- 审计：只写计数/ID，不写被删 statement。

**未完成子项：**

- 当前产品没有单条 message 删除 API，B2 单消息路径为 `NOT_RUN`，没有伪造。
- B1 尚未在一条测试里同时驱动 Mood/Reflection/Thought/Interest 四个投影；这些投影各自的删除测试存在，但不是一个完整纵切。
- B7 备份恢复复用了同一启动函数，现有 backup restore 测试覆盖 journal merge；没有单独做“restore + 注入 replay 错误 → lock”的组合测试。

## 4. P0-D — Inner Cognition 事务与 Outbox（PARTIAL）

`ConversationRepository.append` 的 `afterPersist` 确实在同一个 `database.transaction()` 内；`observeTurn` 的 Thought 写入与 review 也在该事务的 savepoint 内。故障注入测试让 `observeTurn` 抛错，assistant message 被回滚，证明不存在“消息已提交、观察丢失”的窗口。

Outbox 没有新建第二套队列；保留原有 `CognitionOutbox` + `CognitiveEffectLedger`：

- 执行前校验 message/conversation 仍存在；
- projector 返回后再次校验；若删除赢得竞态，重新执行幂等 invalidation 并取消 row；
- `cancelRow` 将 outbox 置 `cancelled`，ledger 置 `terminal_failed/source_invalidated` 并清 claim；
- 旧 worker 的 `complete` 被 generation 围栏拒绝；
- 同一 message drain 10 次只产生一个逻辑 effect；
- 多进程测试继续覆盖 claim/busy、lease 过期接管、旧 worker 不能 mark done、删除与 claim 并发。

**未完成子项：** Issue 列出的六个精确崩溃点没有逐个注入；现有证据覆盖 assistant 事务回滚、claim/lease/delete 边界和 10 次重放，D1 因此是 PARTIAL。

## 5. 验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| gate targeted：`npx vitest run src/self-model/reflection-state-gate.test.ts` | 21 tests PASS |
| P0 integration：`npx vitest run src/app/p0-evidence-deletion.integration.test.ts` | 12 tests PASS（A/B/C/D 场景） |
| full `npx vitest run` | 151 files / 1295 tests；连续两轮全绿（日志见结果目录） |
| `npm run build` | exit 0；main/preload/renderer 产物 |
| built chat smoke | PASS（含 consistency IPC ready 检查） |
| installed chat smoke | PASS（`C:\morrow83test\Morrow.exe`） |
| portable chat smoke | PASS（`C:\morrow83portable\Morrow.exe`） |
| install `/S /D=C:\morrow83test` | exit 0，19 files，Morrow.exe 存在 |
| uninstall `/S` | exit 0，目录删除 |
| CI | 两个 workflow 均为 manual-only；未请求 runner token，`NOT_RUN` |

## 6. Windows 包

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `C:\morrow-out\Morrow-2.0.0-x64-custom-setup.exe` | 158,336,891 | `ea8855e5f81e611a073889610deb5c2e5dcf048af30473498cb35d4cee645d6c` |
| `release\Morrow-2.0.0-x64-portable-p0.zip` | 162,767,754 | `6bc7a13e7b8645eb36fea4014709a09b00687824a0a94cbbd887d82ebd0ee635` |

包构建自代码 SHA `b229c1a` 的 `out/`。独立状态：BUILT / INSTALL_VERIFIED / APP_STARTED / CHAT_VERIFIED / UNINSTALL_VERIFIED（安装与便携分别验证）。安装路径 `C:\morrow83test`、`C:\morrow83portable` 均为新建隔离目录；未触碰 V1 数据。

## 7. 迁移与旧数据

本 Issue 没有新表或新列，schema 保持 v59；没有清库、删表或重置用户数据。旧证据处理：

- 缺来源：`legacy_unverified` 拒绝，不默认 `morrow`；
- 父字段畸形：`malformed_parent_chain` 拒绝，不改写成 origin；
- 旧 lineage 只有真实 source 才惰性写入 origin；
- 显式 restore 只恢复 origin，派生节点等待重新派生，不会自动复活。

## 8. 外部状态（沿用准确标记，不改 PASS）

- 真实云 Provider：`BLOCKED_NO_SECRET`（无 `MORROW_TEST_API_KEY` / `DEEPSEEK_API_KEY`）。
- 原生 consent 人工点击：`PENDING_HUMAN`；自动化只记录 `auto:false`、`grant:false`、随后 `remember:true`，没有独立观察到人类点击。
- CI：`NOT_RUN`（manual-only workflows，未请求 runner token）。

## 9. 固定交付物

- `docs/audit/p0-evidence-deletion-root-cause.md`
- `docs/architecture/evidence-deletion-runtime-contract.md`
- `docs/testing/p0-evidence-deletion-acceptance.md`
- `docs/reports/p0-evidence-deletion-delivery.md`（本文件）
- `docs/reports/p0-evidence-deletion-evidence-index.md`
- `evals/p0-evidence-deletion/results/<timestamp>-b229c1a....json`
- `docs/reports/results/p0-evidence-deletion/run-20261110T1600Z-b229c1a/`
