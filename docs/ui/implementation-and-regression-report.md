# UI 实施与回归报告

- 分支：`feat/morrow-v2-final-closure`
- 真实入口：`src/renderer/index.html` + `src/renderer/src/main.ts`（Electron renderer，不是静态 demo）
- 新增模块：`presence-ui.ts`（hero/canvas/主题/导航编号/设置索引）、`self-model-ui.ts`（自我模型/兴趣）
- 重写样式：`style.css`、`companion.css`

## 1. 页面改造映射

| 页面 | 改造前 | 改造后 | 功能保持 |
| --- | --- | --- | --- |
| 对话 | 普通深色面板 + 会话工具栏 | 空间 hero（轨道点云、标题、产品定位）+ 双栏对话工作区 + 右侧人格面板 + 输入 dock | 所有 ID/事件保留；发送/取消/候选/人格历史不变 |
| 记忆 | 左侧保存 + 右侧列表 + 待确认 | 编辑式 masthead + 双栏（保存 sticky / 记忆卡）+ 待确认 + 自我模型/兴趣 | 保存/搜索/修订/撤销/恢复/删除不变 |
| 目标 | 两张目标卡 + 提醒 | 双栏目标卡 + 全宽提醒；状态胶囊/审批区样式统一 | 候选/目标/计划/审批/提醒不变 |
| 设置 | 纵向大卡片 | 分区索引 + 双栏 Provider 卡 + 全宽认知/备份；官方 DeepSeek 兼容入口明确标注 | 所有 Provider/认知/备份 ID 与 IPC 不变 |
| 全局 | 仅深色 | 深空默认 + 纸面主题切换；导航编号；统一 focus/状态/空态 | 不改变业务语义、不绕过 consent |

## 2. 功能保持

- 没有删除任何既有视图、按钮、表单字段或 IPC 调用。
- 没有把危险确认改成单击；删除/撤回/恢复仍走原有 confirm/二次确认。
- Provider 表单仍通过 `window.morrow.providers.*` typed bridge；密钥输入仍是 password，保存后清空。
- 记忆/目标/提醒/备份仍调用原服务；UI 只消费返回的 `IpcResult`。
- 新增自我模型/兴趣面板只调用已有 `selfModel.listEntries/listInterests/correctEntry/retractEntry/setInterestStatus`，不新增 IPC 通道。

## 3. 兼容性

- 现有 renderer 测试（provider profiles、pending、goal candidates）依赖的 ID/class 保留。
- `shell-ui.ts` 的 `.nav-item[data-view]` 契约保留；新增 `.nav-index` 只是前置装饰。
- `presence-ui.ts` 在 `initializeShell()` 之前运行，注入 hero/masthead/index/theme，之后原有初始化继续。
- 窄窗口：<980px 侧栏变为顶部横条，对话/记忆/目标/设置变单列；<640px 表单单列、卡片堆叠。
- 主题：`data-theme` 只改变 CSS token；Provider/记忆/目标数据不依赖颜色。

## 4. 已知边界

- 原生 consent 对话框不在 renderer DOM 中，无法用 Playwright 截图；它的文案由 `presentProviderConsent` 纯函数测试覆盖。
- 轨道 canvas 是装饰层，不承载唯一信息；无 WebGL/three.js 依赖。
- 纸面主题是同一设计系统的第二翼，不是把主界面改成 Agent 工作台。
- 截图证据由 Windows Electron product-path 在 CI 中真实截取（见 `docs/ui/evidence/`），不是生成图。
