# 项目工作报告 — Morrow AI Companion V2

- **报告日期**：2026-10-26
- **报告范围**：`morrow-ai-companion-v2` 主线（`main` @ `8b207b7`）现状核验与风险评估
- **核验环境**：Windows 10.0.26200 x64 · Node v22.22.2 · npm 10.x · Electron 44.9.3
- **核验方式**：克隆主干后在本机实际执行类型检查、全量测试、构建与两组离线评估；未修改任何源代码
- **结论摘要**：工程实现与文档严谨度高于同规模个人项目；本次核验**全部通过**。存在 3 项事实性不一致（版本号、CI 死步骤、README 过时表述）与 3 项产品层结构性短板（记忆召回精度、逐次同意摩擦、长期层无 UI）。建议按 §6 顺序处置。

---

## 1. 项目概况

| 项目 | 内容 |
|---|---|
| 定位 | 本地优先的桌面端 AI 陪伴应用，核心为「可追溯的认知闭环」 |
| 形态 | Electron 单应用模块化单体（无微服务、无外部后端） |
| 技术栈 | Electron 44 · TypeScript 5.8 · `node:sqlite`（Node 内置）· electron-vite 3 · vitest 5 |
| 代码规模 | 生产代码 15,579 行 / 67 文件；测试代码 7,054 行 / 40 文件 |
| 数据层 | SQLite 单文件，27 张领域表 + `schema_migrations`，迁移 v1–v15 |
| 对外接口 | 63 个白名单 IPC 通道 |
| 版本状态 | `package.json` 声明 1.0.0；README / CHANGELOG 声明 2.0.0（见 §5-P0-1） |
| 谱系 | 2026-10-25 建仓，全新 git 历史；代码自旧仓库 `morrow-ai-companion` 尖端 `40f70f8` 审计后选择性迁移 |

**工程取向**：本项目的设计重心不在对话质量，而在把「记忆 / 人格 / 内在状态 / 兴趣」构造为**可持久化、可回放、可审计的计算变量**。全部关键状态跨会话落库，每类状态变更经统一事件日志留痕。

---

## 2. 架构现状

### 2.1 分层

```
renderer (vanilla TS)
  └─ contextBridge ─ preload ─ 白名单 IPC ─ trusted-sender 校验
        └─ app/（装配根：窗口、IPC、服务构造、同意对话框）
              ├─ conversation / cognition / personality
              ├─ affective-state（内在状态引擎）
              ├─ memory（可追溯记忆）
              ├─ self-model（兴趣 / 自我模型 / 有界反思）
              ├─ motivation（目标审批、提醒）
              ├─ providers（DeepSeek remote + 本地回环 local）
              ├─ security / persistence / observability
```

依赖方向受明确约束（见 `docs/architecture/dependency-map.md`）：领域模块声明 Port，SQLite 实现置于 `persistence`，实现依赖倒置；任何模块不得 import `app/`；`providers` 不得 import `conversation/memory/cognition`。

### 2.2 单轮闭环

1. `analyzeCognitiveTurn` — 本地规则分析意图、话题引用、信号（纠正/改变主意/显式记忆/显式自我事实）
2. `MemoryService.assembleContext` — 词法 × 置信度 × 新近度排序，3000 字符预算，敏感度过滤
3. 读取长期层 — 人格版本、内在状态预衰减快照、活跃兴趣、未确认自我认识
4. 编排系统提示 — 人格偏好 + 轮次引导 + 状态引导 + 长期关注块 + 记忆证据 JSON + 固定原则；历史 12 条 / 6000 字符
5. **逐次同意** — 展示精确载荷、SHA-256、字节数、所含记忆与端点
6. 派发 — 同意后再装配一次并比对哈希（防 TOCTOU），不一致即拒绝
7. 流式回传 → 助手消息入库 → 感受事件同事务应用 → 兴趣观察 / 自我事实写入 → 事件日志
8. 下一轮读取上一轮的持久化结果

### 2.3 值得记录的两处理性设计

- **降级锚点具名化**：`DEGRADED_OPEN_MINIMUM_VERSION = 9` 是常量而非相对偏移，新增迁移失败时应用仍能以 v9 核心聊天能力打开。
- **观察性写入不阻塞主路径**：事件日志一律走 `tryRecord`（失败返回 `null`），认知/感受/兴趣任一环节异常均降级为「无该增强，聊天继续」。

