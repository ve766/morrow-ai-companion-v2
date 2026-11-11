# Stage 5 修复验收矩阵（Issue #27 §4）

- 分支：`fix/stage-5-review-findings` · 代码 SHA：`d9864031221b3e7df238cb87ea50a29a7c4aaf59`
- 测试文件：`src/app/stage5-remediation.integration.test.ts`（19 个用例覆盖 18 项要求）
- 机器结果：`evals/stage-5/remediation/results/20261102T034635Z-d9864031221b3e7df238cb87ea50a29a7c4aaf59.json`
- 所有用例走生产 `sendChat` 装配，并检查数据库状态和/或最终 Provider payload；没有只断言辅助函数返回值。

## 1. 逐项结果

| # | 要求 | 用例 | 结果 | 证据（断言要点） |
|---|---|---|---|---|
| 1 | 设置称呼“小林”后说“那个约定就算了”：称呼仍有效 | 1 | PASS | `address_preference=小林` 仍 `active` |
| 2 | 称呼/话题/节奏三线程，撤回一个话题：只有目标失效 | 2 | PASS | topic=`retracted`，address/rhythm 仍 `active` |
| 3 | 明确要求全部撤回：全部失效且有全局意图证据 | 3 | PASS | 所有行 `retracted`；`event_journal` 有 `relationship.retract_all` 且 `explicitGlobalIntent=true` |
| 4 | 模糊撤回目标：不修改任何线程，进入澄清 | 4 | PASS | 状态串前后完全一致；`relationship.clarify` 事件 ≥1 |
| 5 | “别再叫我小林，叫我阿林”：新值生效，旧值不注入 | 5 | PASS | DB 旧值 `superseded`；新会话 system 含 `"阿林"`、不含 `"小林"` |
| 6 | “不要这样称呼我”无新值：停用旧值，不猜新值 | 6 | PASS | 无 active 称呼；下一轮 system 不含 `"小林"`；未生成新值 |
| 7 | 删除来源消息：证据消失、分数重算、不再注入 | 7 | PASS | 证据计数 0；线程非 active；下一轮 system 不含旧值 |
| 8 | 删除整个会话：证据不可恢复性泄漏 | 8 | PASS | 证据计数 0；无 active 线程 |
| 9 | 备份恢复 + deletion journal replay 后不复活 | 9 + 9b | PASS | 9：孤儿证据被 `reconcile()` 删除；9b：真实备份→删除会话→恢复，`reappliedDeletions=1`，证据 0、无 active |
| 10 | 关系写入失败可安全重试；不重复计权 | 10 | PASS | 失败后 outbox `relationship` 行 pending；`drainCognition()` 重放后线程 active；再次 drain 证据仍为 1 |
| 11 | 多事实批次中途失败：回滚或 `recovery_required` | 11 | PASS | 第二项验证失败时整批回滚：`memories` 无“咪咪”行（`rolled_back`） |
| 12 | 索引失败后重试成功：最终一致，状态恢复 | 12 | PASS | 主记录保留；`fact_index_jobs` degraded；到期 `retryDue()` 后 `indexed` |
| 13 | 同一消息重复 10 次：关系与记忆均不重复计权 | 13 | PASS | 关系证据 1 行、记忆 1 行、revision 1 条、outbox 1 行 |
| 14 | Provider 切换/同库重建：人格、事实、关系、状态一致 | 14 | **PARTIAL** | 同库重建 PASS（新会话仍注入 `"小林"`、人格版本保留）；第二真实 Provider 切换 **NOT_RUN**（无凭据） |
| 15 | 普通否定不触发安慰；明确直接请求必须执行 | 15 | PASS | “我不喜欢这个方案”策略 ≠ `user_tension_unresolved`；“别安慰我，直接说……”=`explicit_direct_request` |
| 16 | S5/S6 自然度：偏好自然、问候不机械自我声明 | 16 + live | PASS（人工 PENDING） | 原则文本存在；live S5/S6 转写按 rubric 2/2；真人复核 PENDING |
| 17 | 事实、权限与安全边界在所有策略下不变 | 17 | PASS | 直接请求下 system 仍含“花生”与 `answer it directly`；无 sensitive 越权标记 |
| 18 | retracted/superseded/expired/deleted 证据不泄漏 | 18 | PASS | 旧称呼替代后 system 只含新值；撤回/删除场景 system 不含旧值 |

