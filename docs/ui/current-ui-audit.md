# 现有 UI 审计（改造前）

- 审计对象：`src/renderer/index.html`、`src/renderer/src/*.ts`、`style.css`、`companion.css`
- 审计方式：读取真实 DOM/事件/IPC 调用，不只看截图
- 结论：功能完整，但视觉上是“深色管理面板 + 多个同权重卡片”，对话与人格没有成为中心；Provider 文案仍把官方 DeepSeek 当成唯一远程路径。

## 1. 页面与入口

| 视图 | 现有入口 | 主要组件 | 依赖 |
| --- | --- | --- | --- |
| 对话 `chat` | 侧栏「对话」 | 会话选择/新建/删除、消息流、发送/取消、敏感记忆开关、记忆候选、人格表单与历史 | conversations、chat、memorySuggestions、personality、providers |
| 记忆 `memory` | 侧栏「记忆与来源」 | 显式保存、搜索、记忆卡、修订谱系、撤销/恢复/删除、待确认事项 | memories、continuity |
| 目标 `goals` | 侧栏「目标与提醒」 | 长期目标候选、用户目标、计划/授权、提醒设置与历史 | companionGoals、goals、reminders |
| 设置 `settings` | 侧栏「设置与备份」 | 多源 Provider、官方 DeepSeek、本地 Provider、认知计算、备份恢复 | providers、cognition、backup |

## 2. 现有交互与状态

- 导航：`shell-ui.ts` 只切换 `hidden`/`active`，视图常驻 DOM；所有 IPC 监听不重建。
- 对话：每次发送前 native consent；流式 delta；失败保留重试；取消；记忆候选审阅。
- 记忆：显式输入 → 列表/搜索 → 修订谱系 → 更正/撤销/恢复/删除；删除为硬删除。
- 目标：候选确认、创建目标、准备计划、审批、执行、取消、提醒设置。
- 设置：Provider profile 列表/保存/测试/发现/默认/删除；官方 DeepSeek 兼容入口；本地 Provider；认知开关；备份预览/恢复。
- 状态：`hidden` + `aria-busy` + `role=status` 反馈；空状态、错误反馈、危险确认均已有。

## 3. 问题

1. **视觉层级**：所有面板同一权重，主对话没有“伴侣存在感”；侧栏是普通管理导航。
2. **空间关系**：对话、记忆候选、人格设置堆在同一列，右栏空白或拥挤；设置页多个大卡片纵向堆叠。
3. **文案**：Provider 面板仍以 DeepSeek 为默认叙事；consent 弹窗对自定义/本地也使用 DeepSeek 厂商与价格。
4. **状态呈现**：错误、空、加载多为一句话 feedback，缺少一致的视觉语言。
5. **响应式**：窄窗口下侧栏、卡片和表单没有针对新信息密度的重新编排。
6. **可发现性**：改造前自我模型/兴趣已有 IPC 能力但没有 UI 入口；本轮新增记忆页自我模型/兴趣面板。
7. **主题**：只有深色，参考中的纸面翼没有可切换入口。

## 4. 必须保留的功能映射

| 功能 | 保留方式 |
| --- | --- |
| 四个视图与所有既有 ID | 保留 DOM 与 `shell-ui` 契约，只改布局/样式/新增装饰层 |
| Provider profile 表单与列表 | 保留全部 ID；新增 settings index 与更清晰的分组 |
| consent gate | 不绕过；只把展示抽成可测试的 `presentProviderConsent` |
| 记忆/目标/提醒/备份 | 保留原有事件与 IPC 调用；只改卡片与状态样式 |
| 键盘 | 保留原生控件、focus-visible、Esc/方向键不新增冲突 |
| 空/错误/加载 | 保留 `feedback`/`empty-state`，统一颜色与间距 |
| 危险操作 | 保留 confirm/长按/二次确认，不用视觉简化掉 |

## 5. 新增入口

- 主对话 hero：presence canvas + 产品定位 + 本机/授权标签。
- 记忆页：自我模型与兴趣面板（只读为主，可更正/撤回/暂停）。
- 设置页：分区索引（模型接入/官方连接/本地模型/认知计算/备份恢复）。
- 全局：深空/纸面主题切换（localStorage 记忆，不影响数据）。
