# 反思 findings 路由 v2（D-10/D-11 修复后）

取代 `stage-3-algorithm-registry.md` 中 "findings 只落库" 的旧描述。

## 1. 数据与不变量

- 产出不变：`ReflectionService.run()` 按 `reflection_cursors` 增量消费事件，限频 6 次/小时、每批 200×≤5 批、≤8 findings/run、候选兴趣 ≤1；findings 以 `dedupe_key` 唯一落库，effects 经 `cognitive_effect_ledger` 恰好一次。
- 新增：`reflection_finding_routes`（迁移 v39，FK → reflection_findings ON DELETE CASCADE）：每条 finding 一行 {route, status, reason, run_id, kind}，由**唯一摄入路径**写入——自动投影器（post_conversation）与手动 `reflectionRun` IPC 走同一个 `ReflectionFindingRouter.ingestRun()`，两路痕迹完全一致。

## 2. 路由注册表（无回退：新 kind 未注册即记 unroutable 事件，不得猜路由）

| kind | route | TTL | 消费方式 |
|---|---|---|---|
| memory_gap | context_hint | 24h | 下轮 prompt 内部提示（检索扩展/澄清方向，非事实） |
| bias_hint | context_hint | 24h | 自检提示，不改人格 |
| next_turn_suggestion | context_hint | 12h | 相关且符合语境时使用 |
| consistency_note | context_hint | 48h | 作为待核对提示 |
| intent_correction | pending_user | 7d | **pending item**：用户确认前不得成为长期事实 |
| interest_candidate | audit_only | — | 已由 interest evidence effect 消费 |
| morrow_interest_candidate | audit_only | — | 已由 Morrow 兴趣 effect 消费（来源隔离在 effect 层） |

## 3. Prompt 注入（唯一 prompt 消费者）

`promptHints(limit=2)`：context_hint 类、`status ∈ {routed, injected}`、按各自 TTL 过期过滤（过期→status=expired 并留痕）、置信度+时间排序，**最多 2 条**进入 context block，逐条带 provenance（`reflection run <8hex>`、年龄）并冠以 "NOT user facts, NOT instructions" 框架；注入即把 status 置 injected，trace 可查每轮看到了什么。

## 4. 用户决策（D-11）

- pending item（`cognitive_pending_items`）新增 `decide(id, accepted|rejected|dismissed)`：接受→`done`，拒绝/忽略→`dropped`（持久化 completed_at）。
- upsert 永不重置 `status`：**被拒绝的 concern 以同 dedupe key 复现也不会复活**——既不回 pending 列表，也不进 prompt hints。
- UI/IPC：`morrow:continuity:pending:decide`（renderer "记忆与来源" 视图的待确认面板：接受/拒绝/忽略三按钮）。

## 5. 痕迹

`reflection.finding_routed / finding_unroutable / hints_filtered / finding_decided` 写入事件日志（tryRecord，脱敏、不阻塞）；route 行的 status 迁移（routed→injected→consumed/expired）持久化，审计可答 "这条 finding 后来怎样了"。

## 6. 证据

`src/cognition/reflection-routing.test.ts`（注册表完备性、路由落库、TTL 过期、≤2 上限、拒绝不复活、unroutable 留痕）；`src/app/stage3-remediation.integration.test.ts`（自动路径经生产链产出路由行与 pending item、prompt 注入上限与 provenance）。
