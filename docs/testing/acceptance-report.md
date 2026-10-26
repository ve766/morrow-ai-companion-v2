# 验收报告（Acceptance Report）

- 日期：2026-10-25
- 环境：Windows 10.0.26200 x64，Node v22.23.2，Electron 44.x，git 2.55
- 仓库：`morrow-ai-companion-v2`（本文件所在仓库）
- 报告对应提交：见 §8（文档提交前的最终代码提交 `563c6e9`）

所有结论都来自本机真实执行的命令输出；未执行的项目明确标注。

## 1. 静态检查与类型检查

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过（0 错误），2026-10-25T14:25:33Z 实测 |

## 2. 自动化测试（vitest）

`npx vitest run`：**40 个测试文件、268 个测试全部通过，0 失败**。

覆盖构成（单测与集成同仓同跑，均为确定性离线测试）：

- 迁移与持久化：15 个版本的迁移（含 v13/v14 重建表）、fail-closed 外来库校验、降级锚点、备份/恢复（防篡改、预览令牌、删除边界重放）、删除日志、事件日志
- 记忆：生命周期、修订链、去重合并、来源/置信度、冲突标记、检索排序、跨库重开
- 内在状态：引擎确定性（衰减/幂等/限幅/权重）、服务事务与重放、脏标记重建
- 认知分析：意图/信号/证据引用校验、上下文预算
- Provider：DeepSeek 流式协议、错误映射、取消/超时；本地类回环强制、无凭据可用、真实 127.0.0.1 HTTP 集成（4 例）
- 目标/提醒：审批生命周期、单次消费、过期、中断恢复、同意控制
- 安全：IPC trusted-sender、请求护栏、密钥存储、CSP/窗口选项、出口门禁
- 自我模型层：兴趣晋升/归档/终止、自我模型纠正 supersede 链、反思边界与限速
- **验收场景 A–H**：`tests/acceptance/scenarios.test.ts` 7 个场景测试（D 在 self-model 套件）全部通过

## 3. 端到端（真实 Electron，Windows 实机）

`npm run build && npm run smoke`：**通过**（重复执行 ≥2 次稳定通过）。

冒烟覆盖（真实 electron.exe 启动、隔离用户配置目录、全程禁网断言）：
- 默认关闭的 Provider 配置态、安全存储拒答时的 fail-closed
- safeStorage 凭据：保存→加密文件落盘（非明文）→重启读取→损坏密文防护→显式删除验证
- 认知核心默认关闭、显式 opt-in 确认、重启持久化、无伪造回复
- M1 记忆生命周期、M2 目标与审批安全、M4 提醒控制
- 本地持久化、删除与重启验证；IPC 不泄漏凭据

## 4. 真实模型 Provider 验证

| 通道 | 状态 | 说明 |
|---|---|---|
| 本地 OpenAI 兼容 Provider | **已验证** | `src/app/local-provider.integration.test.ts` 与验收场景 A/G 用真实 `node:http` 服务器监听 127.0.0.1 随机端口，走真实 `fetch` 网络栈完成多轮对话、凭据头、非回环拒绝、优先级选择——非 Mock 注入 |
| DeepSeek 云端 | **受环境阻塞** | 本执行环境无 DeepSeek API Key（不得伪造凭据、不得擅自消费付费配额）。云端路径的协议实现（流式 SSE、错误码映射、重定向拒绝、Bearer 头、请求体构造）由单元/集成测试以注入 fetch 的方式覆盖；真实 Key 的验证步骤见 README §验证，由持 Key 用户执行 `npm run dev` 后在设置页配置即可 |

## 5. Windows 验证

- 全部开发与验证在本机 Windows 10.0.26200 完成（非 CI 例外豁免）。
- Electron 构建（electron-vite 三段构建）+ 真实启动冒烟通过。
- SQLite：使用 Node 内置 `node:sqlite`（要求 Node ≥ 22.13，自 v22.13.0 起无需 `--experimental-sqlite` 标志），**无原生模块、无本地编译工具链**；运行时打印 `ExperimentalWarning` 属预期。
- 升级路径：v11→v14→v15 迁移在临时库实测（数据保留、置信度回填 80、last_confirmed_at 空）。

## 6. 安全检查

- `git status` / 提交差异检查：无 `.env`、无密钥文件、无用户数据入库（.gitignore 覆盖 node_modules/out/release/dist/*.log/evaluation 产物）。
- 全仓库检索无硬编码密钥模式；测试用的合成凭据均为显式命名的 `test-only/synthetic` 字符串。
- 冒烟断言：IPC 响应无 apiKey 属性；凭据文件非明文；数据库无凭据表。
- 事件日志脱敏：logger 键级脱敏测试 + 场景 F 的 journal 全文扫描断言。

## 7. 认知闭环运行案例（场景 G，来自自动化测试）

```
轮1（会话甲）: "我们来聊聊天文学吧。"
  → 观察器派生词项集 {我们,们再,聊天,天文,文学,…}，兴趣#「聊聊/天文」(candidate, 证据1, 会话1)
轮2（会话乙）: "天文学的进展真快。"
  → 词项共享 {天文,文学} ≥2 → 并入同一兴趣；conversation_count=2
轮3（会话乙）: "关于天文学再多说一点。"
  → 证据3 + 会话2 → 晋升 active（事件 interest.promoted）
轮4（会话乙）: "继续。"
  → 请求系统提示包含 "Bounded long-term attention signal ... 天文（强度 0.xx，置信度 xx/100，依据 3 次）…"
     —— 上一轮的长期层更新真实进入下一轮请求载荷（测试断言请求体，非仅数据库值）
全程：event_journal 记录 interest.observed → interest.promoted → selfmodel.recorded → feeling.event_applied
```

对应测试：`tests/acceptance/scenarios.test.ts` scenario G；同类证据见 scenario A/B/E/H 与 `src/app/cognitive-loop.integration.test.ts`。

## 8. 提交与可追溯性

| 提交 | 内容 |
|---|---|
| `86e06b8` | 审计迁移基线（旧谱系尖端 40f70f8 选择性迁移 + 模块化重组，231 测试全绿） |
| `0fbccdf` | 模块01：事件日志、可观测性、启动失败处理、secrets 加固 |
| `b531280` | 模块02：本地 Provider + DeepSeek 双通道（v13 迁移、回环门禁上移、真实回环集成测试） |
| `c41158c` | 模块03/04/05：记忆溯源升级（v14）、感受事件入日志、兴趣/自我模型/有界反思（v15）、闭环接线 |
| `563c6e9` | 验收场景 A–H 自动化、双 Provider UI 修复、smoke 竞态修复 |
| （本提交） | 全部交付文档、CI、仓库配置 |

## 9. 已知阻塞项（详见 known-limitations.md）

- DeepSeek 真实 Key 端到端：**环境阻塞**（无凭据，不伪造）。
- Electron 打包安装器（nsis）未在本环境执行：electron-builder 需要额外下载与代码签名配置；`MORROW_SMOKE_EXECUTABLE` 通道已就绪，安装包验证留给具备签发条件的发布环境。
