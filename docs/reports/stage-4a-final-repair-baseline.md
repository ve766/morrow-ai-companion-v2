# Stage 4-A 最终修复基线（R1–R4 复核）

- 仓库 `ve766/morrow-ai-companion-v2` · 分支 `feat/stage-4a-companion-continuity` · PR [#24](https://github.com/ve766/morrow-ai-companion-v2/pull/24)（base `feat/stage-3-long-term-companion`）
- 审阅基线 `29c2c9c0`（本机与远端一致，工作树干净）
- 迁移版本：起始 v42；本轮未新增迁移（只改行为路径与查询）

## 逐条复核（源码检查，非照抄报告）

### R1 明确记忆写入在回复之后 — 确认
- `ChatService.prepare()`（`companion-service.ts`）先 `assembleContext()` 再构造请求；
- `afterPersist()` 才把认知任务入 `CognitionOutbox`，`drainCognition()` 执行 `memory` projector；
- projector 内调用 `createExplicitFromTurn()`。
- 实测（修复前）：会话 C 的 provider 请求中**没有**操作结果，`payload` 里证据为上一轮状态；数据库在回复后变正确。

### R2 代词/纠正识别不足 — 确认
- 修复前 `prepare()` 只做有限正则的检索扩展，没有解析纠正目标；
- `createExplicitFromTurn` 的代词规则在回复后运行，且不产出“旧值→新值”的结构化结果；
- 真实运行中模型说“找不到旧记录”，而随后数据库被更新为豆豆。

### R3 Prompt 契约与时序矛盾 — 确认
- 上一轮加入的固定原则写「应用会在回复前持久化已批准记忆」，与 projector 的实际执行时机相反；
- 已在本轮改为：只有 `committed_and_verified` 操作块才允许声称已保存。

### R4 失败路径不透明 — 确认
- `prepare()` 的 `catch {}` 清空 analysis/decision/reading/memory（诊断粒度不足）；
- projector 的显式创建路径有静默 `catch`；用户可能收到“已记住”而持久化失败。
- 本轮：操作失败写分阶段脱敏事件（planning/commit/verification），操作块显式 `status=failed`。

## 本轮改动范围（只修阻断项）

1. 新增确定性 **Memory Operation Planner**（`memory-operation-planner.ts`）：none/create/correct/clarify/rejected/failed；
2. `MemoryService.executeOperation()`：同一事务执行 + 复读验证，幂等重放；
3. `prepare()` 在 provider 调用**前**执行并注入 `committed_and_verified` 操作块；两次 prepare 复用同一结果（载荷哈希稳定）；
4. 移除回复后的显式创建路径（后台认知仍走 outbox）；
5. Prompt 契约改写：只有操作块授权的才可声称保存；superseded 仅作历史；
6. 历史问句注入 superseded 值（history-only 行）；
7. live 评测改为多信号判定（新值/不否认/关系表达），边界用例独立栈。

## 未扩张

Agent、语音、UI 改版、情绪/人格系统重构、迁移表结构变更均未触及。
