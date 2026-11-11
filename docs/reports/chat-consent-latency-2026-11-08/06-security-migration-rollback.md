# 06 · 安全、迁移、回滚

- 使用既有 v53 `provider_consent_grants` 表；无新 migration。
- grant 不含 key/正文；撤销即时（revoked_at）；敏感每次确认。
- 删除 profile/凭据撤销 provider grants 未接入本基线（service 有 revokeProvider；无 UI/接线）→ PARTIAL。
- 回滚：删除 grant 行/revoked_at 即阻断；未改用户聊天/记忆。
