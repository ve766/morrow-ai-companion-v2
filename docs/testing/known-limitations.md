# 已知限制（Known Limitations）

诚实清单：以下是本阶段**未完成、未验证或有意简化**的事项。任何未列出的能力不应被假定存在。

## 最终产品 RC（2026-11-02，release/morrow-v2-final-delivery）

同一清单的当前状态；旧条目保留，发生变化处就地标注“更新”。

| 项 | 当前状态 | 影响 / 绕过 |
|---|---|---|
| 真人自然度盲评 | **PENDING_HUMAN** | Stage 5 A–J 样本；不得声称自然度 PASS |
| 第二真实 Provider | **NOT_RUN** | 无合法凭据；同库重建（S12/P09）不替代真实切换 |
| Windows 安装包 | **已生成**：`release/Morrow-Setup-2.0.0-x64.exe`（111,751,536 B；SHA-256 `b753df7c…8998`） | 旧条目 2 的“未构建”已被本条更新 |
| 真机安装/升级 | **PENDING_HUMAN** | 本机无人值守安装挂起（需 GUI/人工）；安装包与哈希已给出 |
| 本机 Electron smoke | **BLOCKED**（`0xC0000005`，宿主） | CI Ubuntu/Windows 真实应用 smoke 通过（旧条目 13 的“CI 未跑”已被多次 run 更新） |
| DeepSeek 真实 Key | 仍 **未验证**（条目 1 保留） | 真实验收使用 spark-x2.6；DeepSeek 通道由注入 fetch 测试覆盖 |
| 反思路由 `open_question` | P2 | domain/DB 支持，registry 缺；不阻断 RC |
| pending 决策状态 | P2 | accepted→done、rejected/dismissed→dropped；route 行不写终态 |
| Spark UI | P2 | `getProvider()` 不返回 spark；DeepSeek/本地可用 |
| 兴趣时间跨度 | P2 | 现有门槛 3 证据/2 会话；加 24h 跨度会改变既有阶段证据 |
| 归档记忆重述 | P2 | 重述不会恢复召回；产品语义待定 |
| 语义嵌入检索 | P3 | 四通道 RRF（词法/槽位/值/事实），无语义 embedding |

## 产品收口更新（2026-11-07，feat/morrow-v2-product-closure-20261107）

以下条目在产品收口轮（Issue #61）复核后更新；带 SHA 的为当时状态，未列出的历史条目继续有效。

| 项 | 更新后状态 | 证据 / 边界 |
|---|---|---|
| 兴趣/自我模型专属面板 | **已实现**（原条目 4 superseded） | `src/renderer/src/self-model-ui.ts` 渲染自我模型条目与兴趣列表（纠正/撤销/状态控制），挂载于记忆视图 `#self-model-list` / `#interest-list`；IPC 列表面真实存在（`tests/ui-control-contract.test.ts` 覆盖） |
| 运行轨迹可观测 | **已实现** | `turn_trace_events`（schema v50–v52）；右侧 inspector 显示 started/completed/skipped/failed、原因码与耗时；写失败不阻断聊天，读失败显示“轨迹不完整”（`src/app/turn-trace.integration.test.ts`） |
| 多源 Provider UI/真实连接 | **已实现 + 真实验证（spark-x2.6，本机）** | 设置页多源配置（保存/默认/启用/发现模型/测试连接）；2026-11-06 真实连接 10,612ms 与多轮真实对话证据见 `docs/reports/morrow-v2-runtime-trace-evidence-index.md` |
| 反思产物呈现 | **部分完成** | 自我模型面板可查看条目与纠正；反思 findings 的逐条“接受/拒绝”操作仍未做专属控件（runtime path 经 `listPendingItems` 存在） |
| Windows 真机窗口可见性 | **BLOCKED_HUMAN_DESKTOP**（继承 Issue #60） | 宿主自动最小化窗口；CDP/DOM/UIA 证据不等于人工可见验收。已交付窗口生命周期状态机、越界恢复与二次启动聚焦（`src/app/window-lifecycle.ts`、`window-bounds.ts`、`src/app/index.ts` second-instance），需人工桌面 10 分钟验收 |
| Electron 本机 smoke | **BLOCKED**（宿主 0xC0000005 已规避路径：`%LOCALAPPDATA%` + 验收沙箱开关） | 仍非默认产品路径；默认构建保持 `app.enableSandbox()` |
| 语义嵌入检索 | P3（不变） | 四通道 RRF（词法/槽位/值/事实），无 embedding |
| 第二真实 Provider 切换 | **NOT_VERIFIED** | 代码路径完整（multi-source profile/默认切换），本机仅验证了一个自定义 Provider；第二端点切换未实机执行 |

