# 01 · 授权根因与策略

根因：旧 `authorize()` 每轮绑定完整 payload hash；消息/上下文变化 → hash 变化 → 每条都弹窗；批准后再次 prepare。

策略：

- scope = sha256(action + providerId + endpoint + model + maximumSensitivity)；不含 key/正文/payload。
- normal/personal chat 30 天；sensitive 永不长期复用；connection-test/discovery 不在 scope（仅 action=chat）。
- 每次发送仍由 `assessProviderRequest` 计算并校验当前 payload hash；grant 不替代完整性校验。
- 撤销/过期/配置变化 → find null → 重新弹窗。
- 读取失败 fail-closed（service 异常向上；无授权）。
- 真实结果见 `results/consent-evaluation.json`。
