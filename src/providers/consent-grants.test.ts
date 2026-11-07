import { describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../persistence/database'
import { applyMigrations } from '../persistence/migrations'
import { ConsentGrantService, SqliteConsentGrantRepository, consentScopeFingerprint, consentScopeForPreview } from './consent-grants'

const base = { action: 'chat' as const, providerId: 'profile-a', endpoint: 'https://relay.example.com/v1', model: 'model-a', maximumSensitivity: 'personal' as const }

function setup() {
  const database = SqliteDatabase.open(':memory:')
  applyMigrations(database.connection)
  let now = '2026-11-07T10:00:00.000Z'
  const service = new ConsentGrantService(new SqliteConsentGrantRepository(database), () => now)
  return { database, service, advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString() } }
}

describe('persistent consent scopes', () => {
  it('reuses a grant only for the same provider, endpoint, model, action and sensitivity scope', () => {
    const { database, service } = setup()
    try {
      expect(service.find(base)).toBeNull()
      const grant = service.grant(base)
      expect(service.find({ ...base })).toMatchObject({ scopeFingerprint: grant.scopeFingerprint })
      expect(service.find({ ...base, model: 'model-b' })).toBeNull()
      expect(service.find({ ...base, endpoint: 'https://other.example.com/v1' })).toBeNull()
      expect(service.find({ ...base, maximumSensitivity: 'sensitive' })).toBeNull()
      expect(service.find({ ...base, action: 'connection-test' })).toBeNull()
    } finally { database.close() }
  })

  it('fails closed after revocation and after expiry', () => {
    const { database, service, advance } = setup()
    try {
      const grant = service.grant(base)
      expect(service.revoke(grant.scopeFingerprint)).toBe(true)
      expect(service.find(base)).toBeNull()
      service.grant(base)
      advance(25 * 60 * 60 * 1000)
      expect(service.find(base)).toBeNull()
    } finally { database.close() }
  })

  it('fingerprints are stable and do not include message payload or credentials', () => {
    const scope = consentScopeForPreview({ ...base, payloadSha256: 'a'.repeat(64), exactPayload: '{"messages":[{"content":"private"}]}' } as never)
    expect(consentScopeFingerprint(scope)).toBe(consentScopeFingerprint({ ...base }))
    expect(consentScopeFingerprint(scope)).not.toContain('private')
    expect(consentScopeFingerprint(scope)).toHaveLength(64)
  })
})
