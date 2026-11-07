# 01 · 分支、PR 与权威基线

| 对象 | SHA | 说明 |
|---|---|---|
| 默认分支 `main` | `8b207b7d7b80b91ed4369d02fd6ef7e170b81133` | 184 tracked entries；不是最新产品代码 |
| PR #62 base `feat/morrow-v2-product-complete-20261106` | `68468cf...`（创建时） | 产品交付目标分支 |
| PR #62 head `feat/morrow-v2-product-closure-20261107` | `e1d85137...` | 本任务权威实现起点 |
| PR #64 base | `e1d85137...` | 与 PR #62 head 相同 |
| PR #64 head | `b63c998...` | OPEN；self-model/consent PARTIAL；未自动合并 |
| 本任务分支 | `feat/whole-project-return-to-core-20261107` | 从 `e1d85137...` 建立 |

依赖关系：

```text
main (8b207b7)
  └─ feat/morrow-v2-product-complete-20261106 (PR #62 target)
       └─ feat/morrow-v2-product-closure-20261107 (PR #62 head, e1d8513)
            ├─ feat/ai-life-core-upgrade-20261107 (PR #64, b63c998, OPEN)
            └─ feat/whole-project-return-to-core-20261107 (本任务)
```

本任务实际变更：

- 身份契约 `src/app/companion-service.ts` + `identity-contract.test.ts`；
- 只移植 v53 schema（`self-model-states-and-consent-scopes`）以兼容已迁移的 acceptance DB；
- 未移植 PR #64 的 self-model/consent 业务代码；未合并/关闭 PR #64；
- 未修改 `main`/`release/*`。

注意：`main` 与产品分支相差 336 commits（GitHub compare 文件列表上限 300，不代表总变更数）；不能把 main 当权威产品代码。
