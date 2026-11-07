# 04 · Prepare 与检索优化

- prepared snapshot 在 consent 前生成；批准后只检查 config/conversation/settings 未变并复用；变化抛 CONFLICT，不重新 prepare。
- 保留 payload hash 校验；不会重复 append/计费。
- 记忆冲突两两比较未优化；100/500/1000/5000 benchmark 未跑；NOT_RUN。
- 四通道 RRF 保持不变。
