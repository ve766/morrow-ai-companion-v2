# Morrow AI Companion V2

本地优先的 AI 陪伴应用：多轮真实对话、可追溯跨会话记忆、稳定人格、可计算（可持久化、可回放）的内在状态、有证据约束的兴趣与自我模型，以及一个把上述能力串成闭环的对话引擎。

> Morrow 的内在状态是**计算变量**（工程构造），不是对主观意识或真实感受的证明；系统在提示词与 UI 措辞中始终保持这一区分。

核心特性：

- **多源 Provider**：Provider（来源）/ Protocol（协议）/ Endpoint（地址）/ Model（模型）四层解耦。来源支持官方入口（DeepSeek 兼容层）、自定义 HTTPS 中转站与本机回环服务；协议当前实现 `openai-chat-completions`（含 SSE 流式），`anthropic-messages` 与 `ollama-native` 仅有接口占位、未实现。任一可启用的 Provider 均可设为默认对话通道；每次云端发送单独确认。
- **可追溯记忆**：每条记忆带来源（直接输入 / 模型推断+用户确认）、置信度、最近确认时间与完整修订链；支持纠正、撤销、恢复、删除与重复合并。
- **计算性内在状态**：valence/activation/tension + 探索优先级，事件驱动、幂等、半衰期衰减、跨会话持久化与重放。
- **长期层**：兴趣（跨会话证据、晋升门槛、自动归档）、自我模型（事实/推断/未知/纠正链）、有界反思（速率受限、证据支撑、不递归）。
- **安全边界**：凭据走 OS 级加密存储（Windows DPAPI/safeStorage）、IPC 白名单 + trusted-sender 校验、本地类出口仅回环、CSP + 沙箱、每次云端请求单独确认。
- **数据主权**：SQLite 单文件 + 版本迁移 + 备份/恢复（删除边界感知）+ 事件级审计日志。

## 架构

单应用模块化单体（Electron 44 + TypeScript + SQLite）。模块与契约见
[docs/architecture/system-overview.md](docs/architecture/system-overview.md) ·
[module-contracts.md](docs/architecture/module-contracts.md) ·
[data-model.md](docs/architecture/data-model.md) ·
[dependency-map.md](docs/architecture/dependency-map.md)。

```
src/app/            装配根：Electron 窗口生命周期状态机、IPC、同意对话框
src/renderer/src/   工作台 UI（对话/记忆/目标/设置 + 运行轨迹 inspector + 界面博物馆主题特效）
src/conversation/   会话与消息（幂等、事务）
src/cognition/      轮次分析、认知开关
src/affective-state/ 内在状态引擎与服务
src/memory/         可追溯记忆与上下文装配
src/personality/    版本化人格
src/providers/      Provider 协议与实现
src/self-model/     兴趣 / 自我模型 / 反思
src/motivation/     目标审批执行、提醒
src/security/       密钥存储、回环门禁、请求护栏
src/persistence/    SQLite、前向迁移（版本随代码演进，当前见 docs/architecture/database-schema.md）、备份、事件日志
src/observability/  结构化日志（强制脱敏）
src/evaluation/     离线评估器
tests/acceptance/   验收场景 A–H
docs/               审计、架构、算法、测试文档
```

## 安装与运行（Windows）

要求：Node.js ≥ 22.13（使用内置 `node:sqlite`，无原生编译需求）、npm 10+。

```bash
npm install          # 含 Electron 二进制与 better-sqlite3 预编译模块
npm run dev          # 启动开发实例
```

## 验证

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest 全量（数量随版本演进，以实际运行为准）
npm run build          # electron-vite 构建
npm run smoke          # 真实 Electron 冒烟（凭据生命周期/认知开关/记忆/目标/提醒/重启）
npm run smoke:product-path  # 打包产物路径 smoke（renderer 加载/IPC/迁移）
npm run verify         # typecheck + test + evaluate + evaluate:cognition + build + smoke

分层验收入口（scripts/verify/manifest.json 为唯一清单，逐项保留退出码）：

npm run verify:fast      # typecheck + 关键单测
npm run verify:full      # 全量测试 + 常规/认知评估 + build + smoke
npm run verify:product   # 真实产品路径 smoke
npm run verify:stages    # 阶段专项评估（live 项无凭据时标记 SKIPPED）
npm run verify:release   # 串联 full/product/stages 并输出机器可读汇总
```

验收场景 A–H 的自动化映射：`tests/acceptance/scenarios.test.ts`（场景说明见
[docs/testing/acceptance-report.md](docs/testing/acceptance-report.md)）。

### 使用真实 Provider 做端到端验证（持 Key 用户）

1. `npm run dev` → 设置与备份 → 「模型接入配置」→ 新建配置：填写名称、来源类型（自定义 HTTPS 中转站 / 本机回环）、协议（当前实现 OpenAI Chat Completions）、Base URL、模型 ID 与 API Key。
2. 勾选「启用此配置」与「设为默认对话 Provider」后保存（Key 只进 OS 加密存储，保存后输入框清空）。
3. 点击「测试连接」发送一次固定探测消息（会弹出逐次确认框，展示精确载荷与端点摘要）。
4. 回到「对话」发送消息：每次发送前弹出系统级确认，展示端点、模型、载荷哈希与本次包含的记忆；支持流式回复、取消与失败后重试。
5. 也可继续使用「官方 DeepSeek 连接」兼容入口或「本地模型（OpenAI 兼容）」回环通道；无显式默认 Provider 时对话优先使用已启用的本地模型。

### 运行轨迹与界面

- 右侧「运行轨迹」inspector 实时显示本轮真实调用点：接收 → 认知分析 → 上下文/记忆 → 逐次授权 → Provider 请求 → 流式回复 → 持久化 → 完成/失败/取消，含状态、原因码与耗时（每轮 ≤200 条，脱敏）。
- 设置页「界面博物馆 · 主题特效」提供 3D 透视 / 全息边框 / 粗野主义 / 纸片拼贴 / 等离子五种纯视觉主题，仅改变外观，不影响数据与权限。

## 数据与隐私

- 数据库与凭据位于系统用户数据目录（`morrow.sqlite3`、`secrets/*.bin`）。
- 记忆证据、感受事件、兴趣词项均只存**消息引用**，不重复保存原文。
- 备份/恢复：设置页导出/预览/恢复；恢复后按删除边界日志保持备份之后的删除/撤销状态。

## 文档索引

- 旧仓库资产审计：[docs/audit/legacy-asset-audit.md](docs/audit/legacy-asset-audit.md)
- 算法说明：[docs/algorithms/affective-state.md](docs/algorithms/affective-state.md) · [memory-and-interest.md](docs/algorithms/memory-and-interest.md)
- 测试与验收：[docs/testing/acceptance-report.md](docs/testing/acceptance-report.md) · [known-limitations.md](docs/testing/known-limitations.md)
- 安全：[SECURITY.md](SECURITY.md) · 变更历史：[CHANGELOG.md](CHANGELOG.md)

## 许可与状态

私有项目（继承旧仓库许可语境）。当前版本 2.0.0：模块 01–05 重建完成，验证状态见验收报告与已知限制。
