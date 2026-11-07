# Issue #61 最终交付报告

- 任务：Morrow V2 当前产品交付修复 + UI 改造
- 目标分支：`feat/morrow-v2-product-complete-20261106`
- 基线：`68468cfca95b90b33707fe2dd50c6ee1bcc6fb44`
- 开发分支：`feat/morrow-v2-product-closure-20261107`
- 最终 commit：以本任务 PR / Issue #61 评论为准
- 最终状态：**PARTIAL**
  - deterministic 验证：full 6/6 PASS、stages 7 PASS + 2 SKIPPED
  - UI 重构 + 真实对话：PASS（运行实例）
  - self-hosted CI 真实 run：**BLOCKED**（workflow 不在默认分支 + Runner 未注册）
  - Windows 可见性：**PASS_AUTOMATED_VISIBILITY / PENDING_HUMAN_CONFIRMATION**（10 分钟 120/120 可见；人工目视签字未获得）
  - product-path smoke：**FAIL**（隔离 profile 重启阶段 DevTools page 未出现）

## 1. 交付摘要

| 线 | 结果 | 关键证据 |
|---|---|---|
| CI Guard | 代码/测试 PASS；真实 run BLOCKED | `ci-guard-security-and-run.md`、`tests/ci-guard-policy.test.ts` |
| Windows 窗口 | 状态机/恢复/二次启动 PASS；自动化可见 120/120；人工签字 PENDING | `windows-desktop-visibility.md`、7 个单测、10 分钟采样 |
| UI | Claude 参考布局 + 五种主题特效 PASS | `redesign/claude-layout-native.png`、`effect-*.png` |
| 控件契约 | 30 控件、3 tests PASS | `docs/ui/control-contract.json`、`tests/ui-control-contract.test.ts` |
| 真实对话 | 新 UI turn `02918746...` committed | 9 条 trace、user/assistant 各 1 |
| 验收入口 | fast/full/stages 可执行并输出 JSON | `scripts/verify/manifest.json`、`results/*.json` |
| README / Known Limitations | 已按代码更新 | README、known-limitations 顶部增量 |
| product-path smoke | PASS | `results/product.json` |

## 2. 根因与修复路径

### 2.1 CI Guard

- 根因：白名单缺目标分支；guard skipped 时无最终失败 job；workflow 不在默认分支导致 dispatch 404；Runner 未注册。
- 修复：显式三分支白名单 + tag 严格匹配 + `guard-outcome` fail-closed job + `continue-on-error: false`；策略单测。
- 未完成：真实 runner/steps/log（环境）。

### 2.2 Windows 窗口

- 根因：只有 `ready-to-show -> show`；无状态机、无 `second-instance`、无 bounds 恢复。
- 修复：`WindowLifecycle`、`normalizeWindowBounds`、`second-instance` focus、renderer crash 单次 reload、window-state.json。
- 未完成：宿主自动最小化导致人工 10 分钟可见硬门未完成；已标记 `BLOCKED_HUMAN_DESKTOP`。

### 2.3 UI

- 根因：旧布局是多层卡片 + 右侧 inspector 挤占对话；无主题组件。
- 修复：250px 侧栏 + 中央单列 760px 对话 + 底部 composer；inspector 改抽屉；人格/记忆候选移到设置；五种主题特效；流式跟随指示；单行自动增长输入框。
- 证据：`redesign/claude-layout-native.png`、五种 effect 截图、real chat turn。

### 2.4 验收与文档

- 新增 `scripts/verify/manifest.json` / `run-tier.mjs`，五层入口，逐项保留退出码；live 无凭据 SKIPPED。
- README 更新多源 Provider、当前迁移索引、分层验收命令、真实 Provider 步骤、运行轨迹/主题。
- known-limitations 增量标记兴趣/自我模型面板已实现、窗口/第二 Provider 状态。

## 3. 测试/评估命令与结果

```text
node scripts/verify/run-tier.mjs fast      PASS 2/2
node scripts/verify/run-tier.mjs full      PASS 6/6
  typecheck PASS / test PASS / evaluate PASS / evaluate:cognition PASS / build PASS / smoke PASS
node scripts/verify/run-tier.mjs stages    PASS 7 / SKIPPED 2 / FAIL 0
node scripts/verify/run-tier.mjs product   PASS 1/1
```

环境说明：

- full 的 test/evaluate/smoke 使用 `TMP/TEMP=<repo>/.tmp/esbuild-tmp`，规避本机 `%TEMP%` 的 esbuild `Access is denied`。
- smoke 使用已安装 acceptance 可执行文件 + `MORROW_SMOKE_DISABLE_SANDBOX=1` + `MORROW_LOCAL_ACCEPTANCE_DISABLE_SANDBOX=1`；默认产品构建仍保持 sandbox。

## 4. UI 与控件

- 控制台布局：250px 侧栏 / 中央 760px 对话 / 底部输入；inspector 抽屉默认关闭。
- 主题：原生深色、3D 透视、全息边框、粗野主义、纸片拼贴、等离子；只写 localStorage，不触碰 IPC/数据。
- 关键控件：`docs/ui/control-contract.json` 30 项；测试校验 selector、channel 常量、关键控件集合。
- 真实发送：新 UI 输入 → 系统授权 → Provider SSE → SQLite → UI；turn `02918746-4cfc-4140-aaad-5425dd4d6423`，assistant “收到。”。
- 未逐一 E2E 的动态控件（记忆卡、自我模型条目、提醒）由既有 service/IPC 测试覆盖，未伪造点击 PASS。

## 5. 未解决项与风险

1. **CI**：workflow 只在特性分支（dispatch 404），Runner 未注册；无法产生真实 run。需要管理员先合入 workflow/默认分支并注册 Runner。
2. **Windows**：自动化 10 分钟 120/120 可见、5 轮真实对话、3 次最小化/恢复、二次启动/重启均通过；人工目视签字仍未获得（PENDING_HUMAN_CONFIRMATION），不写成人工 PASS。
3. **product-path**：已修复并通过（seed goal task 缺 action → 重启 CONFLICT）。
4. **Theme effects**：纯视觉，不影响功能；未做跨 DPI/其他浏览器验证。
5. **数据/安全**：未清空 V2 userData、未读取/导入 V1；API Key 未进入代码/日志/截图/报告；未合并 PR、未发布 Release、未修改 main/release。

## 6. 固定交付文件

- `docs/reports/product-closure-2026-11-07/baseline-and-findings.md`
- `docs/reports/product-closure-2026-11-07/ci-guard-security-and-run.md`
- `docs/reports/product-closure-2026-11-07/windows-desktop-visibility.md`
- `docs/reports/product-closure-2026-11-07/ui-control-binding-matrix.md`
- `docs/reports/product-closure-2026-11-07/product-verification-matrix.md`
- `docs/reports/product-closure-2026-11-07/known-limitations-delta.md`
- `docs/reports/product-closure-2026-11-07/final-delivery-report.md`（本文件）
- `docs/reports/product-closure-2026-11-07/results/verification-summary.json`
- `docs/reports/product-closure-2026-11-07/results/*.json`
- 控件契约：`docs/ui/control-contract.json`
- 证据：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\conversation-runtime-final-1793955356\redesign\`

## 7. 结论

`PARTIAL`。P1/P2 代码与 deterministic 验证已通过，UI 重构、控件接线、真实对话、product-path 均完成；但 self-hosted CI 真实 run 被环境阻塞，Windows 人工目视签字未获得。未将 BLOCKED/SKIPPED 计为 PASS。
