# 07 · 验收矩阵

| 项 | 状态 | 说明 |
|---|---|---|
| 首次授权 | PASS | 真实弹窗一次 |
| 同 scope 后续 0 弹窗 | PASS | 真实第二条无弹窗完成 |
| 30 天 TTL | PASS | grant expires 2026-12-07 |
| sensitive 不复用 | PASS_UNIT | service returns null |
| 撤销/过期 | PASS_UNIT | tests |
| grant lookup p95<10ms | NOT_RUN | 未 benchmark |
| 单次 prepare | PASS（代码） | snapshot 复用；未计数 benchmark |
| 1000 记忆 <150ms / 5x | NOT_RUN | 无 benchmark |
| TTFT p50/p95 | NOT_RUN | 无 headers/first byte 计时 |
| renderer 首 delta <50ms | NOT_RUN | 无 instrumentation |
| 真实 Provider 10 次 | PARTIAL | 多次真实 turn，但非同条件 10 次计时 |
