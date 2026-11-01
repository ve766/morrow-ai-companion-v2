# Stage 3 快照落地记录

- 时间：2026-11-01T03:5xZ
- 仓库：`ve766/morrow-ai-companion-v2`
- 分支：`feat/stage-3-long-term-companion`
- 基线：`7f219a7`（`docs(c1): record what the intent reading does, and what it still cannot do`）

## 两个提交

| commit | 内容 | 规模 |
|---|---|---|
| `9ac4bd5` | C1 评测与实现：`semantic.ts`、`run.ts` 断言改写、`shared/real-provider.ts` 边界修复、`intent-reading.ts` / `context-window.ts`、provider-retry、`tests/c1-mainchain.test.ts`、`package.json` / `tsconfig.json` / `vitest.config.ts` | 17 文件，+1670 / −267 |
| `bb3c150` | 六份报告 + 登记表与契约更新 + 两套件结果与 traces + 重新生成的离线评估报告 | 27 文件，+5770 / −331 |

本文件本身写在第三个提交里（`docs(stage-3): add the snapshot-to-commit record`）——一份记录无法写下自己的 SHA，这正好是它存在的理由：下一个读到这里的人，用 `git log -1 -- docs/reports/stage-3-commit-record.md` 就能补上。

## 这一条要记住

`docs/reports/stage-3-final-verification.md` 等文件里写着"工作树无 `.git`，`codeCommit: "unknown"`"。那句话描述的是**撰写时**的状态，不是现在的状态，**也不是错误**。

结果文件里的 `codeCommit: "unknown"` / `workingTree: "unknown"` 是那几次运行的真实记录。**不能事后填成 `9ac4bd5`**——它们当时确实是在一个没有身份的树里跑出来的。把 unknown 改成具体 SHA 等于伪造证据。要消除这个空洞，只有一条路：在 `9ac4bd5` 这棵树上重跑，让新结果自己写下真实的 SHA。

## 未纳入的内容

- `node_modules/`、`out/`、`.tmp/`、`.upload/`（构建产物与暂存）。
- 工作树里的 `.tmp/WHERE_TO_PUT_KEY.txt`（见凭据审计：它教人把 key 落盘，与单一凭据入口冲突，建议删除而非提交）。

## 未改变的事实

Stage 3 仍是 **PARTIAL**。本次提交只是让这批结论第一次有了可追溯的 commit，不改变任何一条状态：C1 语义证据仍 `BLOCKED_NO_SECRET`，人工复核仍 `PENDING`，CI 仍因账号计费未启动。**PR #19 仍不得合并。**
