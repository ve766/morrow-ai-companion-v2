# 模块依赖图（Dependency Map）

## 允许的依赖方向（→ = "可 import"）

```
observability ─（无依赖）
persistence ─→ observability（无需；实际仅 node: 内置）
security ─→ persistence(类型)            # url-gate 无依赖
shared ─→ memory(类型)/motivation(类型)/security(url-gate)/self-model(类型)   # 仅类型与纯函数
cognition ─→ shared
memory ─→ persistence(仓储接口实现), persistence(事件日志类型), shared
personality(conversation 内) ─→ persistence, shared
affective-state ─→ cognition(类型), persistence, shared
providers ─→ security(url-gate, secrets, secret-errors), shared
conversation ─→ persistence, shared
motivation ─→ memory(只读工具), persistence, shared
self-model ─→ memory(读取记忆文本), persistence, shared
app ─→ 全部模块（装配根，唯一允许触达所有模块处）
```

## 禁止的依赖（循环防护）

- 任何模块 **不得** import `app/`（装配根唯一，处于依赖图顶端）。
- `shared` 不得 import 任何模块的**实现**（仅类型/纯函数，如 url-gate 的回环判定属 security 的纯函数例外，因共享校验需要且无状态）。
- `memory` 不得 import `self-model`（反向：self-model → memory 单向）。
- `providers` 不得 import `conversation/memory/cognition`（ProviderInput 由调用方组装传入）。
- `affective-state` 不得 import `conversation`（事件由 ChatService 调用其接口传入）。
- `persistence` 不 import 任何领域模块（仓储由领域模块经接口消费；Sqlite*Repository 实现置于 persistence，实现其领域声明的 Port 接口）。

## 接口边界要点

- 领域模块声明 Port（如 `MemoryRepository`、`InterestRepositoryPort`、`SelfModelRepositoryPort`、`ReflectionRepositoryPort`、`InterestRepositoryPort`），SQLite 实现位于 persistence —— 依赖倒置，测试可注入内存实现/临时库。
- 跨模块事件统一走 `EventLogService`（persistence），领域模块只依赖 `tryRecord` 形状的窄接口（如 `MemoryEventSink`、`FeelingEventSink`）。
- ChatService 通过注入的 `SelfModelLoopHooks`（contextBlock/onTurnCompleted）与长期层交互，不直接 import self-model 服务实例类型以外的内容。

## 事件流（运行时数据流，非 import）

```
user ──IPC──▶ app/ChatService.send
   ├─▶ cognition.analyze ──────────────▶ cognitive_turn_observations
   ├─▶ memory.assembleContext ─────────▶ memories 读取
   ├─▶ personality.get / affective-state.snapshot
   ├─▶ self-model.contextBlock（兴趣+自我认识，有界）
   ├─▶ providers.dispatch（同意门禁后）
   ├─▶ conversation.appendMessage（用户+助手，幂等）
   ├─▶ affective-state.recordCompletedTurn ─▶ feeling 表 + event_journal
   └─▶ hooks.onTurnCompleted ─▶ interests.observe / self-model.record ─▶ event_journal
```