## 阻塞类（环境原因）

1. **DeepSeek 真实 Key 端到端未验证**：执行环境没有 DeepSeek API Key，且任务禁止伪造凭据或擅自产生付费调用。云端协议实现（SSE 流式、Bearer、错误码映射、重定向拒绝）由注入 fetch 的测试覆盖；真实调用需持 Key 用户按 README 执行一次。影响：不阻塞运行（本地 Provider 通道完整可用）；属验收门槛中明确允许标记"受环境阻塞"的项。
2. **NSIS 安装包未构建**：electron-builder 打包需下载 WinCodeSign 等工具链且发布签名不在本环境范围。已验证的替代路径：electron-vite 构建产物 + 真实 electron.exe 冒烟（含隔离用户配置目录）；`MORROW_SMOKE_EXECUTABLE` 环境变量已支持对已安装可执行文件跑同一套冒烟。

## 功能边界类（有意设计）

3. **turn_derived_confirmed 记忆来源未接自动管线**：来源枚举与迁移已就绪，但"从对话自动派生记忆候选"仅通过模型建议（model_inferred_confirmed）路径实现；直接派生路径等待更高置信度的抽取规则，避免把聊天原文不加区分地写成事实。
4. **兴趣/自我模型无专属渲染面板**：能力完整经 IPC 暴露（列表/状态控制/纠正/撤销/手动反思），但渲染进程未新增"洞察"视图；用户当前无法在 GUI 内查看兴趣列表。记忆、目标、提醒、备份、人格均有 UI。
5. **冲突检测是标记不是消解**：CJK 词项共享 ≥2 的保守启发式只产出 `memory.conflict_flagged` 事件与查询接口，不做自动合并或覆盖。
6. **反思产物不自动执行任何动作**：findings 仅记录（含至多 1 个 candidate 兴趣），不修改人格、不发送任何请求。这是反递归设计的一部分，也意味着"反思闭环"的最后一公里（把 findings 呈现给用户并指导行为）依赖后续 UI。
7. **人格仅由用户编辑改变**：模型输出、情绪事件、单次对话都不会改写人格（任务要求如此）；"由长期经历形成的人格倾向"以 memory/confidence 演化间接体现，尚无独立"倾向层"。

## 工程债类

8. **`fix/m0-m5-hardening` 的 reminder-service 加固（约 +164 行）未移植**：与尖端版本分叉冲突；尖端版有自己的测试覆盖。若旧分支后续修复了实际缺陷，需要按文件级 diff 甄别回移。
9. **smoke 竞态修复依赖状态文本轮询**：重启后的就绪判定轮询 `#provider-status` 的终态文案（7 秒上限）。更稳的方案是 IPC 就绪事件，当前实现足够但不够优雅。
10. **事件日志无轮转**：event_journal 仅追加，无体积上限或归档策略；payload 有大小限制但条数无界。长期使用需归档/压缩设计。
11. **测试中的 console.warn**：三处降级路径仍用 console.warn（迁移前遗留），未替换为 observability logger（不影响行为，日志格式不统一）。
12. **行尾混合**：仓库部分文件 CRLF/LF 混合（.gitattributes 已声明 `* text=auto eol=lf`，随首次提交归一）；历史提交中的文件在 Windows 检出时由 git 处理。
13. **CI 未在推送前执行**：GitHub Actions 工作流随本提交推送，其首次运行结果需在推送后确认（本报告发布时不谎称 CI 已绿）。
