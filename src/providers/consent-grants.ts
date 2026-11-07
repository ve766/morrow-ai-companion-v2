/**
 * Persistent consent scope (Issue #63 §2).
 *
 * The old flow asked for every message because approval was bound to the exact
 * payload hash. That protects egress but makes normal chat unusable. A grant is
 * now bound to a stable scope — provider + endpoint + model + action +
 * maximum data sensitivity — never to message text or an API key. Any scope
 * change, expiry or explicit revocation requires a new dialog. The exact
 * payload hash is still generated and verified for each request.
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

export interface ConsentGrantRepositoryPort {
  all(): ConsentGrant[]
  find(fingerprint: string): ConsentGrant | null
  upsert(grant: ConsentGrant): void
  revoke(fingerprint: string, revokedAt: string): boolean
  revokeProvider(providerId: string, revokedAt: string): number
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

function mapRow(row: GrantRow): ConsentGrant {
  return {
    scopeFingerprint: row.scope_fingerprint,
    providerId: row.provider_id,
    action: row.action,
    endpoint: row.endpoint,
    model: row.model,
    maximumSensitivity: row.maximum_sensitivity as ConsentScope['maximumSensitivity'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  }
}

export class SqliteConsentGrantRepository implements ConsentGrantRepositoryPort {
  constructor(private readonly database: import('../persistence/database').SqliteDatabase) {}

  all(): ConsentGrant[] {
    return (this.database.connection.prepare('SELECT * FROM provider_consent_grants ORDER BY created_at DESC').all() as unknown as GrantRow[]).map(mapRow)
  }

  find(fingerprint: string): ConsentGrant | null {
    const row = this.database.connection.prepare('SELECT * FROM provider_consent_grants WHERE scope_fingerprint = ?').get(fingerprint) as GrantRow | undefined
    return row ? mapRow(row) : null
  }

  upsert(grant: ConsentGrant): void {
    this.database.connection.prepare(`
      INSERT INTO provider_consent_grants(scope_fingerprint, provider_id, action, endpoint, model, maximum_sensitivity, scope_json, created_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(scope_fingerprint) DO UPDATE SET
        provider_id = excluded.provider_id,
        action = excluded.action,
        endpoint = excluded.endpoint,
        model = excluded.model,
        maximum_sensitivity = excluded.maximum_sensitivity,
        scope_json = excluded.scope_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        revoked_at = NULL
    `).run(grant.scopeFingerprint, grant.providerId, grant.action, grant.endpoint, grant.model, grant.maximumSensitivity, JSON.stringify(grant), grant.createdAt, grant.expiresAt)
  }

  revoke(fingerprint: string, revokedAt: string): boolean {
    return Number(this.database.connection.prepare('UPDATE provider_consent_grants SET revoked_at = ? WHERE scope_fingerprint = ? AND revoked_at IS NULL').run(revokedAt, fingerprint).changes) === 1
  }

  revokeProvider(providerId: string, revokedAt: string): number {
    return Number(this.database.connection.prepare('UPDATE provider_consent_grants SET revoked_at = ? WHERE provider_id = ? AND revoked_at IS NULL').run(revokedAt, providerId).changes)
  }
}

export function consentScopeForPreview(preview: Pick<ProviderConsentPreview, 'action' | 'providerId' | 'endpoint' | 'model' | 'maximumSensitivity'>): ConsentScope {
  return {
    action: preview.action,
    providerId: preview.providerId,
    endpoint: preview.endpoint.trim(),
    model: preview.model.trim(),
    maximumSensitivity: preview.maximumSensitivity
  }
}

/** Stable, key-free fingerprint. Canonical key order is explicit. */
export function consentScopeFingerprint(scope: ConsentScope): string {
  const canonical = JSON.stringify({
    action: scope.action,
    providerId: scope.providerId,
    endpoint: scope.endpoint,
    model: scope.model,
    maximumSensitivity: scope.maximumSensitivity
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export class ConsentGrantService {
  constructor(
    private readonly repository: ConsentGrantRepositoryPort,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly ttlMs = 24 * 60 * 60 * 1000
  ) {}

  find(scope: ConsentScope): ConsentGrant | null {
    const at = this.safeTimestamp(this.clock())
    const grant = this.repository.find(consentScopeFingerprint(scope))
    if (!grant || grant.revokedAt !== null) return null
    return grant.expiresAt > at ? grant : null
  }

  grant(scope: ConsentScope): ConsentGrant {
    const now = this.safeTimestamp(this.clock())
    const grant: ConsentGrant = {
      scopeFingerprint: consentScopeFingerprint(scope),
      providerId: scope.providerId,
      action: scope.action,
      endpoint: scope.endpoint,
      model: scope.model,
      maximumSensitivity: scope.maximumSensitivity,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + this.ttlMs).toISOString(),
      revokedAt: null
    }
    this.repository.upsert(grant)
    return grant
  }

  revoke(fingerprint: string): boolean {
    return this.repository.revoke(fingerprint, this.safeTimestamp(this.clock()))
  }

  revokeProvider(providerId: string): number {
    return this.repository.revokeProvider(providerId, this.safeTimestamp(this.clock()))
  }

  list(): ConsentGrant[] {
    return this.repository.all()
  }

  private safeTimestamp(value: string): string {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new TypeError('Consent timestamp is invalid.')
    return new Date(parsed).toISOString()
  }
}
