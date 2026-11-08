# 源码审计、调用链与根因

本表使用实际符号；行号随提交变化，以符号为准。

## 1. 真实聊天调用链

```text
src/renderer/index.html #chat-form
  → src/renderer/src/companion-ui.ts submit handler
  → window.morrow.chat.send
  → src/preload/index.ts chat.send
  → IPC_CHANNELS.chatSend
  → src/app/ipc.ts createIpcHandlers → companion.sendChat
  → CompanionService.sendChat → ChatService.send
      prepare: analysis → memory → feeling preview → affect preview → expression/exploration
      authorize: src/app/index.ts requestProviderConsent
      provider: src/providers/openai-compatible.ts SSE
      persist: conversations.appendMessage(afterPersist)
          feelings.recordCompletedTurnInTransaction
          affect.recordCompletedTurnInTransaction
      innerCognition.observeTurn
  → IPC result / delta events → renderer messages
```

## 2. 已确认缺陷与修复

| 文件/函数 | 审计发现 | 根因 | 本轮修复 | 测试/证据 |
|---|---|---|---|---|
| `src/app/index.ts requestProviderConsent` | 任意 chat 都直接 `grant(scope)`，没有“仅本次/记住 30 天/取消” | 服务层默认 30 天，UI 无选择 | 三按钮原生对话框；仅本次不写 grant；敏感仍单次；记住才 `grant` | `consent-grants.test.ts` + Electron built app 手动/脚本路径；报告 `02` |
| `src/app/ipc.ts` / `src/preload/index.ts` / `contracts.ts` | 无授权列表/撤销、无 affect 状态/调节/清除 IPC | PR #70/#73 只做后端 | 新增 `affectStateGet/regulate/clear`、`consentGrantsList/revoke`；CompanionService 桥接 | `tests/ui-control-contract.test.ts`、typecheck |
| `src/renderer/src/affect-ui.ts`（新增） | 用户无法查看/调节/清除情绪与人格 | 缺 UI | 状态面板、每情绪“缓解/撤销”、清除、授权列表/撤销 | `docs/ui/control-contract.json` + UI contract |
| `src/affective-state/appraisal-engine.ts` sourceKind | 用户 `intent==='exploration'` 但无显式事件时可能变成 `morrow_self_appraisal`，curiosity `traitEligible=true` | 所有权判定只看 eventType | 新增 `userRequestedExploration`；归 shared_interaction，traitEligible=false，reasonCode | `appraisal-engine.test.ts` 新回归 |
| `src/self-model/morrow-trait-service.ts traitObservationFromEmotion` | 只产生非负 observation，没有生产反证 | 只映射情绪强度 | 新增 `counterObservationFromEmotion`；affect loop 只对已 active trait 写 counter，独立 context tag，可 weaken | `morrow-trait-service.test.ts`、`personality-affect.integration.test.ts` |
| `src/affective-state/affect-loop.ts observeThoughtReviews` | reward 先写、affect 失败被 catch，可能半状态 | 两个独立事务 + 吞异常 | 一个 SQLite transaction；affect 失败则 reward 回滚；失败记事件不静默 | `intrinsic-reward.test.ts` 真实 message FK + 回滚路径 |
| `src/affective-state/affect-loop.ts recordMorrowLoss` | emotion 与 trait 分开提交 | 两个事务 | 外层 transaction 包裹 emotion + trait | typecheck/集成测试 |
| `src/self-model/morrow-trait-service.ts current/active` | 消息删除级联 observation 后 revision 陈旧，依赖 startup | 只读缓存 | `current` 比较 observation 数；不一致立即 recompute；`active` 走 current | `morrow-trait-service.test.ts` 删除证据测试 |
| `src/renderer/index.html`/`companion-ui.ts` | 主工作区、输入、流式、取消、Provider 表单已存在；不能假设“未实现” | 历史报告未更新 | 保留并用真实 chat UI smoke 验证 | `scripts/chat-ui-smoke.mjs` PASS |
| `src/app/companion-service.ts` afterPersist | affect 与 assistant 消息同一事务；但 reward/scheduler 另开事务 | 架构边界 | reward 路径独立修正；assistant 消息 affect 仍同事务 | 集成测试 |
| `src/cognition/reflection-routing.ts` | finding 有路由，但没有直接更新 `morrow_self_states`/trait | 只到 pending/context hint | 未在本轮完整修复；标记 PARTIAL | 报告 `03` |
| `src/memory/*` | 没有 Dense/Cross-Encoder/PPR | 历史算法仍在 docs，未接生产 | 不冒充；保持现有 FTS5/RRF | 报告 `05`、`06` |
| `package.json` / electron-builder | NSIS `BUILD_UNINSTALLER` 执行中间安装器返回 null | 环境执行问题 | 重新尝试并记录；portable 仍可构建 | 报告 `08` |

## 3. UI 控件真实路径

- `#conversation-new` / `#conversation-select` / `#conversation-delete` → `conversations.*` IPC → sqlite。
- `#chat-form` / `#chat-send` / `#chat-cancel` → `chat.send` / `chat.cancel`；`onDelta` 注册/清理在 preload。
- `#provider-profile-form` / `#provider-profile-test` / `#provider-profile-discover` → provider profiles IPC。
- `#affect-refresh` / `#affect-clear` / `#consent-refresh` → 新 IPC；动态缓解/撤销按钮调用 `affectRegulate`。
- `docs/ui/control-contract.json` 已加入新控件；`tests/ui-control-contract.test.ts` 校验 selector、channel、preload、main handler。

## 4. 未修复/边界

- reflection finding → self-state 的真实写回仍未完成（见 03）。
- 独立 continuous mood 表未建；现有 `feeling.ts` 三维状态继续作为短期 mood 投影。
- 情绪“暂停”没有持久化开关；只提供调节/撤销/清除。
- 真实 cloud Provider A–K 未跑。
