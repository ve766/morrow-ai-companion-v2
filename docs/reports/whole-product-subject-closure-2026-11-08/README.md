# Morrow V2 全项目交付（Issue #76 / #78 最终审计整改）

- Issue #78：https://github.com/ve766/morrow-ai-companion-v2/issues/78
- 分支：`fix/audit-driven-companion-remediation-20261109`（从 PR #77 HEAD `1b7ba08` 建立）
- PR：https://github.com/ve766/morrow-ai-companion-v2/pull/80（Draft，stacked on #77，base `fix/core-subjectivity-final-closure-20261109`）
- 状态：**PARTIAL**
- 最新报告：`15-audit-driven-remediation.md`、`16-evidence-lineage-deletion-and-recovery.md`、`17-mood-personality-exploration.md`、`18-memory-provider-ui-windows-validation.md`、`19-acceptance-matrix.json`、`20-machine-results.json`、`21-known-limitations.md`

## Issue #78 实际修复

- Reflection gate 改为 fail-closed：从持久化 finding evidence 解析 root/owner，未知/伪造/非 Morrow 来源拒绝；独立数按 root/correlation cluster，不按 runId。
- Synthetic thought 不再伪造 conversation/turn/message UUID；synthetic refs 不计独立 context、不产生 reward；Shared/User interest 不生成 Morrow thought，X1 shared 排除。
- Conversation deletion 删除相关 thoughts、retract 相关 states；affect/trait 删除已有路径；reflection/mood 全量重建仍 PARTIAL。
- Mood：pause 前结算衰减；paused 自动事件抑制；persisted evaluatedAt/lastAdvancedAt 单调；重复 pause/resume、重启、时钟回拨测试。
- 未修复：P0-D inner cognition durable outbox、P1-B G1/G2 分离、P1-C 完整 investigation、P1-D memory benchmark、P1-E installer install verification。

旧 Issue #76/PR #77 的交付说明保留在下方历史段落。

# 历史：Issue #74 / PR #75 交付

- Issue：https://github.com/ve766/morrow-ai-companion-v2/issues/74
- 实现分支：`fix/whole-product-subject-closure-20261108`
- PR：https://github.com/ve766/morrow-ai-companion-v2/pull/75（Draft，base `fix/morrow-core-cognitive-closure-20261108`）
- 源分支起点：`83dab6ad8b2af3b0a2d98ceb9eb342ee5f081691`（PR #73）
- base：`efdbf52a25e896ee159d296944f019f9b94ab687`（PR #68）
- 源代码 commit：b8ba65558f0e3b7a49b9cc27be354bac1525c2d1
- 最终交付 HEAD：见 Issue #76 最终评论（代码/tested commit 见 `11-machine-results.json`）
- 总体状态：**PARTIAL**

## 本轮真实修复

1. P0 chat UI E2E：真实 built Electron → renderer 输入/发送 → preload → IPC → `ChatService` → loopback SSE Provider → 流式渲染 → SQLite 持久化；`npm run smoke:chat-ui` PASS。
2. Provider consent：原生对话框增加 `取消 / 仅本次 / 记住 30 天`；sensitive 始终单次且默认取消；设置页列出/撤销 grant。
3. 情绪/人格 UI：设置页查看当前情绪与 trait，对单条情绪缓解/撤销，清除情绪/人格/奖励记录。
4. 用户探索所有权：用户 `intent=exploration` 不再变成 Morrow-owned curiosity/trait 证据。
5. 生产反证：对已 active trait，Morrow-owned failure appraisal 写 counter observation；active→weakened，可追溯。
6. Reward/affect 原子性：promoted thought 的 reward + progress affect 同一 transaction；失败回滚，不留半状态。
7. Trait freshness：消息删除级联 observation 后，下一次读取立即 recompute。
8. 第二轮：reflection finding → evidence gate → `morrow_self_states` revision；自主问题从 Morrow interest/reflection 生成；evidence derivation lineage；v56 独立 continuous mood + pause/resume + UI。
9. 第三轮：reflection 独立数改 root/correlation cluster（不再 runId）；Shared/User 不生成 Morrow thought；Mood pause 先结算衰减；新增 13/14 报告。
8. UI contract：新控件加入 `docs/ui/control-contract.json` 和 `tests/ui-control-contract.test.ts`。

## 验证（同一最终代码）

- `npm run typecheck` PASS
- `npm test` PASS：149 files / 1259 tests
- `npm run build` PASS
- `npm run smoke:chat-ui` PASS（真实 Electron + loopback SSE + 持久化）
- `npm run smoke:product-path` PASS（Provider profile/OS 密钥/重启/隔离 profile）
- portable `release/win-unpacked` product-path PASS
- electron-builder NSIS：**BLOCKED**（504）；手动编译 NSIS `Morrow-2.0.0-x64-custom-setup.exe` 158,383,287 bytes SHA `b5c222b7...`，PE/Nullsoft 有效但静默安装 exit 2，**BUILT_NOT_INSTALL_VERIFIED**；旧 189KB stub 不冒充
- 真实 cloud Provider A–K：NOT_RUN
- 记忆 100/500/1000/5000 benchmark：NOT_RUN

## 报告索引

- `00-baseline-and-repository-map.md`
- `01-source-audit-and-callgraph.md`
- `02-ui-ipc-provider-acceptance.md`
- `03-cognitive-evidence-closure.md`
- `04-affect-personality-closure.md`
- `05-algorithm-math-review.md`
- `06-memory-retrieval-benchmarks.md`
- `07-security-privacy-migration-rollback.md`
- `08-windows-build-and-smoke.md`
- `09-adversarial-review-round-2.md`
- `10-acceptance-matrix.json`
- `11-machine-results.json`
- `12-known-limitations.md`
- `13-autonomous-cognition-lifecycle.md`
- `14-runtime-integration-map.md`
- `results/`：原始命令日志

## 结论

用户现在可以在 Windows 上打开深色工作台、配置 loopback Provider、实际发送并看到流式回复；聊天经历进入 affect/trait 账本并在下一轮相关上下文读取。consent/affect UI 已接通。主体闭环仍有 reflection finding 写回、mood 独立层、真实 cloud A–K、NSIS installer 等缺口，因此整体 **PARTIAL**，不是“全部完成”。
