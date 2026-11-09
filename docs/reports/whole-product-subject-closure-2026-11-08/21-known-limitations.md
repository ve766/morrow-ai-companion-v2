# 最终限制（Issue #78）

- P0-A 仅做直接 root/owner 校验与 cluster 去重；递归祖先环、缺失祖先、retracted root 的完整 DAG 校验和传播未实现。
- P0-C 只覆盖 inner cognition 的 conversation delete；reflection findings/routes、self-state 依赖、mood per-source 重建、outbox 执行时 source-validity 复查未统一。
- P0-D inner cognition 仍在 assistant commit 后单独调用；没有 durable inner_cognition outbox effect。
- P1-B user style 仍双写 G1/G2；用户“更直接”可能影响 intrinsic personality，未修复。
- P1-C 无完整 investigation 状态机；goal stall 未接真实 CompanionGoal 时间。
- P1-D 100/500/1000/5000 memory benchmark NOT_RUN；无 Dense/PPR。
- P1-E 真实 cloud Provider NOT_RUN；自定义 NSIS PE/Nullsoft 有效但安装 exit 2（BUILT_NOT_INSTALL_VERIFIED）；electron-builder NSIS 504；原生 consent 对话框点击 PENDING_HUMAN。
- 报告/矩阵的 source/tested/final SHA 在本轮最终 commit 后统一；文档 commit 不冒充代码 commit。