---

## 3. 本次核验（实测）

### 3.1 执行记录

| 命令 | 结果 | 耗时 |
|---|---|---|
| `npx tsc --noEmit` | 通过，0 错误 | 11 s |
| `npx vitest run` | **40 文件 / 268 测试全部通过**，0 失败 | 21 s |
| `npx electron-vite build` | 通过（main / preload / renderer 三段产物） | 10 s |
| `node scripts/run-evaluation.mjs` | 通过 | 3 s |
| `node scripts/run-cognitive-core-evaluation.mjs` | 通过 | 3 s |

> 说明：首次以 `npm install --ignore-scripts` 安装时，4 个测试套件因缺少 Electron 二进制而 import 失败（`electron/index.js` 报 `Electron failed to install correctly`）。补执行 `node node_modules/electron/install.js` 后全量转绿。此项非代码缺陷，属安装方式副作用，已在 §5-P2-3 记录。

### 3.2 离线评估指标

| 数据集 | 用例 | 关键指标 | 门禁 |
|---|---|---|---|
| 记忆检索（morrow-synthetic-memory-retrieval） | 11 | precision 1.00 / recall 1.00（基线 substring 0.40 / 1.00）；来源泄漏、范围泄漏、受限泄漏均为 0 | passed |
| 提醒策略（m4） | 19 | precision 1.00 / recall 1.00 / 误报 0 / 安全泄漏 0 | passed |
| 轮次分析（cognitive-turn-synthetic-v1） | 26 | 意图、策略、纠正精度/召回均 1.00；确定性重放 true | passed |
| 内在状态（morrow-feeling-synthetic） | 34 | 事件分类、状态方向、注意方向均 1.00；用户情绪迁移 0；证据可追溯失败 0 | passed |
| 认知 Alpha 对抗（adversarial） | 28（19 安全关键） | 安全关键通过率 1.00；原始事件文本泄漏 0 | passed |

离线执行断言：`providerCalls=0`、`networkCalls=0`、`toolCalls=0`（评估全程无出口）。

### 3.3 对评估结论的限定

上述 1.00 的精度/召回**不构成泛化能力证据**：全部数据集为仓库自建合成 fixture，覆盖的是实现者对规则的理解，而非真实用户分布。评估报告自身已声明 `calibration.measured=false`（规则强度分与不确定性分桶未做概率校准，不主张 ECE / Brier 分数）。这一自我限定是本次核验中**值得肯定的诚实设计**，评审时应连带引用，勿单独摘取 1.00。

---

## 4. 风险与成熟度评估

| 维度 | 评价 | 依据 |
|---|---|---|
| 安全边界 | **强** | CSP + sandbox + `nodeIntegration:false`；IPC trusted-sender 含 mainFrame 校验；本地 Provider 端点靠 URL 文本自证回环（不做 DNS 信任、拒绝内嵌凭据、拒绝 IPv4-mapped）；载荷 ≤64KB；凭据仅存 safeStorage 加密文件，冒烟断言数据库无明文 |
| 数据主权 | **强** | 单文件 SQLite + WAL + `secure_delete`；删除边界日志在备份恢复后重放；冒烟断言 IPC 响应不含 apiKey |
| 可追溯性 | **强** | append-only `event_journal`；记忆修订链线性；感受事件带幂等键与前/后状态；兴趣 findings 全带证据引用 |
| 迁移可靠性 | **强** | v1–v15 只增不改；CHECK 变更走「重建表 + 具名迁移」；外来实现线库 fail-closed；升级前 `VACUUM INTO` 自动备份 |
| 测试纪律 | **中上** | 268 测试全绿，含真实 `127.0.0.1` HTTP 集成与真实 Electron 冒烟；但评估集为合成数据，无真实用户回归 |
| 认知能力 | **中** | 意图/信号识别为手写正则 + 停用词表（中英双语），非模型驱动；覆盖度受表达式穷举限制 |
| 产品完整度 | **中下** | 兴趣 / 自我模型能力齐全但无 UI；逐次同意对高频对话构成显著摩擦 |
| 可维护性 | **中** | 模块边界清晰、注释质量高；但 `scripts/smoke.mjs` 单文件 73 KB，renderer 为手写 DOM 无组件化 |

