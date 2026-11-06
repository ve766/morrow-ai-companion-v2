# Morrow V2 当前 UI 审计（对话工作台）

- 审计日期：2026-11-06
- 审计对象：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\app\final-1793955356` 的增量更新构建
- 构建 asar SHA256：`cf6e478d9fc2a7848aca5afb3eab07b69b46a098913498f8b8c4a010fb9bdf8a`
- 证据目录：`%LOCALAPPDATA%\MorrowV2-LocalAcceptance\evidence\conversation-runtime-final-1793955356`
- 方法：Electron CDP 读取真实 DOM/computed style/边界矩形，`Emulation.setDeviceMetricsOverride` 在 1440×900、1280×800、1024×768、390×844 四个视口截图；截图只包含 Morrow 应用内容。未读取或上传任何 V1 数据。

## 1. 审计结论

**UI 工作台达到可交付状态，状态记为 `PRODUCT_CHAT_READY` 的界面部分 PASS；宿主窗口可见性仍只能以 CDP/DOM 证据为准（见 §6）。**

已确认：

- 三栏工作台：左侧窄导航/会话，中间对话，右侧运行轨迹 inspector。
- 顶部状态栏显示 Provider 就绪状态、当前会话标题、轨迹条数和 inspector 开关。
- 对话区使用 viewport-height 布局，消息区独立滚动，输入区（composer dock）固定在对话区底部；移动端 composer dock 使用 `position: fixed`。
- 右侧 inspector 在 ≥1201px 默认展开，≤1200px 默认收起为抽屉，可用顶部“运行轨迹”按钮打开，Escape/“收起”关闭。
- 无 Provider 时，对话区显示“尚未配置模型 API”行动卡片，位置在 composer 上方，不与输入区重叠；发送按钮禁用。
- 深色主题、mono 标签、细线卡片、无外部 UI 框架；与既有 Morrow 视觉语言一致。

## 2. 修改前 / 修改后

| 维度 | 修改前 | 修改后 |
|---|---|---|
| 主布局 | 2 栏（导航 + 主区），无 inspector | 3 栏 260px / 1fr / 300px；≤1200px 变 2 栏 + 抽屉 |
| 顶部状态 | 只有侧栏底部 runtime-status | 顶部状态栏：Provider 状态点/文字、当前会话、轨迹条数、inspector 开关 |
| 运行轨迹 | 不存在 | 真实 IPC `chat.trace` 驱动的 inspector；阶段/状态/耗时/模块/原因码 |
| 无 Provider | 发送按钮禁用，无解释 | 行动卡片 + “配置模型 API”跳转设置并聚焦配置名 |
| 输入区 | 页面中段，随页面滚动 | 对话区 viewport-height，消息区滚动，composer dock 保持在对话区底部；移动端 fixed |
| 响应式 | 无 inspector；窄屏布局冲突 | 四档视口验证；无水平溢出；inspector 抽屉覆盖层 |

## 3. 四档视口实测（`responsive/responsive.json`）

| 视口 | 主网格列 | inspector 默认 | 水平溢出 | composer 位置（相对视口） | 结果 |
|---|---|---|---|---|---|
| 1440×900 | `260px 870px 300px` | 展开 | 无（scrollWidth 1430 ≤ 1440） | 底部 683px，完整可见 | PASS |
| 1280×800 | `260px 710px 300px` | 展开 | 无（1270 ≤ 1280） | 底部 564px，完整可见 | PASS |
| 1024×768 | `232px 782px` | 收起；按钮打开 360px 抽屉 | 无（1014 ≤ 1024） | 底部 551px，完整可见 | PASS |
| 390×844 | 单列 `380px`（滚动条 10px） | 收起；按钮打开全宽抽屉 | 无（380 ≤ 390） | fixed dock，底部 836px，完整可见 | PASS |

截图：

- `chat-1440x900-trace.png`：三栏、顶部状态栏、15 条真实 trace、composer、inspector。
- `provider-profiles-1440x900.png`：Provider 配置卡片、默认标记、连接成功 10,612ms、测试连接按钮。
- `no-provider-cta-1440x900.png`：无 Provider CTA 位于 composer 上方。
- `responsive/1440x900.png`、`responsive/1280x800.png`、`responsive/1024x768.png`、`responsive/390x844.png`：四档视口截图。

## 4. 可访问性与键盘

- 导航按钮有 `data-view` 与当前项 `aria-current="page"`；inspector 有 `aria-label="本轮运行轨迹"`。
- 轨迹列表和 chat feedback 使用 `aria-live="polite"`；状态点仅装饰（`aria-hidden`）。
- `Ctrl+Enter` / `Cmd+Enter` 在输入框内提交；`Shift+Enter` 保留换行。
- inspector 开关有 `aria-controls` / `aria-expanded`；Escape 关闭抽屉。
- 所有交互按钮均有可见文字或 `aria-label`；禁用状态由真实 Provider 就绪/发送中状态驱动。

## 5. 已知限制与残余风险

1. **桌面 composer 是“对话区底部固定”而非全窗口 fixed**：对话视图使用 `height: calc(100vh - 52px)` + 消息区滚动 + composer dock 位于网格底部；移动端才是 `position: fixed`。这与“固定输入区”的产品语义一致，但不是字面上的全窗口 `position: fixed`。
2. **宿主窗口最小化**：Windows 11 Build 26200 宿主会在数秒至数分钟内将 Morrow 窗口最小化（Issue #60 已记录）。本报告的截图和 DOM 验证通过 CDP 完成，不能替代“人类在可见窗口内连续操作”的验收。
3. **右侧 inspector 在 ≤1200px 是覆盖式抽屉**，打开时会盖住对话右侧；这是为了在 1024/390 宽度下保留可用的对话区。
4. **长对话**：消息区滚动，composer 保持可见；在 1024/1280 宽度下人格面板位于右侧栏；390 宽度下位于对话内容之后，需要滚动查看。
5. **Provider 连接测试**会弹出系统级发送确认；真实测试耗时约 10.6 秒，期间 UI 显示等待状态。

## 6. 证据边界

- 本报告只对 `final-1793955356` 这个本机部署实例负责；不代表其他 Windows 版本、其他 DPI 或其他 Electron 版本。
- 截图为应用内容截图，不含桌面其他窗口；未截取或读取 V1 聊天/记忆数据库。
- 四档视口通过 CDP 设备指标覆盖模拟，不是四台物理显示器。
