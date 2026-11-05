# Morrow UI 设计系统（实际落地）

所有 token 都在 `src/renderer/src/style.css` 中使用；不是只写在文档里的示意值。深空为默认，纸面为主题切换。

## 1. 颜色

| Token | 深空 | 纸面 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#05070c` | `#f3f0e8` | 页面底色 |
| `--bg-soft` | `#080c14` | `#ede9df` | 次级底色 |
| `--panel` | `#0b1018` | `#fbfaf6` | 面板 |
| `--panel-2` | `#111828` | `#ffffff` | 卡片/浮层 |
| `--ink` | `#edf3ff` | `#131519` | 主文字 |
| `--muted` | `#8595ae` | `#6e6f73` | 次文字/标签 |
| `--line` | 白 12% | 黑 12% | 细线 |
| `--line-2` | 白 24% | 黑 26% | 强线/边框 |
| `--accent` | `#7be7ff` | `#2f5bff` | 主强调/焦点/主按钮 |
| `--accent-2` | `#a78bfa` | `#7c5cff` | 次强调/轨道 |
| `--lime` | `#ddff4d` | `#b7d92b` | 标题句点/少量高光 |
| `--orange` | `#ff8a4c` | `#ff6b35` | 危险/注意 |
| `--mint` | `#2fd3c4` | `#0fa98c` | 成功/在线 |
| `--danger` | `#ff6b6b` | `#c2410c` | 删除/错误 |

语义：颜色不做唯一信息载体；状态同时有文字/图标（status pill 文本、按钮文案）。

## 2. 字体

- 无衬线：`Inter, Segoe UI, PingFang SC, Microsoft YaHei, system-ui`
- 等宽：`JetBrains Mono, SFMono-Regular, ui-monospace, Cascadia Mono, Consolas`
- 衬线：`Instrument Serif, Georgia, Times New Roman`（保留给未来编辑式标题；当前未强制使用）
- 标题：`clamp()` 响应式，字距 `-0.04em` 到 `-0.055em`；正文 13–14.5px / 1.65–1.9。
- mono 只用于编号、标签、端点、哈希、状态，不用于长正文。

## 3. 间距、圆角、层级

- 间距：4 / 6 / 8 / 12 / 16 / 22 / 30 / 44。
- 圆角：卡片 18px，面板 18px，输入 9px，胶囊 999px，小标签 4px。
- 阴影：`0 30px 70px -46px` 深色；纸面更轻。
- 层级：背景 < 面板 < sticky settings index < native dialog；不使用多个浮层叠加。

## 4. 组件

| 组件 | 类 | 规则 |
| --- | --- | --- |
| 主按钮 | `.button.button-primary` | accent 底 + accent-ink 字；hover 只提亮 1px，不放大 |
| 次按钮 | `.button.button-secondary` | panel-2 底 + 细线 |
| 安静按钮 | `.button.button-quiet` | 无边框，hover 只加淡底 |
| 危险按钮 | `.button.button-danger` | danger 字/边框，不用大面积红底 |
| 状态胶囊 | `.status-pill` | mono 8px，文字 + 颜色 |
| 面板 | `.panel` | 细线 + 顶部 accent 渐变线 + 大圆角 |
| 卡片 | `.memory-card` / `.goal-card` / `.pending-item` | 细线 + 低对比底；hover 只抬 1px |
| 输入 | 原生 input/textarea/select | 9px 圆角；focus accent ring 3px |
| 开关 | `.companion-toggle` | 原生 checkbox + 文本，不伪造开关 |
| 空状态 | `.empty-state` | 圆环 mark + 标题 + 一句解释 |
| 反馈 | `.feedback` / `.companion-feedback` | 成功 mint 边，错误 danger 边；`role=status` |
| 设置索引 | `.settings-index` | sticky 胶囊，锚点跳转，不改变 DOM 顺序 |

## 5. 动效

- 页面进入：`view-in` 0.45s，位移 10px。
- 卡片 hover：1px 上移 + 边框提亮，0.18s。
- 轨道 canvas：0.0022 rad/帧，拖拽改变角度；离开视口暂停。
- `prefers-reduced-motion: reduce`：动画/过渡降到 0.001ms，canvas 不自动旋转（`reducedMotion()` 检查）。

## 6. 可访问性

- 所有导航是 `<button>`，active 同时有 `aria-current="page"`。
- 表单 label 与控件显式 `for/id`；错误/成功反馈 `role="status"` / `aria-live="polite"`。
- 焦点环 2px accent，offset 3px；不使用 `outline:none` 无替代。
- 颜色对比：主文字/背景 ≥ 12:1（深空）、≥ 12:1（纸面）；muted 在深空约 5.6:1，在纸面  对  约 4.95:1（由 tests/design-tokens.test.ts 复算）；关键信息不只用 muted。
- 动态 canvas `aria-hidden="true"`，不承载唯一信息。
- 危险操作保留原生 confirm/二次确认；不靠颜色单独表达。

## 7. 主题切换

`#theme-toggle` 写入 `document.documentElement.dataset.theme` 与 `localStorage['morrow-theme']`；只影响 CSS token，不触碰 IPC、数据或 Provider 配置。
