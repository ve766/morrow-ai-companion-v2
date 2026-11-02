# 最终产品运行时映射（真实调用链 / 事务边界）

分支：`release/morrow-v2-final-delivery`。每一步都是生产代码路径，不是 eval 旁路。

## 1. 一轮对话的完整链路

```
sendChat(requestId, content)
  ├─ replay 检查（同 requestId 已有 assistant → 返回存储回复）
  ├─ drainCognition()            # 先清更早的 pending obligation
  ├─ prepare()
  │   ├─ 认知分析（intent/uncertainty/signals）
  │   ├─ 记忆检索：权限/状态过滤 → 词法/槽位/值/事实四通道 → RRF(k=60) → 冲突标注
  │   ├─ MemoryOperationPlanner → executeOperation()   # create/correct 事务内验证
  │   ├─ 关系线程读取（activeThreads）→ 连续性块
  │   ├─ feeling state（有界）→ deriveExpressionPolicy（E/C/T/D 语境作用域）
  │   └─ system prompt 组装（人格 + 证据 + 操作块 + 连续性 + 策略 + 原则）
  ├─ consent（payload hash）→ Provider（URL gate / loopback / 超时分类）
  ├─ 事实守卫（无证据断言改写）
  └─ [事务] assistant 消息 + outbox(其余模块)；用户消息事务已含 relationship obligation
       └─ drain → relationship projector → observe()[写事务内读来源]
```

## 2. 事务边界

| 边界 | 内容 | 失败语义 |
|---|---|---|
| 用户消息事务 | user message + relationship obligation | 任一失败全部不提交 |
| assistant 事务 | assistant 消息 + 其余认知 obligation + 知识缺口 | 回滚则本轮未发生 |
| 记忆 create/correct | 记录 + revision + 事实账本 + 验证 | 验证不符→回滚；索引降级→recovery_required |
| 关系 observe | 读来源 + 写证据/线程/事件 | 来源缺失/错会话→零写入；查询失败→outbox 重试 |
| effect claim | ledger 条件 UPDATE + lease_generation | 旧代际 complete/fail 被拒绝（lostLease） |
| 删除 | messages 级联 → v46 触发器删证据/tombstone + outbox cancel | 删除后任何路径不复活 |
| 备份恢复 | staged 迁移 + deletion journal replay + 原子交换 → relaunch | 恢复失败保持原库 |

## 3. 持久化与恢复

- schema v47；迁移逐版本事务化，升级前 `VACUUM INTO` 快照（保留 2 份）。
- 启动顺序：迁移 → 关系 reconcile（schema≥46，fail-closed）→ 服务装配 →
  interrupted turns 恢复 → outbox drain → IPC/窗口。
- 降级打开（迁移失败、≥v9）：核心聊天可用；reconcile/投影按能力跳过并留痕。

## 4. 安全边界

- 远程 provider 走注册表固定 endpoint + 模型形状校验；本地 provider 仅 loopback。
- API key 仅进 OS 加密 SecretStore；DB/日志/IPC/评测无明文（smoke 断言）。
- 每次外发请求都有 consent + payload hash；64KB 上限；重定向拒绝。

## 5. 交付产物

- Windows x64 NSIS：`release/Morrow-Setup-2.0.0-x64.exe`（SHA-256 见证据索引）。
- CI 在最终 head 上运行 ubuntu/windows typecheck+tests+build+Electron smoke 与 Windows 升级路径。
