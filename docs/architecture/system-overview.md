# 系统总览（System Overview）

Morrow AI Companion V2 是一个**本地优先的单应用模块化单体**（Electron + TypeScript + SQLite），核心是一个可追溯的认知闭环：用户消息经过情境理解、记忆检索、人格与内在状态读取、预算化上下文编排、真实模型调用，再回流为记忆证据、内在状态更新与长期兴趣/自我模型的演化，全部状态跨会话持久化。

本阶段产品定位：**陪伴核心**。不包含 Agent 自动操作外部软件、自动执行外部任务的能力。

## 架构分层

```
┌────────────────────────── Electron ──────────────────────────┐
│ renderer（vanilla TS UI） ── contextBridge ── preload         │
│   │ 只能通过白名单 IPC 通道访问主进程                           │
│   ▼ trusted-sender 校验                                       │
│ app/（装配根：窗口、IPC 注册、服务构造、同意对话框）             │
│   │                                                           │
│   ├── conversation/ 多轮对话与会话管理                          │
│   ├── cognition/ 轮次分析（意图/主题/信号）+ 认知开关           │
│   ├── affective-state/ 计算性内在状态（证据加权规则 v1）         │
│   ├── memory/ 可追溯记忆（来源/置信度/修订链/检索装配）          │
│   ├── personality/ 稳定人格（版本化修订，仅用户可改）           │
│   ├── providers/ DeepSeek（remote）+ 本地 OpenAI 兼容（local） │
│   ├── self-model/ 兴趣、自我模型、有界反思                      │
│   ├── motivation/ 目标审批执行、提醒                            │
│   ├── security/ 密钥存储、IPC 安全、回环门禁、请求护栏          │
│   ├── persistence/ SQLite + 版本迁移 + 备份恢复 + 事件日志      │
│   └── observability/ 结构化日志（强制脱敏）                     │
└───────────────────────────────────────────────────────────────┘
```

## 认知闭环（每轮对话）

1. **接收** `ChatService.send`：请求幂等（requestId）、会话锁、输入校验。
2. **分析** `analyzeCognitiveTurn`：意图、主题来源、话题切换、信号（纠正/改变主意/显式记忆保存/显式自我事实等），随用户消息持久化为认知观察。
3. **检索** `MemoryService.assembleContext`：关键词+CJK 二元组评分 × 置信度 × 最近确认衰减排序，敏感度过滤，字符预算 3000。
4. **读取长期层** 人格档案（版本化）+ 内在状态（预衰减）+ 活跃兴趣 + 未确认自我认识。
5. **编排** 系统提示 = 人格偏好 + 轮次引导 + 状态引导（有界措辞）+ 长期关注块 + 记忆证据 JSON + 固定原则；历史 12 条/6000 字符预算。
6. **同意** `consentPreview`：每次请求显示精确载荷哈希、字节数、包含的记忆与端点，用户逐次授权（120 秒有效）。
7. **调用** `OpenAICompatibleProvider`：DeepSeek（remote）或用户配置的本地回环端点（local）；流式、45s 超时、取消、错误映射。
8. **呈现** 流式增量转发渲染进程，助手消息入库。
9. **状态更新** 感受事件在同事务内应用到内在状态（幂等键防重放），并写入统一事件日志。
10. **长期层更新** 兴趣观察（跨会话题证据）、显式自我事实入自我模型、过期兴趣归档；全部失败安全（不阻塞聊天）。
11. **记录** 事件日志保存 memory/interest/selfmodel/feeling/app 事件链，供反思与追溯。
12. **下一轮生效** 第 5 步读取第 9–11 步的持久化结果（验收场景 G 在请求载荷层验证了这一点）。

## 降级策略

- 认知分析/感受/兴趣/自我模型任一失败：警告日志 + 聊天继续（核心持久化不受影响）。
- 数据库打开失败：启动失败对话框，不暴露底层细节（`startup-error.ts`）。
- 认知表不完整：`cognitivePersistenceAvailable=false`，认知功能退回关闭态。
- 迁移失败：v9 为命名降级锚点（`DEGRADED_OPEN_MINIMUM_VERSION`），核心聊天仍可用。

## Windows 运行

- 开发：`npm install` → `npm run dev`
- 验证：`npm run verify`（typecheck + 全部测试 + 评估 + 构建 + 真实 Electron 冒烟）
- 冒烟覆盖：真实 electron.exe 启动、safeStorage 凭据加密保存/重启读取/损坏防护/显式删除、认知显式开启与持久化、记忆生命周期、目标审批安全、提醒控制、数据删除与重启。
