# 基线、祖先关系与仓库地图

## Git 基线（开工时实时核验）

- 仓库：`https://github.com/ve766/morrow-ai-companion-v2`
- 实现分支：`fix/whole-product-subject-closure-20261108`
- 分支起点：`feat/personality-affect-integration-20261108` @ `83dab6ad8b2af3b0a2d98ceb9eb342ee5f081691`
- 新 PR base：`fix/morrow-core-cognitive-closure-20261108` @ `efdbf52a25e896ee159d296944f019f9b94ab687`（PR #68 head）
- 祖先链核验：`83dab6a` → `b998886`（PR #70）→ `efdbf52`（PR #68），未 reset / force-push。
- `main`：`8b207b7d7b80b91ed4369d02fd6ef7e170b81133`，未用作实现基线，未修改。
- 参考文档：`docs/reference/morrow-2026-11-08/`（Issue #72 上传的 8 份 DOCX、同名 Markdown 与 extraction-manifest）；本任务未重复转换。

## 环境

Windows 11 x64（10.0.26200），Node v22.23.2，Electron 44.9.3，`node:sqlite` DatabaseSync，WAL + STRICT 表。

## 当前 schema

`CURRENT_SCHEMA_VERSION = 55`（`personality-affect-integration`，8 张表）。本任务不新增 schema；Issue #74 的修复复用 v55 表和既有 IPC。

## 模块地图

| 区域 | 核心入口 | 调用/持久化 | 本轮审计结论 |
|---|---|---|---|
| 窗口/启动 | `src/app/index.ts` | 窗口生命周期、provider consent 对话框、IPC 注册 | consent 始终 30 天，无 UI 选择/撤销；已修 |
| 聊天服务 | `src/app/companion-service.ts` | `ChatService.send/prepare/afterPersist`、consent snapshot、affect preview、expression、exploration | 有真实纵向链路；affect 所有权/原子性/反证有缺口；已修一部分 |
| IPC | `src/app/ipc.ts`、`src/preload/index.ts` | 类型化 IPC、校验、错误 | 缺 affect/consent management API；已加 |
| Renderer | `src/renderer/index.html`、`companion-ui.ts`、`provider-profiles-ui.ts`、`affect-ui.ts` | 会话、发送、流式、Provider 表单、设置、记忆 | 主聊天工作区已存在；缺情绪/人格/授权面板；已加 |
| Provider | `src/providers/*` | OpenAI-compatible、SSE、endpoint/model/key、consent | 核心安全与 payload hash 已有；consent 选择粒度不足；已修 |
| 记忆 | `src/memory/*` | FTS5/Fact Slot/冲突检测/RRF | 没有新增 Dense/PPR；本轮不冒充语义检索 |
| 认知 | `src/cognition/*` | analysis、outbox、reflection routing、pending、turn state | 有事务 outbox；finding→self-state 写回仍不完整 |
| 自我模型 | `src/self-model/*` | interest、self-fact、inner cognition、trait | 用户探索污染 Morrow 兴趣的风险已修；反证与 freshness 已修 |
| 情绪 | `src/affective-state/*` | emotion model/appraisal/service/affect loop | 18 family、事件/投影/revisions；mood 仍由 feeling 三维投影承担，未做独立 mood 表 |
| 持久化 | `src/persistence/*` | migrations、event log、backup、turn state | v55 前向迁移；删除/FK/clear 已有部分；trait 即时重算已补 |
| 测试/脚本 | `src/**/*.test.ts`、`tests/`、`scripts/` | full/product/smoke/eval | full suite 147 files / 1246 tests（基线前）；本任务新增 3 个回归点 |
| 打包 | `package.json`、electron-builder | NSIS/portable | NSIS 仍受 BUILD_UNINSTALLER 环境阻塞，见 `08-windows-build-and-smoke.md` |

## 已知不在本任务伪造范围的项

- 真实 cloud Provider A–K 行为盲测：本环境没有新凭据，未伪造。
- Dense/Cross-Encoder/PPR：未实现，不声称已上线。
- 真实 7 天人格数据：仍使用测试时钟模拟。
- 用户 Windows 桌面实机安装：未在用户生产数据上执行。
