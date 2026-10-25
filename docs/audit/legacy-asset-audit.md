# 旧仓库资产审计（Legacy Asset Audit）

- 审计对象：`github.com/ve766/morrow-ai-companion`（private，默认分支 `main`，最后活动 2026-10-22）
- 审计日期：2026-10-25
- 审计方式：克隆全部 31 个远程分支；不只看文档与 PR 描述，逐分支核对提交、代码、依赖、调用路径、数据结构与测试；在被审计的代码上实际执行 `tsc --noEmit` 与完整 vitest 套件（231/231 通过）。
- 约束遵守：旧仓库与 `zo` 分支只读，未做任何修改；本仓库为全新 git 历史，未合并旧分支。

## 一、分支谱系

旧仓库存在一条线性 M0→M5 演进链（`zo` 分支为其起点段），后续分支依次叠加：

```
main ── zo(+12) ── acceptance/cognitive-core-alpha(+4) ── next/provider-manual-chat(+2)
       ── next/v1-core-gaps(+2) ── feat/backup-restore-boundary(+1)
       ── next/v1-core-closure(+2) ── next/v1-rc-gates(+3)
       ── next/v1-memory-goals(+6) ── next/v1-product-experience(+1)  ← 全链尖端 40f70f8
fix/m0-m5-hardening（+3，独立演化，未并入尖端）
manus、ui、opencode、coilpot、docs/*（旁支或已并入 main）
```

## 二、逐类资产结论

| 资产 | 来源分支 | 核心文件 | 审计结论 | 迁移决定 |
|---|---|---|---|---|
| M0 Electron 安全骨架（CSP、沙箱、可信渲染源、IPC 校验） | `zo` 3118e98 | `src/main/index.ts`、`security.ts`、`ipc.ts` | 已实现且测试通过（IPC/安全测试在套件内） | 迁移 |
| M1 可追溯记忆（修订链、纠正/撤销/恢复、敏感度、上下文装配） | `zo`、`review/m1-traceable-memory`、`m0/foundation` | `memory-service.ts`、`memory-repository.ts`、`memory-domain.ts`、`memory-context-assembler.ts` | 已实现且测试通过；缺置信度/来源分类/自动去重（V2 补齐） | 迁移并扩展 |
| M2 受限目标执行（单目标+只读工具+审批门+审计） | `zo` 5a1c754 | `goal-service.ts`、`goal-store.ts`、`tool-registry.ts`、`shared/goals.ts` | 已实现且测试通过；是执行安全骨架而非兴趣/目标生成系统 | 迁移；V2 在其上新增兴趣/自我模型 |
| M3 离线影子评估 | `zo` c4a1f20、`fix/m0-m5-hardening` | `src/evaluation/*` | 已实现且测试通过 | 迁移 |
| M4 同意式本地提醒 | `zo` 0c8ee7d、3d36161 | `reminder-service.ts`、`reminder-store.ts`、`reminder-policy.ts` | 已实现且测试通过；hardening 分支另有加固未并入 | 迁移（尖端版）；hardening 差异记录在案不移植 |
| M5 DeepSeek 连续对话 + 认知状态循环 | `zo` 3330b3c、714aea8 | `companion-service.ts`、`cognitive-feeling-engine.ts`、`cognitive-feeling-service.ts`、`cognitive-turn-analyzer.ts` | 已实现且测试通过；仅 DeepSeek 单通道（V2 补本地 Provider） | 迁移并扩展 |
| 认知 Alpha 验收（生命周期测试、Windows 验收器） | `acceptance/cognitive-core-alpha-20261024` | `src/evaluation/cognitive-alpha-evaluation.ts` 等 | 已实现且测试通过 | 迁移 |
| Provider 手动聊天 + Windows SQLite 冒烟 | `next/provider-manual-chat-20261024` | `openai-compatible.ts`、`provider-policy.ts`、`scripts/smoke.mjs` | 已实现且测试通过 | 迁移 |
| 凭据失败关闭、负载上限、同意哈希 | `next/v1-core-gaps-20261025` | `provider-policy.ts`、`provider-secret-errors.ts` | 已实现且测试通过 | 迁移 |
| 备份/恢复 + 删除边界日志 | `feat/backup-restore-boundary` 193eb5d | `backup-service.ts`、`deletion-journal.ts` | 已实现且测试通过（含防篡改/预览令牌/边界重放） | 迁移 |
| 出口门禁（local 类仅回环） | `next/v1-core-closure-20261025` 5f6d5ef | `provider-policy.ts` 的 `isLoopbackEndpoint` | 已实现且测试通过；V2 将其上移到 `security/url-gate` 供共享校验复用 | 迁移并上移 |
| 删除墓碑、按类审批、schema 门禁 | `next/v1-rc-gates-20261025` | `deletion-journal.ts`、`migrations.ts` | 已实现且测试通过 | 迁移 |
| 记忆时间线/目标证据 UI、v1.0.0 候选 | `next/v1-memory-goals-20261025` | `memory-timeline.ts`、`goal-evidence.ts`、renderer | 已实现且测试通过 | 迁移 |
| 陪伴优先导航 Shell | `next/v1-product-experience-20261025` 40f70f8 | `shell-ui.ts`、renderer | 已实现且测试通过 | 迁移（尖端） |
| M0-M5 可靠性加固 + 符号链接拒绝 | `fix/m0-m5-hardening` c81f419、4078295 | `startup-error.ts`、`secrets.ts` delete、`reminder-service` 大改 | 与尖端已分叉演化：`startup-error` 与 secrets delete 加固可独立移植；companion-service/reminder-service 大改与尖端冲突 | **选择性移植**（startup-error、secrets delete）；其余不移植，理由：尖端版本拥有更完整测试覆盖（231 通过），整体回移风险大于收益 |
| 浮动 UI、打包冒烟 | `manus`、`ui` | renderer | 旁支，与尖端 Shell 重复 | 不迁移 |
| 文档分支（算法规格 v1.1/v1.2/v1.3 等） | `docs/*`、`ve766-*` | docs | 已并入 main 的文档资产 | 参考用途；V2 重写为与实现一致的文档 |

