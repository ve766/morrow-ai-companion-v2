# Stage 3 交付报告

- 分支：`feat/stage-3-long-term-companion`
- 基线：`feat/stage-2-delivery-hardening` @ `84670792fa08352835d4cca88da6355435ee0cd6`
- 目标分支（PR）：`feat/stage-2-delivery-hardening`
- 状态：**PARTIAL**（见 §6）
- 日期：2026-10-30

## 1. 实现摘要

本次交付两个**新的运行时算法**，并把它们接进真实回合主链；同时交付一套可执行的阶段三评测。

| 交付 | 类型 | 位置 |
|---|---|---|
| 人格有界漂移 G1 | 新算法 + 服务 + 迁移 | `src/personalization/personality-growth.ts`、迁移 29 |
| 受约束自主话题 X1 | 新算法 + 服务 + 迁移 | `src/self-model/exploration-policy.ts`、迁移 29 |
| 主链接线 | 修改 | `src/app/companion-service.ts`（`prepare` / `onTurnCompleted` / `buildSelfModelContextBlock` / hooks） |
| 装配 | 修改 | `src/app/index.ts` |
| 测试 | 新增 27 条 | `personality-growth.test.ts`、`exploration-policy.test.ts` |
| 评测 | 新增 3 个运行器 + 数据集 | `evals/stage-3/` |
| 脚本 | 新增 3 个 | `package.json` `eval:stage3*` |

## 2. 变更文件

新增：

```
src/personalization/personality-growth.ts
src/personalization/personality-growth.test.ts
src/self-model/exploration-policy.ts
src/self-model/exploration-policy.test.ts
evals/stage-3/scenarios-v1.json
evals/stage-3/runner/harness.ts
evals/stage-3/runner/cli.ts
evals/stage-3/ablation/run.ts
evals/stage-3/ablation/README.md
evals/stage-3/longitudinal/run.ts
evals/stage-3/longitudinal/README.md
evals/stage-3/results/<ts>-<sha>.json
evals/stage-3/results/<ts>-<sha>-summary.json
evals/stage-3/ablation/results/<ts>-<sha>.json
evals/stage-3/longitudinal/results/<ts>-<sha>.json
docs/reports/stage-3-baseline-and-traceability.md
docs/architecture/stage-3-cognitive-runtime.md
docs/algorithms/stage-3-algorithm-registry.md
docs/reports/stage-3-delivery-report.md
docs/audit/stage-3-independent-audit.md
docs/reports/stage-3-evidence-index.md
```

修改：

```
src/app/companion-service.ts
src/app/index.ts
src/persistence/migrations.ts   (追加 v29)
package.json                     (追加 3 个脚本)
```

## 3. 实际执行的命令与退出码

在干净工作树（无 `.git`，源码取自 `tarball/84670792…`）执行：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | **0** | 无错误 |
| `npx vitest run` | **0** | **82 文件 / 720 测试全部通过** |
| `npx electron-vite build` | **0** | 主进程 / preload / renderer 均构建成功 |
| `MORROW_EVAL_SHA=8467079… npm run eval:stage3` | **0** | 15 场景：13 PASS / 0 FAIL / 2 NOT_RUN |
| `MORROW_EVAL_SHA=8467079… npm run eval:stage3:ablation` | **0** | 4 臂；差异场景见 §4.2 |
| `MORROW_EVAL_SHA=8467079… npm run eval:stage3:longitudinal` | **0** | 6 条断言全部 PASS |

环境：Windows（win32）、Node `v22.x`、`node:sqlite`（ExperimentalWarning 属正常）、npm registry `registry.npmmirror.com`。

## 4. 评测结果

### 4.1 长期陪伴场景（`evals/stage-3/results/`）

| 场景 | 状态 | 断言要点 |
|---|---|---|
| L1 跨会话事实延续 | **PASS** | 两个会话都投递同一条记忆与事实值 |
| L2 纠正后旧值不再进入请求 | **PASS** | 旧值消失、新值出现 |
| L3 冲突与缺失 | **PASS** | 两条冲突值同时出现；无证据时 `memories` 数组为空 |
| L4 人格稳定 | **PASS** | 基线版本不变；漂移在 ±8 内；留下成长证据 |
| L5 用户兴趣 vs 自身关注 | **PASS** | 用户侧标注存在；门禁运行并留痕；自身话题标注归属 |
| L6 有依据的不同意见 | **PASS** | 固定原则仍在 system；未被迎合要求改写 |
| L7 内在状态参与表达 | **PASS** | 状态快照可读；状态进入提示词 |
| L8 兴趣形成/晋升/撤回 | **PASS** | 证据 ≥3、会话 ≥2 才晋升；归档后不进入上下文 |
| L9 反思可追溯 | **PASS** | 产出 finding；带证据引用；不改基线；回合后确实执行 |
| L10 长期目标跨会话 | **NOT_RUN** | `GoalService` 只在 Electron 主进程装配，不在 `CompanionService` 主链 |
| L11 重启后连续 | **PASS** | 重开同一 SQLite 文件后记忆仍在；人格版本不变 |
| L12 删除后派生数据不泄漏 | **PASS** | 触发器级联清除成长证据；偏移重算不保留幽灵值 |
| L13 无记忆不编造 | **PASS** | 记忆块为空；无虚构姓名 |
| L14 Provider 失败与恢复 | **PASS** | 失败抛错不伪造回复；同会话可恢复 |
| L15 多日模拟 | **NOT_RUN** | 由 `longitudinal` 运行器独立执行 |

