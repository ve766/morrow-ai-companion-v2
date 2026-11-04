# Stage 4 产品闭环收口报告（Issue #37）

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-4-companion-confirmation-closure`（自 `3812b185…`）
- 基线 SHA：`3812b185398c0442fcc0d0ba5b180713cafee1d9`（PR #35 head）
- 代码 SHA：`7b83fea8aa9ec7847bf47541e49dde073137059f`
- PR：[#40](https://github.com/ve766/morrow-ai-companion-v2/pull/40) → base `release/morrow-v2-final-delivery`（不指向 main）
- PR #35 保持原样，未合并、未改 base/head。

## 1. 结论

| 项 | 状态 |
|---|---|
| BL-01 反思路由 `open_question` | **FIXED** |
| BL-02 pending 决策终态 | **FIXED** |
| 长期目标候选服务契约 | **FIXED**（reject 持久化/审计/冲突；来源失效持久 expired） |
| 目标候选 IPC + preload + UI | **FIXED**（真实 bridge，真实列表/确认/拒绝） |
| 全量测试 | 108 文件 / **1025 测试通过** |
| typecheck / build | 0 / 成功 |
| Stage 5 scripted/live | 12/12 / 12/12（代码同链） |
| 真人盲评 / 第二 Provider / 真机安装 | 仍 PENDING_HUMAN / NOT_RUN / PENDING_HUMAN（未改写） |

## 2. BL-01：`open_question` 路由

**根因**：`reflection-routing.ts` 维护了与 `self-model-domain.ts` 平行的 kind 列表，
域/数据库/映射已支持 `open_question`，registry 漏注册，导致生产端 finding 进入
`unroutable` fail-closed 分支。

**修复**：

- `REFLECTION_FINDING_KINDS` 直接复用 domain 的规范列表（单一来源），future kind 不再分叉。
- `FINDING_ROUTES.open_question` → `pending_user`，TTL 7 天；理由：
  “Morrow 自己形成但尚未解决的问题，由用户决定是否值得处理”。
- `ingestRun` 把 `findingId` 传入 `PendingCognitionService.absorbReflection`，待处理项
  与 route 建立稳定链接；自动/手动入口共用同一 upsert 去重键。
- 摘要继续使用 category template + digest，不写 finding 原文；未知 kind 仍 fail-closed
  并记录 `reflection.finding_unroutable`。

## 3. BL-02：pending 决策终态

**状态机**：

```
open --accepted--> done      route: consumed
open --rejected--> dropped   route: rejected
open --dismissed-> dropped   route: dismissed
done/dropped --same decision--> unchanged（幂等）
done/dropped --opposite-------> conflict（不覆盖）
```

**实现**：

- v48 迁移为 `cognitive_pending_items` 增加 `finding_id`、`decision` 与索引；历史行保留，
  两列为 NULL（旧项仍可决策，route 更新仅在 finding_id 存在时执行）。
- `SqlitePendingItemRepository.decide()` 在**一个事务**内：校验 item → 条件 UPDATE
  （`status='open'`）→ 更新 `reflection_finding_routes` 的终态 → 写确定性审计事件
  `pending.decision`（仅 ids/状态/decision，无原文）。
- 同一决策重放返回 `unchanged`；终态后相反决策返回 `conflict`；不存在返回 `not_found`。
- route 写失败（触发器/约束）→ 事务回滚，item 仍为 open（测试用 ABORT 触发器验证）。
- 拒绝后重复 ingest：upsert 不重置状态，route `ON CONFLICT DO NOTHING`，不复活。

## 4. 长期目标候选

### 4.1 服务契约

- `decideCandidate(id, 'accept'|'reject')` 是唯一事务路径，返回
  `accepted | rejected | not_found | conflict | source_unavailable`。
- 接受：来源校验 + `createInner` 目标 + candidate accepted + 审计事件同事务；
  重复接受返回同一 goal（replayed）。
- 拒绝：pending→rejected，幂等重放；与接受互为 conflict。
- **来源失效修复**：事务内发现来源缺失/已删除时，先持久化 `status='expired'`、
  `source_state='source_deleted'`，返回 `source_unavailable` 并在事务外由
  `acceptCandidate` 抛出原有 TypeError——不会再因抛错回滚过期标记。
- 审计：`goal.candidate_decision`（candidateId、decision、owner、due 是否设置），
  不含标题/来源正文。

### 4.2 IPC / preload / UI

- 新 channel：`morrow:companion-goals:candidates:list|accept|reject`。
- 校验：`parseGoalCandidateIdRequest`（UUID）；仅可信 renderer；错误走 `IpcResult`。
- preload bridge：`window.morrow.companionGoals.{listCandidates,acceptCandidate,rejectCandidate}`。
- 目标视图新增“长期目标候选”面板：从 bridge 读取真实 pending candidate；展示标题、
  owner（你/共同/Morrow）、时间表达或解析日期；确认/拒绝调用真实 IPC；接受后刷新正式
  目标列表，拒绝后从列表消失；文案明确“确认后才会成为目标”。
- 重复点击：操作期间按钮禁用；终态冲突由服务返回并显示，不本地隐藏。

## 5. 测试与命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无错误 |
| `npx vitest run` | 0 | 108 文件 / **1025 测试通过** |
| 定向 5 文件 | 0 | **79/79**（routing 10、goal-lifecycle 28、ipc 20、pending、renderer 2） |
| `npm run eval:stage5` / `:live` | 0 | 12/12 / 12/12 |
| `npm run eval:stage3` / `:stage4a` | 0 | 15+1NOT_RUN/16 / 7/7 |
| `npm run build` | 0 | 成功 |

关键新增测试：
- `reflection-routing.test.ts`：open_question 路由与 findingId 链接；accepted/rejected/
  dismissed 的 item+route 终态；同决策幂等、相反决策 conflict；route 写失败回滚；
  审计不含原文。
- `goal-lifecycle.test.ts`：reject 持久化/审计/幂等/conflict；accept 重放同一 goal；
  来源失效持久 expired；accept-vs-reject 只留一个终态。
- `ipc.test.ts`：候选 list/accept/reject 转发与 UUID 校验。
- `tests/goal-candidates-ui.test.ts`：DOM stub 验证面板从 bridge 读取并调用真实
  accept/reject（不是本地数组）。

## 6. 未完成 / 外部项

| 项 | 状态 |
|---|---|
| 真人自然度 | PENDING_HUMAN（沿用 A–J 盲评包） |
| 第二真实 Provider | NOT_RUN |
| 真机安装/升级 | PENDING_HUMAN |
| 本机 Electron smoke | 环境 BLOCKED（CI 另列） |

未把 PENDING_HUMAN / NOT_RUN / BLOCKED 写成 PASS；未合并任何 PR，未推 main。

## 7. 与 PR #35 的差异

只新增本任务的路由/决策/候选 UI 与 v48 迁移；未修改人格、记忆、检索、Provider 架构或
已通过的算法参数。PR #35 的 Stage 5 人工门槛不变。
