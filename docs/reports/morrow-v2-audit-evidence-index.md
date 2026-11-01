# Morrow V2 审计证据索引

> **审计基准 SHA**：`43c92813763d9ca3b524d112c231af7f75843a5e`
> 运行环境：Windows 11 / Node v22.22.2 / npm registry `registry.npmmirror.com` / `node:sqlite`（ExperimentalWarning 正常）
> 所有源码链接均固定在审计基准 SHA 上（不可变）。新增文档用相对路径（同树）。

---

## 1. 基准可证明性

| 证据 | 方法 | 结果 |
|---|---|---|
| 本地源码 = 远端提交 | 对远端 tree 每个 blob 重算 `sha1("blob <len>\0"+content)` | 496 blob：**473 一致**、1 仅行尾（归一后一致）、22 本地缺失（复跑评测时删除的旧结果文件） |
| 分支 HEAD | `gh api repos/ve766/morrow-ai-companion-v2/branches/feat/stage-3-long-term-companion` | `43c9281` @ 2026-10-30T14:21:56Z |
| 与任务书声明一致 | 任务书给定 `43c9281` | 一致，无漂移 |
| 提交链 | `compare/8467079...43c9281` | ahead 12，73 文件 |
| PR | `gh pr view 19` | OPEN / MERGEABLE / base `feat/stage-2-delivery-hardening` / 12 提交 |

复现脚本（本地已执行，未提交）：

```js
// 对 tree 的每个 blob 计算 git blob sha 并与远端比对
const tree = JSON.parse(ghApi(`repos/.../git/trees/${SHA}?recursive=1`)).tree.filter(e => e.type === 'blob')
sha1(`blob ${buf.length}\0` + content)
```

---

## 2. 门槛命令（本轮实测）

| 命令 | 退出码 | 结果 | 时间 |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | 无输出（无错误） | ~35s |
| `npx vitest run` | **0** | **Test Files 84 passed / Tests 756 passed** | 71.3s |
| `npx electron-vite build` | **0** | main / preload / renderer 全部产出（renderer js 79.73 kB） | 1.56s |
| `MORROW_EVAL_SHA=43c9281 npm run eval:stage3` | 0 | `{"PASS":15,"NOT_RUN":1}`，denominator **16** | — |
| `... eval:stage3:ablation` | 0 | 4 臂；`no_growth→L4`、`no_exploration→L5`、`no_reflection→L9` | 111s |
| `... eval:stage3:longitudinal` | 0 | PASS，7 断言，`clock:"injected"`，240 模拟小时 | 5.2s |
| `... eval:stage3:restart` | 0 | PASS，6 断言，`clock:"system"` | 1.2s |
| `... eval:stage3:long-conversation` | 0 | PASS，8 断言，30 轮 / 3 会话 | 5.1s |

**未运行**

| 命令 | 原因 |
|---|---|
| `npm run smoke` | 本机渲染进程沙箱崩溃 `0x80000003`（`--no-sandbox` 可绕过），前两轮已两次证伪为环境问题 |
| `npm run package:win` | 无干净授权 Windows 机器 |
| 真实 Provider 调用 | 无凭据 |

> 复跑产生的 5 个结果文件（`20261031T02*Z-43c9281.json`）与已提交的 `d8ee10f` 批次计数完全一致；因代码相同（`43c9281` 只新增证据文件），未重复提交。

---

## 3. 需求 → 源码 → 测试 → 评测 映射

### 3.1 运行时与 IPC

