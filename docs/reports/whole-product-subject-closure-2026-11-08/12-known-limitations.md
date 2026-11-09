# 已知限制（只列真实阻塞/未实现）

## 发布

- **electron-builder NSIS BLOCKED**：两次 HTTP 504；没有生成 electron-builder installer。已用缓存 NSIS 手动编译 `Morrow-2.0.0-x64-custom-setup.exe`（158,377,586 bytes，PE/Nullsoft 标记有效），但静默安装在本环境 exit 2，未标记安装 PASS；旧 189,809-byte stub 未运行。
- Portable runtime 已用当前 `out/` + `package.json` 重打包 `app.asar`，并通过 `smoke:product-path`（隔离 profile）；但它不是安装器，也没有升级/卸载脚本。
- 用户 Windows 桌面实机安装/升级：PENDING_USER_ACTION；未在 Morrow V1 或生产 userData 上执行。
- 签名：未配置，unsigned；未伪称签名。

## 真实 Provider

- 真实 cloud Provider 的 A–K 情绪/人格/表达盲测：NOT_RUN。
- 本任务用 loopback HTTP SSE 验证真实 UI→IPC→ChatService→Provider→持久化；不要求用户提供新密钥。
- Provider quota/auth/timeout 分支未在本环境实跑；现有错误映射保留。

## 算法

- A1 Dense/Cross-Encoder、A2 HippoRAG/PPR、F1 CLS/双时态、G1 ToM/主观逻辑：NOT_IMPLEMENTED/EXPERIMENTAL。
- C1 fractional Beta、H1 ECE/Brier/NLL、E1 VoI/VoC：NOT_IMPLEMENTED；当前是 bounded score/启发式，不称概率。
- 100/500/1000/5000 记忆基准：NOT_RUN；无 Dense 模型、无固定 corpus、无对照。

## 主体/情绪/人格

- reflection finding → self-state gate 已实现（v55 表 + reflection-state-gate + 4 tests）；仍缺完整 ChatService→producer→router 的 live 集成测试 → PARTIAL。
- thought 仍主要由 uncertainty/correction/predictionError 触发；没有从历史兴趣/目标冲突主动生成新问题。
- continuous mood：v56 独立状态 + pause/resume + UI 已实现；真实模型 A/B 行为差异仍 PARTIAL。
- sadness/loneliness 自动 loss：只有显式 `recordMorrowLoss`；生产只接 knowledge gap→concern。
- anger/fear：UNIT_ONLY，无稳定生产场景。
- 情绪暂停：已实现 mood pause/resume（v56 + UI）；event emotion 仍可记录，只暂停 mood dynamics。
- 真实 7 天人格数据：测试时钟模拟。
- 单条消息删除的 UI 路径：未在真实 Electron 中执行；trait 读时重算已覆盖 DB 级删除。

## UI/Consent

- 原生 consent 三按钮（取消/仅本次/记住 30 天）已实现，但 CDP 无法点击 OS 对话框；自动 chat smoke 使用 acceptance-only `MORROW_ACCEPTANCE_AUTO_CONSENT=1`，产品默认仍弹窗。按钮点击为 PENDING_HUMAN。
- UI 停止/重试有 handler 和 service cancel 测试，但没有新增 Electron 点击取消 E2E。
- 情绪面板现包含 mood 暂停/恢复；原生 consent 对话框点击仍 PENDING_HUMAN。

## 测试/CI

- Hosted/self-hosted CI 未运行；不声称 CI PASS。
- `npm run verify:full/product/release` 的完整 tier 组合未全部重跑；本报告只列实际运行的命令。
