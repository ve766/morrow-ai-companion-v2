# 审计驱动修复（Issue #78）

## P0-A Reflection provenance fail-closed

- 根因：`ReflectionStateGate` 默认 owner=morrow，rootSourceId 可回退 findingId，router 未传可验证 lineage。
- 修复：`reflection-state-gate.ts` 从 `reflection_findings.evidence_json` 解析真实来源 ID，逐个 `resolveOwner()` 查 `event_journal`/`memories`/`self_model_entries`；无来源/未解析/owner 非 morrow 直接拒绝并记录 decision；rootSourceId 必须属于 finding 的 evidence ids。
- `cognition.knowledge_gap` / `inner.thought.*` → morrow；memory/user → user；其他 system。
- 独立数按 distinct root/correlation cluster，不按 runId/findingId。
- 测试 `reflection-state-gate.test.ts`：两独立 root 晋升；同 root 100 findings 只 1；伪造 root 拒绝；idempotent；counter weaken；低置信拒绝。
- 仍缺：递归祖先环/缺失/retracted root 的完整拒绝与重算；当前直接父/根检查，非完整 DAG 遍历。PARTIAL。

## P0-B Synthetic provenance

- `synthesizeFromContext` 不再生成随机 turn/conversation/message UUID；evidence 使用 `synthetic:true` + 空 ID，`independentContexts` 排除 synthetic；reward 也过滤 synthetic。
- Shared/User interest 不生成 actor=morrow thought（synthesize 只接受 origin=morrow）；X1 `exploration-policy` 也只允许 origin=morrow。
- 测试 `inner-cognition.test.ts`：synthetic + 1 real 仍 ≤1 独立，不 active。
- 仍缺：从真实 P0-A/P0-C 的深入 investigation 生成 synthetic discovery 的完整生命周期。

## P0-C Conversation deletion

- `InnerCognitionService.deleteConversation()` 在同一 repository transaction 内删除引用该 conversation 的 thoughts，并把引用该 conversation 的 states 标为 retracted；`ChatService.deleteConversation` 已调用。
- 测试：删除后 thought 0、state retracted。
- `AffectLoopService.deleteConversation` 仍只删 emotion events/trait observations 并重建情绪投影；reflection findings/route 和 mood 的 per-source rebuild 未完整实现 → PARTIAL。
- `cognitive_outbox` 已有 message delete trigger，但 reflection consumption 仍需统一 source-validity 查询 → PARTIAL。

## P0-D InnerCognition outbox

- 当前 `innerCognition.observeTurn` 仍在 assistant message commit 后单独调用；崩溃窗口仍存在。
- 本轮未把 inner observation 加入现有 `cognitive_outbox`（缺少 result_message_id/reply text 的可恢复投影）。
- 仍记录 degradation，未伪造 PASS。PARTIAL。

## P1-A Mood time semantics

- `applyEvent` 在 paused 时完全抑制自动事件、不写 revision。
- `applyEvent` 与 `setPaused` 使用 `effectiveAt=max(current.evaluatedAt,input)`，持久化 evaluatedAt/lastAdvancedAt 单调；时钟回拨不回退。
- 测试：pause 前 10 分钟先衰减；暂停 2 天冻结；暂停事件不变；resume 后 10 分钟继续衰减；重复 pause；DB persisted timestamp ≥ start。
- 仍缺：mood per-event source ledger 与 conversation deletion rebuild → PARTIAL。

## P1-B G1/G2 separation

- 未修改 `personality-growth` 的 G1/G2 双写；用户 style 请求仍可能进入 `personality_growth_signals` 并影响 effective profile。
- 这是确认缺口，未冒充修复。PARTIAL。

## P1-C Exploration lifecycle

- X1 shared interest 已排除；goal stall 的 scheduler 接入仍未完成；完整 investigation state machine 未实现。
- inner cognition 的候选问题/review 是可运行子集，不等同完整生命周期。PARTIAL。

## P1-D / P1-E

- 100/500/1000/5000 memory benchmark：NOT_RUN。
- 真实 cloud Provider：NOT_RUN；loopback chat UI smoke PASS。
- electron-builder NSIS 504；自定义 NSIS BUILT_NOT_INSTALL_VERIFIED；portable smoke PASS。