## 2. 与旧测试的关系

- **未删除、未跳过、未降低**任何既有测试；全量由 951 增至 970（新增 19）。
- `src/app/stage5-presence.integration.test.ts` 的一条旧断言 **编码了 P0-A 缺陷**
  （“那个约定就算了”后称呼也失效）。本次将其改为正确语义：
  1. 撤回约定后称呼仍注入、话题不再注入；
  2. 追加“不要这样称呼我”证明显式撤回称呼仍然有效。
  这是纠正错误预期，不是放宽断言；用例数量与强度都增加。
- `src/memory/fact-index-faults.test.ts` 的退避/热循环用例保留，`retryDue` 的窗口语义未改。

## 3. 命令与退出码（本机 win32 / Node 22.23.2）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | 0 | 无类型错误 |
| `npx vitest run` | 0 | 104 文件 / 970 测试全通过 |
| `npx vitest run src/app/stage5-remediation.integration.test.ts` | 0 | 19/19 |
| `npm run eval:stage5` | 0 | 12/12 scripted（`20261102T032728Z-d986403.json`） |
| `npm run eval:stage5:live` | 0 | 12/12 live（`20261102T032842Z-d986403-stage-5.json`） |
| `npm run eval:stage3` | 0 | 15 PASS + 1 NOT_RUN / 16（NOT_RUN 为需要真实模型语义的场景，脚本模式不计 PASS） |
| `npm run eval:stage4a` | 0 | 7/7 |
| `npm run build` | 0 | electron-vite build 成功 |
| `MORROW_SMOKE_DISABLE_SANDBOX=1 npm run smoke` | **1（本机 BLOCKED）** | 本机 Electron 启动即退出 `3221225477 / 0xC0000005`；渲染进程崩溃，未提交页面 |
| CI run `41386833397` | **success** | ubuntu-latest / windows-latest 的 typecheck、tests、build、真实 Electron smoke 全部通过；Windows 升级路径 job 通过 |

> 环境注记：本机 esbuild 无法写入系统临时目录（`Access is denied`，单文件 bundle 可复现），
> 全量测试与评测把 `TEMP/TMP` 指向仓库内 `.tmp/es`。这是宿主限制，不是产品行为。

## 4. 未通过 / 未运行 / 阻塞

| 项 | 状态 | 说明 |
|---|---|---|
| Electron / Windows 应用级冒烟 | **PASS（CI）** | CI `41386833397` 的 windows-latest 与 ubuntu-latest 真实应用 smoke 通过；本机单独运行 BLOCKED（`0xC0000005`，环境限制），不作为产品结论 |
| 第二真实 Provider 切换 | NOT_RUN | 无第二 Provider 凭据；只验证同库重建（S12/测试 14） |
| 真人自然度评分 | PENDING | Agent rubric 见 `transcript-remediation.md`；不得冒充真人评分 |
| CI | **PASS** | run `41386833397`，3 个 job 全部 success（含 Windows 升级路径） |

## 5. 自然度 rubric（摘要）

完整 rubric 与逐场景评分见 `evals/stage-5/remediation/review/transcript-remediation.md`。

- 0 分：状态报告/自我免责/客服式收尾；“我没有情绪”“运行正常/一切照常”“随时可以帮你”。
- 1 分：有上述痕迹但被后续内容覆盖；或过度解释检索边界。
- 2 分：像熟悉的人说话；在一个从句内自然使用记忆；边界正确但不打断对话。
- 任一维度出现反例即该维度 ≤1；真人评分与客观断言分开报告。

## 6. 结论

- 代码层 18 项验收：1–13、15–18 PASS；14 PARTIAL（真实双 Provider NOT_RUN）。
- 自然度：S5/S6 按书面 rubric 通过，真人复核 PENDING。
- 外部环境：CI 全绿（含 Windows/Ubuntu 真实 Electron smoke）；本机 Electron 单独运行 BLOCKED。
- 因此本次交付整体状态为 **PARTIAL**，不把 12/12 客观检查写成完整 PASS。