分母 15，计入 13。**不把 NOT_RUN 计入通过率。**

### 4.2 消融（`evals/stage-3/ablation/results/`）

| 臂 | 与 full 的差异场景 |
|---|---|
| `no_growth` | **L4** |
| `no_exploration` | **L5** |
| `no_reflection` | **L9** |

每个模块都至少在一个场景里是承重的。**注意**：差异只出现在对应的单一场景，说明 15 个脚本化场景对这三个模块的覆盖很窄，不能外推为"模块整体有效"。

### 4.3 纵向（`evals/stage-3/longitudinal/results/`）

10 个合成"天" × 3 轮，全部断言 PASS：

- 漂移始终在 ±8 内；
- 用户编辑的基线版本未被改写；
- 每日自主发起次数未越界；
- 半衰期性质在纯函数上成立（`fresh=3 → aged=1.5`）。

**方法学限制**：时钟是真实时钟，"天"是三轮的区块，不是 24 小时。跨真实日历日的打扰控制**未验证**。

## 5. 真实 Provider / Electron / Windows

| 项 | 状态 | 说明 |
|---|---|---|
| 真实 Provider | **BLOCKED** | 无凭据；本次所有评测使用脚本化 Provider，只证明接线与载荷，不证明模型质量 |
| Electron 启动 / renderer smoke | **BLOCKED** | 本机 `npm run smoke` 不可用（阶段二已两次证伪为环境问题：渲染进程沙箱初始化崩溃 0x80000003） |
| Windows 安装器升级 | **BLOCKED** | 需在干净机器上「装旧版 → 覆盖装新版 → 启动 → 验数据」，本次无授权机器 |
| CI | **BLOCKED** | 账号侧 `runner_id=0 / steps=0`（阶段二记录为付款/额度问题），本分支未获得流水线执行 |

以上四项**不计入通过**，也不写成"已覆盖"。

## 6. 完成度判定

**PARTIAL。** 理由：

已完成（有可复核证据）：G1、X1、主链接线、27 条新测试、3 个评测运行器、6 份文档、全量测试与构建通过。

未完成（Issue 明确要求）：

1. **记忆巩固与按重要度的衰减/归档**（§3.2）——未实现。
2. **人格漂移的 UI 可见与用户回滚入口**（§4）——服务层有 `rollback`，界面未接。
3. **语音入口闭环**（§4）——未实现。
4. **桌面/Windows 验收**（§4）——BLOCKED。
5. **真实 Provider 行为层评分**（§5）——BLOCKED。

因此不建议按"阶段三完成"合并；建议按"阶段三第一部分"评审。

## 7. 复现步骤

```bash
npm install --ignore-scripts
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npx tsc --noEmit
npx vitest run
npx electron-vite build
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:ablation
MORROW_EVAL_SHA=$(git rev-parse HEAD) npm run eval:stage3:longitudinal
```

`--ignore-scripts` 后必须补 electron 安装，否则 7 个测试文件因缺少二进制而无法导入（环境问题，非代码缺陷）。


---

## 8. 后续交付（Issue #20）

| 项 | 结果 |
|---|---|
| F1–F6 | 已按代码级修复，有回归证据（见 `docs/reports/stage-3-followup-implementation-report.md`） |
| F7 | 降级为客观检查，模型质量 BLOCKED |
| 全量测试 | **84 文件 / 747 测试通过** |
| 新增评测套件 | `restart`（6 断言）、`long-conversation`（7 断言，30 轮 / 3 会话） |
| 迁移 | v30 / v31 / **v32 `companion-goals`** |
| 记忆生命周期（§2A） | **已实现**：重要度打分、只归档不删除、同槽合并只引用；L16 六条断言 |
| 长期目标（§2D） | **已实现**：三类归属、优先级、到期即 expired、完成即退出 payload；L10 六条断言 |
| 仍未实现 | §2B appraisal、§2C 反思质量、§2F 语音 |
| 整体状态 | **PARTIAL** |

---

## 最终纠偏轮（2026-10-31）

本轮**不是**新功能，是把上一轮被判定为「部分接线」的八项修到可验证。

| 项 | 结果 |
|---|---|
| 代码基线 | `b0e719ad116db5607295da9f5ccddc6e2f4589b4` |
| 迁移 | **v35** `effect-ledger-reflection-cursor-and-evidence-origin` |
| 新增可靠性设施 | effect ledger、reflection cursor、knowledge-gap 台账、goal 幂等键 |
| P0-1…P0-5 | 5/5 PASS |
| P1-6、P1-7 | 2/2 PASS |
| P1-8 | **BLOCKED**（无真实凭据、Actions runner 未启动） |
| 主评测 | 16 场景：**15 PASS / 0 FAIL / 1 NOT_RUN**（L15 由纵向运行器负责） |
| 消融 | 基线 15 PASS；`no_growth`→L4,L12；`no_exploration`→L5；`no_reflection`→L5,L9 |
| 纵向（10 天压缩时钟） | **7/7** 断言 |
| 重启 | **6/6** 断言 |
| 长对话（30 轮） | **8/8** 断言 |
| 全量测试 | **92 文件 / 820 测试**全通过 |
| 类型检查 | `tsc --noEmit` 0 错误 |
| 构建 | `electron-vite build` 成功（main/preload/renderer） |
| 整体状态 | **PARTIAL** |

仍未完成：真实 Provider 多轮陪伴、有效 CI、Electron 渲染层、Windows 安装升级、§2B appraisal、§2C 反思质量、§2F 语音。本轮没有新增其中任何一项，也不声称它们存在。