---

## 5. 发现的问题

### P0 — 事实性不一致（影响交付物与对外表述）

**P0-1 版本号三处不一致**
`package.json:3` 为 `"version": "1.0.0"`，README §许可与状态 与 CHANGELOG 均为 `2.0.0`。`src/app/index.ts:62` 使用 `app.getVersion()` 读取 package.json，因此：
- 设置页/关于处显示的版本号将为 1.0.0
- `electron-builder` 产物名将为 `Morrow-Setup-1.0.0-x64.exe`（`build.win.artifactName` 引用 `${version}`）

建议：将 `package.json` 版本改为 `2.0.0` 并打 `v2.0.0` tag，或在文档侧统一降为 1.0.0。二者取一，不宜长期并存。

**P0-2 CI 中 `npm rebuild better-sqlite3` 为死步骤**
`.github/workflows/ci.yml` 的两个 job 均包含该步骤，但 V2 已切换至 `node:sqlite`，`package.json` / `package-lock.json` 中均无 `better-sqlite3` 依赖。该命令对不存在的包静默成功（实测退出码 0），不产生任何效果，仅延长 CI 时间并误导读者以为存在原生模块。

建议：删除两个 job 中的该步骤。

**P0-3 文档残留 V1 表述**
- `README.md` §安装与运行：「`npm install` # 含 Electron 二进制与 **better-sqlite3 预编译模块**」
- `docs/testing/acceptance-report.md` §5：「**better-sqlite3 原生模块**：npm 预编译二进制直接可用，无需本地编译工具链」

二者均为 V1 遗留。V2 使用 Node 内置 `node:sqlite`，不存在原生编译环节——这恰是 V2 的技术收益之一，被旧表述抵消。

建议：改为「依赖 Node ≥22.13 内置 `node:sqlite`，无原生模块编译需求」。

### P1 — 影响产品体验的结构性短板

**P1-1 记忆召回被词面重叠硬过滤**
`src/memory/memory-context-assembler.ts:55` 存在 `.filter((item) => item.score > 0)`：当前消息与被检索记忆**零词面重叠时，该记忆完全不进入上下文**。

后果：用户曾保存「我住在杭州」，此后讨论任何不含「杭州/住」字面的话题时，该事实不会被注入。对「陪伴」这一定位，这是核心能力缺口——真正的陪伴需要「无需提示即在场」的稳定事实。

建议：拆为双层——(a) 小型「常驻核心事实」集（用户标记为 always-on，或高置信度 + 高敏感度许可者）无条件注入；(b) 现有词面检索负责长尾召回。二者共享同一 3000 字符预算并按优先级分配。

**P1-2 每轮云端请求强制人工同意**
`ChatService.send` 在每次派发前调用 `authorize(preview)`，用户取消即抛 `FORBIDDEN`。安全上无可指摘（这是本项目最强的防护之一），但对连续对话场景意味着每条消息一次弹窗。

建议：保留「首次/载荷显著变化时确认」的语义，对同一会话内**载荷类别未变**（同一 provider、未新增敏感记忆、字节数增量在阈值内）的请求提供「本会话内不再询问」选项，并把授权范围与失效条件在 UI 上明示。此改动须与安全边界一同评审，不建议单独实施。

**P1-3 长期层能力无 UI**
兴趣（列表/状态控制）、自我模型（纠正/撤销）、手动反思（触发/查看 findings）均已通过 IPC 完整暴露（`morrow:selfmodel:*` 共 8 个通道），但渲染层无对应视图。用户当前**无法在 GUI 内看到系统「记住了什么兴趣、认为自己知道什么」**。

建议：新增只读「洞察」面板（兴趣列表 + 自我认识条目 + 最近反思 findings），不做编辑以外的写操作，成本可控而收益直接。

### P2 — 工程债

