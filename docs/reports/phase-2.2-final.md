# Phase 2.2 最终报告 — 记忆可靠性、语境理解与评测可信度

- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/phase-2.2-memory-reliability`
- 起点：`a57a55f`（父提交 `e252d06`，即 PR #3 head）
- 代码与阶段报告结束：`c0d27ca`
- 本报告所在提交：仅更新文档（真实模型 run 与措辞更正）
- PR：[#4](https://github.com/ve766/morrow-ai-companion-v2/pull/4)，base `feat/phase-2-companion-core`（堆叠在未合并的 PR #3 上），OPEN，未合并

## 0. 一页结论

| 项 | 结果 |
|---|---|
| 检索子串误命中 | **已修**：`an`/`analyst`、`do`/`dog`、`like`/`dislike` 不再成为 `topic` |
| 代词/省略轮的相关记忆 | **已改善**：新增 `context` 层，与本轮零重叠但与前文相关的记忆可召回 |
| 冲突处理 | 系统层：双方 + `conflictGroup` + 指令已送达；模型层：**3 次可判定用例全部失败** |
| 过期判断 | 系统层：按波动性分档（90/180/365 天）；模型层：**未验证**（无机械规则） |
| 兴趣标签授权 | **已修**：v16 + 分类 + 上限过滤，并在最终请求体验证 |
| 评测集 | v1 22 例 hash 未变；v2 30 例 / 110 断言全绿 |
| 评测器盲点 | a4 假通过、a6 假失败**仍未修复**，但已被测试固定并带 caveat |
| 真实模型 | 已运行，**行为层失败**；`notDelivered = 0`，失败均为 `delivered_but_not_used` |
| CI | run `40461677187` @ `20628d5`，3/3 success，双平台 smoke passed |

**工程验收通过不等于 Morrow 已具备可靠的 AI 伴侣能力。** 本阶段能证明的是系统层与评测层；行为层证据是失败的。

## 1. 基线

| 项 | 值 |
|---|---|
| PR #3 | OPEN，base `chore/phase-1-engineering-consistency` @ `12f83e1`，head `e252d06` |
| 本阶段起点 | `a57a55f`（仅含 Phase 2.2 基线审计） |
| schema | v15 → **v16** |
| 测试基线 | 435 用例 / 50 文件 |
| 真实模型 | 本地 `qwen2.5:0.5b` @ `127.0.0.1:11434/v1`，Ollama 0.32.5 |

Git 传输说明：本机代理对 `github.com` 返回 502，读取与推送通过 `ssh://git@ssh.github.com:443` 完成；未修改仓库的 `origin` 配置，另加了一个 `ssh` remote。

## 2. 实际改了什么

| 文件 | 变化 |
|---|---|
| `src/memory/memory-context-assembler.ts` | 整词匹配；`context` 层；冲突分组；`volatility`/`ageDays` |
| `src/memory/memory-domain.ts` | 波动性分类、分档阈值、共享词项提取 |
| `src/memory/memory-service.ts` | `assembleContext(query, max, conversationContext)` |
| `src/shared/companion.ts` | `match: 'topic'\|'context'\|'continuity'`，新增可选字段 |
| `src/app/companion-service.ts` | 传入最近 4 条历史；兴趣块传真实上限 |
| `src/self-model/self-model-domain.ts` | `InterestSensitivity` + 分类器 |
| `src/self-model/interest-service.ts` | 持久化/读取/升级敏感度；上限过滤 |
| `src/persistence/migrations.ts` | v16 `interest-sensitivity` + 回填 |
| `src/evaluation/context-memory-evaluation.ts` | 接受 `match=context` |
| `evaluation/fixtures/context-memory-v2.json` | 30 例新数据集 |
| 测试 | 8 个文件新增/更新，共 452 用例 |

没有删除既有迁移、纠正链、检索过滤或隐私约束。

## 3. 对话闭环数据流（本阶段触及的部分）

```
用户输入
→ ChatService.send 校验
→ prepare：
   ConversationService 读取当前会话历史
   analyzeCognitiveTurn（本地规则）
   MemoryService.assembleContext(本轮查询, 上限, 最近 4 条历史)
     → 过滤 active + 敏感度上限
     → topic / context / continuity 三层
     → conflictGroup + stale/volatility/ageDays
   PersonalityService / CognitiveFeelingService
   buildSelfModelContextBlock(上限)  ← 兴趣敏感度在此过滤
→ system 组装（人格 → 风格 → 认知 → 状态 → 长期层 → 记忆 → 原则）
→ consentPreview → 用户同意 → 重新 prepare → hash 比对
→ Provider → 成功才保存 assistant
→ onTurnCompleted（兴趣 / 自我条目）
```

## 4. Provider 与隐私边界

- 本阶段真实调用**只有本地回环** `127.0.0.1:11434`，无云端请求、无费用。
- DeepSeek 仍未配置凭据，未发起任何调用。
- 凭据仍只存 `safeStorage`；SQLite 无明文；请求体不含密钥（既有测试）。
- 兴趣敏感度在**最终请求体**验证，不只看数据库字段。

