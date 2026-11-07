# Windows 桌面窗口可见性与恢复

- 代码：`src/app/window-lifecycle.ts`、`src/app/window-bounds.ts`、`src/app/index.ts`
- 测试：`src/app/window-lifecycle.test.ts`（3）、`src/app/window-bounds.test.ts`（4）
- 复现脚本：`scripts/desktop/window-visibility-check.ps1`
- 最终状态：**PARTIAL — PASS_AUTOMATED_VISIBILITY / PENDING_HUMAN_CONFIRMATION**（10 分钟 120/120 可见；人工目视签字未获得）

## 1. 修复前的窗口问题

- 只有 `ready-to-show -> show`，没有显式状态机；启动/恢复/关闭竞态没有保护。
- 没有 `second-instance` 处理：第二次启动拿不到单实例锁后直接退出，首个窗口不会被聚焦。
- 没有窗口位置持久化与越界恢复；保存的坐标可能落在当前屏幕/工作区之外。
- 渲染进程崩溃时没有恢复路径。

## 2. 已实现

### 2.1 状态机

`WindowLifecycle` 状态：

`CREATED → READY → VISIBLE ↔ MINIMIZED / HIDDEN → CLOSING → CLOSED`

- 非法转换抛 `IllegalWindowTransition`，不会静默覆盖状态。
- `focusMainWindow` 对 `MINIMIZED` 先 restore、对 `HIDDEN` 先 show，再 focus。
- `second-instance` 事件调用 `focusMainWindow`；现有窗口被恢复/聚焦，不存在“后台有进程但没有可见窗口”的静默启动。
- `render-process-gone` 记录原因；非 clean-exit 最多自动 reload 一次，避免无限重启循环。
- `unresponsive/responsive` 写入结构化日志。

### 2.2 bounds 恢复

`normalizeWindowBounds(saved, workAreas, primary)`：

- 无保存值 → 在主显示器工作区居中 1100×760。
- 保存值至少有 160×160 px 落在某个工作区 → 保留，并夹紧到该工作区。
- 完全离屏/负数坐标/超大窗口 → 回退到主显示器居中，尺寸夹紧。
- 窗口 `moved/resized` 300ms debounce 写入 `userData/window-state.json`；`close` 再写一次。

### 2.3 可观测

日志事件（不含用户内容）：

- `window state`（event/state）
- `window transition rejected`
- `renderer process gone`（reason/exitCode）
- `window unresponsive` / `window responsive again`

## 3. 自动化验证

```bash
npx vitest run src/app/window-lifecycle.test.ts src/app/window-bounds.test.ts
# 7 passed
```

覆盖：

- 正常生命周期、最小化后二次启动 show、非法转换拒绝。
- 无 saved bounds、可见 saved bounds、离屏恢复、超大窗口夹紧。

## 4. 实机验收

脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop/window-visibility-check.ps1 -DurationMinutes 10
```

输出：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\window-visible-<timestamp>.json`

本轮实际采样（见 `results/window-visibility.json`）：

- 采样开始/结束：2026-11-07 10:40–10:50 UTC（10 分钟，5 秒间隔）
- 采样数：120
- 可见且非最小化：120
- 隐藏/最小化：0
- 结果：`PASS_VISIBLE_WINDOW`

随后完成：

- 5 轮真实 Provider 对话（turn `02918746...`、`89c64196...`、`f6184a76...`、`e4e82456...`、`f3686174...`，均 committed）；
- 3 次最小化/恢复（每次 minimized=true, restored=true）；
- 二次启动：第二个进程退出，原窗口 PID 不变，visible=true/iconic=false；
- 关闭应用并重启：窗口可见，原会话和 trace 恢复（`9 条事件 · turn f3686174`）。

详见 `results/window-human-gate.json`。

## 5. 结论与阻塞

- 代码层窗口状态机、越界恢复、二次启动聚焦、渲染崩溃恢复已实现并有单测。
- **人工目视签字未完成**：自动化 10 分钟可见、5 轮真实对话、3 次最小化/恢复、二次启动与重启均已通过，但“用户实际看见”的人工签字无法由自动化替代。最终状态标记 `PARTIAL / PENDING_HUMAN_CONFIRMATION`，不把自动化结果写成人工 PASS。
- 最短解阻：在实际用户桌面会话中运行上述 10 分钟脚本，并完成 5 轮真实对话、3 次最小化/恢复、二次启动/重启；记录截图、OS build、DPI、显示器布局和进程/窗口状态。