**P2-1 `scripts/smoke.mjs` 单文件 73 KB**
真实 Electron 冒烟覆盖凭据生命周期、认知 opt-in、记忆、目标、提醒、删除与重启，但全部逻辑集中于一个脚本，且重启就绪判定依赖 7 秒状态文本轮询（`known-limitations.md` #9 已自述）。建议按场景拆分为 `smoke/` 目录，就绪判定改用 IPC 事件。

**P2-2 renderer 无组件化**
`index.html` 24 KB + 5 个 UI 模块（companion 32 KB、reminders 17 KB、goals 14 KB、main 13 KB、backup 5.7 KB）全部手写 DOM。当前规模尚可维护，但 P1-3 新增面板后复杂度将上升。建议至少抽出渲染工具层（`renderList` / `bindForm` 等）。

**P2-3 安装方式副作用**
`npm install --ignore-scripts` 会跳过 Electron 二进制下载（`postinstall` 中的 `scripts/ensure-electron.mjs` 不执行），导致 4 个套件 import 失败。CI 对此有正确规避（单独 `node node_modules/electron/install.js`），但本地开发者容易踩坑。建议在 README 的验证章节补一行提示。

---

## 6. 建议处置顺序

| 优先级 | 事项 | 工作量估计 | 风险 |
|---|---|---|---|
| 1 | 统一版本号（P0-1） | 极小 | 无 |
| 2 | 删除 CI 死步骤 + 修正 README/验收报告表述（P0-2、P0-3） | 极小 | 无 |
| 3 | 记忆召回双层化（P1-1） | 中 | 需新增「常驻」标记与迁移，注意预算分配回归 |
| 4 | 洞察面板（P1-3） | 中 | 只读，风险低；可先于 P1-2 |
| 5 | 同意策略优化（P1-2） | 中大 | **须与安全边界联合评审**，不可单方面放宽 |
| 6 | smoke 拆分、renderer 抽层（P2） | 中大 | 纯重构，可在功能间隙进行 |

**不建议做的事**：把认知分析从正则换成语义模型。当前规则引擎的确定性是可回放、可离线评估、可解释的前提，替换会同时失去这三项性质；若要提升理解能力，更稳妥的路径是**扩充评估集到真实语料**，先量化规则的真实边界，再决定是否引入模型。

---

## 7. 结论

1. 项目在**安全、数据主权、可追溯性、迁移可靠性**四个维度达到可交付水准，且这些性质由自动化测试与真实 Electron 冒烟共同守住，不是文档承诺。
2. 三处 P0 不一致均属「V1→V2 迁移的收尾遗漏」，不涉及架构，建议立即清理，否则会污染发布产物与对外叙事。
3. 真正的短板在**产品层**：记忆召回靠字面、确认靠每次弹窗、长期层不可见。这三项共同决定了「陪伴感」的上限，而工程地基已经足够支撑修复。
4. 评估体系诚实（自陈合成数据与未校准），但因此**当前不具备真实效果结论**。若要对外宣称效果，必须先补齐真实语料回归。

---

## 附录 A — 核验提交

| 提交 | 说明 |
|---|---|
| `86e06b8` | 自旧谱系尖端 `40f70f8` 审计迁移（seed） |
| `0fbccdf` | 模块 01：事件日志、可观测性、启动失败处理、secrets 加固 |
| `b531280` | 模块 02：本地 Provider + DeepSeek 双通道（v13） |
| `c41158c` | 模块 03/04/05：记忆溯源（v14）、感受事件入日志、兴趣/自我模型/反思（v15） |
| `563c6e9` | 验收场景 A–H 自动化、双 Provider UI、smoke 竞态修复 |
| `95641c0` | 交付文档、安全策略、CI |
| `aa74d0f` / `8b207b7` | CI：Linux xvfb 与跨平台 smoke |

## 附录 B — 复现方式

```bash
git clone https://github.com/ve766/morrow-ai-companion-v2.git
cd morrow-ai-companion-v2
npm install                 # 需 Node >= 22.13
npm run typecheck
npm test                    # 40 files / 268 tests
npm run evaluate
npm run evaluate:cognition
npm run build
npm run smoke               # 真实 Electron（需图形环境）
```

`npm run verify` 为上述链的一体化入口。数据库与 `node:sqlite` 会打印 `ExperimentalWarning`，属预期行为。
