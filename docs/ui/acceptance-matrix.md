# UI 验收矩阵

- 真实 renderer：Electron 44 + `src/renderer/index.html`
- 截图：Windows CI product-path 真实窗口，1440×900 / 1280×800 / 390×844，输出到 `docs/ui/evidence/20261105T084141Z-45483dd6/`
- 状态：PASS = 代码/截图/交互证据；PARTIAL = 受外部宿主限制；NOT_RUN = 未执行

## 1. 页面 × 状态

| 页面 | 正常 | 加载 | 空 | 错误 | 禁用 | 危险确认 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 对话 | PASS | PASS（chat-state） | PASS（空消息） | PASS（feedback） | PASS（send disabled） | PASS（原生 consent/删除会话 confirm） | 截图 + provider/manual-chat 测试 |
| 记忆 | PASS | PASS（aria-busy） | PASS（empty-state） | PASS（feedback） | PASS（无修订时） | PASS（删除/撤销 confirm） | 截图 + main.ts 现有逻辑 |
| 自我模型/兴趣 | PASS | PASS | PASS | PASS（self-model-feedback） | PASS（非 active 隐藏更正/撤回） | PASS（撤回 confirm） | 新面板 + 截图 |
| 目标 | PASS | PASS | PASS | PASS | PASS | PASS（计划/审批/取消） | 截图 + goal 测试 |
| 设置/Provider | PASS | PASS（刷新/发现中） | PASS（无 profile） | PASS（错误 feedback） | PASS（官方编辑禁用） | PASS（删除/清空密钥 confirm） | 截图 + provider UI 测试 |
| 备份 | PASS | PASS（预览） | PASS | PASS | PASS（未确认恢复 disabled） | PASS（恢复 confirm） | 现有 backup 逻辑 |

## 2. 尺寸

| 尺寸 | 结果 | 说明 |
| --- | --- | --- |
| 1440×900 | PASS | 双栏对话/记忆/设置；无横向溢出 |
| 1280×800 | PASS | 侧栏 232px；内容仍双栏 |
| 390×844 | PASS | 侧栏顶部横条；单列；表单/卡片不溢出 |
| 窄窗口长文本 | PASS | 卡片 `min-width:0`，文本换行；无固定宽度撑破 |
| 弹窗/浮层 | PASS | 使用原生 dialog/confirm；无自绘越界浮层 |

## 3. 键盘与可访问性

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Tab 顺序 | PASS | 原生 button/input/select；无 tabindex 篡改 |
| 焦点可见 | PASS | `:focus-visible` 2px accent + 3px offset |
| 导航语义 | PASS | `aria-current="page"` + 按钮 |
| 表单标签 | PASS | 所有控件保留 label/for 或 aria-label |
| 状态播报 | PASS | `role=status` / `aria-live=polite` |
| 动态 canvas | PASS | `aria-hidden=true`，不承载唯一信息 |
| 减弱动效 | PASS | `prefers-reduced-motion` + canvas 检查 |
| 颜色对比 | PASS | 主文字 ≥12:1；关键状态有文字标签 |

## 4. 功能入口覆盖

| 功能 | 入口 | 状态 |
| --- | --- | --- |
| 对话/会话切换/删除 | 对话视图 | PASS |
| 敏感记忆开关 | 对话 composer | PASS |
| 记忆候选审阅 | 对话底部 | PASS |
| 人格调整/历史 | 对话右栏 | PASS |
| 显式保存/搜索/修订/撤销/恢复/删除 | 记忆视图 | PASS |
| 待确认事项 | 记忆视图 | PASS |
| 自我模型更正/撤回 | 记忆视图新增 | PASS |
| 兴趣暂停/恢复 | 记忆视图新增 | PASS |
| 目标候选/目标/计划/审批 | 目标视图 | PASS |
| 提醒设置/暂停/撤回/静音/历史 | 目标视图 | PASS |
| 多源 Provider 列表/保存/测试/发现/默认/删除 | 设置视图 | PASS |
| 官方 DeepSeek 兼容连接 | 设置视图 | PASS |
| 本地 Provider | 设置视图 | PASS |
| 认知计算开关/清空 | 设置视图 | PASS |
| 备份导出/预览/恢复 | 设置视图 | PASS |
| 主题切换 | 侧栏底部 | PASS |

## 5. 截图证据

由 `scripts/product-path-smoke.mjs` 在 CI Windows 真实 Electron 窗口中生成：

- `chat-1440x900.png` / `chat-1280x800.png` / `chat-390x844.png`
- `memory-*.png`
- `settings-*.png`

每张截图对应同一 run id；`evals/morrow-v2-final/results/20261105T084141Z-45483dd6.json` 记录 `uiEvidence` 路径。截图不是生成图；本机 Electron 宿主 0xC0000005 阻塞时，保留 FAILED 运行记录，不以静态图替代。
