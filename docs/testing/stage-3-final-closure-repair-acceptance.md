# Final Closure 修复验收矩阵（收口轮）

对象:closure 修复轮 HEAD(完整 SHA 见 PR #19;注意——CI workflow 提交 `4e8547a` 存在于本地分支,推送被 workflow scope 拒绝,当前远端 head 为其父提交 `f96f2e3`,**业务代码与 4e8547a 完全一致**)。

| 线 | 验证 | 结果 |
|---|---|---|
| A 抽取 | `fact-memory.test.ts`(9 用例:多事实/保守性/revision 溯源) | PASS |
| B 生命周期 | 撤回不复活/重放×10/删除无孤儿/correct supersedes/restore 重开 | PASS |
| C 检索 | 60 场景 closure 套件(同义/代词/长间隔/多会话/更新/撤回/冲突/噪音/时限/无证据+J1 重放) | **60/60 PASS**(extraction 1.0、recall@2 1.0、MRR≈0.95、误注入 0) |
| D 证据门 | 集成+套件逐 case 分类断言(四类互斥+manifest) | PASS |
| E 真实模型 | 八类 live 重跑(12 调用 0 错误,绑定 8f662e2):J3 拒绝正确识别、J4/J5 证据使用、J8 三维(接受纠正+承认旧值)、J1 行为发现留 rubric、J2/J7 字面信号留 rubric | AWAITING_MANUAL_REVIEW |
| F 反思 | observeConsumption(used_observed 需确定性证据)+注入轮 join | PASS |
| G G1/G2 | 修复轮集成测试未回退(D-1 六断言) | PASS |
| H 持久化 | 迁移谱系 v1→v41、v41 升级、CASCADE、幂等 | PASS |
| I CI | **BLOCKED_WORKFLOW_SCOPE**:4e8547a 已本地提交七套件门禁;推送需 scope;解锁 `gh auth refresh -h github.com -s workflow` → `git push` | BLOCKED |
| 真人复核 | **PENDING**(final-closure-review.md) | PENDING |

## 命令与退出码

`tsc --noEmit`=0 · `vitest run --no-file-parallelism` =0(TEMP 重定向;865+ 断言;`offline-evaluation.test.ts` 文件级装载失败=本机 esbuild %TEMP% 拒写,重定向后通过)· `electron-vite build`=0 · `eval:stage3:final-closure`=0(60/60)· 七套件=0 · `eval:final-closure:live`=0(修复后 12 调用 0 错误)

## 决策:**BLOCKED**

代码侧(A–H)全部完成;唯一阻断=真人复核 + CI workflow scope(外部条件)。不包装成 GO;PR #19 保持 OPEN。


---

# 追加：复核补充轮验收（A–E）

| 项 | 结果 | 证据 |
|---|---|---|
| A 索引失败处理 | PASS | fact-index-faults.test.ts 4 用例（脱敏事件/退避恢复/窗口不热循环/降级扫描命中）+ v42 |
| B provenance | PASS | 同文件 B 用例（create→revision→fact 全链 source_message_id=真实 id；correct 无 provenance=legacy）+ accept 路径接线 |
| C 查询收窄 | PASS | closure 套件 60/60（含 F59/F60 断言值对照）；候选收窄至 residence/employer |
| D CI | BLOCKED_WORKFLOW_SCOPE | 本地提交 4e8547a；远端无 Stage 3 门禁的事实如实记录 |
| E 真实模型 | AWAITING_MANUAL_REVIEW | 重跑结果绑定本轮 SHA；J1 原则补强；J3/J7 拒绝语境判定；真人 rubric PENDING |
