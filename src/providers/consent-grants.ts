/**
 * Persistent consent scope (Issue #69 P1).
 *
 * Normal/personal chat may be remembered for 30 days for the exact provider,
 * endpoint, protocol/model and sensitivity scope. Sensitive data is NEVER
 * covered by a long grant: it still requires a per-request confirmation.
 * The API key, message text and payload hash are not part of the scope.
 */
import { createHash } from 'node:crypto'
import type { ProviderAction, ProviderConsentPreview } from './provider-policy'

export interface ConsentScope {
  action: ProviderAction
  providerId: string
  endpoint: string
  model: string
  maximumSensitivity: 'normal' | 'personal' | 'sensitive'
}

export interface ConsentGrant {
  scopeFingerprint: string
  providerId: string
  action: string
  endpoint: string
  model: string
  maximumSensitivity: ConsentScope['maximumSensitivity']
  createdAt: string
  expiresAt: string
  revokedAt: string | null
}

interface GrantRow {
  scope_fingerprint: string
  provider_id: string
  action: string
  endpoint: string
  model: string
  maximum_sensitivity: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export function consentScopeForPreview(preview: Pick<ProviderConsentPreview, 'action' | 'providerId' | 'endpoint' | 'model' | 'maximumSensitivity'>): ConsentScope {
  return { action: preview.action, providerId: preview.providerId, endpoint: preview.endpoint.trim(), model: preview.model.trim(), maximumSensitivity: preview.maximumSensitivity }
}

export function consentScopeFingerprint(scope: ConsentScope): string {
  return createHash('sha256').update(JSON.stringify({ action: scope.action, providerId: scope.providerId, endpoint: scope.endpoint, model: scope.model, maximumSensitivity: scope.maximumSensitivity })).digest('hex')
}

export class SqliteConsentGrantRepository {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}
  all(): ConsentGrant[] {
    return (this.database.connection.prepare('SELECT * FROM provider_consent_grants ORDER BY created_at DESC').all() as unknown as GrantRow[]).map((row) => ({ scopeFingerprint: row.scope_fingerprint, providerId: row.provider_id, action: row.action, endpoint: row.endpoint, model: row.model, maximumSensitivity: row.maximum_sensitivity as ConsentScope['maximumSensitivity'], createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at }))
  }
  find(fingerprint: string): ConsentGrant | null {
    const row = this.database.connection.prepare('SELECT * FROM provider_consent_grants WHERE scope_fingerprint = ?').get(fingerprint) as GrantRow | undefined
    return row ? { scopeFingerprint: row.scope_fingerprint, providerId: row.provider_id, action: row.action, endpoint: row.endpoint, model: row.model, maximumSensitivity: row.maximum_sensitivity as ConsentScope['maximumSensitivity'], createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at } : null
  }
  upsert(grant: ConsentGrant): void {
    this.database.connection.prepare(`INSERT INTO provider_consent_grants(scope_fingerprint, provider_id, action, endpoint, model, maximum_sensitivity, scope_json, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(scope_fingerprint) DO UPDATE SET provider_id=excluded.provider_id, action=excluded.action, endpoint=excluded.endpoint, model=excluded.model, maximum_sensitivity=excluded.maximum_sensitivity, scope_json=excluded.scope_json, created_at=excluded.created_at, expires_at=excluded.expires_at, revoked_at=NULL`).run(grant.scopeFingerprint, grant.providerId, grant.action, grant.endpoint, grant.model, grant.maximumSensitivity, JSON.stringify(grant), grant.createdAt, grant.expiresAt)
  }
  revoke(fingerprint: string, at: string): boolean { return Number(this.database.connection.prepare('UPDATE provider_consent_grants SET revoked_at = ? WHERE scope_fingerprint = ? AND revoked_at IS NULL').run(at, fingerprint).changes) === 1 }
  revokeProvider(providerId: string, at: string): number { return Number(this.database.connection.prepare('UPDATE provider_consent_grants SET revoked_at = ? WHERE provider_id = ? AND revoked_at IS NULL').run(at, providerId).changes) }
}

export class ConsentGrantService {
  constructor(private readonly repository: SqliteConsentGrantRepository, private readonly clock: () => string = () => new Date().toISOString(), private readonly ttlMs = 30 * 24 * 60 * 60 * 1000) {}

  find(scope: ConsentScope): ConsentGrant | null {
    if (scope.maximumSensitivity === 'sensitive') return null
    const now = this.safe(this.clock())
    const grant = this.repository.find(consentScopeFingerprint(scope))
    if (!grant || grant.revokedAt !== null) return null
    return grant.expiresAt > now ? grant : null
  }

  grant(scope: ConsentScope): ConsentGrant | null {
    if (scope.maximumSensitivity === 'sensitive') return null
    const now = this.safe(this.clock())
    const grant: ConsentGrant = { scopeFingerprint: consentScopeFingerprint(scope), providerId: scope.providerId, action: scope.action, endpoint: scope.endpoint, model: scope.model, maximumSensitivity: scope.maximumSensitivity, createdAt: now, expiresAt: new Date(Date.parse(now) + this.ttlMs).toISOString(), revokedAt: null }
    this.repository.upsert(grant)
    return grant
  }

  revoke(fingerprint: string): boolean { return this.repository.revoke(fingerprint, this.safe(this.clock())) }
  revokeProvider(providerId: string): number { return this.repository.revokeProvider(providerId, this.safe(this.clock())) }
  list(): ConsentGrant[] { return this.repository.all() }

  private safe(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Consent timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}