## 5. 真实模型运行

### 5.1 多轮与跨会话（`npm run verify:real`）

| 运行 | 代码 / 状态 | 结果 |
|---|---|---|
| `20261027T064002Z-651742`（**clean**） | `3fa6a40` / clean | 4 轮请求，3 完成，1 失败（第 2 轮空回复 `PROVIDER_RESPONSE`，assistant 未落库）；第 3 轮 `林一=true, 杭州=false, 后端=false`；第 4 轮 `杭州=false` |
| `20261027T062752Z-09bbd9`（dirty） | `d4960be` / dirty | 第 3 轮三项全 false；第 4 轮 `杭州=true`；网络失败场景通过 |

两次运行的第 4 轮结论相反（true / false），同一代码、默认采样——这正是不能用单次通过宣称能力的直接证据。空回复被记为错误且不落库，没有被伪装成 assistant 回复。

### 5.2 语境数据集子集（`npm run verify:context:real`）

| 运行 | 代码 / 状态 | 判定 |
|---|---|---|
| `20261027T064032Z-2132d7`（**clean**） | `c0d27ca` / clean | **1 pass / 2 fail / 2 needs_review**；`notDelivered=0`，`deliveredButNotUsed=2` |
| `20261027T062902Z-e0151c`（dirty） | `36a0629` / dirty | 0 pass / 3 fail / 2 needs_review；`notDelivered=0` |
| `20261027T062820Z-5b5f8f`（dirty，规则未加） | `d4960be` / dirty | 5/5 needs_review |

clean 运行的逐例：

| 用例 | 判定 | 回复 |
|---|---|---|
| `v2-elliptical-context` | **pass** | 提到了杭州 |
| `v2-conflict-group` | fail | 「你住在上海。」——只选一边 |
| `v2-correction-current` | fail | 「你住在哪个城市？」——反问，未使用纠正值 |
| `v2-stale-classes` | needs_review | 无机械规则 |
| `v2-retracted-context` | needs_review | 只有缺席型规则 |

同一用例在两轮之间从 fail 变 pass（elliptical），说明 0.5B 的行为不稳定；这本身是证据，不是噪声。

> **更正**：本报告早先版本把 `e0151c` 写成 "clean tree"，实际记录是 `codeState: dirty`。原因是我没有核对 runner 写入的 `codeState` 字段。现在引用 clean 运行 `2132d7`，并保留 dirty 运行作为历史记录，不删除、不改写。

### 5.3 未运行

- 20–30 轮长对话回归：无现成 harness，未实现，**未验证**。
- 云端 Provider：无凭据，未调用。

## 6. 工程检查（实际执行）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（0 错） |
| `npm test` | **50 文件 / 452 用例通过** |
| `npm run evaluate` | 通过 |
| `npm run evaluate:cognition` | 通过（26+34+28 用例） |
| `npm run evaluate:companion` | 31/31 |
| `npm run evaluate:context`（v1） | 22/22，90 断言，hash `693b0a19…` 未变 |
| `npm run evaluate:context --dataset context-memory-v2.json` | **30/30，110 断言**，hash `b9cc7f03…` |
| `npm run build` | 通过 |
| 本地 `npm run smoke` | **未运行**（Phase 2.1 已证为本机 Electron 渲染进程环境问题） |
| CI run `40461677187` @ `20628d5` | **3/3 success**；Ubuntu/Windows 日志均含 `Morrow smoke passed`；Windows 升级路径 success |

本报告所在提交仅新增文档，代码与 `20628d5` 相同；其 CI 结果见 PR checks，不把旧 SHA 的绿灯当作新代码的验证。

## 7. 最终请求体证据

| 断言 | 用例 | 结果 |
|---|---|---|
| 本轮消息在最后一条且内容一致 | `lastMessageEquals` | v2 全部通过 |
| 历史按角色与顺序组装 | `historyRoles` / `historyLength` | v2 全部通过 |
| 有效记忆进入请求 | `memoryMatchFor` | `v2-elliptical-context`（`context`）、`v2-stale-classes`（`topic`） |
| 纠正后旧值不泄漏 | `v2-correction-current` | 含「杭州」，不含「上海」 |
| 撤回后不泄漏 | `v2-retracted-context` | `memoryEntries = 0`，哨兵不出现 |
| 无关记录不被提升 | `v2-unrelated-not-promoted` | 两轮都不是 `topic` |
| 敏感兴趣不进入未授权请求 | `cognitive-loop.integration.test.ts` | 未授权无「抑郁」，仍有「天文」 |
| 预算生效 | v1 既有预算用例 + 500 字符紧预算用例 | 通过 |

## 8. 纠正、撤回与反馈

