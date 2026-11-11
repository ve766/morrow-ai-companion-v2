# 产品验收矩阵（Issue #61）

- 日期：2026-11-07
- 分支：`feat/morrow-v2-product-closure-20261107`
- 基线：`68468cfca95b90b33707fe2dd50c6ee1bcc6fb44`
- 最终 asar（本机 acceptance）：`1dd5cfa76815902696a849f8bc3d32e7da6afa94a1abed2dedb61dae589fdffb`
- 状态标记：PASS / FAIL / SKIPPED / BLOCKED / NOT_RUN；失败不折算为 PASS。

## 1. 分层验收

| 层级 | 命令 | 结果 | 证据 |
|---|---|---|---|
| fast | `node scripts/verify/run-tier.mjs fast` | **PASS 2/2** | `.tmp/verify-fast.json` |
| full | `node scripts/verify/run-tier.mjs full`（`MORROW_SMOKE_EXECUTABLE=<installed>`） | **PASS 6/6** | `.tmp/verify-full2.json` |
| stages | `node scripts/verify/run-tier.mjs stages` | **PASS 7 / SKIPPED 2 / FAIL 0** | `.tmp/verify-stages.json` |
| product | `node scripts/verify/run-tier.mjs product`（installed exe） | **PASS 1/1** | `results/product.json` |
| release | `verify:release` | 未执行 | 需 product PASS；不伪造 |

full 层逐项：typecheck PASS、test PASS、evaluate PASS、evaluate:cognition PASS、build PASS、smoke PASS。

stages 逐项：stage2 / stage3 / stage3:restart / stage4a / stage5 / provider-multi-source / final-closure PASS；stage3:live 与 final-closure:live 因无 `MORROW_TEST_API_KEY` **SKIPPED**（不计 PASS）。

product 层已 PASS：修复了 seed goal task 缺少配对 action 导致的重启 `CONFLICT`，并允许启动恢复合法改变 goal task/action 状态；隔离 profile 完整跑通 restart/provider switch/continuity。

## 2. P1 CI

| 项 | 状态 | 说明 |
|---|---|---|
| Guard 白名单 | PASS（代码/测试） | 3 个显式分支 + tag 严格匹配 |
| Guard skipped 最终失败 | PASS（代码/测试） | `guard-outcome` job |
| 真实 self-hosted run | **BLOCKED** | workflow 不在默认分支（`gh run list` 404）；Runner 未注册 |

## 3. P1 Windows 窗口

| 项 | 状态 | 说明 |
|---|---|---|
| 状态机/越界恢复/二次启动聚焦 | PASS（代码/单测） | `window-lifecycle.ts`、`window-bounds.ts`、`second-instance` |
| 10 分钟真实可见 | **PASS_AUTOMATED / PENDING_HUMAN_CONFIRMATION** | 120/120 样本可见且非最小化；见 `results/window-visibility.json` |
| 5 轮真实对话 | PASS | 新界面 turn `02918746...`、`89c64196...`、`f6184a76...`、`e4e82456...`、`f3686174...` 均 committed |
| 3 次最小化/恢复、二次启动/重启 | PASS（自动化） | 3/3 minimized→restored；二次启动原 PID 不变且可见；重启后会话保留；人工目视签字 PENDING |

## 4. UI 与控件

| 项 | 状态 | 证据 |
|---|---|---|
| Claude 参考布局（250px 侧栏 + 中央聊天 + 底部输入） | PASS | `redesign/claude-layout-native.png`、DOM 边界 |
| 默认深色工作台 | PASS | `body[data-effect="none"]`、截图 |
| 五种主题特效 | PASS（展示） | `redesign/effect-*.png`、`effects.json` |
| 运行轨迹抽屉 | PASS | 默认关闭，按钮打开；真实 9 条 trace |
| 关键控件契约 | PASS（30 控件/3 tests） | `docs/ui/control-contract.json`、`tests/ui-control-contract.test.ts` |
| 真实发送链路 | PASS | turn `02918746...` |
| 所有控件逐一 E2E | PARTIAL | 部分动态控件由 service/IPC 测试覆盖，未伪造点击 |

## 5. 文档与 Known Limitations

| 项 | 状态 |
|---|---|
| README 与当前 Provider/迁移/测试入口一致 | PASS |
| known-limitations 增量（兴趣/自我模型面板、窗口、第二 Provider） | PASS |
| 7 份固定路径报告 | PASS（见 final-delivery-report） |

## 6. 总体结论

**PARTIAL**：deterministic full/stages/product、UI 重构与真实对话均通过；self-hosted CI 真实 run 被环境阻塞，Windows 人工目视签字仍为 PENDING_HUMAN_CONFIRMATION。未将 BLOCKED/SKIPPED 计为 PASS。
