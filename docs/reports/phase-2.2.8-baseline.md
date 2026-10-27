# Phase 2.2.8 — 基线与分支状态

日期：2026-10-28  
状态：实施前基线，非验收结论。

## 仓库与分支

| 项 | 实测值 |
|---|---|
| 仓库 | `ve766/morrow-ai-companion-v2` |
| 远端 `main` | `8b207b7d7b80b91ed4369d02fd6ef7e170b81133` |
| PR #4 状态 | **OPEN**，非 draft |
| PR #4 HEAD | `25e80004256a597eaf8d0b8c8c01eb0f8431c9e8` |
| PR #4 base | `feat/phase-2-companion-core` @ `e252d062581bc6aacc5f1197ff52693f8a944358` |
| PR #4 CI | 三个 job 全部 success（run 40534067789） |
| 诊断运行代码 | `1bd5468d81460b3c0138d945e59df8a81a4cfd88` |
| 修复分支 | `fix/memory-reliability-v0.1`，从 `25e8000` 建立 |
| 修复工作区 | `E:/opencode/morrow-v1-fix-v0.1`，初始 clean |
| 算法分支 | `research/cognitive-update-pack-v0.1` @ `0f44aa617942883cb2684f4bc45316ca6d0fc461` |
| 算法工作区 | `E:/opencode/morrow-v1-cognitive-v0.1` |

本地原分支的远端跟踪引用在 fetch 后显示 `[gone]`，但本地 HEAD 与 GitHub PR #4 head 完全一致；这是 remote 名称从 `ssh/phase-2.2-memory-reliability` 变为 `ssh/feat/phase-2.2-memory-reliability` 造成的跟踪名变化，不是提交丢失。

## 1bd5468 与 25e8000 是否同一实现

`git diff 1bd5468..25e8000` 的所有变更均为新增文档/证据：

- `docs/reports/engineering-audit-and-real-model-readiness.md`
- `docs/reports/memory-pipeline-diagnostic-20261027.md`
- `docs/reports/evidence/memory-pipeline-20261027/*`

`src/`、`package.json`、`package-lock.json`、`vitest.config.ts`、`.github/` 的差异为空。因此：

- **最新运行时实现与诊断报告一致**；
- 诊断运行仍必须绑定 `1bd5468`；
- 文档提交 `25e8000` 不能被称为一次新的真实模型运行。

## 已有算法包真实状态

- 分支并非空分支，已有 blueprint、数学规格、算子目录、评测计划和独立 JS 原型。
- `MATHEMATICAL_SPEC.md` 位于 `research-pack/cognitive-update-pack/`，不是仓库根目录；不得覆盖。
- 已有 O-03/O-04/O-05/O-06 等参考实现，但之前 CHANGELOG 明确记录“测试已编写、尚未在本环境执行”。
- 原型未被正式运行时导入，继续遵守该边界。

## 本轮执行约束

- 主项目修复只落在 `fix/memory-reliability-v0.1`。
- 算法研究只落在 `research/cognitive-update-pack-v0.1`。
- 不合并 PR、不修改 `main`、不发布、不调用付费云模型、不读取凭据。
- A1 未达标前，不宣称 A2–A4 已完成认知可靠性修复。
- `uncertain` 不得用于包装已知错误；测试预期不得下调。