## 三、实证验证记录

在尖端分支 `next/v1-product-experience-20261025`（40f70f8）工作树上，本机（Windows 10.0.26200，Node 22.23.2）：

- `npm install`（含 Electron 二进制与 better-sqlite3 原生模块重建）：成功
- `npx tsc --noEmit`：0 错误
- `npx vitest run`：32 个文件 231 个测试全部通过

ZO 分支验收报告与代码核对结论：报告所述 M0–M5 与认知状态循环均能在代码与测试中对应，未发现“仅文档无实现”或“以 Mock 冒充实现”的虚报；Mock 仅出现在测试注入点（`FetchLike`、`MemorySecretStore`），属合理的离线测试设计。

## 四、迁移原则执行情况

- 新仓库 `morrow-ai-companion-v2` 全新 git 历史（初始提交为迁移说明，非 merge）。
- 未合并任何旧分支；代码从尖端工作树复制后按模块重组。
- 每个职责只有一个权威实现（例如循环端点门禁只存在于 `security/url-gate.ts`，provider-policy 仅再导出）。
- 未丢弃已验证的算法、测试、迁移与安全机制；V2 的 v12–v15 迁移直接叠加在旧 v1–v11 历史上并保留其 fail-closed 语义。
- 旧仓库与 `zo` 分支零改动。

## 五、遗留与风险

- `fix/m0-m5-hardening` 的 reminder-service 加固（+164 行）与 companion-service 凭据处理改写未移植；潜在收益记入 `docs/testing/known-limitations.md`。
- 旧仓库 UI 分支（`ui`、`manus`）的浮动球界面未迁移（与 V2 Shell 重复）。
- 旧算法规格文档与 V2 实现存在措辞差异（V2 为证据加权规则 v1）；以 V2 文档为准。
