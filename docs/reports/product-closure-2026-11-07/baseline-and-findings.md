# Issue #61 基线与发现

- 任务：Morrow V2 当前产品交付修复 + UI 改造总任务
- 目标分支（Issue）：`feat/morrow-v2-product-complete-20261106`
- 开工实测 HEAD：`68468cfca95b90b33707fe2dd50c6ee1bcc6fb44`
- 本任务开发分支：`feat/morrow-v2-product-closure-20261107`
- 日期：2026-11-07
- 最终 commit：以本任务 PR / Issue #61 评论中的 SHA 为准

## 1. 开工事实核查

| 项 | 实测 | 来源 |
|---|---|---|
| 目标分支 HEAD | `68468cfca95b90b33707fe2dd50c6ee1bcc6fb44` | `git rev-parse HEAD` |
| 工作树 | 干净（开工时） | `git status --short` |
| schema | v52 | `src/persistence/migrations.ts`、证据 DB `schema_migrations` |
| 全量测试（修复后） | 137 files / 1190 tests PASS | `npm test`（`TMP/TEMP=.tmp/esbuild-tmp`） |
| self-hosted workflow | `.github/workflows/self-hosted-ci.yml` 只存在于特性分支 | `gh run list` 404 on default branch |
| Runner | 未注册 | #56/#57 最新评论均标记 PARTIAL / PENDING_USER_ACTION |
| Windows 宿主 | 11 Build 26200，窗口会被宿主最小化 | Issue #60 历史证据 + 本轮采样 |
| 真实 Provider | 本机已有用户提供的 Spark 自定义 Provider | 既有 DB profile + 真实对话 |

## 2. 已确认缺陷 / 缺口

### P1 CI Guard

- 原 guard 只允许 `feat/morrow-v2-final-closure` 和 `ci-self-hosted-*` tag；目标分支 dispatch 会被跳过，verify 因 `needs.guard.result != success` 不执行，但工作流可能显示为成功。
- 工作流只存在于特性分支，GitHub 默认分支没有该 workflow；`gh run list` 返回 404，当前无法从 UI/API dispatch。
- Runner 未注册；即使 workflow 在默认分支，也无法产生真实 steps/log。

### P1 Windows 窗口

- 窗口创建后只有 `ready-to-show -> show`，没有显式状态机；`minimize/restore/hide/close` 竞态无保护。
- 没有 `second-instance` 处理：二次启动获得 lock 失败后直接退出，首个窗口不会聚焦/恢复。
- 没有窗口 bounds 持久化/越界恢复；历史坐标可能把窗口放到屏幕外。
- host 在 Build 26200 自动最小化，CDP 可操作不等于用户可见（Issue #60 已记录）。

### P2 文档 / 验收

- README 写 migration v1–v15、90+ files / 890+ tests、DeepSeek 单一入口，均过期。
- `docs/testing/known-limitations.md` 仍写“兴趣/自我模型无专属渲染面板”，实际 `self-model-ui.ts` 已接入。
- `package.json` 的 `verify` 不包含 `smoke:product-path` 和阶段专项评估；没有 manifest/聚合汇总。
- 评估/smoke 在本机 `%TEMP%` 下会因 esbuild 写入 `Access is denied` 失败；需显式 TMP/TEMP 或安装路径规避。

### P2 UI

- 改造前是 2/3 栏管理面板 + 右侧 inspector，信息密度高、装饰多；与用户提供的 Claude 参考文件布局不一致。
- 缺少界面博物馆主题组件（3D 透视、全息、粗野、拼贴、等离子）。
- 关键控件缺少稳定 `data-testid` 与控件契约源文件。

## 3. 基线限制（不随本轮自动关闭）

- Issue #56/#57：self-hosted Runner 未注册，CI 真实 NSIS/run 未发生；仍为 PARTIAL/PENDING_USER_ACTION。
- Issue #60：Windows 窗口自动最小化；人工可见桌面验收仍受环境阻塞。
- 本任务不合并 PR、不发 Release、不修改 main/release、不 force-push。
