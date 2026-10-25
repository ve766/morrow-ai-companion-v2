# 更新日志（Changelog）

## 2.0.0 — 2026-10-25

Morrow AI Companion V2：模块 01–05 的模块化重建与验收交付。全新 git 历史，代码自旧仓库
`next/v1-product-experience-20261025`（含 `zo` 分支 M0–M5 工作，尖端 40f70f8）经完整审计后选择性迁移；
审计报告见 `docs/audit/legacy-asset-audit.md`。

### 模块 01 — 架构、持久化与基础设施

- 模块目录重组：app/conversation/memory/personality/cognition/affective-state/motivation/self-model/providers/security/persistence/observability/shared。
- 新增统一事件日志（schema v12 `event_journal`）：append-only 事件信封（来源模块、类型、行为者、主体、关联 id、有界载荷）。
- 新增结构化日志器（键级强制脱敏、永不抛出）与启动失败安全上报（自旧 hardening 分支移植）。
- secrets 删除路径加固（可注入删除器、ENOENT 幂等）。
- 降级锚点改为命名常量 `DEGRADED_OPEN_MINIMUM_VERSION=9`：新增迁移不再可能把已降级数据库锁在门外。
- 备份恢复校验下限与锚点对齐。

### 模块 02 — 真实对话与多 Provider

- 新增**本地 OpenAI 兼容 Provider**（schema v13 重建 provider_profiles）：用户配置回环端点 + 模型名，可选口令；启用时优先于 DeepSeek。
- 回环门禁上移至 `security/url-gate`（配置保存时 fail-closed 校验 + 派发时双保险）；拒绝内嵌凭据与一切不可证明为本机的端点。
- OpenAICompatibleProvider 按 providerClass 区分 configured 语义；DeepSeek 专属 `thinking` 字段仅对 DeepSeek 发送。
- 同意对话框按通道区分措辞（本地=不出本机不计费；DeepSeek=逐次确认+费用提示）。
- 真实 127.0.0.1 HTTP 集成测试（无注入适配器）：多轮对话、凭据头仅在有凭据时发送、非回环拒绝、双通道优先级。
- 上下文预算保持：记忆装配 3000 字符、历史 12 条/6000 字符、载荷上限 64KB。

### 模块 03 — 记忆与稳定人格

- 记忆溯源升级（schema v14，含 memory_suggestions 重建以保持外键有效）：来源三分类、置信度 1–100、last_confirmed_at、confirm 转移。
- 重复合并：归一键相同的再次输入转化为对原记忆的确认（revision+1、置信度+5、新近度刷新），不再分叉。
- 保守冲突标记：CJK 二元组词项共享 ≥2 时记录 `memory.conflict_flagged`（建议性，不阻塞）。
- 检索排序加入置信度与 30 天半衰期新近度；180 天未确认判 stale；上下文载荷携带逐条来源与置信度。
- 人格保持仅用户可改 + 版本修订 + 恢复为新增版本（继承旧实现，测试保留）。

### 模块 04 — 计算性内在状态

- 感受事件应用汇总写入统一事件日志（详细证据保留在感受表）；幂等、衰减、限幅、基线恢复语义不变。
- 算法文档化：`docs/algorithms/affective-state.md`（维度定义、预设增量、权重公式、边界措辞）。
- 验收场景 C/G 固化为自动化测试（确定性衰减、状态进入请求载荷的对照证据）。

### 模块 05 — 兴趣、自我模型与有界反思（新实现）

- 兴趣（schema v15）：词项集话题身份（CJK 二元组+拉丁 token）、强度/置信度确定性曲线、晋升需 ≥2 会话且 ≥3 证据、30 天自动归档、用户状态控制（dropped 终态）。
- 自我模型：fact/inference/unknown/correction，纠正 = supersede 链（旧条目保留可查）。
- 有界反思：单趟、findings 上限 8、候选兴趣上限 1、6 趟/小时硬限速、绝不自触发；findings 全部带证据引用。
- 闭环接线：轮次完成 → 兴趣观察 + 显式自我事实；下一轮系统提示携带带限定的长期关注块（验收场景 G 在请求载荷层断言）。
- IPC：兴趣/自我模型/反思的完整只读与用户控制通道。

### 测试与验证

- 40 个测试文件 / 268 个测试全部通过；`tsc --noEmit` 干净。
- 新增 `tests/acceptance/scenarios.test.ts`：验收场景 A/B/C/E/F/G/H（D 在 self-model 套件）。
- Windows 真实 Electron 冒烟通过（重复执行稳定）：构建、safeStorage 凭据保存/重启/损坏防护/删除、认知 opt-in、记忆、目标、提醒、数据删除与重启。
- 修复：迁移 v14 期间发现的旧索引名冲突与 memory_suggestions 外键悬空；smoke 重启检查的竞态；迁移 v12 期间的 `event_log`→`event_journal` 命名冲突。

### 已知限制

见 `docs/testing/known-limitations.md`（DeepSeek 真实 Key 验证受环境阻塞、NSIS 打包未执行、兴趣/自我模型暂无专属 UI 面板等 13 项）。