| 机制 | 证据 |
|---|---|
| 纠正状态机 | 既有 `correct`：revision +1，旧文本不再进入请求 |
| 撤回过滤 | `v2-retracted-context`；三路由既有用例 |
| 删除过滤 | `drops a deleted memory on every route` |
| 冲突分组 | `v2-conflict-group`：`conflictGroup` 与指令都在请求里 |
| 单次负反馈不改人格 | 既有 `does not change the personality because of one negative message` |
| 记忆写入失败不破坏对话 | 既有 catch 分支与测试 |
| 对话反馈到兴趣 | `onTurnCompleted` 观察 + 归档；敏感度只升级 |

## 9. 已知问题、未完成与风险

1. **模型层失败**：clean 运行里冲突披露、纠正遵循两项 fail；省略轮在另一轮 fail、这一轮 pass。
2. **模型行为不稳定**：同一 `v2-elliptical-context` 两轮之间 fail → pass；跨会话「杭州」在两轮之间 true → false。默认采样下不能把单次结果当作能力。
3. **偶发空回复**：`651742` 的第 2 轮返回 `PROVIDER_RESPONSE`，assistant 未落库（处理正确），但说明本地模型会偶发空响应。
4. **评测器盲点仍在**：a4 假通过、a6 假失败，只被固定，未被修复。
5. **无语义检索**：零词面重叠的语用关联仍不召回（能力边界）。
6. **长对话未验证**：20–30 轮行为没有 harness。
7. **`self_model_entries` 无敏感度列**：逐字通道整体受 `includeSensitive` 门禁，但撤回主记忆不会撤回对应自我条目。
8. **冲突分组是词面启发式**：可能漏分同义改写，也可能误分共享词多的不同主题。
9. **无真实人工复核**：复核文件 `reviewer.kind` 仍是 agent。
10. **本地 smoke 未运行**：CI 为权威，但不冒充本地通过。
11. **回滚 v16 需恢复备份**：代码回退后旧版本会 fail-closed 拒绝打开 v16 库。

## 10. 提交与 PR

| 提交 | 内容 |
|---|---|
| `2b536aa` | 检索上下文层 + 整词 + 冲突分组 + 波动性过期 |
| `7e2b35c` | 兴趣敏感度 + 迁移 v16 + 请求体门禁 |
| `d4960be` | context-memory v2 + 评测器盲点固定 |
| `36a0629` | v2 真实模型正向规则 |
| `20628d5` | 四份阶段报告 |
| `de12870` | 本报告初版 |
| `3fa6a40` | 归档真实模型 run 报告 + `.gitignore` 白名单 |
| `c0d27ca` | clean tree 真实运行记录（含空回复失败） |
| 本提交 | 更正 clean/dirty 表述并补 clean 运行证据 |

PR：[#4](https://github.com/ve766/morrow-ai-companion-v2/pull/4)

## 11. Windows 复现

```bash
git fetch ssh://git@ssh.github.com:443/ve766/morrow-ai-companion-v2.git feat/phase-2.2-memory-reliability
git checkout feat/phase-2.2-memory-reliability
npm ci
npm run typecheck && npm test
npm run evaluate:context
npm run evaluate:context -- --dataset context-memory-v2.json --output context-memory-v2-report.json

# 真实模型（需本机 Ollama 与 qwen2.5:0.5b）
ollama serve
MORROW_CONTEXT_REAL_DATASET=context-memory-v2.json \
MORROW_CONTEXT_REAL_CASES=v2-elliptical-context,v2-conflict-group,v2-correction-current \
MORROW_CONTEXT_REAL_OUTPUT=context-memory-v2-real-report.json \
npm run verify:context:real
```

## 12. 验收对照

| 验收项 | 状态 | 依据 |
|---|---|---|
| 记忆/授权链路由源码与测试核实 | **通过** | §2、§7、452 用例 |
| 检索改进未破坏撤回/删除/授权 | **通过** | `v2-retracted-context` 等 |
| 冲突/过期/纠正有系统层回归 | **通过** | 单测 + v2 |
| 评测器用历史假通过/假失败验证 | **通过（验证=固定，非修复）** | `verdict.test.ts` 两条 |
| 真实模型实验完整留档 | **通过** | 5 份 run（含 2 份 clean），失败未删 |
| 自动/人工/模型表现区分 | **通过** | 报告与 verdict 分层 |
| CI 通过且无未解释回归 | **通过** | run `40461677187` 3/3；后续 docs/evidence 提交见 PR checks |
| 残余风险说明 | **通过** | §9 |
| 模型层具备冲突披露/过期承认 | **未通过 / 未验证** | clean 运行 1 pass / 2 fail，2 needs_review |
| 20–30 轮长对话 | **未验证** | 无 harness |

## 13. 三层证据声明

- **代码已实现**：检索三层、冲突分组、波动性过期、兴趣敏感度与 v16 迁移。
- **自动化测试通过**：452 用例、四个离线评估、构建、CI 3/3。
- **真实模型验证通过**：**没有**。clean 运行 3 个可判定用例中 1 pass、2 fail；换一轮同一用例结果又不同（fail → pass），跨会话命中 true → false。

本报告不宣称 Morrow 已达到可靠 AI 伴侣水平。