| 主张 | 源码 | 测试 |
|---|---|---|
| 三个构建目标 | [`electron.vite.config.ts:39-62`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/electron.vite.config.ts#L39-L62) | build 退出码 0 |
| 组合根 21 服务 | [`src/app/index.ts:183-405`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/index.ts#L183-L405) | `startup-error.test.ts` |
| 66 通道 / 64 handler | [`src/shared/contracts.ts:26-93`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/shared/contracts.ts#L26-L93)、[`src/app/ipc.ts:214-287`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/ipc.ts#L214-L287) | `ipc.test.ts` |
| 发送者来源校验 | [`src/app/ipc.ts:147-151`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/ipc.ts#L147-L151) | `ipc.test.ts` |
| 唯一出网点 | [`src/providers/openai-compatible.ts:269`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/providers/openai-compatible.ts#L269) | `local-provider.integration.test.ts` |
| 回环端点自证 | [`src/security/url-gate.ts:6-29`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/security/url-gate.ts#L6-L29) | `url-gate` 相关用例 |

### 3.2 认知闭环

| 主张 | 源码 | 测试 / 评测 |
|---|---|---|
| 入口与幂等 | [`companion-service.ts:1147-1188`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1147-L1188) | `turn-reliability.integration.test.ts` |
| `prepare` 被调用两次 | [`companion-service.ts:1194`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1194)、[`:1212`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1212) | `companion-service.test.ts` |
| 哈希比对防 TOCTOU | [`companion-service.ts:1213`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1213) | `turn-reliability.integration.test.ts` |
| system 数组 8 段 | [`companion-service.ts:1557-1570`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1557-L1570) | `companion-service.test.ts:282,340-344` |
| 载荷结构 | [`companion-service.ts:260-268`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L260-L268) | 同上 |
| 事务内落库 | [`companion-service.ts:1364`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1364) | `turn-state-sequence.integration.test.ts` |
| 回合后钩子 | [`companion-service.ts:1377-1393`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1377-L1393) | `cognitive-loop.integration.test.ts` |

### 3.3 P0 断链（每条都有可执行复现）

| 编号 | 主张 | 源码证据 | 复现 |
|---|---|---|---|
| P0-1 | `origin='morrow'` 无生产写入 | [`interest-service.ts:309-318`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/self-model/interest-service.ts#L309-L318)；[`reflection-service.ts:396-411`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/self-model/reflection-service.ts#L396-L411) 不传 origin | `grep -rn observeMorrow src evals` → 仅定义 + 4 处 evals |
| P0-2 | `companion_goals` 无生产写入 | [`companion-service.ts:638`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L638) 类型为 `Pick<…,'activeForContext'>` | `grep -rn "goals.create" src` → 仅测试与 harness |
| P0-3 | 成长读路径零断言 | [`companion-service.ts:1485`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1485)；[`personality-growth.ts:268-276`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/personalization/personality-growth.ts#L268-L276) | `grep -rn "Bounded style drift" src tests evals` → 仅生产者；L11 detail `{"warmth":0,"directness":0,"humor":0}` |
| P0-4 | 删消息删整条兴趣；证据表无 FK | [`migrations.ts:754-759`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/migrations.ts#L754-L759)；[`:1301`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/migrations.ts#L1301)；[`:1318`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/migrations.ts#L1318) | 3 条消息建兴趣 → 删 1 条 → 兴趣行消失、证据残留 |
| P0-5 | 评测假阳性 | [`harness.ts:196-204`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/evals/stage-3/runner/harness.ts#L196-L204) 等 16 处 | 见成熟度矩阵 §3 |
| P0-6 | 预算在拒绝时泄漏 | 预留 [`companion-service.ts:1552-1556`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/companion-service.ts#L1552-L1556)；结算仅 `:1269,1284,1377`；拒绝在 `:1204` | 两次拒绝后 `usedToday()==2` |
| P0-7 | CI job 未启动 | `gh api .../check-runs` | 三个 job `steps=0`，2 秒结束 |

### 3.4 数据血缘

| 主张 | 源码 |
|---|---|
| 16 个存活触发器 | [`migrations.ts`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/migrations.ts)（24 条语句，8 条为重建） |
| `interest_evidence` 重建时先 DROP 5 个触发器 | [`migrations.ts:1290-1298`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/migrations.ts#L1290-L1298) |
| 迁移前备份 | [`database.ts:56-79,104-105`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/database.ts#L56-L79) |
| 降级打开锚点 | [`database.ts:107-112`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/database.ts#L107-L112)；`DEGRADED_OPEN_MINIMUM_VERSION=9` |
| 备份/恢复校验 | [`backup-service.ts:321-354`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/backup-service.ts#L321-L354) |
| 删除边界只覆盖两类 | [`deletion-journal.ts:55-64`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/persistence/deletion-journal.ts#L55-L64)；`migrations.ts:411` |

### 3.5 真实环境

| 项 | 证据 |
|---|---|
| Spark 真实调用 | [`evals/stage-2/provider/phase24-real-model-26aeac7.json`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/evals/stage-2/provider/phase24-real-model-26aeac7.json) |
| 本机 Provider 假响应 | [`local-provider.integration.test.ts:38-80`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/src/app/local-provider.integration.test.ts#L38-L80)（`:70` 硬编码 `'Local model reply.'`） |
| 本机模型 NOT_RUN | `evals/stage-2/results/2026-10-29T08-35Z-local-not-run.json` |
| 安装配置（无产物） | [`package.json:45-73`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/package.json#L45-L73) |
| CI 死步骤 | [`.github/workflows/ci.yml:20-21`](https://github.com/ve766/morrow-ai-companion-v2/blob/43c92813763d9ca3b524d112c231af7f75843a5e/.github/workflows/ci.yml#L20-L21)（`npm rebuild better-sqlite3`） |

---

## 4. 评测有效性的具体证据

| 断言 | 位置 | 假通过原因 | 实测 detail |
|---|---|---|---|
| `memoryBlockEmpty` | `harness.ts:196-204` | 标记缺失返回 `true` | L3/L13 `block scan` |
| L6-1 | `harness.ts:379` | `\|\| system.length > 200` 恒真 | `919 chars` |
| L6-2 | `harness.ts:380` | 检查不存在的字符串 | `marker` |
| L7-2 | `harness.ts:396` | `includes('state')` 被记忆指令命中 | `marker` |
| L11-2 | `harness.ts:507` | 两侧全 0 | `{"warmth":0,"directness":0,"humor":0}` |
| L12-1 | `harness.ts:529` | `evidenceCount >= 0` | `evidence=0` |
| L12-3 | `harness.ts:531` | `0 <= 0` | `0 -> 0` |
| L5-6 | `harness.ts:367` | `\|\| failedStates.length === 0` | `no permission this turn` |
| 长对话 | `long-conversation/run.ts:60` | `0 <= 30` | `growth=0 exploration=0` |

---

## 5. 文档漂移

| 文档 | 说法 | 实际 |
|---|---|---|
| `README.md`、`docs/architecture/system-overview.md` | 有 `src/personality/` | 不存在；`PersonalityService` 在 `companion-service.ts:523-623` |
| 多处 | 测试数 40/268、82/720、82/726、84/747、84/756 | **84 / 756** |
| `stage-3-delivery-report.md` §4.1 | 15 场景 13 PASS / 2 NOT_RUN | 16 场景 15 PASS / 1 NOT_RUN |
| `stage-3-followup-implementation-report.md` §3 vs §4 | 两处自相矛盾（15 PASS/1 NOT_RUN vs 13 PASS/2 NOT_RUN） | 同上 |
| `stage-3-delivery-report.md` §4.1 | L10 NOT_RUN | 已 PASS（靠评测直调） |
| `evals/stage-3/longitudinal/README.md` | 「时钟是真实时钟」 | 代码注入，结果 `clock:"injected"` |
| `docs/architecture/stage-3-cognitive-runtime.md` | 引用 `:876/:1004/:1397/:1464-1476` | 实际 `:848/:957/:1147/:1470` |
| `docs/testing/acceptance-report.md` §3 | smoke 通过 ≥2 次 | `stage-3-delivery-report.md` §5：smoke BLOCKED |
| `evals/stage-3/scenarios-v1.json` | `stage-3-v1.3` | 运行器硬编码 `stage-3-v1`，从不加载该文件 |
| `package.json` | `version 1.0.0` | 对外称 V2 |

---

## 6. 本轮新增文档

| 文档 | 内容 |
|---|---|
| `docs/audit/morrow-v2-system-audit.md` | 审计总报告 |
| `docs/architecture/morrow-v2-runtime-architecture.md` | 运行时架构与源码映射 |
| `docs/architecture/morrow-v2-cognitive-loop.md` | 认知调用链逐段证据 |
| `docs/architecture/morrow-v2-data-lineage.md` | 数据血缘与失效传播 |
| `docs/audit/morrow-v2-capability-maturity-matrix.md` | M0–M6 矩阵 |
| `docs/audit/morrow-v2-risk-dependency-register.md` | P0/P1/P2 与依赖顺序 |
| `docs/governance/morrow-v2-development-baseline-v1.0-candidate.md` | 基准候选版 |
| `docs/governance/issue-20-requirement-disposition.md` | 需求逐条处置 |
| `docs/reports/morrow-v2-audit-evidence-index.md` | 本文件 |
| `docs/reports/morrow-v2-audit-delivery-report.md` | 交付总结 |

---

## 7. 未验证项（明确清单）

| 项 | 状态 | 原因 |
|---|---|---|
| 真实 DeepSeek 调用 | BLOCKED | 无凭据 |
| 真实本机模型（Ollama 等） | BLOCKED | 环境未部署 |
| Electron renderer 启动 | BLOCKED | 本机沙箱崩溃 `0x80000003` |
| Windows 安装/升级 | BLOCKED | 无干净授权机器 |
| CI 执行 | BLOCKED | job `steps=0`，平台侧未分配 |
| 真实时间跨度 | NOT_RUN | 审计轮无法产生 |
| 语音 | NOT_RUN | 无实现 |
| 真实 DPAPI 落盘 | UNKNOWN | 需 Electron 运行时 |

> 以上均**不计入任何通过率**。
