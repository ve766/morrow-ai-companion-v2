# Morrow AI Companion V2

本地优先的 AI 陪伴应用：多轮真实对话、可追溯跨会话记忆、稳定人格、可计算（可持久化、可回放）的内在状态、有证据约束的兴趣与自我模型，以及一个把上述能力串成闭环的对话引擎。

> Morrow 的内在状态是**计算变量**（工程构造），不是对主观意识或真实感受的证明；系统在提示词与 UI 措辞中始终保持这一区分。

核心特性：

- **双模型通道**：DeepSeek（云端，逐次同意 + 载荷哈希校验）与本地 OpenAI 兼容服务（仅回环地址，数据不出本机）；本地启用时优先。
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
src/app/            装配根：Electron 生命周期、IPC、同意对话框
src/conversation/   会话与消息（幂等、事务）
src/cognition/      轮次分析、认知开关
src/affective-state/ 内在状态引擎与服务
src/memory/         可追溯记忆与上下文装配
src/personality/    版本化人格
src/providers/      Provider 协议与实现
src/self-model/     兴趣 / 自我模型 / 反思
src/motivation/     目标审批执行、提醒
src/security/       密钥存储、回环门禁、请求护栏
src/persistence/    SQLite、迁移 v1–v15、备份、事件日志
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
npm run typecheck    # tsc --noEmit
npm test             # vitest 全量（40 文件 / 268 测试）
npm run build        # electron-vite 构建
npm run smoke        # 真实 Electron 冒烟（凭据生命周期/认知开关/记忆/目标/提醒/重启）
npm run verify       # 上述全部
```

验收场景 A–H 的自动化映射：`tests/acceptance/scenarios.test.ts`（场景说明见
[docs/testing/acceptance-report.md](docs/testing/acceptance-report.md)）。

### 使用真实 DeepSeek Key 做端到端验证（持 Key 用户）

1. `npm run dev` → 设置页 → 粘贴 DeepSeek API Key → 保存（Key 只进 OS 加密存储）。
2. 点击“测试连接”（发送一次固定探测消息）。
3. 新建对话并连续对话若干轮；每次发送前会弹出逐次确认框，展示精确请求载荷与所选记忆。
4. 本地通道：设置页“本地模型（OpenAI 兼容）”填 `http://127.0.0.1:<port>` 与模型名（llama.cpp server / LM Studio / Ollama 等），启用后自动优先于 DeepSeek。

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
