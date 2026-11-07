# Morrow V2 项目记忆

## 0. 当前任务（Issue #65，2026-11-07）

- 分支：`feat/whole-project-return-to-core-20261107`（从权威基线 `e1d8513` 建立）
- PR：https://github.com/ve766/morrow-ai-companion-v2/pull/66
- 代码 commit：`8bdc48adf1420c48b92e1c192b5ba07e79a293c5`
- 状态：**PARTIAL**；UI 未修改。
- P0 身份：`identityContract(provider)` 置顶 system；真实 Spark 干净会话已验证 Morrow/Provider 分离、无 Provider 冒充、无命名来源编造；原始回复 `docs/reports/whole-project-return-to-core-2026-11-07/results/identity-behavior-evaluation.json`。
- v53 schema 只做兼容移植；PR #64 未合并。
- 全仓 1215 tracked files 100% 记录；人工逐行审阅 18 个 P0/关键文件；其余自动扫描/二进制排除；人工覆盖率 1.48%，不冒充 100%。
- 测试 138 files / 1192 tests PASS；typecheck/build PASS；asar `df113e01...`。
- 未完成：全仓人工逐行、reflection→self-model、语义检索/消融、统一探索、多 Provider 身份矩阵、sensitive consent 修复。

> 本文件是工作区级项目记忆，供后续会话快速恢复上下文。它不是验收报告；事实以代码、测试输出和 `docs/reports/product-closure-2026-11-07/` 为准。最后更新：2026-11-07。

## 1. 当前工作

- 仓库：`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`
- 远端：`https://github.com/ve766/morrow-ai-companion-v2`
- 当前分支：`feat/morrow-v2-product-closure-20261107`（从 `feat/morrow-v2-product-complete-20261106` @ `68468cfca95b90b33707fe2dd50c6ee1bcc6fb44` 建立）
- 当前任务：GitHub Issue #61「Morrow V2 当前产品交付修复 + UI 改造总任务」
- 工作树：已提交并推送（代码 commit `3a491b7`；文档/元数据 head `3db8f7e`；PR https://github.com/ve766/morrow-ai-companion-v2/pull/62）
- 目标 PR base：`feat/morrow-v2-product-complete-20261106`（Issue #61 要求）
- 禁止：修改 `main`/`release/*`、合并既有 PR、发 Release、force-push、删除证据、把未执行项写成 PASS。

## 2. 已完成（本轮工作树）

### P1 CI Guard

- `.github/workflows/self-hosted-ci.yml`
  - 可信分支白名单加入：`feat/morrow-v2-final-closure`、`feat/morrow-v2-product-complete-20261106`、`feat/morrow-v2-product-closure-20261107`。
  - 仅允许 `workflow_dispatch` + 白名单分支，或 `push` + `ci-self-hosted-<sha>` tag；校验 repository/actor/triggering_actor/tag 名。
  - 新增 `guard-outcome` job（`if: always()`），guard 或 verify 非 success 时显式 `throw`，避免 Guard skipped 被误判绿色。
  - 三个 job 均显式 `continue-on-error: false`。
- `scripts/ci/guard-policy.ts` + `tests/ci-guard-policy.test.ts`（4 tests）：允许/拒绝分支、tag、actor、repository，及 workflow 终态门。
- **未完成**：自托管 Runner 仍未注册（继承 #56/#57），真实 dispatch/run 证据尚未产生；不能标记 CI PASS。

### P1 Windows 窗口

- `src/app/window-lifecycle.ts` + `src/app/window-lifecycle.test.ts`（3 tests）：`CREATED/READY/VISIBLE/MINIMIZED/HIDDEN/CLOSING/CLOSED`，非法转换抛错。
- `src/app/window-bounds.ts` + `src/app/window-bounds.test.ts`（4 tests）：离屏/多显示器/过大窗口回退到可见工作区。
- `src/app/index.ts`
  - 窗口创建时恢复/校正 bounds；`ready-to-show` 显示并进入 `VISIBLE`。
  - `minimize/restore/hide/close/closed` 记录状态；`moved/resized` 持久化 `window-state.json`。
  - `focusMainWindow`：最小化恢复、隐藏显示、聚焦。
  - 新增 `app.on('second-instance')`：二次启动聚焦/重建现有窗口。
  - `render-process-gone` 记录并最多自动 reload 一次；`unresponsive/responsive` 日志。
- **未完成**：真实桌面 10 分钟可见、5 轮真实对话、3 次最小化/恢复、二次启动/重启人工验收。宿主机仍可能自动最小化；预期最终标记 `BLOCKED_HUMAN_DESKTOP` 或 `PARTIAL`，不得用 CDP 代替。

### P2 UI 重构

- `src/renderer/index.html`
  - 顶部状态栏加入 `#stream-follow` 跟随指示与 `#effect-switcher`（原生/3D 透视/全息/粗野/拼贴/等离子）。
  - 设置页新增「界面博物馆 · 主题特效」`#visual-lab`，5 个主题卡片，均为纯视觉。
  - 关键控件补 `data-testid`（nav、会话、发送/取消、Provider 保存/测试/默认/启用、人格保存、记忆保存/搜索、备份、主题按钮）。
- `src/renderer/src/visual-effects.ts`
  - `localStorage['morrow.visual-effect']` 持久化；`body[data-effect]`。
  - 3D 透视鼠标跟随倾斜；全息/粗野/拼贴/等离子由 CSS 实现；只改变外观。
