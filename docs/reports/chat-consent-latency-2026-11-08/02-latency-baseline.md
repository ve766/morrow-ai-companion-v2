# 02 · 延迟基线

- 旧发送路径：prepare → consent → prepare（第二次），未在修改前记录分段耗时。
- 因此 baseline 标记 PARTIAL，不伪造 p95。
- 现有 trace 样本只覆盖阶段，不含 IPC/renderer 首 delta；见 `results/latency-after.json`。
