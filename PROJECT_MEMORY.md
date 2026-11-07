# Morrow V2 项目记忆

> 本文件是工作区级项目记忆，供后续会话快速恢复上下文。它不是验收报告；事实以代码、测试输出和 `docs/reports/product-closure-2026-11-07/` 为准。最后更新：2026-11-07。

## 1. 当前工作

- 仓库：`E:\Hasee\Documents\morrow v2\zcode\stage3-audit\repo`
- 远端：`https://github.com/ve766/morrow-ai-companion-v2`
- 当前分支：`feat/morrow-v2-product-closure-20261107`（从 `feat/morrow-v2-product-complete-20261106` @ `68468cfca95b90b33707fe2dd50c6ee1bcc6fb44` 建立）
- 当前任务：GitHub Issue #61「Morrow V2 当前产品交付修复 + UI 改造总任务」
- 工作树：**未提交的进行中改动**（CI Guard、窗口生命周期、UI 重构、验收清单、文档）
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
| `verify:full` | **FAIL** | `evaluate`、`evaluate:cognition`、`smoke` 失败 |
| `verify:product` | 未运行 | 需先修复/确认 product-path smoke |
| `verify:stages` | 未运行 | live 项应 SKIPPED |
| Windows 真机可见性 | BLOCKED_HUMAN_DESKTOP | 宿主自动最小化；不能以 CDP 代替 |
| self-hosted CI 真实 run | BLOCKED | Runner 未注册 |

`verify:full` 失败详情：

- `evaluate`：退出 1，stdout 无成功报告（`M3 offline runner could not complete`）。
- `evaluate:cognition`：退出 1，`Offline cognitive evaluation failed`。
- `smoke`：esbuild 写入 `%TEMP%\morrow-alpha-smoke-*\morrow-alpha-smoke-seeder-*.mjs` 报 `Access is denied`；与本机 `%TEMP%` 权限/杀软环境有关。完整测试已用 `TMP/TEMP=<repo>/.tmp/esbuild-tmp` 规避，但 smoke 脚本自身仍使用 `%TEMP%`，需修复或显式传递 TMP。
- `verify:full` 的失败未经任何跳过/降级；不得把 full 层写成 PASS。

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

1. 修复 `verify:full` 的 `evaluate/evaluate:cognition/smoke` 环境失败（至少让 smoke 使用仓库内临时目录；评估脚本同样检查 esbuild TMP）。
2. 构建并增量部署到既有 acceptance app（备份旧 asar，不动 userData），CDP 验证：
   - 默认深色工作台、五种主题切换、四档响应式；
   - 发送/取消/重试、Provider 保存/测试、记忆/人格/轨迹控件真实后端变化；
   - 截图与 JSON 证据写入 `docs/reports/product-closure-2026-11-07/results/` 与既有 evidence 目录。
3. 运行 `verify:product`、`verify:stages`（记录 FAIL/SKIPPED/BLOCKED 真实状态），生成 `results/verification-summary.json`。
4. 真实桌面可见性：执行最小验收脚本；若宿主仍最小化，标记 `BLOCKED_HUMAN_DESKTOP`，不做 PASS。
5. 写齐 Issue #61 固定路径 7 份报告；提交/推送分支；向目标分支开 PR；在 Issue #61 按 10 项顺序评论最终状态。