- `src/renderer/src/companion-ui.ts`
  - 流式跟随状态：发送时显示「跟随中」，用户上滑显示「已松手」，仅在跟随时自动滚底。
- `src/renderer/src/style.css`
  - 深色 Claude Code 工作台重设计：232px 左栏 + 中央对话 + 318px inspector；clay 主色；更扁平的卡片/输入区/轨迹卡。
  - 五种主题特效、弹簧按压、勾选双跳、details 展开、聊天气泡/滚动渐隐。
- `docs/ui/control-contract.json` + `tests/ui-control-contract.test.ts`（3 tests）
  - 30 个关键控件的 selector、IPC、service、持久化、测试映射；测试校验 selector 存在、channel 常量存在。
- **未完成**：构建后需在 `%LOCALAPPDATA%\MorrowV2-LocalAcceptance` 增量部署，用 CDP 截图验证默认深色 + 五种特效 + 四档响应式 + 真实按钮效果。

### P2 验收与文档

- `scripts/verify/manifest.json`：fast/full/product/stages/release 五层；live 阶段标 `requiresCredentials`。
- `scripts/verify/run-tier.mjs`：逐项保留退出码，失败非零退出，live 无凭据标记 `SKIPPED`，可写 JSON 汇总。
- `package.json` 新增 `verify:fast/full/product/stages/release`。
- `tests/verify-manifest.test.ts`（4 tests）：层级完整、命令存在、live 标记、runner 退出码。
- `README.md`：多源 Provider、当前迁移索引、分层验收命令、真实 Provider 配置步骤、运行轨迹/主题说明。
- `docs/testing/known-limitations.md`：新增 2026-11-07 产品收口增量，标记兴趣/自我模型面板已实现、轨迹/多源 Provider 已实现、窗口可见性 `BLOCKED_HUMAN_DESKTOP`、第二 Provider `NOT_VERIFIED`。
- `docs/architecture/database-schema.md`：当前 v52（v50 trace 表、v51 started 状态、v52 级联删除）。

## 3. 验证状态（截至 2026-11-07）

| 命令/层级 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | PASS | 最新工作树 |
| `npx vitest run`（full 层内） | PASS | 全量测试通过（数量以运行日志为准） |
| `npm run build` | PASS | electron-vite |
| `verify:fast` | PASS | 2/2 |
| `verify:full` | **PASS 6/6** | typecheck/test/evaluate/evaluate:cognition/build/smoke；smoke 使用已安装 acceptance exe + 验收沙箱开关 |
| `verify:product` | **PASS 1/1** | seed goal task 缺 action 修复后跑通 |
| `verify:stages` | **PASS 7 / SKIPPED 2** | stage2/3/restart/4a/5/provider/final-closure；live 无凭据跳过 |
| Windows 真机可见性 | **PASS_AUTOMATED / PENDING_HUMAN** | 10 分钟 120/120 可见；5 轮真实对话；3 次最小化/恢复；二次启动；重启保留会话；人工签字未获得 |
| self-hosted CI 真实 run | BLOCKED | workflow 不在默认分支（dispatch 404）+ Runner 未注册 |

验证详情：

- full 层真实 PASS；test 137 files / 1190 tests；评估通过；smoke 使用已安装 exe。
- stages PASS 7 / SKIPPED 2。
- product 层已 PASS（修复 seed goal task 缺配对 action 导致的 restart CONFLICT）。

## 4. 关键代码路径

- 对话链路：`index.html` → `preload/index.ts` → `app/ipc.ts` → `app/companion-service.ts` → `providers/*` → `persistence/*`。
- 运行轨迹：`persistence/migrations.ts` v50–v52、`persistence/turn-state-repository.ts`、`cognition/turn-state-machine.ts`、`app/companion-service.ts`、`preload` `chat.trace`、`renderer/companion-ui.ts`。
- 窗口：`app/index.ts`、`app/window-lifecycle.ts`、`app/window-bounds.ts`。
- UI 主题：`renderer/index.html` `#effect-switcher`/`#visual-lab`、`renderer/src/visual-effects.ts`、`style.css` 末尾 “Product-closure redesign”。
- 验收：`scripts/verify/manifest.json`、`scripts/verify/run-tier.mjs`、`tests/verify-manifest.test.ts`。
- 控件契约：`docs/ui/control-contract.json`、`tests/ui-control-contract.test.ts`。

## 5. 环境与安全

- Windows 11 Build 26200；Node 22.23.2；Electron 44.9.3。
- 本机部署：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356`；userData `...\user-data\final-1793955356`；证据 `...\evidence\...`。
- 真实 Provider 配置来自用户；API Key 只在 `.tmp` / 环境变量 `MORROW_TEST_API_KEY` 注入，绝不写入代码、日志、截图、Issue/PR。
- 不读取/导入 V1 数据；不清空既有 V2 userData；不修改 main/release；不合并 PR/发布 Release。

## 6. 下一步（按优先级）

1. 已推送并开 PR #62、已向 Issue #61 评论；等待 review。
2. CI：需管理员把 workflow 合入默认分支并注册 Runner；在此之前不得标记 CI PASS。
3. product-path：已修复并通过（seed goal task 缺 action → 重启 CONFLICT）。
4. Windows：自动化 10 分钟可见/5 轮对话/3 次最小化恢复/二次启动/重启已通过；人工目视签字仍为 `PENDING_HUMAN_CONFIRMATION`。
5. 不改写失败/阻塞历史；不合并 PR、不发 Release、不改 main/release。
